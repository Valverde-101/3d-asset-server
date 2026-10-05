/**
 * Public usage statistics for the /stats page and GET /v1/stats.
 *
 * Two sources, same shape:
 * - PrometheusStats queries the cluster's Prometheus (PROMETHEUS_URL), so
 *   numbers survive restarts and cover every replica (last 24 hours / 7 days).
 * - LocalStats tallies this process's events since it started. It is the
 *   fallback when Prometheus is not configured or not reachable.
 *
 * Only aggregate counts leave the server: no queries, IPs or user agents.
 */

import type { Analytics, SearchEvent, Surface } from "./analytics.js";

export interface UsageWindow {
  key: string;
  label: string;
  searches: number;
  searchesWithResults: number;
  bySurface: Record<Surface, number>;
  assetViews: number;
  downloads: number;
  toolCalls: number;
  pageViews: number;
}

export interface ProviderHealth {
  provider: string;
  /** Searches that reached the source (ok + error + timeout). */
  requests: number;
  ok: number;
  errors: number;
  timeouts: number;
  /** ok / requests, or null with no traffic. */
  okRate: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface Ranked {
  name: string;
  count: number;
}

export interface UsageStats {
  generatedAt: string;
  /** Where the numbers come from. */
  source: "prometheus" | "process";
  /** Start of the counting period for the "process" source. */
  since?: string;
  windows: UsageWindow[];
  /** Label of the period the rankings and provider health cover. */
  breakdownLabel: string;
  clients: Ranked[];
  tools: Ranked[];
  assetTypes: Ranked[];
  providers: ProviderHealth[];
}

export interface StatsSource {
  snapshot(): Promise<UsageStats>;
}

const SURFACES: Surface[] = ["web", "api", "mcp"];
const emptySurfaces = (): Record<Surface, number> => ({ web: 0, api: 0, mcp: 0 });

function rank(m: Map<string, number>, max = 10): Ranked[] {
  return [...m.entries()]
    .filter(([, n]) => n > 0)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, max);
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i]!;
}

const bump = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

/** Latency samples kept per source (most recent), enough for stable p50/p95. */
const LATENCY_SAMPLES = 500;

/** In-process tallies since start. Also an Analytics sink, so it sees every event. */
export class LocalStats implements Analytics, StatsSource {
  private readonly started: Date;
  private searches = 0;
  private searchesWithResults = 0;
  private readonly bySurface = emptySurfaces();
  private assetViews = 0;
  private downloads = 0;
  private toolCalls = 0;
  private pageViews = 0;
  private readonly clients = new Map<string, number>();
  private readonly tools = new Map<string, number>();
  private readonly types = new Map<string, number>();
  private readonly health = new Map<string, { ok: number; errors: number; timeouts: number; ms: number[] }>();

  constructor(private readonly now: () => Date = () => new Date()) {
    this.started = now();
  }

  search(e: SearchEvent): void {
    this.searches++;
    if (e.response.results.length > 0) this.searchesWithResults++;
    this.bySurface[e.surface]++;
    bump(this.clients, e.client);
    if (!e.types?.length) bump(this.types, "any");
    else for (const t of e.types) bump(this.types, t);
    for (const p of e.response.providers) {
      if (p.status !== "ok" && p.status !== "error" && p.status !== "timeout") continue;
      let h = this.health.get(p.provider);
      if (!h) this.health.set(p.provider, (h = { ok: 0, errors: 0, timeouts: 0, ms: [] }));
      if (p.status === "ok") h.ok++;
      else if (p.status === "error") h.errors++;
      else h.timeouts++;
      h.ms.push(p.tookMs);
      if (h.ms.length > LATENCY_SAMPLES) h.ms.shift();
    }
  }

  assetView(_e: Parameters<Analytics["assetView"]>[0]): void {
    this.assetViews++;
  }

  download(_e: Parameters<Analytics["download"]>[0]): void {
    this.downloads++;
  }

  toolCall(e: Parameters<Analytics["toolCall"]>[0]): void {
    this.toolCalls++;
    bump(this.tools, e.tool);
  }

  httpRequest(_e: Parameters<Analytics["httpRequest"]>[0]): void {}

  pageView(_e: Parameters<Analytics["pageView"]>[0]): void {
    this.pageViews++;
  }

  async snapshot(): Promise<UsageStats> {
    const providers: ProviderHealth[] = [...this.health.entries()]
      .map(([provider, h]) => {
        const requests = h.ok + h.errors + h.timeouts;
        const sorted = [...h.ms].sort((a, b) => a - b);
        return {
          provider,
          requests,
          ok: h.ok,
          errors: h.errors,
          timeouts: h.timeouts,
          okRate: requests ? h.ok / requests : null,
          p50Ms: quantile(sorted, 0.5),
          p95Ms: quantile(sorted, 0.95),
        };
      })
      .sort((a, b) => a.provider.localeCompare(b.provider));
    return {
      generatedAt: this.now().toISOString(),
      source: "process",
      since: this.started.toISOString(),
      windows: [
        {
          key: "process",
          label: "Since the last restart",
          searches: this.searches,
          searchesWithResults: this.searchesWithResults,
          bySurface: { ...this.bySurface },
          assetViews: this.assetViews,
          downloads: this.downloads,
          toolCalls: this.toolCalls,
          pageViews: this.pageViews,
        },
      ],
      breakdownLabel: "Since the last restart",
      clients: rank(this.clients),
      tools: rank(this.tools),
      assetTypes: rank(this.types),
      providers,
    };
  }
}

interface PromSample {
  metric: Record<string, string>;
  value: [number, string];
}

export interface PrometheusStatsOptions {
  /** Base URL, e.g. http://kube-prometheus-stack-prometheus.monitoring.svc:9090 */
  url: string;
  /** Used when Prometheus fails. */
  fallback: StatsSource;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
  /** Log a failed query (defaults to console.error). */
  onError?: (e: unknown) => void;
}

const WINDOWS = [
  { key: "24h", label: "Last 24 hours" },
  { key: "7d", label: "Last 7 days" },
] as const;
/** Rankings use the longest window; provider health the shortest (it should reflect now). */
const BREAKDOWN = "7d";
const HEALTH = "24h";

/** Counts from the cluster's Prometheus, which scrapes METRICS_PORT on every replica. */
export class PrometheusStats implements StatsSource {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: PrometheusStatsOptions) {
    this.base = opts.url.replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async snapshot(): Promise<UsageStats> {
    try {
      return await this.query();
    } catch (e) {
      (this.opts.onError ?? ((err) => console.error("stats: prometheus query failed:", err)))(e);
      return this.opts.fallback.snapshot();
    }
  }

  private async vector(promql: string): Promise<PromSample[]> {
    const url = `${this.base}/api/v1/query?query=${encodeURIComponent(promql)}`;
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.opts.timeoutMs ?? 4000) });
    if (!res.ok) throw new Error(`prometheus ${res.status} for ${promql}`);
    const body = (await res.json()) as { status: string; data?: { resultType: string; result: PromSample[] } };
    if (body.status !== "success" || body.data?.resultType !== "vector") throw new Error(`prometheus: unexpected response for ${promql}`);
    return body.data.result;
  }

  private async scalar(promql: string): Promise<number> {
    return count((await this.vector(promql))[0]);
  }

  /** Event counts per label value (rounded, NaN = 0). */
  private async byLabel(promql: string, label: string): Promise<Map<string, number>> {
    const m = new Map<string, number>();
    for (const s of await this.vector(promql)) m.set(s.metric[label] ?? "unknown", count(s));
    return m;
  }

  /** Raw sample values per label value (NaN kept, for quantiles). */
  private async valuesByLabel(promql: string, label: string): Promise<Map<string, number>> {
    const m = new Map<string, number>();
    for (const s of await this.vector(promql)) m.set(s.metric[label] ?? "unknown", Number(s.value[1]));
    return m;
  }

  private async window(key: string, label: string): Promise<UsageWindow> {
    const inc = (metric: string, sel = "") => `sum(increase(${metric}${sel}[${key}]))`;
    const [surfaces, withResults, assetViews, downloads, toolCalls, pageViews] = await Promise.all([
      this.byLabel(`sum by (surface) (increase(asset_server_searches_total[${key}]))`, "surface"),
      this.scalar(inc("asset_server_searches_total", `{has_results="true"}`)),
      this.scalar(inc("asset_server_asset_views_total")),
      this.scalar(inc("asset_server_downloads_total")),
      this.scalar(inc("asset_server_mcp_tool_calls_total")),
      this.scalar(inc("asset_server_page_views_total")),
    ]);
    const bySurface = emptySurfaces();
    for (const s of SURFACES) bySurface[s] = surfaces.get(s) ?? 0;
    return {
      key,
      label,
      searches: bySurface.web + bySurface.api + bySurface.mcp,
      searchesWithResults: withResults,
      bySurface,
      assetViews,
      downloads,
      toolCalls,
      pageViews,
    };
  }

  private async query(): Promise<UsageStats> {
    const [windows, clients, tools, types, outcomes, p50, p95] = await Promise.all([
      Promise.all(WINDOWS.map((w) => this.window(w.key, w.label))),
      this.byLabel(`sum by (client) (increase(asset_server_searches_total[${BREAKDOWN}]))`, "client"),
      this.byLabel(`sum by (tool) (increase(asset_server_mcp_tool_calls_total[${BREAKDOWN}]))`, "tool"),
      this.byLabel(`sum by (type) (increase(asset_server_searches_total[${BREAKDOWN}]))`, "type"),
      this.vector(`sum by (provider, status) (increase(asset_server_provider_requests_total{status=~"ok|error|timeout"}[${HEALTH}]))`),
      this.valuesByLabel(latency(0.5), "provider"),
      this.valuesByLabel(latency(0.95), "provider"),
    ]);

    const health = new Map<string, { ok: number; errors: number; timeouts: number }>();
    for (const s of outcomes) {
      const id = s.metric.provider ?? "unknown";
      const h = health.get(id) ?? { ok: 0, errors: 0, timeouts: 0 };
      const n = count(s);
      if (s.metric.status === "ok") h.ok += n;
      else if (s.metric.status === "error") h.errors += n;
      else h.timeouts += n;
      health.set(id, h);
    }
    const ms = (m: Map<string, number>, id: string) => {
      const v = m.get(id);
      return v === undefined || !Number.isFinite(v) ? null : Math.round(v * 1000);
    };
    const providers: ProviderHealth[] = [...health.entries()]
      .map(([provider, h]) => {
        const requests = h.ok + h.errors + h.timeouts;
        return {
          provider,
          requests,
          ...h,
          okRate: requests ? h.ok / requests : null,
          p50Ms: ms(p50, provider),
          p95Ms: ms(p95, provider),
        };
      })
      .filter((p) => p.requests > 0)
      .sort((a, b) => a.provider.localeCompare(b.provider));

    return {
      generatedAt: (this.opts.now?.() ?? new Date()).toISOString(),
      source: "prometheus",
      windows,
      breakdownLabel: WINDOWS.find((w) => w.key === BREAKDOWN)!.label,
      clients: rank(clients),
      tools: rank(tools),
      assetTypes: rank(types),
      providers,
    };
  }
}

function latency(q: number): string {
  return `histogram_quantile(${q}, sum by (provider, le) (rate(asset_server_provider_duration_seconds_bucket[${HEALTH}])))`;
}

/** Prometheus `increase` extrapolates, so round to whole events; NaN (no data) counts as 0. */
function count(s: PromSample | undefined): number {
  if (!s) return 0;
  const v = Number(s.value[1]);
  return Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
}

/** Serve one snapshot for `ttlMs` so page loads don't each hit Prometheus. Concurrent callers share a request. */
export function cachedStats(source: StatsSource, ttlMs = 60_000, now: () => number = Date.now): StatsSource {
  let cached: { at: number; value: Promise<UsageStats> } | undefined;
  return {
    snapshot() {
      const t = now();
      if (!cached || t - cached.at >= ttlMs) {
        const value = source.snapshot();
        cached = { at: t, value };
        value.catch(() => {
          if (cached?.value === value) cached = undefined;
        });
      }
      return cached.value;
    },
  };
}

/** Fan one event out to several sinks (metrics + local stats). */
export function teeAnalytics(...sinks: Analytics[]): Analytics {
  return {
    registry: sinks.find((s) => s.registry)?.registry,
    search: (e) => sinks.forEach((s) => s.search(e)),
    assetView: (e) => sinks.forEach((s) => s.assetView(e)),
    download: (e) => sinks.forEach((s) => s.download(e)),
    toolCall: (e) => sinks.forEach((s) => s.toolCall(e)),
    httpRequest: (e) => sinks.forEach((s) => s.httpRequest(e)),
    pageView: (e) => sinks.forEach((s) => s.pageView(e)),
  };
}
