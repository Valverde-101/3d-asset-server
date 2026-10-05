/**
 * Backend analytics: Prometheus metrics + one structured JSON log line per
 * product event.
 *
 * - Metrics (scraped from METRICS_PORT/metrics) carry only bounded labels
 *   (surface, client family, provider, status, tool) so cardinality stays flat.
 * - Free-text facts (the query itself) go to the event log only. In the
 *   cluster, pod logs are shipped to Loki, where Grafana ranks top queries
 *   and zero-result searches.
 *
 * Nothing here identifies a person: no IPs, no API keys, no cookies.
 */

import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";
import type { ProviderSearchReport, SearchResponse } from "./service.js";
import type { AssetType } from "./types.js";

/** Where a request came from. `web` is the bundled website, `api` any other REST caller. */
export type Surface = "api" | "web" | "mcp";

export interface SearchEvent {
  surface: Surface;
  client: string;
  query: string;
  types?: AssetType[];
  freeOnly?: boolean;
  downloadableOnly?: boolean;
  response: SearchResponse;
  tookMs: number;
}

export interface Analytics {
  readonly registry?: Registry;
  search(e: SearchEvent): void;
  assetView(e: { surface: Surface; client: string; provider: string; found: boolean }): void;
  download(e: { surface: Surface; client: string; provider: string; kind: "redirect" | "zip" | "local" }): void;
  toolCall(e: { tool: string; client: string; outcome: "ok" | "error"; tookMs: number }): void;
  httpRequest(e: { route: string; method: string; status: number; tookMs: number }): void;
  pageView(e: { page: string }): void;
}

/** Drop-in for tests, the CLI and stdio MCP: records nothing. */
export const noopAnalytics: Analytics = {
  search() {},
  assetView() {},
  download() {},
  toolCall() {},
  httpRequest() {},
  pageView() {},
};

const CLIENT_PATTERNS: [string, RegExp][] = [
  ["claude-code", /claude[- ]code/i],
  ["claude-desktop", /claude/i],
  ["cursor", /cursor/i],
  ["windsurf", /windsurf|codeium/i],
  ["vscode", /vscode|visual studio code|copilot/i],
  ["codex", /codex/i],
  ["gemini", /gemini/i],
  ["zed", /\bzed\b/i],
  ["cline", /cline|roo-?code/i],
  ["openai", /openai/i],
  ["mcp-sdk", /mcp/i],
  ["python", /python|httpx|aiohttp|requests/i],
  ["curl", /^curl\//i],
  ["node", /node|undici|axios|got\b/i],
  ["bot", /bot|crawler|spider|slurp/i],
  ["browser", /mozilla|safari|chrome|firefox/i],
];

/** Collapse a User-Agent into a small, fixed set of client families (metric-safe). */
export function clientFamily(userAgent: string | undefined): string {
  if (!userAgent) return "unknown";
  for (const [name, re] of CLIENT_PATTERNS) if (re.test(userAgent)) return name;
  return "other";
}

function typeLabel(types?: AssetType[]): string {
  if (!types?.length) return "any";
  return types.length === 1 ? types[0]! : "multi";
}

const MAX_QUERY_LOG = 200;

export class PrometheusAnalytics implements Analytics {
  readonly registry = new Registry();
  private readonly searches: Counter;
  private readonly searchDuration: Histogram;
  private readonly searchResults: Histogram;
  private readonly providerRequests: Counter;
  private readonly providerDuration: Histogram;
  private readonly assetViews: Counter;
  private readonly downloads: Counter;
  private readonly toolCalls: Counter;
  private readonly toolDuration: Histogram;
  private readonly httpRequests: Counter;
  private readonly httpDuration: Histogram;
  private readonly pageViews: Counter;

  constructor(private readonly log: (line: string) => void = (l) => console.log(l)) {
    const r = this.registry;
    collectDefaultMetrics({ register: r, prefix: "asset_server_" });
    this.searches = new Counter({
      name: "asset_server_searches_total",
      help: "Searches by surface, client family, asset type filter and whether anything was found.",
      labelNames: ["surface", "client", "type", "free_only", "has_results"],
      registers: [r],
    });
    this.searchDuration = new Histogram({
      name: "asset_server_search_duration_seconds",
      help: "End-to-end search latency (all sources in parallel).",
      labelNames: ["surface"],
      buckets: [0.25, 0.5, 1, 2, 3, 5, 8, 12, 20],
      registers: [r],
    });
    this.searchResults = new Histogram({
      name: "asset_server_search_results",
      help: "Number of results returned per search.",
      labelNames: ["surface"],
      buckets: [0, 1, 5, 10, 25, 50, 100],
      registers: [r],
    });
    this.providerRequests = new Counter({
      name: "asset_server_provider_requests_total",
      help: "Per-source outcome of every search fan-out (ok, error, timeout, skipped, link).",
      labelNames: ["provider", "status"],
      registers: [r],
    });
    this.providerDuration = new Histogram({
      name: "asset_server_provider_duration_seconds",
      help: "Per-source search latency (excludes skipped and link-only sources).",
      labelNames: ["provider"],
      buckets: [0.1, 0.25, 0.5, 1, 2, 4, 8, 12],
      registers: [r],
    });
    this.assetViews = new Counter({
      name: "asset_server_asset_views_total",
      help: "Asset detail lookups.",
      labelNames: ["surface", "client", "provider", "found"],
      registers: [r],
    });
    this.downloads = new Counter({
      name: "asset_server_downloads_total",
      help: "Downloads started (redirect to a single file, streamed zip, or MCP local write).",
      labelNames: ["surface", "client", "provider", "kind"],
      registers: [r],
    });
    this.toolCalls = new Counter({
      name: "asset_server_mcp_tool_calls_total",
      help: "MCP tool invocations by tool, client family and outcome.",
      labelNames: ["tool", "client", "outcome"],
      registers: [r],
    });
    this.toolDuration = new Histogram({
      name: "asset_server_mcp_tool_duration_seconds",
      help: "MCP tool latency.",
      labelNames: ["tool"],
      buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20],
      registers: [r],
    });
    this.httpRequests = new Counter({
      name: "asset_server_http_requests_total",
      help: "HTTP requests by matched route, method and status class.",
      labelNames: ["route", "method", "status"],
      registers: [r],
    });
    this.httpDuration = new Histogram({
      name: "asset_server_http_request_duration_seconds",
      help: "HTTP latency by matched route.",
      labelNames: ["route"],
      buckets: [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20],
      registers: [r],
    });
    this.pageViews = new Counter({
      name: "asset_server_page_views_total",
      help: "Website page views counted server-side (HTML documents served).",
      labelNames: ["page"],
      registers: [r],
    });
  }

  search(e: SearchEvent): void {
    const n = e.response.results.length;
    this.searches.inc({
      surface: e.surface,
      client: e.client,
      type: typeLabel(e.types),
      free_only: String(Boolean(e.freeOnly)),
      has_results: String(n > 0),
    });
    this.searchDuration.observe({ surface: e.surface }, e.tookMs / 1000);
    this.searchResults.observe({ surface: e.surface }, n);
    for (const p of e.response.providers) this.provider(p);
    this.event("search", {
      surface: e.surface,
      client: e.client,
      query: e.query.trim().toLowerCase().slice(0, MAX_QUERY_LOG),
      types: e.types ?? [],
      free: Boolean(e.freeOnly),
      downloadable: Boolean(e.downloadableOnly),
      results: n,
      sources_ok: e.response.providers.filter((p) => p.status === "ok").length,
      ms: e.tookMs,
    });
  }

  private provider(p: ProviderSearchReport): void {
    this.providerRequests.inc({ provider: p.provider, status: p.status });
    if (p.status === "ok" || p.status === "error" || p.status === "timeout") {
      this.providerDuration.observe({ provider: p.provider }, p.tookMs / 1000);
    }
  }

  assetView(e: { surface: Surface; client: string; provider: string; found: boolean }): void {
    this.assetViews.inc({ ...e, found: String(e.found) });
    this.event("asset_view", e);
  }

  download(e: { surface: Surface; client: string; provider: string; kind: "redirect" | "zip" | "local" }): void {
    this.downloads.inc(e);
    this.event("download", e);
  }

  toolCall(e: { tool: string; client: string; outcome: "ok" | "error"; tookMs: number }): void {
    this.toolCalls.inc({ tool: e.tool, client: e.client, outcome: e.outcome });
    this.toolDuration.observe({ tool: e.tool }, e.tookMs / 1000);
    this.event("mcp_tool", { tool: e.tool, client: e.client, outcome: e.outcome, ms: e.tookMs });
  }

  httpRequest(e: { route: string; method: string; status: number; tookMs: number }): void {
    this.httpRequests.inc({ route: e.route, method: e.method, status: `${Math.floor(e.status / 100)}xx` });
    this.httpDuration.observe({ route: e.route }, e.tookMs / 1000);
  }

  pageView(e: { page: string }): void {
    this.pageViews.inc(e);
  }

  private event(name: string, data: Record<string, unknown>): void {
    this.log(JSON.stringify({ event: name, ts: new Date().toISOString(), ...data }));
  }
}
