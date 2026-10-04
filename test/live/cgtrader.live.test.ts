import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { CgtraderBlockedError, cgtrader } from "../../src/providers/cgtrader.js";

const ctx = { fetch: createHttpClient() };

describe.skipIf(!process.env.LIVE)("cgtrader (live)", () => {
  it("searches free models and parses a product page", async (t) => {
    let r;
    try {
      r = await cgtrader.search({ query: "chair", freeOnly: true, limit: 3 }, ctx);
    } catch (e) {
      // CGTrader's AWS WAF challenges many cloud/datacenter IPs; that is an environment
      // limitation, not a parser regression, so skip with the reason instead of failing.
      if (e instanceof CgtraderBlockedError) return t.skip(e.message);
      throw e;
    }
    expect(r.assets.length).toBeGreaterThan(0);
    expect(r.assets.every((a) => a.price?.free && a.type === "model")).toBe(true);

    const d = await cgtrader.getAsset!(r.assets[0]!.nativeId, ctx);
    expect(d?.url).toMatch(/^https:\/\/www\.cgtrader\.com\//);
    expect(d?.title).toBeTruthy();
    expect(d?.downloadable).toBe(false);
  });
});
