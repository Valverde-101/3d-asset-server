import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { cgbookcase } from "../../src/providers/cgbookcase.js";

const ctx = { fetch: createHttpClient() };

describe.skipIf(!process.env.LIVE)("cgbookcase (live)", () => {
  it("searches the catalogue and lists per-resolution zips", async () => {
    const r = await cgbookcase.search({ query: "brick", limit: 3 }, ctx);
    expect(r.assets.length).toBeGreaterThan(0);
    expect(r.assets[0]).toMatchObject({ provider: "cgbookcase", license: { name: "CC0" } });
    const thumb = await ctx.fetch.raw(r.assets[0]!.thumbnailUrl!, { method: "HEAD" });
    expect(thumb.status).toBe(200);

    const d = await cgbookcase.getAsset!(r.assets[0]!.nativeId, ctx);
    expect(d?.files.length).toBeGreaterThan(0);
    expect(d!.files.every((f) => f.format === "zip" && f.resolution)).toBe(true);
  });
});
