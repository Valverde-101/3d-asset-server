import { linkProvider } from "./link.js";

/** CraftPix has a public site search, but no documented API/feed we can use safely. */
export const craftpix = linkProvider({
  id: "craftpix",
  name: "CraftPix",
  homepage: "https://craftpix.net/",
  description: "Free and premium 2D and 3D game assets, including sprites, UI, tilesets, models and asset packs. Searches open on CraftPix.",
  assetTypes: ["model", "sprite", "ui", "texture", "pack"],
  pricing: "freemium",
  buildSearchUrl(query) {
    const text = query.query.trim();
    if (!text) return "https://craftpix.net/";
    const params = new URLSearchParams({ s: text, post_type: "product" });
    return `https://craftpix.net/?${params.toString()}`;
  },
});
