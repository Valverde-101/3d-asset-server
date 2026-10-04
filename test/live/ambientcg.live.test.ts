import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { ambientcg } from "../../src/providers/ambientcg.js";

const ctx = { fetch: createHttpClient() };

describe.skipIf(!process.env.LIVE)("ambientcg (live)", () => {
  it("searches and resolves a downloadable asset", async () => {
    const r = await ambientcg.search({ query: "wood", types: ["material"], limit: 3 }, ctx);
    expect(r.assets.length).toBeGreaterThan(0);
    const first = r.assets[0]!;
    expect(first).toMatchObject({ provider: "ambientcg", downloadable: true });

    const d = await ambientcg.getAsset!(first.nativeId, ctx);
    expect(d?.files.length).toBeGreaterThan(0);
    const smallest = [...d!.files].sort((a, b) => (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0))[0]!;
    // Plain GET (redirects to the CDN), no login: only read the first bytes.
    const res = await ctx.fetch.raw(smallest.url, { headers: { range: "bytes=0-3" } });
    expect([200, 206]).toContain(res.status);
    const head = new Uint8Array(await res.arrayBuffer()).slice(0, 2);
    expect(String.fromCharCode(...head)).toBe("PK");
  });
});
