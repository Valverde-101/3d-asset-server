import { afterEach, describe, expect, it, vi } from "vitest";
import type { HttpRequestInit } from "../../src/core/types.js";
import { blenderkit } from "../../src/providers/blenderkit.js";
import { fixtureCtx } from "../helpers.js";

const FREE = "7bea2b93-30ac-4ee2-8414-c5e1f712911e";
const PAID = "99286ccd-5514-442b-ad36-468400a40164";

const routes: [RegExp, string][] = [
  [new RegExp(`/search/\\?query=asset_base_id%3A${FREE}`), "blenderkit/asset_free.json"],
  [new RegExp(`/search/\\?query=asset_base_id%3A${PAID}`), "blenderkit/asset_paid.json"],
  [/\/search\/\?query=chair\+asset_type%3Amodel%2Cprintable%2Cscene/, "blenderkit/search_chair.json"],
  [/\/downloads\/71be19e1-c220-489c-bc7d-3c7831f62691\/\?scene_uuid=[0-9a-f-]{36}$/, "blenderkit/download_71be19e1-c220-489c-bc7d-3c7831f62691.json"],
  [/\/downloads\/f7c7357a-6f00-43b3-a4fc-319eeb8d2d6b\/\?scene_uuid=[0-9a-f-]{36}$/, "blenderkit/download_f7c7357a-6f00-43b3-a4fc-319eeb8d2d6b.json"],
  [/\/downloads\/250ead8f-de8f-4d46-a9ce-adedc09d2ae2\/\?scene_uuid=[0-9a-f-]{36}$/, "blenderkit/download_250ead8f-de8f-4d46-a9ce-adedc09d2ae2.json"],
];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("blenderkit", () => {
  it("searches with asset_type filters and maps metadata", async () => {
    const ctx = fixtureCtx(routes);
    const r = await blenderkit.search({ query: "chair", types: ["model"], limit: 3 }, ctx);
    expect(ctx.fetch.requests).toEqual([
      "https://www.blenderkit.com/api/v1/search/?query=chair+asset_type%3Amodel%2Cprintable%2Cscene&page_size=3",
    ]);
    expect(r.total).toBeGreaterThan(3);
    expect(r.assets).toHaveLength(3);
    expect(r.assets[0]).toMatchObject({
      id: `blenderkit:${FREE}`,
      title: "Dining table and chairs set",
      type: "model",
      url: `https://www.blendkit.com/asset-gallery-detail/${FREE}/`,
      author: "dleon3D León",
      license: { name: "Royalty Free", commercialUse: true },
      price: { free: true },
      polyCount: 20384,
      rigged: false,
      downloadable: true,
    });
    expect(r.assets[0]?.formats).toEqual(expect.arrayContaining(["blend", "glb"]));
    expect(r.assets[0]?.resolutions).toEqual(["0.5k", "1k", "2k", "4k"]);
    expect(r.assets[0]?.thumbnailUrl).toMatch(/^https:\/\/public\.blenderkit\.com\/thumbnails\//);
    expect(r.assets[0]?.tags).toContain("chair");
    expect(r.searchUrl).toBe(
      "https://www.blendkit.com/asset-gallery?query=chair+asset_type%3Amodel%2Cprintable%2Cscene",
    );
  });

  it("adds is_free:true for freeOnly and skips unsupported types", async () => {
    const ctx = fixtureCtx(routes);
    await blenderkit.search({ query: "chair", types: ["hdri"], freeOnly: true, limit: 5 }, ctx).catch(() => undefined);
    expect(ctx.fetch.requests[0]).toContain("query=chair+asset_type%3Ahdr+is_free%3Atrue");

    const ctx2 = fixtureCtx(routes);
    const r = await blenderkit.search({ query: "x", types: ["audio"], limit: 5 }, ctx2);
    expect(r.assets).toEqual([]);
    expect(ctx2.fetch.requests).toEqual([]);
  });

  it("resolves free files to signed CDN URLs", async () => {
    const ctx = fixtureCtx(routes);
    const d = await blenderkit.getAsset!(FREE, ctx);
    expect(d).toMatchObject({ id: `blenderkit:${FREE}`, downloadable: true });
    expect(d!.files).toHaveLength(3);
    const glb = d!.files.find((f) => f.group === "gltf");
    expect(glb).toMatchObject({ format: "glb", sizeBytes: 690468 });
    expect(glb?.url).toMatch(/^https:\/\/assets\.blenderkit\.com\/.*\.glb\?verify=/);
    expect(glb?.requiresAuth).toBeUndefined();
    expect(d!.files.find((f) => f.resolution === "1k")).toMatchObject({ format: "blend", group: "resolutions" });
    // Thumbnails are not resolved.
    expect(ctx.fetch.requests.filter((u) => u.includes("/downloads/"))).toHaveLength(3);
  });

  it("marks paid assets as requiring auth without calling the download API", async () => {
    const ctx = fixtureCtx(routes);
    const d = await blenderkit.getAsset!(PAID, ctx);
    expect(d).toMatchObject({ downloadable: false, price: { free: false } });
    expect(d!.files.length).toBeGreaterThan(0);
    expect(d!.files.every((f) => f.requiresAuth && f.url === d!.url)).toBe(true);
    expect(ctx.fetch.requests.some((u) => u.includes("/downloads/"))).toBe(false);
  });

  it("sends the API key as a bearer token when configured", async () => {
    vi.stubEnv("BLENDERKIT_API_KEY", "secret-key");
    const ctx = fixtureCtx(routes);
    const seen: (HttpRequestInit | undefined)[] = [];
    const json = ctx.fetch.json.bind(ctx.fetch);
    ctx.fetch.json = (async (url: string, init?: HttpRequestInit) => {
      seen.push(init);
      return json(url, init);
    }) as typeof ctx.fetch.json;
    await blenderkit.search({ query: "chair", types: ["model"], limit: 3 }, ctx);
    expect(seen[0]?.headers).toMatchObject({ authorization: "Bearer secret-key" });
  });

  it("rejects ids that are not uuids", async () => {
    const ctx = fixtureCtx(routes);
    expect(await blenderkit.getAsset!("not-a-uuid", ctx)).toBeNull();
    expect(ctx.fetch.requests).toEqual([]);
  });
});
