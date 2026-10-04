import { describe, expect, it } from "vitest";
import { cgbookcase } from "../../src/providers/cgbookcase.js";
import { fixtureCtx } from "../helpers.js";

const routes: [string, string][] = [
  ["/api/textures", "cgbookcase/textures.json"],
  ["/textures/brick-wall-29", "cgbookcase/texture_brick-wall-29.html"],
  ["/textures/manhole-cover-16", "cgbookcase/texture_manhole-cover-16.html"],
];

describe("cgbookcase", () => {
  it("filters the cached catalogue locally", async () => {
    const r = await cgbookcase.search({ query: "brick wall", limit: 5 }, fixtureCtx(routes));
    expect(r.assets.map((a) => a.id)).toEqual(["cgbookcase:brick-wall-29", "cgbookcase:brick-wall-04"]);
    expect(r.total).toBe(2);
    expect(r.assets[0]).toMatchObject({
      type: "material",
      url: "https://www.cgbookcase.com/textures/brick-wall-29",
      license: { name: "CC0" },
      downloadable: false,
      resolutions: ["1k", "2k", "3k", "4k"],
      thumbnailUrl: "https://cdn.cgbookcase.cloud/file/cgbookcase/textures/renders/bg_white/480w/Brick_wall_29_default.jpg",
    });
  });

  it("builds thumbnails for both render schemes and types plain photos as textures", async () => {
    const r = await cgbookcase.search({ query: "", limit: 10 }, fixtureCtx(routes));
    const manhole = r.assets.find((a) => a.nativeId === "manhole-cover-16");
    expect(manhole?.thumbnailUrl).toBe(
      "https://cgbookcase.b-cdn.net/textures/renders/2024_b/ManholeCover16_render_default.jpg?width=480",
    );
    expect(manhole?.resolutions).toEqual(["1k", "2k", "4k", "6k", "8k"]);
    expect(r.assets.find((a) => a.nativeId === "granite-08-large")?.thumbnailUrl).toContain("/Granite_08_large_default.jpg");
    expect(r.assets.find((a) => a.nativeId === "tree-07")?.type).toBe("texture");
    // Newest first when browsing.
    expect(r.assets[0]!.nativeId).toBe("manhole-cover-16");
  });

  it("only fetches the catalogue once per search and skips unrelated types", async () => {
    const ctx = fixtureCtx(routes);
    expect((await cgbookcase.search({ query: "x", types: ["model"], limit: 5 }, ctx)).assets).toEqual([]);
    expect(ctx.fetch.requests).toEqual([]);
  });

  it("lists per-resolution zips from the texture page", async () => {
    const d = await cgbookcase.getAsset!("brick-wall-29", fixtureCtx(routes));
    expect(d?.files.map((f) => f.filename)).toEqual([
      "BrickWall29_MR_1K.zip",
      "BrickWall29_MR_2K.zip",
      "BrickWall29_MR_3K.zip",
      "BrickWall29_MR_4K.zip",
    ]);
    expect(d?.files[0]).toMatchObject({
      url: "https://www.cgbookcase.com/textures/thanks?t=BrickWall29_MR_1K.zip&r=1&u=BrickWall29",
      format: "zip",
      resolution: "1k",
    });
    const m = await cgbookcase.getAsset!("manhole-cover-16", fixtureCtx(routes));
    expect(m?.files.map((f) => f.filename)).toContain("ManholeCover16_8K.zip");
    expect(await cgbookcase.getAsset!("no-such-texture", fixtureCtx(routes))).toBeNull();
  });
});
