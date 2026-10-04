import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { hdrihub } from "../../src/providers/hdrihub.js";

const ctx = { fetch: createHttpClient() };

describe.skipIf(!process.env.LIVE)("hdrihub (live)", () => {
  it("searches the shop and reads product details", async () => {
    const r = await hdrihub.search({ query: "sky", types: ["hdri"], limit: 3 }, ctx);
    expect(r.assets.length).toBeGreaterThan(0);
    expect(r.assets[0]).toMatchObject({ provider: "hdrihub", type: "hdri", downloadable: false });
    expect(r.assets[0]!.price?.free).toBe(false);

    const d = await hdrihub.getAsset!(r.assets[0]!.nativeId, ctx);
    expect(d?.title).toBeTruthy();
    expect(d?.price?.amount).toBeGreaterThan(0);
  });

  it("browses free samples", async () => {
    const r = await hdrihub.search({ query: "", freeOnly: true, limit: 5 }, ctx);
    expect(r.assets.length).toBeGreaterThan(0);
    expect(r.assets.every((a) => a.price?.free)).toBe(true);
  });
});
