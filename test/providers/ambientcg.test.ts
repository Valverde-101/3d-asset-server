import { describe, expect, it } from "vitest";
import { ambientcg } from "../../src/providers/ambientcg.js";
import { fixtureCtx } from "../helpers.js";

const routes: [RegExp, string][] = [
  [/[?&]id=3DApple002&/, "ambientcg/asset_3DApple002.json"],
  [/[?&]id=DaySkyHDRI071B&/, "ambientcg/asset_DaySkyHDRI071B.json"],
  [/\/api\/v3\/assets\?q=apple&type=terrain%2C3d-model&/, "ambientcg/search_apple_models.json"],
  [/\/api\/v3\/assets\?q=wood&sort=popular&/, "ambientcg/search_wood.json"],
];

describe("ambientcg", () => {
  it("searches the v3 API sorted by popularity", async () => {
    const ctx = fixtureCtx(routes);
    const r = await ambientcg.search({ query: "wood", limit: 3 }, ctx);
    expect(ctx.fetch.requests).toHaveLength(1);
    expect(ctx.fetch.requests[0]).toContain("sort=popular");
    expect(ctx.fetch.requests[0]).toContain("limit=3");
    expect(r.total).toBeGreaterThan(3);
    expect(r.assets).toHaveLength(3);
    expect(r.assets[0]).toMatchObject({
      id: "ambientcg:Wood096",
      type: "material",
      url: "https://ambientcg.com/a/Wood096",
      downloadable: true,
      license: { name: "CC0" },
      price: { free: true },
    });
    expect(r.assets[0]?.formats).toEqual(expect.arrayContaining(["jpg", "png"]));
    expect(r.assets[0]?.resolutions).toEqual(expect.arrayContaining(["1k", "2k", "4k"]));
    expect(r.assets[0]?.thumbnailUrl).toMatch(/^https:\/\/.*Wood096\.jpg$/);
    expect(r.searchUrl).toBe("https://ambientcg.com/list?q=wood&sort=popular");
  });

  it("maps requested types to ambientCG types", async () => {
    const ctx = fixtureCtx(routes);
    const r = await ambientcg.search({ query: "apple", types: ["model"], limit: 3 }, ctx);
    expect(ctx.fetch.requests[0]).toContain("type=terrain%2C3d-model");
    expect(r.assets.map((a) => a.type)).toEqual(["model", "model", "model"]);
    expect(r.assets[0]?.formats).toContain("obj");
  });

  it("skips the request when types do not apply", async () => {
    const ctx = fixtureCtx(routes);
    const r = await ambientcg.search({ query: "x", types: ["audio"], limit: 10 }, ctx);
    expect(r.assets).toEqual([]);
    expect(ctx.fetch.requests).toEqual([]);
  });

  it("returns direct zip downloads per resolution and format", async () => {
    const d = await ambientcg.getAsset!("3DApple002", fixtureCtx(routes));
    expect(d).toMatchObject({ id: "ambientcg:3DApple002", type: "model", downloadable: true });
    const f = d!.files.find((x) => x.filename === "3DApple002_LQ-1K-JPG.zip");
    expect(f).toMatchObject({
      url: "https://ambientcg.com/get?file=3DApple002_LQ-1K-JPG.zip",
      format: "zip",
      resolution: "1k",
      group: "lq-jpg",
    });
    expect(f?.sizeBytes).toBeGreaterThan(0);
    expect(d!.files.every((x) => x.url.startsWith("https://ambientcg.com/get?file="))).toBe(true);
  });

  it("returns HDRI zips with exr", async () => {
    const d = await ambientcg.getAsset!("DaySkyHDRI071B", fixtureCtx(routes));
    expect(d?.type).toBe("hdri");
    expect(d?.formats).toContain("exr");
    expect(d?.files.map((f) => f.resolution)).toContain("16k");
    expect(d?.files[0]).toMatchObject({ format: "zip", group: "archive" });
  });

  it("returns null for unknown or invalid ids", async () => {
    expect(await ambientcg.getAsset!("Bad,Id", fixtureCtx(routes))).toBeNull();
  });
});
