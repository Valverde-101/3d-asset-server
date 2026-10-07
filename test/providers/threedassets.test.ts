import { describe, expect, it } from "vitest";
import { threedassets } from "../../src/providers/threedassets.js";
import { fixtureCtx } from "../helpers.js";

const routes: [string | RegExp, string][] = [
  ["/api/v1/categories", "threedassets/categories.json"],
  [/assets\?.*category=/, "threedassets/cat_nature.json"],
  ["/api/v1/assets/bellroot", "threedassets/detail.json"],
  [/assets\?.*q=tree/, "threedassets/search_tree.json"],
  [/assets\?limit=1$/, "threedassets/total.json"],
];

describe("threedassets", () => {
  it("maps search results", async () => {
    const ctx = fixtureCtx(routes);
    const r = await threedassets.search({ query: "tree", limit: 3 }, ctx);
    expect(r.assets).toHaveLength(3);
    expect(r.total).toBeGreaterThan(3);
    expect(r.assets[0]).toMatchObject({
      provider: "threedassets",
      type: "model",
      downloadable: true,
      license: { name: "CC0" },
      formats: ["glb"],
    });
    expect(r.assets[0]!.tags).toContain("ai-generated");
    expect(ctx.fetch.requests).toHaveLength(1);
    expect(ctx.fetch.requests[0]).toContain("limit=3");
  });

  it("paginates by page and straddles pages for unaligned offsets", async () => {
    const ctx = fixtureCtx(routes);
    await threedassets.search({ query: "tree", limit: 3, offset: 3 }, ctx);
    expect(ctx.fetch.requests[0]).toContain("page=2");
    const ctx2 = fixtureCtx(routes);
    const r = await threedassets.search({ query: "tree", limit: 3, offset: 1 }, ctx2);
    expect(ctx2.fetch.requests).toHaveLength(2);
    expect(r.assets.length).toBeLessThanOrEqual(3);
  });

  it("skips the request when types do not apply", async () => {
    const ctx = fixtureCtx(routes);
    const r = await threedassets.search({ query: "tree", types: ["hdri"], limit: 5 }, ctx);
    expect(r.assets).toEqual([]);
    expect(ctx.fetch.requests).toEqual([]);
  });

  it("returns the GLB for an asset", async () => {
    const d = await threedassets.getAsset!("bellroot-fen-floodward-marches-ceremonial-bellroot-tre-aec588ae", fixtureCtx(routes));
    expect(d?.files).toEqual([
      expect.objectContaining({ url: "https://cdn.3dassets.dev/assets/32932/v1/model.glb", format: "glb", sizeBytes: 294112 }),
    ]);
    expect(d?.polyCount).toBe(13736);
  });

  it("returns null for unknown ids", async () => {
    expect(await threedassets.getAsset!("nope", fixtureCtx([]))).toBeNull();
  });

  it("counts the catalogue", async () => {
    const c = await threedassets.census!(fixtureCtx(routes));
    expect(c.total).toBeGreaterThan(1000);
    expect(c.byType.model).toBe(c.total);
    expect(Object.keys(c.categories ?? {})).toContain("Buildings & Architecture");
  });
});
