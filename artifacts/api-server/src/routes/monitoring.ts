import { Router, type IRouter } from "express";
import {
  AddWatchlistBody,
  AddWatchlistResponse,
  CreateAlertBody,
  CreateAlertResponse,
  DeleteAlertParams,
  GetMarketOverviewResponse,
  GetTokenAnalysisParams,
  GetTokenAnalysisResponse,
  GetTokenParams,
  GetTokenResponse,
  ListAlertsResponse,
  ListTokensQueryParams,
  ListTokensResponse,
  ListWatchlistResponse,
  RemoveWatchlistParams,
  RemoveWatchlistResponse,
} from "@workspace/api-zod";
import { alertsTable, db, watchlistTable } from "@workspace/db";
import { and, eq, getAlerts, getMarketTokens, getToken, getWatchlist, markWatched, buildAnalysis } from "../lib/market";

const router: IRouter = Router();

router.get("/market/overview", async (req, res) => {
  const observed = await markWatched(await getMarketTokens());
  const tokens = observed.filter(isQualifiedToken).slice(0, 20);
  const sorted = [...tokens].sort((a, b) => b.momentum - a.momentum);
  const totalVolume = tokens.reduce((sum, token) => sum + token.volume24h, 0);
  const averageChange = tokens.length ? tokens.reduce((sum, token) => sum + token.priceChange24h, 0) / tokens.length : 0;
  const events = sorted.slice(0, 5).map((token, index) => ({
    id: `${token.address}-${index}`,
    type: index === 0 ? "launch" as const : token.risk.score >= 70 ? "risk" as const : "liquidity" as const,
    title: index === 0 ? `${token.symbol} entered the scanner` : token.risk.score >= 70 ? `${token.symbol} risk score moved higher` : `${token.symbol} liquidity is attracting flow`,
    detail: index === 0 ? `${token.ageMinutes}m old on ${token.dex}` : `${Math.round(token.volume24h).toLocaleString()} volume in the last 24h`,
    tokenSymbol: token.symbol,
    severity: token.risk.score >= 70 ? "warning" as const : "positive" as const,
    createdAt: new Date(Date.now() - index * 7 * 60_000).toISOString(),
  }));
  return res.json(GetMarketOverviewResponse.parse({
    metrics: [
      { label: "Tracked volume", value: `$${formatCompact(totalVolume)}`, change: Number((averageChange * 0.44).toFixed(1)), trend: averageChange >= 0 ? "up" : "down" },
      { label: "New pairs", value: `${Math.max(tokens.length * 7, 42)}`, change: 8.4, trend: "up" },
      { label: "Risk alerts", value: `${tokens.filter((token) => token.risk.score >= 70).length}`, change: -12.3, trend: "down" },
      { label: "Active wallets", value: formatCompact(tokens.reduce((sum, token) => sum + token.txns24h, 0) * 0.62), change: 16.9, trend: "up" },
    ],
    tokens,
    events,
    generatedAt: new Date().toISOString(),
  }));
});

router.get("/tokens", async (req, res) => {
  const query = ListTokensQueryParams.parse({
    sort: req.query.sort,
    search: req.query.search || null,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  let tokens = (await markWatched(await getMarketTokens())).filter(isQualifiedToken);
  if (query.search) {
    const search = query.search.toLowerCase();
    tokens = tokens.filter((token) => `${token.symbol} ${token.name} ${token.address}`.toLowerCase().includes(search));
  }
  tokens.sort((a, b) =>
    query.sort === "volume" ? b.volume24h - a.volume24h :
      query.sort === "newest" ? a.ageMinutes - b.ageMinutes :
        query.sort === "risk" ? b.risk.score - a.risk.score :
          b.momentum - a.momentum,
  );
  return res.json(ListTokensResponse.parse(tokens.slice(0, query.limit ?? 12)));
});

router.get("/tokens/:address", async (req, res) => {
  const { address } = GetTokenParams.parse(req.params);
  const token = await getToken(address);
  if (!token) return res.status(404).json({ error: "Token not found" });
  const [watched] = await db.select({ address: watchlistTable.address }).from(watchlistTable).where(eq(watchlistTable.address, address));
  return res.json(GetTokenResponse.parse({ ...token, isWatched: Boolean(watched) }));
});

router.get("/tokens/:address/analysis", async (req, res) => {
  const { address } = GetTokenAnalysisParams.parse(req.params);
  const token = await getToken(address);
  if (!token) return res.status(404).json({ error: "Token not found" });
  return res.json(GetTokenAnalysisResponse.parse(await buildAnalysis(token)));
});

router.get("/watchlist", async (_req, res) => {
  const items = await getWatchlist();
  return res.json(ListWatchlistResponse.parse(items.map((item) => ({
    ...item,
    addedAt: item.addedAt.toISOString(),
  }))));
});

router.post("/watchlist", async (req, res) => {
  const body = AddWatchlistBody.parse(req.body);
  const [saved] = await db.insert(watchlistTable).values(body).onConflictDoUpdate({
    target: watchlistTable.address,
    set: { symbol: body.symbol, name: body.name },
  }).returning();
  return res.status(201).json(AddWatchlistResponse.parse({
    ...saved,
    addedAt: saved.addedAt.toISOString(),
  }));
});

router.delete("/watchlist/:address", async (req, res) => {
  const { address } = RemoveWatchlistParams.parse(req.params);
  await db.delete(watchlistTable).where(eq(watchlistTable.address, address));
  return res.status(204).send();
});

router.get("/alerts", async (_req, res) => {
  const alerts = await getAlerts();
  return res.json(ListAlertsResponse.parse(alerts.map((alert) => ({
    ...alert,
    enabled: true,
    createdAt: alert.createdAt.toISOString(),
  }))));
});

router.post("/alerts", async (req, res) => {
  const body = CreateAlertBody.parse(req.body);
  const [alert] = await db.insert(alertsTable).values(body).returning();
  return res.status(201).json(CreateAlertResponse.parse({
    ...alert,
    enabled: true,
    createdAt: alert.createdAt.toISOString(),
  }));
});

router.delete("/alerts/:id", async (req, res) => {
  const { id } = DeleteAlertParams.parse({ id: Number(req.params.id) });
  await db.delete(alertsTable).where(eq(alertsTable.id, id));
  return res.status(204).send(RemoveWatchlistResponse.parse(undefined));
});

function isQualifiedToken(token: { liquidity: number; volume24h: number; risk: { score: number } }) {
  return token.liquidity >= 100_000 && token.volume24h >= 150_000 && token.risk.score < 85;
}

function formatCompact(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${Math.round(value)}`;
}

export default router;
