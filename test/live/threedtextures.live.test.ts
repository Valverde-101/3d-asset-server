import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { threedtextures } from "../../src/providers/threedtextures.js";

const ctx = { fetch: createHttpClient() };

describe.skipIf(!process.env.LIVE)("threedtextures (live)", () => {
  it("searches posts and finds the Google Drive link", async () => {
    const r = await threedtextures.search({ query: "wood", limit: 3 }, ctx);
    expect(r.assets.length).toBeGreaterThan(0);
    expect(r.assets[0]).toMatchObject({ provider: "threedtextures", type: "material", downloadable: false });
    const d = await threedtextures.getAsset!(r.assets[0]!.nativeId, ctx);
    expect(d?.title).toBeTruthy();
    expect(d?.files.some((f) => f.group === "google-drive")).toBe(true);
  });
});
