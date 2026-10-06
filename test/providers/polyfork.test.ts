import { describe, expect, it } from "vitest";
import type { HttpClient } from "../../src/core/types.js";
import { polyfork } from "../../src/providers/polyfork.js";
import { fixtureCtx } from "../helpers.js";

const FREE = "geyser-cone-2b5033";
const PAID = "ginkgo-tree-baa895";

const routes: [RegExp, string][] = [
  [/\/api\/assets\?q=rock&free=1&per_page=5$/, "polyfork/search_rock_free.json"],
  [/\/api\/assets\?q=rock&page=2&per_page=5$/, "polyfork/search_rock_p2.json"],
  [/\/api\/assets\?q=rock&per_page=5$/, "polyfork/search_rock.json"],
  [new RegExp(`/api/assets/${FREE}$`), "polyfork/asset_free.json"],
  [new RegExp(`/api/assets/${PAID}$`), "polyfork/asset_paid.json"],
];

describe("polyfork", () => {
  it("searches the API and maps metadata", async () => {
    const ctx = fixtureCtx(routes);
    const r = await polyfork.search({ query: "rock", limit: 5 }, ctx);
    expect(ctx.fetch.requests).toEqual(["https://polyfork.dev/api/assets?q=rock&per_page=5"]);
    expect(r.total).toBeGreaterThan(5);
    expect(r.assets).toHaveLength(5);
    expect(r.assets[0]).toMatchObject({
      id: "polyfork:lava-rock-pile-d56d19",
      provider: "polyfork",
      title: "Lava Rock Pile",
      type: "model",
      url: "https://polyfork.dev/asset/lava-rock-pile-d56d19",
      thumbnailUrl: "https://polyfork.dev/files/lava-rock-pile-d56d19/renders/hero.png",
      license: { name: "Royalty Free", commercialUse: true, attributionRequired: false },
      price: { free: false },
      downloadable: false,
    });
    expect(r.assets[0]?.polyCount).toBeGreaterThan(0);
    expect(r.assets[0]?.categories).toContain("prop");
    const free = r.assets.find((a) => a.nativeId === "rock-cave-ledge-2a9532");
    expect(free).toMatchObject({ price: { free: true }, downloadable: true });
    expect(r.searchUrl).toBe("https://polyfork.dev/assets?q=rock");
  });

  it("filters free assets server-side and skips non-model types", async () => {
    const ctx = fixtureCtx(routes);
    const r = await polyfork.search({ query: "rock", freeOnly: true, limit: 5 }, ctx);
    expect(ctx.fetch.requests).toEqual(["https://polyfork.dev/api/assets?q=rock&free=1&per_page=5"]);
    expect(r.assets.length).toBeGreaterThan(0);
    expect(r.assets.every((a) => a.price?.free && a.downloadable)).toBe(true);

    const ctx2 = fixtureCtx(routes);
    expect((await polyfork.search({ query: "rock", types: ["hdri", "texture"], limit: 5 }, ctx2)).assets).toEqual([]);
    expect(ctx2.fetch.requests).toEqual([]);
  });

  it("maps offset to the API's pages", async () => {
    const ctx = fixtureCtx(routes);
    const r = await polyfork.search({ query: "rock", limit: 5, offset: 5 }, ctx);
    expect(ctx.fetch.requests).toEqual(["https://polyfork.dev/api/assets?q=rock&page=2&per_page=5"]);
    expect(r.assets[0]?.nativeId).toBe("garden-rock-7f5d60");
  });

  it("gives free assets a direct CDN GLB", async () => {
    const d = await polyfork.getAsset!(FREE, fixtureCtx(routes));
    expect(d).toMatchObject({ id: `polyfork:${FREE}`, title: "Geyser Cone", downloadable: true, price: { free: true } });
    const direct = d!.files.filter((f) => !f.requiresAuth);
    expect(direct).toEqual([{ url: `https://polyfork.dev/cdn/${FREE}.glb`, filename: `${FREE}.glb`, format: "glb", group: "glb" }]);
    // FBX / USDZ / OBJ exports need a Polyfork account.
    expect(d!.files.filter((f) => f.requiresAuth).map((f) => f.format).sort()).toEqual(["fbx", "obj", "usdz"]);
    expect(d!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("marks every file of a paid asset as requiring auth", async () => {
    const d = await polyfork.getAsset!(PAID, fixtureCtx(routes));
    expect(d).toMatchObject({ downloadable: false, price: { free: false } });
    expect(d!.files.length).toBeGreaterThan(0);
    expect(d!.files.every((f) => f.requiresAuth && f.url === d!.url)).toBe(true);
  });

  it("returns null for unknown or malformed ids", async () => {
    const ctx = fixtureCtx(routes);
    expect(await polyfork.getAsset!("no-such-asset", ctx)).toBeNull();
    expect(await polyfork.getAsset!("../etc", ctx)).toBeNull();
    expect(ctx.fetch.requests).toEqual(["https://polyfork.dev/api/assets/no-such-asset"]);
  });

  it("counts total, free and per-class listings", async () => {
    const totals: Record<string, number> = { "": 2011, free: 821, prop: 1271, building: 294, vehicle: 126, character: 89, animal: 82, ultra: 86, attachment: 48, terrain: 13, hand: 2 };
    const urls: string[] = [];
    const http = {
      async json(url: string) {
        urls.push(url);
        const p = new URL(url).searchParams;
        expect(p.get("per_page")).toBe("1");
        return { total: totals[p.get("free") ? "free" : (p.get("class") ?? "")], assets: [] };
      },
    } as unknown as HttpClient;
    const c = await polyfork.census!({ fetch: http });
    expect(c).toMatchObject({ total: 2011, free: 821, byType: { model: 2011 } });
    expect(Object.keys(c.categories!)[0]).toBe("prop");
    expect(Object.values(c.categories!).reduce((a, b) => a + b, 0)).toBe(2011);
    expect(urls).toHaveLength(11);
  });
});
