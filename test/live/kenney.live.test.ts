import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { kenney } from "../../src/providers/kenney.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("kenney (live)", () => {
  it("finds 3D nature packs and resolves a direct zip", async () => {
    const r = await kenney.search({ query: "low poly tree pack", limit: 5 }, ctx);
    expect(r.assets.length).toBeGreaterThan(0);
    expect(r.assets.some((a) => a.type === "model")).toBe(true);
    const d = await kenney.getAsset!(r.assets[0]!.nativeId, ctx);
    const zip = d!.files.find((f) => f.group === "archive");
    expect(zip?.url).toMatch(/^https:\/\/kenney\.nl\/.+\.zip$/);
    const head = await ctx.fetch.raw(zip!.url, { method: "HEAD" });
    expect(head.headers.get("content-type")).toContain("zip");
  });
});
