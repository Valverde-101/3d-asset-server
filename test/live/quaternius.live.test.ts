import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { quaternius } from "../../src/providers/quaternius.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("quaternius (live)", () => {
  it("finds nature packs and scrapes a pack page", async () => {
    const r = await quaternius.search({ query: "low poly tree pack", limit: 5 }, ctx);
    expect(r.assets.length).toBeGreaterThan(0);
    const d = await quaternius.getAsset!(r.assets[0]!.nativeId, ctx);
    expect(d?.title).toBeTruthy();
    expect(d!.formats?.length).toBeGreaterThan(0);
    expect(d!.files.length).toBeGreaterThan(0);
    expect(d!.files.every((f) => f.requiresAuth)).toBe(true);
  });
});
