import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { texturecan } from "../../src/providers/texturecan.js";

const ctx = { fetch: createHttpClient() };

describe.skipIf(!process.env.LIVE)("texturecan (live)", () => {
  it("searches and resolves a direct zip download", async () => {
    const r = await texturecan.search({ query: "wood", types: ["material"], limit: 3 }, ctx);
    expect(r.assets.length).toBeGreaterThan(0);
    expect(r.assets[0]).toMatchObject({ provider: "texturecan", type: "material", downloadable: true });

    const d = await texturecan.getAsset!(r.assets[0]!.nativeId, ctx);
    const file = d!.files.find((f) => f.resolution === "1k") ?? d!.files[0]!;
    // Plain GET, no login: only read the first bytes.
    const res = await ctx.fetch.raw(file.url, { headers: { range: "bytes=0-3" } });
    expect([200, 206]).toContain(res.status);
    const head = new Uint8Array(await res.arrayBuffer()).slice(0, 2);
    expect(String.fromCharCode(...head)).toBe("PK");
  });

  it("lists models", async () => {
    const r = await texturecan.search({ query: "", types: ["model"], limit: 3 }, ctx);
    expect(r.assets.length).toBeGreaterThan(0);
    expect(r.assets.every((a) => a.type === "model")).toBe(true);
  });
});
