import { describe, expect, it } from "vitest";
import { craftpix } from "../../src/providers/craftpix.js";
import { fixtureCtx } from "../helpers.js";

describe("CraftPix link provider", () => {
  it("creates a product search URL and never fetches or copies listings", async () => {
    const ctx = fixtureCtx([]);
    const result = await craftpix.search({ query: "low poly knight & shield", limit: 12 }, ctx);
    const searchUrl = new URL(result.searchUrl!);

    expect(craftpix).toMatchObject({ id: "craftpix", access: "link", pricing: "freemium", supportsDownload: false });
    expect(result.assets).toEqual([]);
    expect(searchUrl.origin).toBe("https://craftpix.net");
    expect(searchUrl.searchParams.get("s")).toBe("low poly knight & shield");
    expect(searchUrl.searchParams.get("post_type")).toBe("product");
    expect(ctx.fetch.requests).toEqual([]);
  });

  it("opens the CraftPix home page when the search is empty", () => {
    expect(craftpix.buildSearchUrl({ query: "", limit: 1 })).toBe("https://craftpix.net/");
  });
});
