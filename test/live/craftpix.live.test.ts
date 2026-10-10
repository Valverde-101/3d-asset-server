import { describe, expect, it } from "vitest";
import { craftpix } from "../../src/providers/craftpix.js";

describe.runIf(process.env.LIVE)("CraftPix public search (live)", () => {
  it("serves its public product search page", async () => {
    const url = craftpix.buildSearchUrl({ query: "low poly tree", limit: 1 });
    const response = await fetch(url, { headers: { "user-agent": "3d-asset-server source availability check" } });
    expect(response.status).toBe(200);
    expect(new URL(response.url).hostname).toBe("craftpix.net");
    // We check reachability only; we do not parse, index or retain the page content.
  }, 20_000);
});
