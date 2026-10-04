import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { sharetextures } from "../../src/providers/sharetextures.js";

const ctx = { fetch: createHttpClient() };

describe.skipIf(!process.env.LIVE)("sharetextures (live)", () => {
  it("searches by tag and resolves item details", async () => {
    const r = await sharetextures.search({ query: "brick wall", limit: 3 }, ctx);
    expect(r.assets.length).toBeGreaterThan(0);
    expect(r.assets[0]).toMatchObject({ provider: "sharetextures", downloadable: false });
    expect(r.assets.every((a) => a.tags.some((t) => t.includes("brick")))).toBe(true);

    const d = await sharetextures.getAsset!(r.assets[0]!.nativeId, ctx);
    expect(d?.title).toBe(r.assets[0]!.title);
    expect(d?.resolutions?.length).toBeGreaterThan(0);
  });

  it("finds models", async () => {
    const r = await sharetextures.search({ query: "chair", types: ["model"], limit: 3 }, ctx);
    expect(r.assets.length).toBeGreaterThan(0);
    expect(r.assets.every((a) => a.type === "model")).toBe(true);
  });
});
