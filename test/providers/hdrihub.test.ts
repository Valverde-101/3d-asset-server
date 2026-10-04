import { describe, expect, it } from "vitest";
import { hdrihub, mediaUrl, typeFromPath } from "../../src/providers/hdrihub.js";
import { fixtureCtx } from "../helpers.js";

const routes: [string, string][] = [
  ["/search?q=garage", "hdrihub/search_garage.html"],
  ["/search?q=free", "hdrihub/search_free.html"],
  ["/search?q=night+garage", "hdrihub/search_empty.html"],
  ["/search?q=zzzz", "hdrihub/search_empty.html"],
  ["/shop/hdri/space/hdr-180-8-space-sky-and-nebula", "hdrihub/product_hdr-180-8.html"],
  ["/shop/hdri", "hdrihub/category_hdri.html"],
];

describe("hdrihub", () => {
  it("maps paths and image URLs", () => {
    expect(typeFromPath("hdri/space/x")).toBe("hdri");
    expect(typeFromPath("backplates/sets-bundles/x")).toBe("other");
    expect(typeFromPath("3d-models/3d-people/x")).toBe("model");
    expect(typeFromPath("free-samples/free-hdri-downloads/x")).toBe("hdri");
    expect(typeFromPath("free-samples/free-3d-people-models-for-architectural-visualization/x")).toBe("model");
    expect(mediaUrl("/_next/image?url=%2Fapi%2Fmedia%2Ffile%2Fhdr-1-featured-3-400x267.jpg&w=828&q=75")).toBe(
      "https://www.hdri-hub.com/media/hdr-1-featured-3-400x267.jpg",
    );
  });

  it("scrapes search cards, ignoring the featured carousel and resolving streamed cards", async () => {
    const r = await hdrihub.search({ query: "garage", limit: 10 }, fixtureCtx(routes));
    expect(r.total).toBe(8);
    expect(r.assets.map((a) => a.nativeId)).toEqual([
      "backplates/layout-private-use/hdr-039-garage-layout",
      "backplates/sets-bundles/hdr-039-garage-plates",
      "hdri/bundles/hdr-pack-005",
      "hdri/indoor/hdr-039-garage-2-16k",
    ]);
    expect(r.assets[2]).toMatchObject({
      title: "HDR Pack 005",
      type: "hdri",
      url: "https://www.hdri-hub.com/shop/hdri/bundles/hdr-pack-005",
      thumbnailUrl: "https://www.hdri-hub.com/media/hdr-pack-005-featured-3-400x267.jpg",
      price: { free: false, amount: 49, currency: "EUR" },
      downloadable: false,
    });
    // Card body streamed into <div hidden id="S:1">.
    expect(r.assets[3]).toMatchObject({ title: "HDR 039 Garage 2 16k", price: { free: false, amount: 20 } });
  });

  it("filters by type and free-only", async () => {
    const hdri = await hdrihub.search({ query: "garage", types: ["hdri"], limit: 10 }, fixtureCtx(routes));
    expect(hdri.assets.every((a) => a.type === "hdri")).toBe(true);
    expect(hdri.total).toBe(2);
    const free = await hdrihub.search({ query: "free", freeOnly: true, limit: 10 }, fixtureCtx(routes));
    expect(free.assets.length).toBe(2);
    expect(free.assets[0]).toMatchObject({ type: "model", price: { free: true } });
  });

  it("retries a multi-word query with its longest word", async () => {
    const ctx = fixtureCtx(routes);
    const r = await hdrihub.search({ query: "night garage", limit: 10 }, ctx);
    expect(ctx.fetch.requests.map((u) => new URL(u).search)).toEqual(["?q=night+garage", "?q=garage"]);
    expect(r.assets.length).toBeGreaterThan(0);
    const none = await hdrihub.search({ query: "zzzz", limit: 10 }, fixtureCtx(routes));
    expect(none).toMatchObject({ assets: [], total: 0 });
  });

  it("browses category JSON-LD with canonical ids when the query is empty", async () => {
    const r = await hdrihub.search({ query: "", limit: 2 }, fixtureCtx(routes));
    expect(r.assets.map((a) => a.nativeId)).toEqual([
      "hdri/space/hdr-180-8-space-sky-and-nebula",
      "hdri/space/hdr-180-5-space-sky-and-stars",
    ]);
    expect(r.assets[0]).toMatchObject({ type: "hdri", price: { free: false, amount: 9.9, currency: "USD" } });
  });

  it("reads product JSON-LD", async () => {
    const d = await hdrihub.getAsset!("hdri/space/hdr-180-8-space-sky-and-nebula", fixtureCtx(routes));
    expect(d).toMatchObject({
      title: "HDR 180-8 Space Sky with Nebula",
      type: "hdri",
      categories: ["Space"],
      price: { free: false, amount: 9.9, currency: "USD" },
      downloadable: false,
      files: [],
    });
    expect(d!.tags).toEqual(expect.arrayContaining(["space", "stars"]));
    expect(d!.resolutions).toContain("4k");
    expect(await hdrihub.getAsset!("../etc/passwd", fixtureCtx(routes))).toBeNull();
  });
});
