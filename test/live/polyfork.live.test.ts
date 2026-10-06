import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { polyfork } from "../../src/providers/polyfork.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("polyfork (live)", () => {
  it("searches free models and serves the GLB with a plain GET", async () => {
    const r = await polyfork.search({ query: "rock", freeOnly: true, limit: 5 }, ctx);
    expect(r.assets.length).toBeGreaterThan(0);
    expect(r.assets.every((a) => a.price?.free)).toBe(true);

    const d = await polyfork.getAsset!(r.assets[0]!.nativeId, ctx);
    const glb = d!.files.find((f) => !f.requiresAuth)!;
    expect(glb).toMatchObject({ format: "glb" });
    const res = await ctx.fetch.raw(glb.url, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/model\/gltf-binary|octet-stream/);
  });

  it("counts the catalogue", async () => {
    const c = await polyfork.census!(ctx);
    expect(c.total).toBeGreaterThan(0);
    expect(c.free).toBeGreaterThan(0);
  });
});
