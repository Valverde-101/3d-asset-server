import { describe, expect, it } from "vitest";
import { CgtraderBlockedError, cgtrader } from "../../src/providers/cgtrader.js";
import { fixtureCtx } from "../helpers.js";

const routes: [RegExp, string][] = [
  [/\/search\?(page=\d+&)?free=1&keywords=wooden\+chair$/, "cgtrader/search_wooden_chair_free.json"],
  [/\/search\?(page=\d+&)?keywords=chair$/, "cgtrader/search_chair.json"],
  [/\/3d-model\/dining-chair-armrest-chair-walnut-wood-amir$/, "cgtrader/product_paid.html"],
  [/\/3d-model\/outdooring-wooden-chair-free$/, "cgtrader/product_free.html"],
  [/\/search\?keywords=blocked$/, "cgtrader/waf_challenge.html"],
];

describe("cgtrader", () => {
  it("searches free models via the listing JSON", async () => {
    const ctx = fixtureCtx(routes);
    const r = await cgtrader.search({ query: "wooden chair", freeOnly: true, limit: 3 }, ctx);
    expect(ctx.fetch.requests).toEqual(["https://www.cgtrader.com/search?free=1&keywords=wooden+chair"]);
    expect(r.total).toBe(12597);
    expect(r.assets).toHaveLength(3);
    expect(r.assets[0]).toMatchObject({
      id: "cgtrader:outdooring-wooden-chair-free",
      title: "Outdoor Wooden Chair Free",
      type: "model",
      url: "https://www.cgtrader.com/free-3d-models/furniture/chair/outdooring-wooden-chair-free",
      price: { free: true },
      downloadable: false,
      animated: false,
      rigged: false,
      categories: ["Furniture", "Chair"],
    });
    expect(r.assets[0]?.formats).toEqual(expect.arrayContaining(["fbx", "obj", "max"]));
    expect(r.assets[0]?.thumbnailUrl).toMatch(/^https:\/\/media\.cgtrader\.com\//);
    expect(r.searchUrl).toBe("https://www.cgtrader.com/search?free=1&keywords=wooden+chair");
  });

  it("returns prices for paid models", async () => {
    const r = await cgtrader.search({ query: "chair", limit: 2 }, fixtureCtx(routes));
    expect(r.assets[0]).toMatchObject({
      nativeId: "dining-chair-armrest-chair-walnut-wood-amir",
      price: { free: false, amount: 17, currency: "USD" },
    });
  });

  it("maps offsets onto the site's fixed 120-item pages", async () => {
    const ctx = fixtureCtx(routes);
    await cgtrader.search({ query: "chair", limit: 5, offset: 118 }, ctx);
    expect(ctx.fetch.requests).toEqual([
      "https://www.cgtrader.com/search?keywords=chair",
      "https://www.cgtrader.com/search?page=2&keywords=chair",
    ]);
    const ctx2 = fixtureCtx(routes);
    await cgtrader.search({ query: "chair", limit: 5, offset: 240 }, ctx2);
    expect(ctx2.fetch.requests).toEqual(["https://www.cgtrader.com/search?page=3&keywords=chair"]);
  });

  it("skips the request when types do not apply", async () => {
    const ctx = fixtureCtx(routes);
    const r = await cgtrader.search({ query: "x", types: ["hdri"], limit: 10 }, ctx);
    expect(r.assets).toEqual([]);
    expect(ctx.fetch.requests).toEqual([]);
  });

  it("parses product details from JSON-LD and React props", async () => {
    const d = await cgtrader.getAsset!("dining-chair-armrest-chair-walnut-wood-amir", fixtureCtx(routes));
    expect(d).toMatchObject({
      id: "cgtrader:dining-chair-armrest-chair-walnut-wood-amir",
      title: "Dining chair armrest chair walnut wood Amir",
      url: "https://www.cgtrader.com/3d-models/furniture/chair/dining-chair-armrest-chair-walnut-wood-amir",
      author: "cgdoca",
      price: { free: false, amount: 17, currency: "USD" },
      license: { name: "Royalty Free (no AI)", commercialUse: true },
      polyCount: 7416,
      downloadable: false,
      createdAt: "2025-06-30",
      categories: ["Furniture", "Chair"],
    });
    expect(d!.tags).toContain("walnut");
    expect(d!.description).toMatch(/^Name: Dining chair /);
    // Paragraph breaks become spaces.
    expect(d!.description).toContain("Renderer projects. Tags:");
    expect(d!.files.length).toBeGreaterThan(0);
    expect(d!.files.every((f) => f.requiresAuth && f.url === d!.url)).toBe(true);
    expect(d!.files.find((f) => f.format === "max")).toMatchObject({ group: "native" });
    expect(d!.files.find((f) => f.format === "fbx")?.sizeBytes).toBeGreaterThan(1_000_000);
  });

  it("parses free product pages", async () => {
    const d = await cgtrader.getAsset!("outdooring-wooden-chair-free", fixtureCtx(routes));
    expect(d).toMatchObject({ price: { free: true }, author: "merrilikusi", polyCount: 90288 });
    expect(d!.formats).toEqual(expect.arrayContaining(["max", "obj", "fbx"]));
  });

  it("returns null for unknown slugs and rejects bad ids", async () => {
    const ctx = fixtureCtx(routes);
    expect(await cgtrader.getAsset!("no-such-model", ctx)).toBeNull();
    expect(await cgtrader.getAsset!("../etc", ctx)).toBeNull();
    expect(ctx.fetch.requests).toEqual(["https://www.cgtrader.com/3d-model/no-such-model"]);
  });

  it("reports the AWS WAF challenge as a clear error", async () => {
    await expect(cgtrader.search({ query: "blocked", limit: 5 }, fixtureCtx(routes))).rejects.toBeInstanceOf(
      CgtraderBlockedError,
    );
  });
});
