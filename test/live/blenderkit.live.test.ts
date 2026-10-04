import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { blenderkit } from "../../src/providers/blenderkit.js";

const ctx = { fetch: createHttpClient() };

describe.skipIf(!process.env.LIVE)("blenderkit (live)", () => {
  it("searches free models and resolves a signed download URL", async () => {
    const r = await blenderkit.search({ query: "chair", types: ["model"], freeOnly: true, limit: 5 }, ctx);
    expect(r.assets.length).toBeGreaterThan(0);
    expect(r.assets.every((a) => a.price?.free)).toBe(true);
    const first = r.assets.find((a) => a.downloadable)!;
    expect(first).toBeDefined();

    const d = await blenderkit.getAsset!(first.nativeId, ctx);
    const files = d!.files.filter((f) => !f.requiresAuth);
    expect(files.length).toBeGreaterThan(0);
    const smallest = [...files].sort((a, b) => (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0))[0]!;
    // Plain GET, no auth headers or cookies: only read the first bytes.
    const res = await ctx.fetch.raw(smallest.url, { headers: { range: "bytes=0-3" } });
    expect([200, 206]).toContain(res.status);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
});
