import { describe, expect, it } from "vitest";
import { hdrmaps } from "../../src/providers/hdrmaps.js";
import { fixtureCtx } from "../helpers.js";

const routes: [string | RegExp, string][] = [
  ["/products?slug=jawornik-before-the-sunset", "hdrmaps/product_jawornik.json"],
  ["/freebies/jawornik-before-the-sunset/", "hdrmaps/freebie_jawornik.html"],
  [/\/wc\/store\/v1\/products\?search=sunset/, "hdrmaps/search_sunset.json"],
];

describe("hdrmaps", () => {
  it("searches the WooCommerce Store API and maps prices", async () => {
    const ctx = fixtureCtx(routes);
    const r = await hdrmaps.search({ query: "sunset", limit: 10 }, ctx);
    expect(ctx.fetch.requests[0]).toContain("category_operator=not_in");
    // Hidden reseller products ("HDRI Map 947") are dropped.
    expect(r.assets.map((a) => a.nativeId)).toEqual([
      "jawornik-before-the-sunset",
      "kalten-floss-sunset",
      "egg-hill-clear-sky-sunset",
    ]);
    expect(r.assets[0]).toMatchObject({
      type: "hdri",
      price: { free: true },
      downloadable: true,
      resolutions: ["10k"],
      url: "https://hdrmaps.com/freebies/jawornik-before-the-sunset/",
      license: { name: "Royalty Free" },
    });
    expect(r.assets[0]!.tags).toContain("sunset");
    expect(r.assets[1]).toMatchObject({
      price: { free: false, amount: 7, currency: "EUR" },
      downloadable: false,
      resolutions: ["30k"],
    });
  });

  it("restricts to freebies for freeOnly", async () => {
    const ctx = fixtureCtx(routes);
    const r = await hdrmaps.search({ query: "sunset", limit: 10, freeOnly: true }, ctx);
    expect(ctx.fetch.requests[0]).toContain("category=64");
    expect(r.assets.every((a) => a.price?.free)).toBe(true);
    expect(r.assets).toHaveLength(2);
  });

  it("skips the request when types do not apply", async () => {
    const ctx = fixtureCtx(routes);
    const r = await hdrmaps.search({ query: "x", types: ["texture"], limit: 5 }, ctx);
    expect(r.assets).toEqual([]);
    expect(ctx.fetch.requests).toEqual([]);
  });

  it("returns direct EXR files for freebies", async () => {
    const d = await hdrmaps.getAsset!("jawornik-before-the-sunset", fixtureCtx(routes));
    expect(d?.downloadable).toBe(true);
    expect(d?.resolutions).toEqual(["10k", "4k", "2k", "1k"]);
    expect(d?.files[1]).toEqual({
      url: "https://dl.hdrmaps.com/file/hmfreebies/hdris/197_hdrmaps_com_free_4K.exr",
      filename: "197_hdrmaps_com_free_4K.exr",
      format: "exr",
      resolution: "4k",
      sizeBytes: Math.round(80.21 * 1024 ** 2),
      group: "hdri",
    });
    expect(d?.files).toHaveLength(4);
  });
});
