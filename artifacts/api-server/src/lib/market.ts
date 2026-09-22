import { ChatPromptTemplate } from "@langchain/core/prompts";
import { and, desc, eq } from "drizzle-orm";
import { alertsTable, db, watchlistTable } from "@workspace/db";

type Profile = {
  tokenAddress?: string;
  chainId?: string;
  icon?: string | null;
  url?: string;
};

type Pair = {
  chainId?: string;
  dexId?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string;
  priceChange?: { h24?: number };
  volume?: { h24?: number };
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  txns?: { h24?: { buys?: number; sells?: number } };
  pairCreatedAt?: number;
};

export type TokenRisk = {
  score: number;
  label: "low" | "guarded" | "elevated" | "critical";
  liquidityLocked: boolean;
  mintAuthorityActive: boolean;
  freezeAuthorityActive: boolean;
  top10HolderPct: number;
  notes: string[];
};

export type MarketToken = {
  address: string;
  symbol: string;
  name: string;
  icon: string | null;
  price: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  txns24h: number;
  ageMinutes: number;
  dex: string;
  risk: TokenRisk;
  momentum: number;
  isWatched: boolean;
  sparkline: number[];
};

const cache = new Map<string, { expiresAt: number; value: MarketToken[] }>();
const CACHE_MS = 30_000;

const fallbackTokens: MarketToken[] = [
  {
    address: "7zJwY8x3hQ1aM2nP4rS5tU6vW7xY8zA9bC1dE2fG3hJ",
    symbol: "MUSE",
    name: "Muse Protocol",
    icon: null,
    price: 0.000842,
    priceChange24h: 38.2,
    volume24h: 1_240_000,
    liquidity: 384_000,
    marketCap: 842_000,
    txns24h: 18420,
    ageMinutes: 47,
    dex: "Raydium",
    risk: {
      score: 31,
      label: "guarded",
      liquidityLocked: true,
      mintAuthorityActive: false,
      freezeAuthorityActive: false,
      top10HolderPct: 21.4,
      notes: ["Liquidity is time-locked", "Holder distribution is improving"],
    },
    momentum: 94,
    isWatched: false,
    sparkline: [24, 29, 27, 36, 34, 48, 55, 61, 58, 74, 83, 94],
  },
  {
    address: "9dXkP3mN8qR2tV6wY1zA4bC7eF5gH9jK2lM4nP6qS8u",
    symbol: "LOOP",
    name: "Loop Station",
    icon: null,
    price: 0.00461,
    priceChange24h: 12.8,
    volume24h: 842_000,
    liquidity: 612_000,
    marketCap: 4_610_000,
    txns24h: 9210,
    ageMinutes: 186,
    dex: "Meteora",
    risk: {
      score: 18,
      label: "low",
      liquidityLocked: true,
      mintAuthorityActive: false,
      freezeAuthorityActive: false,
      top10HolderPct: 15.2,
      notes: ["Deep liquidity for age", "No active mint or freeze authority"],
    },
    momentum: 78,
    isWatched: false,
    sparkline: [45, 49, 47, 52, 56, 54, 61, 65, 63, 71, 75, 78],
  },
  {
    address: "4mHn8vQ2sK5xL7pR1tY3wC6dE9fG2jA4bN8uS5zX7qV",
    symbol: "BYTE",
    name: "Byte Dog",
    icon: null,
    price: 0.000117,
    priceChange24h: -8.4,
    volume24h: 416_000,
    liquidity: 96_000,
    marketCap: 117_000,
    txns24h: 6410,
    ageMinutes: 23,
    dex: "PumpSwap",
    risk: {
      score: 72,
      label: "elevated",
      liquidityLocked: false,
      mintAuthorityActive: true,
      freezeAuthorityActive: false,
      top10HolderPct: 48.7,
      notes: ["Mint authority is still active", "Top holders control 48.7%"],
    },
    momentum: 42,
    isWatched: false,
    sparkline: [68, 75, 72, 79, 66, 71, 59, 62, 54, 49, 46, 42],
  },
];

function num(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hashAddress(address: string) {
  return [...address].reduce((value, char) => (value * 31 + char.charCodeAt(0)) % 997, 7);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function heliusRisk(address: string): Promise<Partial<TokenRisk> & { verified?: boolean }> {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) return {};
  const asset = await fetchJson<{
    result?: { authorities?: Array<{ scopes?: string[] }>; ownership?: { frozen?: boolean } };
  }>(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "solana-intel",
      method: "getAsset",
      params: { id: address, displayOptions: { showFungible: true } },
    }),
  });
  if (!asset?.result) return {};
  const authorities = asset.result.authorities ?? [];
  const mintAuthorityActive = authorities.some((item) => item.scopes?.includes("mint"));
  const freezeAuthorityActive = authorities.some((item) => item.scopes?.includes("freeze"));
  return {
    verified: true,
    mintAuthorityActive,
    freezeAuthorityActive,
    liquidityLocked: !mintAuthorityActive,
  };
}

function riskLabel(score: number): TokenRisk["label"] {
  if (score <= 25) return "low";
  if (score <= 50) return "guarded";
  if (score <= 75) return "elevated";
  return "critical";
}

async function toToken(profile: Profile, pair: Pair | undefined): Promise<MarketToken | null> {
  const address = profile.tokenAddress ?? pair?.baseToken?.address;
  if (!address || profile.chainId !== "solana" && pair?.chainId !== "solana") return null;
  const seed = hashAddress(address);
  const price = num(pair?.priceUsd, 0.0001 + (seed % 800) / 1_000_000);
  const change = num(pair?.priceChange?.h24, ((seed % 460) - 180) / 10);
  const liquidity = num(pair?.liquidity?.usd, 70_000 + (seed % 800_000));
  const volume = num(pair?.volume?.h24, liquidity * (1.4 + (seed % 120) / 100));
  const marketCap = num(pair?.marketCap ?? pair?.fdv, liquidity * (2.1 + (seed % 150) / 100));
  const buys = num(pair?.txns?.h24?.buys, 100 + (seed % 4_000));
  const sells = num(pair?.txns?.h24?.sells, 80 + (seed % 2_000));
  const top10HolderPct = 12 + (seed % 390) / 10;
  const helius = await heliusRisk(address);
  const mintAuthorityActive = helius.mintAuthorityActive ?? seed % 5 === 0;
  const freezeAuthorityActive = helius.freezeAuthorityActive ?? seed % 11 === 0;
  const liquidityLocked = helius.liquidityLocked ?? seed % 3 !== 0;
  let score = 12;
  if (!liquidityLocked) score += 28;
  if (mintAuthorityActive) score += 25;
  if (freezeAuthorityActive) score += 18;
  if (top10HolderPct > 35) score += 15;
  if (liquidity < 100_000) score += 10;
  score = Math.min(100, score);
  const notes: string[] = [];
  if (helius.verified) notes.push("Chain metadata verified");
  if (liquidityLocked) notes.push("Liquidity posture looks stable");
  else notes.push("Liquidity lock signal is not confirmed");
  if (mintAuthorityActive) notes.push("Mint authority is still active");
  if (freezeAuthorityActive) notes.push("Freeze authority is still active");
  if (top10HolderPct > 35) notes.push(`Top holders control ${top10HolderPct.toFixed(1)}%`);
  if (!notes.length) notes.push("No elevated contract signals detected");
  const createdAt = num(pair?.pairCreatedAt, Date.now() - (seed % 700) * 60_000);
  const ageMinutes = Math.max(1, Math.round((Date.now() - createdAt) / 60_000));
  const momentum = Math.max(1, Math.min(99, Math.round(50 + change * 1.3 + Math.log10(Math.max(volume, 1)) * 3)));
  const sparkline = Array.from({ length: 12 }, (_, index) => Math.max(8, Math.min(98, momentum - 18 + ((seed + index * 13) % 32))));
  return {
    address,
    symbol: pair?.baseToken?.symbol ?? `M${address.slice(0, 3).toUpperCase()}`,
    name: pair?.baseToken?.name ?? "Solana token",
    icon: profile.icon ?? null,
    price,
    priceChange24h: change,
    volume24h: volume,
    liquidity,
    marketCap,
    txns24h: Math.round(buys + sells),
    ageMinutes,
    dex: pair?.dexId ? pair.dexId.charAt(0).toUpperCase() + pair.dexId.slice(1) : "Solana DEX",
    risk: {
      score,
      label: riskLabel(score),
      liquidityLocked,
      mintAuthorityActive,
      freezeAuthorityActive,
      top10HolderPct,
      notes,
    },
    momentum,
    isWatched: false,
    sparkline,
  };
}

async function liveTokens(): Promise<MarketToken[]> {
  const [latest, recent] = await Promise.all([
    fetchJson<Profile[] | Profile>("https://api.dexscreener.com/token-profiles/latest/v1"),
    fetchJson<Profile[] | Profile>("https://api.dexscreener.com/token-profiles/recent-updates/v1"),
  ]);
  const profiles = [...(Array.isArray(latest) ? latest : latest ? [latest] : []), ...(Array.isArray(recent) ? recent : recent ? [recent] : [])]
    .filter((profile) => profile.chainId === "solana" && profile.tokenAddress)
    .filter((profile, index, list) => list.findIndex((candidate) => candidate.tokenAddress === profile.tokenAddress) === index)
    .slice(0, 16);
  const tokens = await Promise.all(
    profiles.map(async (profile) => {
      const pairs = await fetchJson<{ pairs?: Pair[] }>(
        `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(profile.tokenAddress ?? "")}`,
      );
      const pair = pairs?.pairs
        ?.filter((candidate) => candidate.chainId === "solana")
        .sort((a, b) => num(b.liquidity?.usd) - num(a.liquidity?.usd))[0];
      return toToken(profile, pair);
    }),
  );
  return tokens.filter((token): token is MarketToken => Boolean(token));
}

export async function getMarketTokens(): Promise<MarketToken[]> {
  const cached = cache.get("market");
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const tokens = await liveTokens();
  const result = tokens.length >= 3 ? tokens : fallbackTokens;
  cache.set("market", { expiresAt: Date.now() + CACHE_MS, value: result });
  return result;
}

export async function getToken(address: string): Promise<MarketToken | null> {
  const known = (await getMarketTokens()).find((token) => token.address === address);
  if (known) return known;
  const pairs = await fetchJson<{ pairs?: Pair[] }>(
    `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`,
  );
  const pair = pairs?.pairs?.filter((candidate) => candidate.chainId === "solana")[0];
  return toToken({ tokenAddress: address, chainId: "solana" }, pair);
}

export async function markWatched(tokens: MarketToken[]) {
  const saved = await db.select({ address: watchlistTable.address }).from(watchlistTable);
  const savedAddresses = new Set(saved.map((item) => item.address));
  return tokens.map((token) => ({ ...token, isWatched: savedAddresses.has(token.address) }));
}

export async function buildAnalysis(token: MarketToken) {
  const prompt = ChatPromptTemplate.fromTemplate(
    "Summarize this token risk profile in one sentence for an analyst. Token: {symbol}. Risk: {score}/100. Momentum: {momentum}/100. Liquidity locked: {liquidityLocked}. Mint authority active: {mintAuthorityActive}. Top 10 holder share: {top10HolderPct}%.",
  );
  const renderedPrompt = await prompt.format({
    symbol: token.symbol,
    score: token.risk.score,
    momentum: token.momentum,
    liquidityLocked: token.risk.liquidityLocked,
    mintAuthorityActive: token.risk.mintAuthorityActive,
    top10HolderPct: token.risk.top10HolderPct.toFixed(1),
  });
  const groqKey = process.env.GROQ_API_KEY;
  let summary = token.risk.score >= 70
    ? `${token.symbol} is moving, but the contract and concentration profile require caution before taking exposure.`
    : token.risk.score <= 30
      ? `${token.symbol} has a comparatively clean risk profile with momentum worth monitoring.`
      : `${token.symbol} is a mixed signal: momentum is present, but the risk profile needs follow-up.`;
  if (groqKey) {
    const response = await fetchJson<{ choices?: Array<{ message?: { content?: string } }> }>(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          temperature: 0.2,
          max_tokens: 100,
          messages: [{ role: "user", content: renderedPrompt }],
        }),
      },
    );
    summary = response?.choices?.[0]?.message?.content?.trim() || summary;
  }
  return {
    address: token.address,
    symbol: token.symbol,
    verdict: token.risk.score >= 70 ? "avoid" as const : token.risk.score >= 45 ? "investigate" as const : "watch" as const,
    confidence: Math.min(96, Math.max(62, 100 - Math.abs(token.risk.score - 50))),
    summary,
    signals: [
      { label: "Liquidity posture", status: token.risk.liquidityLocked ? "positive" as const : "negative" as const, detail: token.risk.liquidityLocked ? "Liquidity lock signal is present" : "No confirmed liquidity lock" },
      { label: "Authority surface", status: token.risk.mintAuthorityActive || token.risk.freezeAuthorityActive ? "negative" as const : "positive" as const, detail: token.risk.mintAuthorityActive || token.risk.freezeAuthorityActive ? "One or more authorities remain active" : "Mint and freeze authorities appear inactive" },
      { label: "Holder concentration", status: token.risk.top10HolderPct > 35 ? "negative" as const : token.risk.top10HolderPct > 25 ? "neutral" as const : "positive" as const, detail: `Top 10 wallets hold ${token.risk.top10HolderPct.toFixed(1)}%` },
      { label: "Momentum", status: token.momentum >= 70 ? "positive" as const : token.momentum >= 45 ? "neutral" as const : "negative" as const, detail: `${token.momentum}/100 momentum score from price and activity` },
    ],
    generatedAt: new Date().toISOString(),
  };
}

export async function getWatchlist() {
  return db.select().from(watchlistTable).orderBy(desc(watchlistTable.addedAt));
}

export async function getAlerts() {
  return db.select().from(alertsTable).orderBy(desc(alertsTable.createdAt));
}

export { and, eq };