import { describe, expect, it } from "vitest";
import { itchio, parsePrice } from "../../src/providers/itchio.js";
import { fixtureCtx } from "../helpers.js";

const routes: [RegExp, string][] = [
  [/^https:\/\/itch\.io\/search\?/, "itchio/search.html"],
  [/^https:\/\/itch\.io\/game-assets\/free\/tag-3d\?format=json&page=1$/, "itchio/browse_free_3d.json"],
  [/kaylousberg\.itch\.io\/kaykit-forest\/data\.json$/, "itchio/kaykit-forest.data.json"],
  [/kaylousberg\.itch\.io\/kaykit-forest$/, "itchio/kaykit-forest.html"],
  [/example-231791\.itch\.io\/low-poly-tree\/data\.json$/, "itchio/low-poly-tree.data.json"],
  [/example-231791\.itch\.io\/low-poly-tree$/, "itchio/low-poly-tree.html"],
];

describe("itchio", () => {
  it("scrapes asset search results", async () => {
    const ctx = fixtureCtx(routes);
    const r = await itchio.search({ query: "low poly tree", limit: 10 }, ctx);
    expect(ctx.fetch.requests).toEqual(["https://itch.io/search?q=low+poly+tree&classification=assets"]);
    expect(r.searchUrl).toBe(ctx.fetch.requests[0]);
    expect(r.assets).toHaveLength(6);
    expect(r.assets[0]).toMatchObject({
      id: "itchio:example-231791/low-poly-tree",
      title: "Low Poly tree",
      type: "model",
      url: "https://example-231791.itch.io/low-poly-tree",
      author: "example",
      price: { free: false, amount: 1, currency: "USD" },
      downloadable: false,
    });
    expect(r.assets[0]!.thumbnailUrl).toMatch(/^https:\/\/img\.itch\.zone\//);
    expect(r.assets[1]).toMatchObject({ nativeId: "brokenvector/low-poly-tree-pack", price: { free: true } });
  });

  it("filters free results locally and adds a 3D hint for model-only queries", async () => {
    const ctx = fixtureCtx(routes);
    const r = await itchio.search({ query: "tree", types: ["model"], freeOnly: true, limit: 10 }, ctx);
    expect(ctx.fetch.requests[0]).toBe("https://itch.io/search?q=tree+3d&classification=assets");
    expect(r.assets.length).toBe(4);
    expect(r.assets.every((a) => a.price?.free && a.type === "model")).toBe(true);
  });

  it("browses the free 3D listing JSON when the query is empty", async () => {
    const ctx = fixtureCtx(routes);
    const r = await itchio.search({ query: "", types: ["model"], freeOnly: true, limit: 3, offset: 1 }, ctx);
    expect(ctx.fetch.requests).toEqual(["https://itch.io/game-assets/free/tag-3d?format=json&page=1"]);
    expect(r.searchUrl).toBe("https://itch.io/game-assets/free/tag-3d");
    expect(r.assets.map((a) => a.nativeId)).toEqual([
      "kaylousberg/kaykit-adventurers",
      "quaternius/universal-animation-library-2",
      "pizzadoggy/retro-tree-pack",
    ]);
    expect(r.assets[0]).toMatchObject({ type: "model", animated: true, rigged: true });
    expect(r.assets[0]!.tags).toContain("3d");
  });

  it("parses prices", () => {
    expect(parsePrice("$19.95")).toEqual({ free: false, amount: 19.95, currency: "USD" });
    expect(parsePrice("0€")).toEqual({ free: true, amount: 0, currency: "EUR" });
    expect(parsePrice("$1.00 USD")).toEqual({ free: false, amount: 1, currency: "USD" });
    expect(parsePrice("")).toBeUndefined();
  });

  it("skips HDRIs without requesting", async () => {
    const ctx = fixtureCtx(routes);
    expect((await itchio.search({ query: "sky", types: ["hdri"], limit: 5 }, ctx)).assets).toEqual([]);
    expect(ctx.fetch.requests).toEqual([]);
  });

  it("combines data.json and the game page for details", async () => {
    const d = await itchio.getAsset!("kaylousberg/kaykit-forest", fixtureCtx(routes));
    expect(d).toMatchObject({
      id: "itchio:kaylousberg/kaykit-forest",
      title: "KayKit - Forest Nature Pack",
      type: "model",
      author: "Kay Lousberg",
      license: { name: "CC0" },
      price: { free: true, amount: 0 },
      description: "3D stylised low poly trees, rocks, grass, and more.",
      downloadable: false,
    });
    expect(d!.tags).toEqual(expect.arrayContaining(["3d", "low-poly", "trees"]));
    expect(d!.files.map((f) => f.filename)).toEqual(["Free", "Extra", "Source Files"]);
    expect(d!.files[0]).toMatchObject({
      url: "https://kaylousberg.itch.io/kaykit-forest/purchase",
      sizeBytes: 6_100_000,
      requiresAuth: true,
    });
  });

  it("reads paid prices and upload formats", async () => {
    const d = await itchio.getAsset!("example-231791:low-poly-tree", fixtureCtx(routes));
    expect(d!.nativeId).toBe("example-231791/low-poly-tree");
    expect(d!.price).toEqual({ free: false, amount: 1, currency: "USD" });
    expect(d!.files[0]).toMatchObject({ filename: "Low Poly Tree.zip", format: "zip", requiresAuth: true });
  });

  it("returns null for unknown or malformed ids", async () => {
    expect(await itchio.getAsset!("someone/missing", fixtureCtx(routes))).toBeNull();
    expect(await itchio.getAsset!("not-an-id", fixtureCtx(routes))).toBeNull();
  });
});
