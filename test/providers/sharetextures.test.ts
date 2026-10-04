import { describe, expect, it } from "vitest";
import { queryToTags, sharetextures } from "../../src/providers/sharetextures.js";
import { fixtureCtx } from "../helpers.js";

const routes: [string | RegExp, string][] = [
  ["/for-frontend/tag-paths", "sharetextures/tag-paths.json"],
  ["/for-frontend/items?", "sharetextures/items_brick-wall.json"],
  ["/for-frontend/item/brick-wall-2", "sharetextures/item_brick-wall-2.json"],
];

describe("sharetextures", () => {
  it("maps query words to known tag slugs", () => {
    const known = new Set(["brick", "brick-wall", "wall", "wood", "floor", "chair"]);
    expect(queryToTags("brick wall", known)).toEqual(["brick-wall"]);
    expect(queryToTags("Wood floors", known)).toEqual(["wood", "floor"]);
    expect(queryToTags("chairs zzz", known)).toEqual(["chair"]);
    expect(queryToTags("zzz", known)).toEqual([]);
  });

  it("searches by tag via the site API", async () => {
    const ctx = fixtureCtx(routes);
    const r = await sharetextures.search({ query: "brick wall", limit: 3 }, ctx);
    expect(ctx.fetch.requests[1]).toContain("tag=brick-wall");
    expect(r.total).toBe(9);
    expect(r.searchUrl).toBe("https://www.sharetextures.com/tag/brick-wall");
    expect(r.assets[0]).toMatchObject({
      id: "sharetextures:brick-wall-2",
      title: "Brick Wall 2",
      type: "material",
      url: "https://www.sharetextures.com/textures/wall/brick-wall-2",
      downloadable: false,
      price: { free: true },
    });
    expect(r.assets[0]!.thumbnailUrl).toMatch(/^https:\/\/images\.sharetextures\.com\/u\/.+\.webp$/);
    expect(r.assets[0]!.tags).toContain("brick wall");
  });

  it("returns nothing (without listing everything) when no word is a known tag", async () => {
    const ctx = fixtureCtx(routes);
    const r = await sharetextures.search({ query: "qwertyuiop", limit: 3 }, ctx);
    expect(r).toMatchObject({ assets: [], total: 0 });
    expect(ctx.fetch.requests.some((u) => u.includes("/items?"))).toBe(false);
  });

  it("requests a single item type when the filter allows it", async () => {
    const ctx = fixtureCtx(routes);
    await sharetextures.search({ query: "", types: ["model"], limit: 3, offset: 3 }, ctx);
    expect(ctx.fetch.requests[0]).toContain("itemType=models");
    expect(ctx.fetch.requests[0]).toContain("page=2");
  });

  it("skips the request when types do not apply", async () => {
    const ctx = fixtureCtx(routes);
    expect((await sharetextures.search({ query: "x", types: ["hdri"], limit: 3 }, ctx)).assets).toEqual([]);
    expect(ctx.fetch.requests).toEqual([]);
  });

  it("returns details without exposing download URLs", async () => {
    const d = await sharetextures.getAsset!("brick-wall-2", fixtureCtx(routes));
    expect(d).toMatchObject({ title: "Brick Wall 2", downloadable: false, files: [], resolutions: ["1k", "2k", "4k"] });
    expect(d!.formats).toContain("zip");
    expect(d!.author).toBeTruthy();
  });
});
