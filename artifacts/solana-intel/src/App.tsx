import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  BookMarked,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Database,
  ExternalLink,
  Eye,
  FileSearch,
  Gauge,
  LineChart,
  ListFilter,
  LoaderCircle,
  Menu,
  Plus,
  Radar,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import {
  getGetMarketOverviewQueryKey,
  getGetTokenAnalysisQueryKey,
  getGetTokenQueryKey,
  getListAlertsQueryKey,
  getListTokensQueryKey,
  getListWatchlistQueryKey,
  useAddWatchlist,
  useCreateAlert,
  useDeleteAlert,
  useGetMarketOverview,
  useGetToken,
  useGetTokenAnalysis,
  useHealthCheck,
  useListAlerts,
  useListTokens,
  useListWatchlist,
  useRemoveWatchlist,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import './index.css';

const queryClient = new QueryClient();

const navItems = [
  { href: '/', label: 'Market overview', icon: Radar },
  { href: '/tokens', label: 'Token scanner', icon: LineChart },
  { href: '/watchlist', label: 'Watchlist', icon: Star },
  { href: '/alerts', label: 'Alert rules', icon: Bell },
];

function formatMoney(value = 0, compact = false) {
  if (compact) {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  }
  if (value < 0.01) return `$${value.toFixed(8)}`;
  if (value < 1) return `$${value.toFixed(4)}`;
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function formatAgo(value?: string) {
  if (!value) return '—';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

function shortAddress(address = '') {
  return address.length > 13 ? `${address.slice(0, 5)}…${address.slice(-4)}` : address;
}

function initials(symbol = '?') {
  return symbol.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?';
}

function TokenAvatar({ symbol, icon, size = 'md' }: { symbol: string; icon?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-7 w-7 text-[10px]', md: 'h-9 w-9 text-xs', lg: 'h-14 w-14 text-lg' };
  return icon ? (
    <img data-testid={`img-token-${symbol}`} src={icon} alt="" className={`${sizes[size]} rounded-md object-cover ring-1 ring-border`} />
  ) : (
    <div data-testid={`avatar-token-${symbol}`} className={`${sizes[size]} flex shrink-0 items-center justify-center rounded-md bg-primary font-mono font-medium text-primary-foreground`}>
      {initials(symbol)}
    </div>
  );
}

function Sparkline({ points, positive = true }: { points?: number[]; positive?: boolean }) {
  const values = points?.length ? points : [4, 5, 4, 6, 7, 6, 8, 9, 8, 10];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const path = values.map((point, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = 28 - ((point - min) / range) * 23;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg aria-hidden="true" className="h-8 w-24 overflow-visible" viewBox="0 0 100 30" preserveAspectRatio="none">
      <path d={path} fill="none" stroke={positive ? 'hsl(72 74% 42%)' : 'hsl(4 74% 53%)'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Badge({ children, tone = 'neutral' }: { children: string; tone?: 'neutral' | 'positive' | 'warning' | 'critical' | 'lime' }) {
  const tones = {
    neutral: 'bg-secondary text-muted-foreground',
    positive: 'bg-[hsl(150_42%_88%)] text-[hsl(154_54%_27%)]',
    warning: 'bg-[hsl(39_94%_88%)] text-[hsl(28_78%_34%)]',
    critical: 'bg-[hsl(4_80%_91%)] text-[hsl(4_70%_40%)]',
    lime: 'bg-accent text-accent-foreground',
  };
  return <span className={`inline-flex items-center rounded-sm px-2 py-1 font-mono text-[10px] uppercase tracking-[.08em] ${tones[tone]}`}>{children}</span>;
}

function riskTone(label?: string): 'positive' | 'warning' | 'critical' | 'neutral' {
  if (label === 'low') return 'positive';
  if (label === 'guarded') return 'warning';
  if (label === 'critical') return 'critical';
  return 'neutral';
}

function LoadingPanel({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" data-testid="loading-panel">
      {Array.from({ length: rows }).map((_, index) => <div className="skeleton h-16 rounded-lg" key={index} />)}
    </div>
  );
}

function ErrorPanel({ onRetry, label = 'Signal feed unavailable' }: { onRetry?: () => void; label?: string }) {
  return (
    <div className="obs-card flex min-h-36 flex-col items-center justify-center gap-3 p-6 text-center" data-testid="status-error">
      <AlertTriangle className="h-5 w-5 text-destructive" />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-1 text-xs text-muted-foreground">The observer could not reach the latest market state.</p>
      </div>
      {onRetry && <button data-testid="button-retry" onClick={onRetry} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium transition hover:border-accent hover:bg-accent/20"><RefreshCw className="h-3.5 w-3.5" />Retry scan</button>}
    </div>
  );
}

function EmptyPanel({ icon: Icon = Database, title, detail }: { icon?: typeof Database; title: string; detail: string }) {
  return (
    <div className="obs-card flex min-h-48 flex-col items-center justify-center px-6 text-center" data-testid="status-empty">
      <div className="mb-3 rounded-full border border-dashed border-border p-3 text-muted-foreground"><Icon className="h-5 w-5" /></div>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: watchlist } = useListWatchlist();
  const watchCount = watchlist?.length ?? 0;

  const closeMobile = () => setMobileOpen(false);
  return (
    <div className="noise min-h-[100dvh] bg-background">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-200 md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-[76px] items-center justify-between border-b border-sidebar-border px-6">
          <Link href="/" onClick={closeMobile} className="flex items-center gap-3" data-testid="link-brand">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground"><Radar className="h-4 w-4" /></div>
            <div>
              <div className="font-display text-[15px] font-semibold tracking-tight">SOL / INTEL</div>
              <div className="font-mono text-[9px] uppercase tracking-[.22em] text-sidebar-foreground/50">market observatory</div>
            </div>
          </Link>
          <button className="rounded p-1 text-sidebar-foreground/60 md:hidden" onClick={closeMobile} data-testid="button-close-menu"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-4 pb-5 pt-7">
          <div className="mb-3 px-3 font-mono text-[10px] uppercase tracking-[.16em] text-sidebar-foreground/40">Workspace</div>
          <nav className="space-y-1">
            {navItems.map(({ href, label, icon: Icon }) => {
              const active = href === '/' ? location === '/' : location.startsWith(href);
              return (
                <Link key={href} href={href} onClick={closeMobile} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`} className={`group flex items-center justify-between rounded-md px-3 py-2.5 text-sm transition ${active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'}`}>
                  <span className="flex items-center gap-3"><Icon className={`h-4 w-4 ${active ? 'text-sidebar-primary' : ''}`} />{label}</span>
                  {label === 'Watchlist' && <span className={`font-mono text-[10px] ${active ? 'text-sidebar-primary' : 'text-sidebar-foreground/35'}`}>{watchCount}</span>}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="mt-auto p-4">
          <div className="rounded-md border border-sidebar-border bg-sidebar-accent/50 p-3">
            <div className="flex items-center gap-2 text-xs font-medium"><span className="dot-pulse h-1.5 w-1.5 rounded-full bg-sidebar-primary" />Solana mainnet</div>
            <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-sidebar-foreground/45"><span>RPC latency</span><span className="text-sidebar-primary/80">184 ms</span></div>
            <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-sidebar-foreground/45"><span>Indexer</span><span className="text-sidebar-primary/80">synced</span></div>
          </div>
          <div className="mt-4 flex items-center gap-2 px-2 font-mono text-[9px] uppercase tracking-[.13em] text-sidebar-foreground/30"><CircleHelp className="h-3.5 w-3.5" />Signal confidence is not advice</div>
        </div>
      </aside>
      {mobileOpen && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-[hsl(222_29%_16%/.45)] md:hidden" onClick={closeMobile} data-testid="button-dismiss-menu" />}
      <main className="min-h-[100dvh] md:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-border/80 bg-background/90 px-5 backdrop-blur-md md:px-9">
          <div className="flex items-center gap-3">
            <button className="rounded-md border border-border p-2 md:hidden" onClick={() => setMobileOpen(true)} data-testid="button-open-menu"><Menu className="h-4 w-4" /></button>
            <div className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-[hsl(72_70%_40%)]" />Live market feed</div>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="hidden font-mono text-[10px] sm:inline">UTC {new Date().toISOString().slice(11, 16)}</span>
            <div className="h-4 w-px bg-border" />
            <span className="flex items-center gap-1.5 font-mono text-[10px]"><Activity className="h-3.5 w-3.5 text-[hsl(72_70%_40%)]" /> observing</span>
          </div>
        </header>
        <div className="page-enter mx-auto max-w-[1500px] px-5 py-7 md:px-9 md:py-9">{children}</div>
      </main>
    </div>
  );
}

function PageHeading({ kicker, title, detail, action }: { kicker: string; title: string; detail: string; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-col justify-between gap-5 border-b border-border/80 pb-7 lg:flex-row lg:items-end">
      <div>
        <div className="eyebrow mb-2">{kicker}</div>
        <h1 className="font-display text-3xl font-semibold tracking-[-.04em] text-foreground md:text-4xl">{title}</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{detail}</p>
      </div>
      {action}
    </div>
  );
}

function MetricStrip({ metrics }: { metrics?: Array<{ label: string; value: string; change: number; trend: string }> }) {
  if (!metrics?.length) return <EmptyPanel title="No market metrics" detail="The observer is waiting for a fresh market snapshot." />;
  return (
    <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
      {metrics.slice(0, 4).map((metric) => (
        <div className="bg-card p-4" key={metric.label} data-testid={`metric-${metric.label.toLowerCase().replaceAll(' ', '-')}`}>
          <div className="eyebrow">{metric.label}</div>
          <div className="mt-2 flex items-end justify-between gap-2">
            <span className="data-value text-xl font-medium tracking-tight">{metric.value}</span>
            <span className={`flex items-center gap-0.5 font-mono text-[10px] ${metric.change >= 0 ? 'text-[hsl(154_54%_27%)]' : 'text-destructive'}`}>
              {metric.change >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(metric.change).toFixed(1)}%
            </span>
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-secondary"><div className="signal-line h-full rounded-full" style={{ width: `${Math.min(100, Math.max(8, 50 + metric.change * 2))}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function TokenTable({ tokens, onWatch, pendingAddress }: { tokens: any[]; onWatch?: (token: any) => void; pendingAddress?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[780px] text-left">
        <thead className="border-b border-border bg-secondary/40">
          <tr className="eyebrow">
            <th className="px-4 py-3 font-normal">Asset</th><th className="px-4 py-3 font-normal">Price / 24h</th><th className="px-4 py-3 font-normal">Momentum</th><th className="px-4 py-3 font-normal">Volume</th><th className="px-4 py-3 font-normal">Liquidity</th><th className="px-4 py-3 font-normal">Risk</th><th className="px-4 py-3 font-normal text-right">Track</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {tokens.map((token) => (
            <tr className="group transition hover:bg-accent/10" key={token.address} data-testid={`row-token-${token.symbol}`}>
              <td className="px-4 py-3">
                <Link href={`/tokens/${token.address}`} className="flex items-center gap-3" data-testid={`link-token-${token.symbol}`}>
                  <TokenAvatar symbol={token.symbol} icon={token.icon} />
                  <span><span className="block text-sm font-semibold">{token.symbol}</span><span className="block font-mono text-[10px] text-muted-foreground">{token.name} · {token.dex}</span></span>
                </Link>
              </td>
              <td className="px-4 py-3"><span className="data-value block text-sm">{formatMoney(token.price)}</span><span className={`font-mono text-[10px] ${token.priceChange24h >= 0 ? 'text-[hsl(154_54%_27%)]' : 'text-destructive'}`}>{token.priceChange24h >= 0 ? '+' : ''}{token.priceChange24h.toFixed(2)}%</span></td>
              <td className="px-4 py-3"><div className="flex items-center gap-2"><Sparkline points={token.sparkline} positive={token.priceChange24h >= 0} /><span className="data-value text-xs">{token.momentum}</span></div></td>
              <td className="data-value px-4 py-3 text-xs">${formatMoney(token.volume24h, true)}</td>
              <td className="data-value px-4 py-3 text-xs">${formatMoney(token.liquidity, true)}</td>
              <td className="px-4 py-3"><Badge tone={riskTone(token.risk?.label)}>{token.risk?.label ?? 'unknown'}</Badge></td>
              <td className="px-4 py-3 text-right">
                {onWatch && <button onClick={() => onWatch(token)} disabled={pendingAddress === token.address} className={`rounded-md border p-2 transition ${token.isWatched ? 'border-accent bg-accent/20 text-foreground' : 'border-border text-muted-foreground hover:border-accent hover:text-foreground'} disabled:opacity-50`} data-testid={`button-watch-${token.symbol}`} aria-label={`${token.isWatched ? 'Remove' : 'Add'} ${token.symbol} watchlist`}>
                  {pendingAddress === token.address ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Star className={`h-3.5 w-3.5 ${token.isWatched ? 'fill-current' : ''}`} />}
                </button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityFeed({ events }: { events?: any[] }) {
  return (
    <div className="obs-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-card-border px-5 py-4"><div><div className="eyebrow">Event stream</div><h2 className="mt-1 text-sm font-semibold">Market activity</h2></div><Activity className="h-4 w-4 text-muted-foreground" /></div>
      {events?.length ? <div className="divide-y divide-border/70">{events.slice(0, 6).map((event) => (
        <div className="flex gap-3 px-5 py-4" key={event.id} data-testid={`event-${event.id}`}>
          <div className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm ${event.severity === 'critical' ? 'bg-destructive/10 text-destructive' : event.severity === 'positive' ? 'bg-[hsl(150_42%_88%)] text-[hsl(154_54%_27%)]' : event.severity === 'warning' ? 'bg-[hsl(39_94%_88%)] text-[hsl(28_78%_34%)]' : 'bg-secondary text-muted-foreground'}`}><Zap className="h-3 w-3" /></div>
          <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><p className="text-xs font-semibold">{event.title}</p><span className="shrink-0 font-mono text-[9px] text-muted-foreground">{formatAgo(event.createdAt)}</span></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{event.detail}</p><span className="mt-2 inline-block font-mono text-[10px] text-foreground/60">${event.tokenSymbol}</span></div>
        </div>
      ))}</div> : <EmptyPanel icon={Activity} title="No activity in the window" detail="New launches, liquidity shifts, and whale movements will appear here." />}
    </div>
  );
}

function Overview() {
  const market = useGetMarketOverview();
  const health = useHealthCheck();
  const client = useQueryClient();
  const data = market.data;
  return (
    <div data-testid="page-overview">
      <PageHeading kicker="01 / situational awareness" title="Market overview" detail="A live read on the Solana memecoin surface. Start broad, then follow the signal." action={<button onClick={() => client.invalidateQueries({ queryKey: getGetMarketOverviewQueryKey() })} className="inline-flex items-center gap-2 self-start rounded-md border border-border bg-card px-3 py-2 text-xs font-medium transition hover:border-accent hover:bg-accent/20 lg:self-auto" data-testid="button-refresh-overview"><RefreshCw className="h-3.5 w-3.5" />Refresh snapshot</button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground"><span className="flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${health.isError ? 'bg-destructive' : 'bg-[hsl(72_70%_40%)]'}`} />{health.isError ? 'degraded connection' : 'observer online'}</span><span className="text-border">/</span><span>last indexed {formatAgo(data?.generatedAt)}</span></div>
      {market.isLoading ? <LoadingPanel rows={2} /> : market.isError ? <ErrorPanel onRetry={() => market.refetch()} /> : <><MetricStrip metrics={data?.metrics} /><div className="mt-7 grid gap-7 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,.8fr)]"><div className="obs-card overflow-hidden"><div className="flex items-end justify-between border-b border-card-border px-5 py-4"><div><div className="eyebrow">Priority surface</div><h2 className="mt-1 text-sm font-semibold">Momentum leaders</h2></div><Link href="/tokens" className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[.12em] text-muted-foreground transition hover:text-foreground" data-testid="link-view-scanner">Open scanner <ChevronRight className="h-3 w-3" /></Link></div>{data?.tokens?.length ? <TokenTable tokens={data.tokens.slice(0, 7)} /> : <EmptyPanel icon={LineChart} title="No tokens detected" detail="The scanner will populate as the market indexer reports." />}</div><ActivityFeed events={data?.events} /></div></>}
    </div>
  );
}

function Scanner() {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'momentum' | 'volume' | 'newest' | 'risk'>('momentum');
  const params = useMemo(() => ({ sort, search: search || undefined, limit: 50 }), [search, sort]);
  const tokens = useListTokens(params);
  const client = useQueryClient();
  const add = useAddWatchlist();
  const remove = useRemoveWatchlist();
  const [pending, setPending] = useState('');
  const handleWatch = (token: any) => {
    setPending(token.address);
    const onDone = () => { setPending(''); client.invalidateQueries({ queryKey: getListTokensQueryKey(params) }); client.invalidateQueries({ queryKey: getListWatchlistQueryKey() }); };
    if (token.isWatched) remove.mutate({ address: token.address }, { onSettled: onDone });
    else add.mutate({ data: { address: token.address, symbol: token.symbol, name: token.name } }, { onSettled: onDone });
  };
  return (
    <div data-testid="page-scanner">
      <PageHeading kicker="02 / discovery" title="Token scanner" detail="Compare live momentum, liquidity, flow, and contract risk without leaving the surface." action={<div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 font-mono text-[10px] text-muted-foreground"><span className="dot-pulse h-1.5 w-1.5 rounded-full bg-[hsl(72_70%_40%)]" />50 max results</div>} />
      <div className="obs-card mb-5 flex flex-col gap-3 p-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input data-testid="input-token-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search symbol, name, or mint address" className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-accent focus:ring-2 focus:ring-accent/20" /></div><div className="flex items-center gap-2"><SlidersHorizontal className="ml-2 h-4 w-4 text-muted-foreground" /><select data-testid="select-token-sort" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="h-10 rounded-md border border-border bg-background px-3 text-xs outline-none focus:border-accent"><option value="momentum">Highest momentum</option><option value="volume">Volume surge</option><option value="newest">Newest launches</option><option value="risk">Risk first</option></select></div></div>
      <div className="obs-card overflow-hidden"><div className="flex items-center justify-between border-b border-card-border px-5 py-4"><div className="flex items-center gap-2"><ListFilter className="h-4 w-4 text-muted-foreground" /><span className="text-sm font-semibold">Live token surface</span></div><span className="font-mono text-[10px] text-muted-foreground">{tokens.data?.length ?? 0} observed</span></div>{tokens.isLoading ? <div className="p-4"><LoadingPanel rows={7} /></div> : tokens.isError ? <div className="p-4"><ErrorPanel onRetry={() => tokens.refetch()} /></div> : tokens.data?.length ? <TokenTable tokens={tokens.data} onWatch={handleWatch} pendingAddress={pending} /> : <div className="p-4"><EmptyPanel icon={Search} title="No matching tokens" detail="Try a shorter symbol, or clear the search to restore the full surface." /></div>}</div>
    </div>
  );
}

function DetailStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="border-l border-border pl-4"><div className="eyebrow">{label}</div><div className="data-value mt-2 text-lg">{value}</div>{hint && <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div>}</div>;
}

function TokenDetail() {
  const { address } = useParams<{ address: string }>();
  const tokenQuery = useGetToken(address ?? '', { query: { enabled: !!address, queryKey: getGetTokenQueryKey(address ?? '') } });
  const analysisQuery = useGetTokenAnalysis(address ?? '', { query: { enabled: !!address, queryKey: getGetTokenAnalysisQueryKey(address ?? '') } });
  const client = useQueryClient();
  const add = useAddWatchlist();
  const remove = useRemoveWatchlist();
  const [copied, setCopied] = useState(false);
  const token: any = tokenQuery.data;
  const analysis: any = analysisQuery.data;
  const isPending = add.isPending || remove.isPending;
  const toggleWatch = () => {
    if (!token) return;
    if (token.isWatched) remove.mutate({ address: token.address }, { onSuccess: () => { token.isWatched = false; client.invalidateQueries({ queryKey: getGetTokenQueryKey(token.address) }); client.invalidateQueries({ queryKey: getListWatchlistQueryKey() }); } });
    else add.mutate({ data: { address: token.address, symbol: token.symbol, name: token.name } }, { onSuccess: () => { token.isWatched = true; client.invalidateQueries({ queryKey: getGetTokenQueryKey(token.address) }); client.invalidateQueries({ queryKey: getListWatchlistQueryKey() }); } });
  };
  const copyAddress = async () => { await navigator.clipboard?.writeText(address ?? ''); setCopied(true); window.setTimeout(() => setCopied(false), 1400); };
  return (
    <div data-testid="page-token-detail">
      {tokenQuery.isLoading ? <LoadingPanel rows={5} /> : tokenQuery.isError || !token ? <ErrorPanel onRetry={() => tokenQuery.refetch()} label="Token record unavailable" /> : <>
        <div className="mb-8 flex flex-col justify-between gap-5 border-b border-border/80 pb-7 lg:flex-row lg:items-end"><div><Link href="/tokens" className="mb-5 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[.13em] text-muted-foreground hover:text-foreground" data-testid="link-back-scanner">← Back to scanner</Link><div className="flex items-center gap-4"><TokenAvatar symbol={token.symbol} icon={token.icon} size="lg" /><div><div className="eyebrow">{token.dex} / {formatAgo(new Date(Date.now() - token.ageMinutes * 60000).toISOString())}</div><h1 className="mt-1 font-display text-3xl font-semibold tracking-[-.04em]">{token.symbol}<span className="ml-2 text-muted-foreground/60">/ {token.name}</span></h1><div className="mt-2 flex items-center gap-2"><button onClick={copyAddress} className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground transition hover:text-foreground" data-testid="button-copy-address">{copied ? 'copied' : shortAddress(token.address)}<Copy className="h-3 w-3" /></button><a href={`https://solscan.io/token/${token.address}`} target="_blank" rel="noreferrer" className="text-muted-foreground transition hover:text-foreground" data-testid="link-solscan"><ExternalLink className="h-3.5 w-3.5" /></a></div></div></div></div><button onClick={toggleWatch} disabled={isPending} className={`inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-xs font-medium transition ${token.isWatched ? 'border-accent bg-accent/20' : 'border-border bg-card hover:border-accent hover:bg-accent/20'} disabled:opacity-50`} data-testid="button-detail-watch">{isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Star className={`h-3.5 w-3.5 ${token.isWatched ? 'fill-current' : ''}`} />}{token.isWatched ? 'Watching' : 'Add to watchlist'}</button></div>
        <div className="obs-card mb-7 overflow-hidden"><div className="grid gap-6 p-5 sm:grid-cols-2 lg:grid-cols-4"><DetailStat label="Price" value={formatMoney(token.price)} hint={`${token.priceChange24h >= 0 ? '+' : ''}${token.priceChange24h.toFixed(2)}% / 24h`} /><DetailStat label="Market cap" value={`$${formatMoney(token.marketCap, true)}`} hint={`${token.txns24h.toLocaleString()} txns / 24h`} /><DetailStat label="Liquidity" value={`$${formatMoney(token.liquidity, true)}`} hint="current pool depth" /><DetailStat label="Momentum" value={`${token.momentum} / 100`} hint="composite signal" /></div><div className="border-t border-card-border bg-secondary/25 p-5"><div className="flex items-center justify-between"><div><div className="eyebrow">Price trace</div><div className="mt-1 text-xs text-muted-foreground">Observed over the latest market window</div></div><Sparkline points={token.sparkline} positive={token.priceChange24h >= 0} /></div></div></div>
        <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_380px]"><div className="space-y-7"><section className="obs-card p-5"><div className="mb-5 flex items-center justify-between"><div><div className="eyebrow">Explainable model</div><h2 className="mt-1 text-base font-semibold">AI analysis</h2></div>{analysis && <Badge tone={analysis.verdict === 'avoid' ? 'critical' : analysis.verdict === 'watch' ? 'positive' : 'warning'}>{analysis.verdict}</Badge>}</div>{analysisQuery.isLoading ? <LoadingPanel rows={3} /> : analysisQuery.isError ? <ErrorPanel onRetry={() => analysisQuery.refetch()} label="Analysis unavailable" /> : analysis ? <><div className="rounded-md border border-border bg-secondary/35 p-4"><div className="flex items-center justify-between"><span className="text-xs font-medium">Model confidence</span><span className="data-value text-lg">{analysis.confidence}%</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${analysis.confidence}%` }} /></div><p className="mt-4 text-sm leading-6 text-muted-foreground">{analysis.summary}</p></div><div className="mt-5 divide-y divide-border/70">{analysis.signals?.map((signal: any) => <div className="flex gap-3 py-3 first:pt-0 last:pb-0" key={signal.label}><div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${signal.status === 'positive' ? 'bg-[hsl(154_54%_40%)]' : signal.status === 'negative' ? 'bg-destructive' : 'bg-[hsl(39_80%_55%)]'}`} /><div><div className="text-xs font-medium">{signal.label}</div><div className="mt-1 text-xs leading-5 text-muted-foreground">{signal.detail}</div></div></div>)}</div></> : <EmptyPanel icon={Sparkles} title="Analysis pending" detail="The model has not produced an explainable read for this asset yet." />}</section><section className="obs-card p-5"><div className="eyebrow">Market context</div><h2 className="mt-1 text-base font-semibold">Execution surface</h2><div className="mt-5 grid gap-5 sm:grid-cols-3"><DetailStat label="24h volume" value={`$${formatMoney(token.volume24h, true)}`} /><DetailStat label="Token age" value={`${Math.round(token.ageMinutes / 60)}h`} /><DetailStat label="Venue" value={token.dex} /></div></section></div><RiskPanel risk={token.risk} /></div>
      </>}
    </div>
  );
}

function RiskPanel({ risk }: { risk: any }) {
  const checks = [{ label: 'Liquidity locked', value: risk?.liquidityLocked, good: true }, { label: 'Mint authority', value: risk?.mintAuthorityActive, good: false }, { label: 'Freeze authority', value: risk?.freezeAuthorityActive, good: false }];
  return <section className="obs-card h-fit p-5"><div className="flex items-center justify-between"><div><div className="eyebrow">Contract risk</div><h2 className="mt-1 text-base font-semibold">Risk posture</h2></div><div className={`flex h-12 w-12 items-center justify-center rounded-full border-4 text-sm font-semibold ${risk?.score > 70 ? 'border-destructive/40 text-destructive' : risk?.score > 40 ? 'border-[hsl(39_80%_55%/.5)] text-[hsl(28_78%_34%)]' : 'border-[hsl(154_54%_40%/.45)] text-[hsl(154_54%_27%)]'}`}>{risk?.score ?? '—'}</div></div><div className="mt-5 flex items-center justify-between"><span className="text-xs text-muted-foreground">Assessment</span><Badge tone={riskTone(risk?.label)}>{risk?.label ?? 'unknown'}</Badge></div><div className="mt-5 divide-y divide-border/70 border-y border-border/70">{checks.map((check) => <div className="flex items-center justify-between py-3" key={check.label}><span className="text-xs">{check.label}</span>{check.value === check.good ? <ShieldCheck className="h-4 w-4 text-[hsl(154_54%_40%)]" /> : <ShieldAlert className="h-4 w-4 text-destructive" />}</div>)}</div><div className="mt-5 flex items-center justify-between text-xs"><span className="text-muted-foreground">Top 10 holders</span><span className="data-value">{risk?.top10HolderPct?.toFixed(1)}%</span></div>{risk?.notes?.length ? <div className="mt-5 space-y-2">{risk.notes.map((note: string) => <div className="flex gap-2 text-xs leading-5 text-muted-foreground" key={note}><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(28_78%_45%)]" />{note}</div>)}</div> : null}</section>;
}

function Watchlist() {
  const list = useListWatchlist();
  const tokens = useListTokens({ limit: 50 });
  const remove = useRemoveWatchlist();
  const client = useQueryClient();
  const enrich = useMemo(() => new Map((tokens.data ?? []).map((token: any) => [token.address, token])), [tokens.data]);
  return <div data-testid="page-watchlist"><PageHeading kicker="03 / retained signal" title="Watchlist" detail="Keep a tight set of assets in view. Your saved names stay available while the market moves." action={<Link href="/tokens" className="inline-flex items-center gap-2 self-start rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition hover:opacity-90 lg:self-auto" data-testid="link-add-watchlist"><Plus className="h-3.5 w-3.5" />Find tokens</Link>} />{list.isLoading ? <LoadingPanel rows={4} /> : list.isError ? <ErrorPanel onRetry={() => list.refetch()} /> : list.data?.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{list.data.map((item: any) => { const token: any = enrich.get(item.address); return <div className="obs-card obs-card-hover group p-5" key={item.address} data-testid={`card-watchlist-${item.symbol}`}><div className="flex items-start justify-between"><div className="flex items-center gap-3"><TokenAvatar symbol={item.symbol} icon={token?.icon} /><div><div className="text-sm font-semibold">{item.symbol}</div><div className="text-xs text-muted-foreground">{item.name}</div></div></div><button onClick={() => { if (window.confirm(`Remove ${item.symbol} from watchlist?`)) remove.mutate({ address: item.address }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListWatchlistQueryKey() }); client.invalidateQueries({ queryKey: getListTokensQueryKey({ limit: 50 }) }); } }); }} className="rounded p-1.5 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100" data-testid={`button-remove-watchlist-${item.symbol}`}><Trash2 className="h-3.5 w-3.5" /></button></div>{token ? <><div className="mt-6 flex items-end justify-between"><div><div className="data-value text-xl">{formatMoney(token.price)}</div><div className={`mt-1 font-mono text-[10px] ${token.priceChange24h >= 0 ? 'text-[hsl(154_54%_27%)]' : 'text-destructive'}`}>{token.priceChange24h >= 0 ? '+' : ''}{token.priceChange24h.toFixed(2)}% / 24h</div></div><Sparkline points={token.sparkline} positive={token.priceChange24h >= 0} /></div><div className="mt-5 flex items-center justify-between border-t border-border/70 pt-3"><span className="font-mono text-[10px] text-muted-foreground">added {formatAgo(item.addedAt)}</span><Link href={`/tokens/${item.address}`} className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[.1em] text-muted-foreground hover:text-foreground" data-testid={`link-watchlist-detail-${item.symbol}`}>Inspect <ChevronRight className="h-3 w-3" /></Link></div></> : <div className="mt-6 border-t border-border/70 pt-4 text-xs text-muted-foreground">Market details are outside the current scan window.</div>}</div> })}</div> : <EmptyPanel icon={BookMarked} title="Your watchlist is clear" detail="Pin assets from the scanner when a signal deserves a second look." />}</div>;
}

function Alerts() {
  const list = useListAlerts();
  const create = useCreateAlert();
  const remove = useDeleteAlert();
  const client = useQueryClient();
  const [address, setAddress] = useState('');
  const [symbol, setSymbol] = useState('');
  const [condition, setCondition] = useState('price_change');
  const [threshold, setThreshold] = useState('10');
  const [direction, setDirection] = useState('above');
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!address.trim() || !symbol.trim()) return;
    create.mutate({ data: { address: address.trim(), symbol: symbol.trim().toUpperCase(), condition: condition as any, threshold: Number(threshold), direction: direction as any } }, { onSuccess: () => { setAddress(''); setSymbol(''); setThreshold('10'); client.invalidateQueries({ queryKey: getListAlertsQueryKey() }); } });
  };
  const conditionLabel = (value: string) => value === 'price_change' ? 'price change' : value === 'liquidity_drop' ? 'liquidity drop' : 'risk score';
  return <div data-testid="page-alerts"><PageHeading kicker="04 / monitoring rules" title="Alert rules" detail="Define the thresholds that should pull your attention back to an asset." /><div className="grid gap-7 xl:grid-cols-[380px_minmax(0,1fr)]"><section className="obs-card h-fit p-5"><div className="mb-5 flex items-center gap-3"><div className="rounded-md bg-accent/25 p-2 text-foreground"><Bell className="h-4 w-4" /></div><div><div className="eyebrow">New rule</div><h2 className="mt-1 text-sm font-semibold">Monitor a condition</h2></div></div><form onSubmit={submit} className="space-y-4"><label className="block"><span className="eyebrow mb-2 block">Token symbol</span><input data-testid="input-alert-symbol" value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="e.g. BONK" className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" /></label><label className="block"><span className="eyebrow mb-2 block">Mint address</span><input data-testid="input-alert-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Paste token mint" className="h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-xs outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" /></label><div className="grid grid-cols-2 gap-3"><label><span className="eyebrow mb-2 block">Condition</span><select data-testid="select-alert-condition" value={condition} onChange={(event) => setCondition(event.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-accent"><option value="price_change">Price change</option><option value="liquidity_drop">Liquidity drop</option><option value="risk_score">Risk score</option></select></label><label><span className="eyebrow mb-2 block">Direction</span><select data-testid="select-alert-direction" value={direction} onChange={(event) => setDirection(event.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-accent"><option value="above">Above</option><option value="below">Below</option></select></label></div><label className="block"><span className="eyebrow mb-2 block">Threshold</span><div className="relative"><input data-testid="input-alert-threshold" type="number" value={threshold} onChange={(event) => setThreshold(event.target.value)} className="data-value h-10 w-full rounded-md border border-border bg-background px-3 pr-12 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" /><span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground">{condition === 'risk_score' ? '/ 100' : '%'}</span></div></label><button type="submit" disabled={create.isPending || !address || !symbol} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40" data-testid="button-create-alert">{create.isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Create monitoring rule</button></form></section><section className="obs-card overflow-hidden"><div className="flex items-center justify-between border-b border-card-border px-5 py-4"><div><div className="eyebrow">Active rules</div><h2 className="mt-1 text-sm font-semibold">Watching the threshold map</h2></div><span className="font-mono text-[10px] text-muted-foreground">{list.data?.length ?? 0} rules</span></div>{list.isLoading ? <div className="p-4"><LoadingPanel rows={4} /></div> : list.isError ? <div className="p-4"><ErrorPanel onRetry={() => list.refetch()} /> </div> : list.data?.length ? <div className="divide-y divide-border/70">{list.data.map((rule: any) => <div className="group flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between" key={rule.id} data-testid={`row-alert-${rule.id}`}><div className="flex items-start gap-3"><div className={`mt-0.5 rounded-md p-2 ${rule.enabled ? 'bg-accent/20 text-foreground' : 'bg-secondary text-muted-foreground'}`}><Gauge className="h-4 w-4" /></div><div><div className="flex items-center gap-2"><span className="text-sm font-semibold">${rule.symbol}</span><Badge tone={rule.enabled ? 'lime' : 'neutral'}>{rule.enabled ? 'armed' : 'paused'}</Badge></div><div className="mt-1 text-xs text-muted-foreground">{conditionLabel(rule.condition)} {rule.direction} <span className="data-value font-medium text-foreground">{rule.threshold}{rule.condition === 'risk_score' ? '' : '%'}</span></div><div className="mt-1 font-mono text-[10px] text-muted-foreground">{shortAddress(rule.address)} · created {formatAgo(rule.createdAt)}</div></div></div><button onClick={() => { if (window.confirm(`Delete the ${rule.symbol} alert?`)) remove.mutate({ id: rule.id }, { onSuccess: () => client.invalidateQueries({ queryKey: getListAlertsQueryKey() }) }); }} className="inline-flex items-center gap-2 self-start rounded-md border border-border px-3 py-2 text-xs text-muted-foreground transition hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive sm:self-auto" data-testid={`button-delete-alert-${rule.id}`}><Trash2 className="h-3.5 w-3.5" />Delete</button></div>)}</div> : <div className="p-4"><EmptyPanel icon={Bell} title="No rules armed" detail="Add a threshold on the left to turn market movement into a clear notification." /></div>}</section></div></div>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Shell><Switch><Route path="/" component={Overview} /><Route path="/tokens" component={Scanner} /><Route path="/tokens/:address" component={TokenDetail} /><Route path="/watchlist" component={Watchlist} /><Route path="/alerts" component={Alerts} /><Route component={NotFound} /></Switch></Shell></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;