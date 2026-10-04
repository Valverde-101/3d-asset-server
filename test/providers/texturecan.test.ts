import { describe, expect, it } from "vitest";
import { texturecan } from "../../src/providers/texturecan.js";
import { fixtureCtx } from "../helpers.js";

const routes: [string, string][] = [
  ["/search/wood/1/", "texturecan/search_wood_1.html"],
  ["/search/wood/2/", "texturecan/search_wood_2.html"],
  ["/models/details/547/", "texturecan/model_547.html"],
  ["/models/", "texturecan/models.html"],
  ["/details/591/", "texturecan/details_591.html"],
];

describe("texturecan", () => {
  it("parses server-side search results", async () => {
    const ctx = fixtureCtx(routes);
    const r = await texturecan.search({ query: "wood", types: ["material"], limit: 3 }, ctx);
    expect(ctx.fetch.requests).toEqual(["https://www.texturecan.com/search/wood/1/"]);
    expect(r.assets.map((a) => a.id)).toEqual(["texturecan:591", "texturecan:590", "texturecan:589"]);
    expect(r.assets[0]).toMatchObject({
      title: "Laminated Long Brown Wood Planks",
      type: "material",
      url: "https://www.texturecan.com/details/591/",
      thumbnailUrl: "https://www.texturecan.com/img/textures/wood_0066/wood_0066_sphere_300.png",
      downloadable: true,
      license: { name: "CC0" },
    });
    expect(r.assets[0]!.description).toContain("laminated long wood floor tiles");
    // 4 result pages exist, only one was fetched: total unknown.
    expect(r.total).toBeUndefined();
  });

  it("maps offsets onto the site's 20-item pages", async () => {
    const ctx = fixtureCtx(routes);
    await texturecan.search({ query: "wood", types: ["material"], limit: 5, offset: 18 }, ctx);
    expect(ctx.fetch.requests).toEqual([
      "https://www.texturecan.com/search/wood/1/",
      "https://www.texturecan.com/search/wood/2/",
    ]);
  });

  it("joins words with + and lists matching models first", async () => {
    const ctx = fixtureCtx([["/search/gold+coin/1/", "texturecan/search_wood_2.html"], ...routes]);
    const r = await texturecan.search({ query: "gold coin", limit: 4 }, ctx);
    expect(r.assets[0]).toMatchObject({ id: "texturecan:model-547", type: "model", title: "Gold Coin 3D Model" });
    expect(ctx.fetch.requests).toContain("https://www.texturecan.com/search/gold+coin/1/");
  });

  it("skips the request when types do not apply", async () => {
    const ctx = fixtureCtx(routes);
    expect((await texturecan.search({ query: "x", types: ["hdri"], limit: 3 }, ctx)).assets).toEqual([]);
    expect(ctx.fetch.requests).toEqual([]);
  });

  it("reads tex1 meta tags and direct zip downloads", async () => {
    const d = await texturecan.getAsset!("591", fixtureCtx(routes));
    expect(d).toMatchObject({
      title: "Laminated Long Brown Wood Planks",
      categories: ["Wood"],
      createdAt: "2022-12-20",
      resolutions: ["1k", "2k", "4k"],
      downloadable: true,
    });
    expect(d!.tags).toContain("laminated");
    expect(d!.files.map((f) => [f.resolution, f.group])).toEqual([
      ["1k", "textures"],
      ["2k", "textures"],
      ["4k", "textures"],
      [undefined, "sbsar"],
    ]);
    expect(d!.files[0]).toMatchObject({
      url: "https://www.texturecan.com/downloads/wood_0066/wood_0066_1k_HoQeAg.zip",
      filename: "wood_0066_1k_HoQeAg.zip",
      format: "zip",
    });
  });

  it("resolves model details", async () => {
    const d = await texturecan.getAsset!("model-547", fixtureCtx(routes));
    expect(d).toMatchObject({ type: "model", url: "https://www.texturecan.com/models/details/547/", categories: ["Finance"] });
    expect(d!.files[0]).toMatchObject({ format: "zip", group: "model" });
    expect(await texturecan.getAsset!("not-an-id", fixtureCtx(routes))).toBeNull();
  });
});
