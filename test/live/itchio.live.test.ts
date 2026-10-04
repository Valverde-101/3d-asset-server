import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { itchio } from "../../src/providers/itchio.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("itchio (live)", () => {
  it("searches free 3D assets and reads details", async () => {
    const r = await itchio.search({ query: "low poly tree", types: ["model"], freeOnly: true, limit: 5 }, ctx);
    expect(r.assets.length).toBeGreaterThan(0);
    expect(r.assets.every((a) => a.price?.free)).toBe(true);
    const d = await itchio.getAsset!(r.assets[0]!.nativeId, ctx);
    expect(d?.title).toBeTruthy();
    expect(d!.url).toMatch(/\.itch\.io\//);
  });

  it("browses the free 3D listing", async () => {
    const r = await itchio.search({ query: "", types: ["model"], freeOnly: true, limit: 5 }, ctx);
    expect(r.assets.length).toBe(5);
  });
});
