import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { threedtexel } from "../../src/providers/threedtexel.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("threedtexel (live)", () => {
  it("searches materials and resolves one asset", async () => {
    const r = await threedtexel.search({ query: "brick", types: ["material"], limit: 3 }, ctx);
    expect(r.assets.length).toBeGreaterThan(0);
    expect(r.assets[0]).toMatchObject({ provider: "threedtexel", downloadable: false });

    const d = await threedtexel.getAsset!(r.assets[0]!.nativeId, ctx);
    expect(d?.id).toBe(r.assets[0]!.id);
  });

  it("counts the library", async () => {
    const c = await threedtexel.census!(ctx);
    expect(c.total).toBeGreaterThan(0);
  });
});
