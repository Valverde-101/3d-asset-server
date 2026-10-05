import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/api/app.js";
import { addedSince, appendHistory, countBy, mapLimit, parseCount, runCensus, tallyAssets, top, wpTotal, type Catalog } from "../src/core/census.js";
import { AssetService } from "../src/core/service.js";
import type { HttpClient, Provider, SourceCensus } from "../src/core/types.js";
import { makeAsset } from "../src/core/util.js";
import { blenderkit } from "../src/providers/blenderkit.js";
import { cgbookcase } from "../src/providers/cgbookcase.js";
import { hdrihub } from "../src/providers/hdrihub.js";
import { hdrmaps } from "../src/providers/hdrmaps.js";
import { allProviders } from "../src/providers/index.js";
import { itchio } from "../src/providers/itchio.js";
import { polyhaven } from "../src/providers/polyhaven.js";
import { texturescom } from "../src/providers/texturescom.js";
import { threedtextures } from "../src/providers/threedtextures.js";
import { bytesHttp, fakeProvider } from "./fakes.js";
import { fixtureCtx } from "./helpers.js";

const SITE = fileURLToPath(new URL("./fixtures/site", import.meta.url));

/** HttpClient answering by URL: a string body, or { body, headers }. */
function routeHttp(route: (url: string) => string | { body: string; headers?: Record<string, string> } | undefined): HttpClient & { urls: string[] } {
  const urls: string[] = [];
  const answer = (url: string) => {
    urls.push(url);
    const r = route(url);
    if (r === undefined) throw new Error(`unexpected ${url}`);
    return typeof r === "string" ? { body: r, headers: {} } : r;
  };
  return {
    urls,
    async text(url) {
      return answer(url).body;
    },
    async json<T>(url: string) {
      return JSON.parse(answer(url).body) as T;
    },
    async raw(url) {
      const r = answer(url);
      return new Response(r.body, { headers: r.headers });
    },
  };
}

describe("census helpers", () => {
  it("counts, ranks and dates", () => {
    expect(countBy([{ t: "a" }, { t: "b" }, { t: "a" }, { t: undefined }], (x) => x.t)).toEqual({ a: 2, b: 1 });
    expect(countBy([{ c: ["x", "y"] }, { c: ["x"] }], (x) => x.c)).toEqual({ x: 2, y: 1 });
    expect(top({ a: 1, b: 5, c: 3, d: 0 }, 2)).toEqual({ b: 5, c: 3 });
    const now = Date.parse("2026-10-05T00:00:00Z");
    expect(addedSince(["2026-10-01", "2026-08-01", Date.parse("2026-09-20") / 1000, undefined, "nonsense"], now)).toBe(2);
    expect(parseCount("Browse (118,384 results)", /\(?([\d,]+) results\)?/)).toBe(118384);
    expect(parseCount("nothing", /([\d,]+) results/)).toBeUndefined();
  });

  it("limits concurrency and keeps order", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, n));
      active--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
  });

  it("tallies a full catalogue", () => {
    const a = (type: "model" | "hdri", license: string, createdAt?: string) =>
      makeAsset({ provider: "x", nativeId: Math.random().toString(), title: "t", type, tags: [], url: "https://x", license: { name: license }, price: { free: true }, downloadable: true, createdAt, categories: [type] });
    const c = tallyAssets([a("model", "CC0", "2026-10-01"), a("model", "CC-BY-4.0"), a("hdri", "CC0")], "m", { now: Date.parse("2026-10-05") });
    expect(c).toMatchObject({ total: 3, free: 3, byType: { model: 2, hdri: 1 }, byLicense: { CC0: 2, "CC-BY-4.0": 1 }, categories: { model: 2, hdri: 1 }, addedLast30Days: 1 });
  });

  it("reads X-WP-Total", async () => {
    const http = routeHttp(() => ({ body: "[]", headers: { "x-wp-total": "1498" } }));
    expect(await wpTotal(http, "https://x/wp-json/wp/v2/posts")).toBe(1498);
    await expect(wpTotal(routeHttp(() => "[]"), "https://x")).rejects.toThrow(/X-WP-Total/);
  });
});

describe("provider census", () => {
  it("every searchable source can count itself", () => {
    const missing = allProviders.filter((p) => p.access !== "link" && !p.census).map((p) => p.id);
    expect(missing).toEqual([]);
  });

  it("polyhaven: types, downloads, most downloaded per type", async () => {
    const c = await polyhaven.census!(fixtureCtx([["/assets?t=all", "polyhaven/assets.json"]]));
    expect(c.total).toBeGreaterThan(0);
    expect(c.free).toBe(c.total);
    expect(Object.values(c.byType).reduce((a, b) => a + b!, 0)).toBe(c.total);
    expect(c.downloads).toBeGreaterThan(0);
    expect(c.highlights?.[0]).toMatchObject({ label: expect.stringMatching(/^Most downloaded/), url: expect.stringMatching(/^https:\/\/polyhaven\.com\/a\//) });
  });

  it("cgbookcase: counts its whole catalogue", async () => {
    const c = await cgbookcase.census!(fixtureCtx([["/api/textures", "cgbookcase/textures.json"]]));
    expect(c.total).toBeGreaterThan(0);
    expect(c.byType.material! + (c.byType.texture ?? 0)).toBe(c.total);
  });

  it("hdrihub: counts product pages in the sitemap", async () => {
    const loc = (p: string) => `<url><loc>https://www.hdri-hub.com${p}</loc></url>`;
    const xml = `<urlset>${[loc("/shop/hdri"), loc("/shop/hdri/sky/a"), loc("/shop/hdri/sky/b"), loc("/shop/3d-models/people/c"), loc("/shop/free-samples/hdri/d")].join("")}</urlset>`;
    const c = await hdrihub.census!({ fetch: routeHttp((u) => (u.endsWith("/sitemap.xml") ? xml : undefined)) });
    expect(c).toMatchObject({ total: 4, free: 1, categories: { hdri: 2, "3d-models": 1, "free-samples": 1 } });
    expect(c.byType.model).toBe(1);
  });

  it("itchio: result counts from the browse pages", async () => {
    const counts: Record<string, string> = { "": "118,384", "/free": "55,261", "/tag-3d": "16,458" };
    const http = routeHttp((u) => {
      const path = u.replace("https://itch.io/game-assets", "");
      return `<h2>Filter Results</h2><span>(${counts[path] ?? "1,000"} results)</span>`;
    });
    const c = await itchio.census!({ fetch: http });
    expect(c).toMatchObject({ total: 118384, free: 55261, byType: { pack: 118384 }, unit: "packs" });
    expect(c.categories?.["3D"]).toBe(16458);
  });

  it("hdrmaps and 3dtextures: WordPress totals", async () => {
    const hm = await hdrmaps.census!({
      fetch: routeHttp((u) => {
        const cat = new URL(u).searchParams.get("category");
        const op = new URL(u).searchParams.get("category_operator");
        const n = op === "not_in" ? 875 : ({ "52": 491, "57": 132, "64": 214 } as Record<string, number>)[cat ?? ""] ?? 5;
        return { body: "[]", headers: { "x-wp-total": String(n) } };
      }),
    });
    expect(hm).toMatchObject({ total: 875, free: 214 });
    expect(hm.byType.hdri).toBe(623);
    const tt = await threedtextures.census!({
      fetch: routeHttp((u) => {
        const p = new URL(u).searchParams;
        if (p.get("_fields") === "date") return JSON.stringify([{ date: new Date().toISOString().slice(0, 19) }]);
        return { body: "[]", headers: { "x-wp-total": p.get("categories") ? "2" : "1500" } };
      }),
    });
    expect(tt).toMatchObject({ total: 1500, free: 1498, byType: { material: 1500 }, addedLast30Days: 1 });
  });

  it("blenderkit: flags counts capped at 10,000 as lower bounds", async () => {
    const c = await blenderkit.census!({
      fetch: routeHttp((u) => {
        const q = new URL(u).searchParams.get("query") ?? "";
        const count = q.startsWith("asset_type:model") && !q.includes("is_free") ? 10_000 : 100;
        return JSON.stringify({ count, results: [] });
      }),
    });
    expect(c.atLeast).toBe(true);
    expect(c.byType.model).toBeGreaterThanOrEqual(10_000);
  });

  it("texturescom: photo sets per top-level category", async () => {
    const cat = (id: number, name: string, n: number, kind: string) => ({ id, name, parentCategoryId: null, photoSetCount: n, kind, enabled: 1 });
    const tree = { data: { categories: [cat(1, "Brick", 2319, "regular"), cat(114553, "3D Objects", 1344, "special"), cat(23740, "HDR Skies", 317, "special"), cat(52338, "Decals", 691, "special")] } };
    const c = await texturescom.census!({ fetch: routeHttp(() => JSON.stringify(tree)) });
    // Curated "special" roots (Decals) overlap the regular ones and are not added.
    expect(c).toMatchObject({ total: 2319 + 1344 + 317, byType: { texture: 2319, model: 1344, hdri: 317 } });
  });
});

describe("runCensus", () => {
  const source = (id: string, census: SourceCensus | Error, extra: Partial<Provider> = {}): Provider => ({
    ...fakeProvider,
    id,
    name: id.toUpperCase(),
    pricing: "free",
    license: { name: "CC0" },
    census: async () => {
      if (census instanceof Error) throw census;
      return census;
    },
    ...extra,
  });

  it("aggregates totals, types, licences and keeps stale counts", async () => {
    const previous = {
      sources: [{ id: "down", name: "DOWN", homepage: "", pricing: "paid", supportsDownload: false, total: 50, byType: { model: 50 }, method: "m", countedAt: "2026-10-01T00:00:00.000Z" }],
    } as unknown as Catalog;
    const providers = [
      source("free", { total: 100, byType: { material: 60, hdri: 40 }, addedLast30Days: 3, method: "m" }),
      source("mixed", { total: 1000, free: 200, atLeast: true, byType: { model: 1000 }, byLicense: { CC0: 10, "Royalty Free": 990 }, method: "m" }, { pricing: "freemium", license: undefined, supportsDownload: false }),
      source("down", new Error("boom"), { pricing: "paid", license: undefined }),
      { ...fakeProvider, id: "link", census: undefined },
    ];
    const c = await runCensus(providers, { fetch: bytesHttp() }, { previous, now: new Date("2026-10-05T00:00:00Z") });
    expect(c.sources.map((s) => s.id)).toEqual(["mixed", "free", "down"]);
    expect(c.totals.listings).toEqual({ count: 1150, atLeast: true });
    expect(c.totals.free).toEqual({ count: 300, atLeast: true }); // "down" has no free count
    expect(c.totals.cc0).toEqual({ count: 110, atLeast: true });
    expect(c.totals.directDownload.count).toBe(100);
    expect(c.totals.addedLast30Days).toBe(3);
    expect(c.byType.model).toEqual({ count: 1050, atLeast: true });
    expect(c.byLicense).toMatchObject({ CC0: 110, "Royalty Free": 990 });
    expect(c.sources.find((s) => s.id === "down")?.stale).toEqual({ since: "2026-10-01T00:00:00.000Z", error: "boom" });
    expect(c.linked.map((l) => l.id)).toEqual(["link"]);

    const h1 = appendHistory([], c);
    const h2 = appendHistory(h1, { ...c, totals: { ...c.totals, listings: { count: 9 } } });
    expect(h2).toHaveLength(1); // one point per day
    expect(h2[0]).toMatchObject({ date: "2026-10-05", listings: 9, sources: { mixed: 1000 } });
  });
});

describe("GET /v1/catalog", () => {
  it("serves the census shipped with the site", async () => {
    const app = createApp(new AssetService({ providers: [fakeProvider], http: bytesHttp() }), { siteRoot: SITE });
    const res = await app.request("/v1/catalog");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const body = (await res.json()) as Catalog;
    expect(body.totals.listings.count).toBe(1234);
  });
});
