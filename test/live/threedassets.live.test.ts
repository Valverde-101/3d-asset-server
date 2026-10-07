import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { threedassets } from "../../src/providers/threedassets.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("threedassets (live)", () => {
  it("searches, resolves a GLB and counts the catalogue", async () => {
    const r = await threedassets.search({ query: "tree", limit: 3 }, ctx);
    expect(r.assets.length).toBeGreaterThan(0);
    const d = await threedassets.getAsset!(r.assets[0]!.nativeId, ctx);
    expect(d?.files.length).toBeGreaterThan(0);
    const head = await ctx.fetch.raw(d!.files[0]!.url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toMatch(/gltf|octet-stream/);

    const c = await threedassets.census!(ctx);
    expect(c.total).toBeGreaterThan(0);
  });
});
