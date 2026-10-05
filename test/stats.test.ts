import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/api/app.js";
import { openApiSpec } from "../src/api/openapi.js";
import { AssetService } from "../src/core/service.js";
import { LocalStats, PrometheusStats, cachedStats, type UsageStats } from "../src/core/stats.js";
import { fab } from "../src/providers/linked.js";
import { brokenProvider, bytesHttp, fakeProvider, slowProvider } from "./fakes.js";

const SITE = fileURLToPath(new URL("./fixtures/site", import.meta.url));

function service() {
  return new AssetService({ providers: [fakeProvider, brokenProvider, slowProvider, fab], http: bytesHttp(), defaultTimeoutMs: 200 });
}

type StatsBody = UsageStats & { catalog: { sources: number; directDownload: number; byAccess: Record<string, number> } };

/** A fake Prometheus /api/v1/query: answers each PromQL by the first matching rule. */
function fakePrometheus(rules: [RegExp, { metric?: Record<string, string>; v: number | string }[]][]) {
  const queries: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const q = new URL(String(input)).searchParams.get("query") ?? "";
    queries.push(q);
    const hit = rules.find(([re]) => re.test(q));
    const result = (hit?.[1] ?? []).map((s) => ({ metric: s.metric ?? {}, value: [1_700_000_000, String(s.v)] }));
    return new Response(JSON.stringify({ status: "success", data: { resultType: "vector", result } }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchImpl, queries };
}

describe("LocalStats", () => {
  it("tallies searches, surfaces, clients, types, tools and per-source health", async () => {
    const s = new LocalStats(() => new Date("2026-10-05T00:00:00Z"));
    const response = {
      query: "crate",
      results: [{} as never],
      providers: [
        { provider: "a", name: "A", status: "ok" as const, count: 1, tookMs: 100 },
        { provider: "b", name: "B", status: "timeout" as const, count: 0, tookMs: 8000 },
        { provider: "c", name: "C", status: "link" as const, count: 0, tookMs: 0 },
      ],
    };
    s.search({ surface: "web", client: "browser", query: "crate", response, tookMs: 120 });
    s.search({ surface: "mcp", client: "claude-code", query: "tree", types: ["model"], response: { ...response, results: [] }, tookMs: 90 });
    s.toolCall({ tool: "search_assets", client: "claude-code", outcome: "ok", tookMs: 90 });
    s.download({ surface: "api", client: "curl", provider: "a", kind: "zip" });
    s.pageView({ page: "/" });

    const snap = await s.snapshot();
    expect(snap.source).toBe("process");
    expect(snap.since).toBe("2026-10-05T00:00:00.000Z");
    expect(snap.windows).toHaveLength(1);
    expect(snap.windows[0]).toMatchObject({ searches: 2, searchesWithResults: 1, bySurface: { web: 1, api: 0, mcp: 1 }, downloads: 1, toolCalls: 1, pageViews: 1 });
    expect(snap.clients).toEqual([
      { name: "browser", count: 1 },
      { name: "claude-code", count: 1 },
    ]);
    expect(snap.tools).toEqual([{ name: "search_assets", count: 1 }]);
    expect(snap.assetTypes).toEqual([
      { name: "any", count: 1 },
      { name: "model", count: 1 },
    ]);
    // Link-only sources never reach the network, so they have no health row.
    expect(snap.providers.map((p) => p.provider)).toEqual(["a", "b"]);
    expect(snap.providers[0]).toMatchObject({ requests: 2, ok: 2, okRate: 1, p50Ms: 100, p95Ms: 100 });
    expect(snap.providers[1]).toMatchObject({ requests: 2, timeouts: 2, okRate: 0 });
  });

  it("never exposes query text", async () => {
    const s = new LocalStats();
    s.search({ surface: "api", client: "curl", query: "secret project name", response: { query: "", results: [], providers: [] }, tookMs: 1 });
    expect(JSON.stringify(await s.snapshot())).not.toContain("secret");
  });
});

describe("PrometheusStats", () => {
  it("builds 24h / 7d windows, rankings and health from PromQL", async () => {
    const prom = fakePrometheus([
      [/^sum by \(surface\).*\[24h\]/, [{ metric: { surface: "web" }, v: "10.4" }, { metric: { surface: "mcp" }, v: "3" }]],
      [/^sum by \(surface\).*\[7d\]/, [{ metric: { surface: "web" }, v: "70" }, { metric: { surface: "api" }, v: "5" }, { metric: { surface: "mcp" }, v: "25" }]],
      [/has_results="true".*\[24h\]/, [{ v: "11" }]],
      [/has_results="true".*\[7d\]/, [{ v: "90" }]],
      [/downloads_total\[24h\]/, [{ v: "2" }]],
      [/sum by \(client\)/, [{ metric: { client: "claude-code" }, v: "40" }, { metric: { client: "browser" }, v: "60" }, { metric: { client: "curl" }, v: "0" }]],
      [/sum by \(tool\)/, [{ metric: { tool: "search_assets" }, v: "25" }]],
      [/sum by \(type\)/, [{ metric: { type: "model" }, v: "30" }]],
      [/provider_requests_total/, [
        { metric: { provider: "polyhaven", status: "ok" }, v: "19" },
        { metric: { provider: "polyhaven", status: "timeout" }, v: "1" },
      ]],
      [/histogram_quantile\(0\.5,/, [{ metric: { provider: "polyhaven" }, v: "0.3" }]],
      [/histogram_quantile\(0\.95,/, [{ metric: { provider: "polyhaven" }, v: "NaN" }]],
    ]);
    const stats = new PrometheusStats({ url: "http://prom:9090/", fallback: new LocalStats(), fetch: prom.fetchImpl });
    const snap = await stats.snapshot();

    expect(snap.source).toBe("prometheus");
    expect(snap.since).toBeUndefined();
    expect(snap.windows.map((w) => w.key)).toEqual(["24h", "7d"]);
    expect(snap.windows[0]).toMatchObject({ searches: 13, searchesWithResults: 11, bySurface: { web: 10, api: 0, mcp: 3 }, downloads: 2 });
    expect(snap.windows[1]).toMatchObject({ searches: 100, searchesWithResults: 90 });
    expect(snap.breakdownLabel).toBe("Last 7 days");
    expect(snap.clients).toEqual([
      { name: "browser", count: 60 },
      { name: "claude-code", count: 40 },
    ]);
    expect(snap.providers).toEqual([
      { provider: "polyhaven", requests: 20, ok: 19, errors: 0, timeouts: 1, okRate: 0.95, p50Ms: 300, p95Ms: null },
    ]);
    expect(prom.queries.every((q) => q.includes("asset_server_"))).toBe(true);
  });

  it("falls back to in-process counts when Prometheus fails", async () => {
    const errors: unknown[] = [];
    const stats = new PrometheusStats({
      url: "http://prom:9090",
      fallback: new LocalStats(),
      fetch: (async () => new Response("down", { status: 503 })) as typeof fetch,
      onError: (e) => errors.push(e),
    });
    const snap = await stats.snapshot();
    expect(snap.source).toBe("process");
    expect(errors).toHaveLength(1);
  });

  it("cachedStats reuses a snapshot for the TTL", async () => {
    let calls = 0;
    let t = 0;
    const source = { snapshot: async () => ({ n: ++calls }) as unknown as UsageStats };
    const cached = cachedStats(source, 1000, () => t);
    await cached.snapshot();
    await cached.snapshot();
    expect(calls).toBe(1);
    t = 1000;
    await cached.snapshot();
    expect(calls).toBe(2);
  });
});

describe("GET /v1/stats", () => {
  it("reports in-process usage and the catalog, cached for a minute", async () => {
    const app = createApp(service(), { siteRoot: SITE });
    await app.request("/v1/search?q=crate", { headers: { "x-asset-client": "web", "user-agent": "Mozilla/5.0" } });
    const res = await app.request("/v1/stats");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = (await res.json()) as StatsBody;
    expect(body.source).toBe("process");
    expect(body.windows[0]).toMatchObject({ searches: 1, bySurface: { web: 1, api: 0, mcp: 0 } });
    expect(body.clients).toEqual([{ name: "browser", count: 1 }]);
    expect(body.catalog.sources).toBe(4);
    expect(body.catalog.byAccess.link).toBe(1);
    expect(body.providers.find((p) => p.provider === "slow")?.timeouts).toBe(1);
  });

  it("uses Prometheus when configured", async () => {
    const prom = fakePrometheus([[/sum by \(surface\)/, [{ metric: { surface: "api" }, v: "4" }]]]);
    const app = createApp(service(), { siteRoot: SITE, prometheus: { url: "http://prom:9090", fetch: prom.fetchImpl } });
    const body = (await (await app.request("/v1/stats")).json()) as StatsBody;
    expect(body.source).toBe("prometheus");
    expect(body.windows[0]?.searches).toBe(4);
  });

  it("is documented in OpenAPI and linked from the JSON index", async () => {
    const spec = openApiSpec("https://3d.shep.bot") as { paths: Record<string, Record<string, { operationId: string; responses: Record<string, unknown> }>> };
    expect(spec.paths["/v1/stats"]?.get?.operationId).toBe("getStats");
    expect(spec.paths["/v1/stats"]?.get?.responses).toHaveProperty("429");
    const app = createApp(service(), { siteRoot: SITE });
    const index = (await (await app.request("/", { headers: { accept: "application/json" } })).json()) as { endpoints: Record<string, string> };
    expect(index.endpoints.stats).toBe("/v1/stats");
  });
});
