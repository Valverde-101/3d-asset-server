import { describe, expect, it } from "vitest";
import { threedtexel } from "../../src/providers/threedtexel.js";
import { fixtureCtx } from "../helpers.js";

const routes: [string | RegExp, string][] = [
  ["/public/types", "threedtexel/types.json"],
  ["/public/categories?type=pbr", "threedtexel/categories_pbr.json"],
  ["/wp/v2/product?slug=mossy-rock-3d-asset-3", "threedtexel/product_mossy.json"],
  ["/wp/v2/product?slug=nope", "threedtexel/product_none.json"],
  ["search?q=brick&free=1", "threedtexel/search_brick_pbr.json"],
  ["search?type=hdri", "threedtexel/search_free.json"],
  ["search?q=Mossy", "threedtexel/search_mossy.json"],
  ["search?free=1", "threedtexel/search_free.json"],
];

describe("threedtexel", () => {
  it("searches the free library through the public API", async () => {
    const ctx = fixtureCtx(routes);
    const r = await threedtexel.search({ query: "brick", types: ["material"], limit: 3 }, ctx);
    expect(ctx.fetch.requests).toHaveLength(1);
    expect(r.total).toBeGreaterThan(0);
    expect(r.assets).toHaveLength(3);
    expect(r.assets[0]).toMatchObject({
      provider: "threedtexel",
      type: "material",
      downloadable: false,
      price: { free: true },
      license: { name: "CC0" },
    });
    expect(r.assets[0]!.nativeId).toMatch(/^[a-z0-9-]+$/);
    expect(r.assets[0]!.url).toBe(`https://3dtexel.com/product/${r.assets[0]!.nativeId}/`);
    expect(r.assets[0]!.thumbnailUrl).toMatch(/^https:\/\//);
  });

  it("paginates within a page of results", async () => {
    const first = await threedtexel.search({ query: "brick", types: ["material"], limit: 3 }, fixtureCtx(routes));
    const next = await threedtexel.search({ query: "brick", types: ["material"], limit: 3, offset: 3 }, fixtureCtx(routes));
    expect(next.assets).toHaveLength(3);
    expect(next.assets[0]!.id).not.toBe(first.assets[0]!.id);
  });

  it("filters by type when several library types apply", async () => {
    const ctx = fixtureCtx(routes);
    const r = await threedtexel.search({ query: "", types: ["model"], limit: 50 }, ctx);
    expect(ctx.fetch.requests[0]).toContain("free=1");
    expect(r.assets.length).toBeGreaterThan(0);
    expect(r.assets.every((a) => a.type === "model")).toBe(true);
  });

  it("requests a single library type when the filter allows it", async () => {
    const ctx = fixtureCtx(routes);
    const r = await threedtexel.search({ query: "", types: ["hdri"], limit: 50 }, ctx);
    expect(ctx.fetch.requests[0]).toContain("type=hdri");
    expect(r.assets.every((a) => a.type === "hdri")).toBe(true);
  });

  it("skips the request when types do not apply", async () => {
    const ctx = fixtureCtx(routes);
    const r = await threedtexel.search({ query: "x", types: ["audio"], limit: 3 }, ctx);
    expect(r.assets).toEqual([]);
    expect(ctx.fetch.requests).toEqual([]);
  });

  it("resolves an asset by slug without exposing files", async () => {
    const d = await threedtexel.getAsset!("mossy-rock-3d-asset-3", fixtureCtx(routes));
    expect(d).toMatchObject({
      id: "threedtexel:mossy-rock-3d-asset-3",
      title: "Mossy Rock – 3D Asset",
      type: "model",
      downloadable: false,
      files: [],
    });
  });

  it("returns null for an unknown id", async () => {
    expect(await threedtexel.getAsset!("nope", fixtureCtx(routes))).toBeNull();
  });

  it("counts the free library", async () => {
    const c = await threedtexel.census!(fixtureCtx(routes));
    expect(c.total).toBeGreaterThan(1000);
    expect(c.free).toBe(c.total);
    expect(c.byType.material).toBeGreaterThan(0);
    expect(c.byLicense?.CC0).toBeGreaterThan(0);
    expect(c.categories).toBeTruthy();
  });
});
