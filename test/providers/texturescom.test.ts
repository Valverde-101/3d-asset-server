import { describe, expect, it } from "vitest";
import { texturescom } from "../../src/providers/texturescom.js";
import { fab, poliigon, turbosquid } from "../../src/providers/linked.js";
import { fixtureCtx } from "../helpers.js";

const routes: [string, string][] = [["/api/v1/texture/search?q=tree", "texturescom/search_tree.json"]];

describe("texturescom", () => {
  it("maps photo sets to typed assets", async () => {
    const r = await texturescom.search({ query: "tree", limit: 10 }, fixtureCtx(routes));
    const byTitle = Object.fromEntries(r.assets.map((a) => [a.title, a]));
    expect(byTitle["Birch Tree 2"]?.type).toBe("model");
    expect(byTitle["European Beech Leaves"]?.type).toBe("material");
    expect(byTitle["Norway Forest"]?.type).toBe("hdri");
    expect(byTitle["Beech Bark 1"]?.url).toMatch(/^https:\/\/www\.textures\.com\/download\/.+\/\d+$/);
  });

  it("filters by type and free samples", async () => {
    const models = await texturescom.search({ query: "tree", types: ["model"], limit: 10 }, fixtureCtx(routes));
    expect(models.assets.map((a) => a.title)).toEqual(["Birch Tree 2"]);
    const free = await texturescom.search({ query: "tree", freeOnly: true, limit: 10 }, fixtureCtx(routes));
    expect(free.assets.every((a) => a.price?.free)).toBe(true);
    expect(free.assets.length).toBeGreaterThan(0);
  });
});

describe("link-only providers", () => {
  it("build deep search links", async () => {
    const q = { query: "sci fi crate", limit: 5, freeOnly: true };
    expect(fab.buildSearchUrl(q)).toBe("https://www.fab.com/search?q=sci+fi+crate&is_free=1");
    expect(poliigon.buildSearchUrl(q)).toBe("https://www.poliigon.com/search/sci%20fi%20crate");
    expect(turbosquid.buildSearchUrl(q)).toBe("https://www.turbosquid.com/Search/3D-Models/free/sci-fi-crate");
    const r = await fab.search(q, fixtureCtx([]));
    expect(r).toEqual({ assets: [], searchUrl: fab.buildSearchUrl(q) });
  });
});
