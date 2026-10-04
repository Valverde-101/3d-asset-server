import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { hdrmaps } from "../../src/providers/hdrmaps.js";

const ctx = { fetch: createHttpClient() };

describe.skipIf(!process.env.LIVE)("hdrmaps (live)", () => {
  it("searches freebies and resolves a direct EXR download", async () => {
    const r = await hdrmaps.search({ query: "sunset", types: ["hdri"], freeOnly: true, limit: 3 }, ctx);
    expect(r.assets.length).toBeGreaterThan(0);
    expect(r.assets[0]).toMatchObject({ provider: "hdrmaps", type: "hdri", price: { free: true }, downloadable: true });

    const d = await hdrmaps.getAsset!(r.assets[0]!.nativeId, ctx);
    const smallest = [...d!.files].sort((a, b) => (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0))[0]!;
    expect(smallest.format).toBe("exr");
    // Plain GET, no login: only read the first bytes (OpenEXR magic 76 2f 31 01).
    const res = await ctx.fetch.raw(smallest.url, { headers: { range: "bytes=0-3" } });
    expect([200, 206]).toContain(res.status);
    expect([...new Uint8Array(await res.arrayBuffer()).slice(0, 4)]).toEqual([0x76, 0x2f, 0x31, 0x01]);
  });

  it("finds paid HDRIs with prices", async () => {
    const r = await hdrmaps.search({ query: "forest", limit: 5 }, ctx);
    expect(r.assets.some((a) => a.price?.free === false && (a.price.amount ?? 0) > 0)).toBe(true);
  });
});
