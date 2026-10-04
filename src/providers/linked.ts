/**
 * Sources that sit behind bot protection (HTTP 403 to non-browser clients) and
 * have no public API. We expose them as deep links so a search still tells the
 * user where else to look.
 */
import { qs } from "../core/util.js";
import { linkProvider } from "./link.js";

export const fab = linkProvider({
  id: "fab",
  name: "Fab",
  homepage: "https://www.fab.com",
  description: "Epic's marketplace (formerly Unreal Marketplace, Sketchfab Store, Quixel): game-ready models, environments, characters, materials.",
  assetTypes: ["model", "material", "texture", "pack", "audio"],
  pricing: "freemium",
  buildSearchUrl: (q) => `https://www.fab.com/search${qs({ q: q.query, is_free: q.freeOnly ? 1 : undefined })}`,
});

export const poliigon = linkProvider({
  id: "poliigon",
  name: "Poliigon",
  homepage: "https://www.poliigon.com",
  description: "Premium photoreal PBR materials, HDRIs and models (subscription, with a free selection).",
  assetTypes: ["material", "texture", "hdri", "model"],
  pricing: "freemium",
  buildSearchUrl: (q) =>
    q.query.trim() ? `https://www.poliigon.com/search/${encodeURIComponent(q.query.trim())}` : "https://www.poliigon.com/search",
});

export const turbosquid = linkProvider({
  id: "turbosquid",
  name: "TurboSquid",
  homepage: "https://www.turbosquid.com",
  description: "Large marketplace of free and paid 3D models.",
  assetTypes: ["model"],
  pricing: "freemium",
  buildSearchUrl: (q) => {
    const term = encodeURIComponent(q.query.trim().replace(/\s+/g, "-"));
    const base = `https://www.turbosquid.com/Search/3D-Models${q.freeOnly ? "/free" : ""}`;
    return term ? `${base}/${term}` : base;
  },
});
