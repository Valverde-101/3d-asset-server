import { describe, expect, it } from "vitest";
import { threedtextures } from "../../src/providers/threedtextures.js";
import { fixtureCtx } from "../helpers.js";

const routes: [string | RegExp, string][] = [
  ["/posts?slug=wood-tiles-005", "threedtextures/post_wood-tiles-005.json"],
  [/\/posts\?search=/, "threedtextures/search_wood.json"],
];

describe("threedtextures", () => {
  it("searches WordPress posts with embedded terms", async () => {
    const ctx = fixtureCtx(routes);
    const r = await threedtextures.search({ query: "wood", limit: 10 }, ctx);
    const url = ctx.fetch.requests[0]!;
    expect(url).toContain("search=wood");
    expect(url).toContain("_embed=wp%3Aterm");
    expect(url).toContain("categories_exclude=504794035");
    expect(r.assets[0]).toMatchObject({
      id: "threedtextures:wood-tiles-005",
      title: "Wood Tiles 005",
      type: "material",
      url: "https://3dtextures.me/2026/08/24/wood-tiles-005/",
      downloadable: false,
      license: { name: "CC0" },
      price: { free: true },
    });
    expect(r.assets[0]!.thumbnailUrl).toContain("Material_2003.png");
    // Tags come from embedded terms, minus generic noise.
    expect(r.assets[0]!.tags).toContain("wood");
    expect(r.assets[0]!.tags).not.toContain("cc0");
    // " – Free Seamless PBR Texture" suffix is stripped.
    expect(r.assets[1]!.title).toBe("Wood Wicker 013");
  });

  it("marks Patreon-exclusive posts as paid and drops them for freeOnly", async () => {
    const all = await threedtextures.search({ query: "wood", limit: 10 }, fixtureCtx(routes));
    expect(all.assets.find((a) => a.nativeId === "asphalt-damaged-001")?.price).toEqual({ free: false });

    const ctx = fixtureCtx(routes);
    const free = await threedtextures.search({ query: "wood", limit: 10, freeOnly: true }, ctx);
    expect(ctx.fetch.requests[0]).toContain("categories_exclude=504794035%2C523608841");
    expect(free.assets.map((a) => a.nativeId)).not.toContain("asphalt-damaged-001");
  });

  it("skips the request when types do not apply", async () => {
    const ctx = fixtureCtx(routes);
    const r = await threedtextures.search({ query: "x", types: ["hdri"], limit: 5 }, ctx);
    expect(r.assets).toEqual([]);
    expect(ctx.fetch.requests).toEqual([]);
  });

  it("parses Google Drive download links from the post", async () => {
    const d = await threedtextures.getAsset!("wood-tiles-005", fixtureCtx(routes));
    expect(d).toMatchObject({ title: "Wood Tiles 005", resolutions: ["1k"], downloadable: false });
    expect(d!.files).toEqual([
      {
        url: "https://drive.google.com/drive/folders/1XEyuYBP6GbmJQc8ZQTLTwVNe_aEtHAk3?usp=sharing",
        filename: "wood-tiles-005",
        format: "folder",
        group: "google-drive",
      },
    ]);
  });
});
