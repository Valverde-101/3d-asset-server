import * as cheerio from "cheerio";
import type { Asset, AssetDetails, AssetFile, Provider, SearchQuery } from "../core/types.js";
import { LICENSES, filterLocal, makeAsset, paginate, qs, wantsType } from "../core/util.js";

/**
 * cgbookcase — ~570 free CC0 PBR textures (SvelteKit site).
 *
 * The whole catalogue is one JSON document (`/api/textures`, the same data the site embeds in
 * its /textures page), fetched once per hour and filtered locally.
 *
 * Downloads: the zips live on `cgbookcase-volume.b-cdn.net/t/<Name>_<res>K.zip`, but the CDN
 * has hotlink protection (403 without a cgbookcase Referer), so they are not plain-GET
 * downloadable. `getAsset` lists one file per resolution pointing at the site's own download
 * page (`/textures/thanks?t=…`), which starts that exact zip in a browser.
 */

const SITE = "https://www.cgbookcase.com";
const CATALOGUE_TTL = 60 * 60_000;
/** Textures from this id on use the 2024 naming/render scheme. */
const NEW_SCHEME_ID = 539;

interface CgTexture {
  id: number;
  title: string;
  tags?: string[];
  releasedate?: string;
  /** Max resolution in K. */
  resolution?: number;
  /** Map names, e.g. Base_Color, Normal. */
  files?: string[];
  colors?: string[];
  categories?: string[];
  /** pbr-procedural | pbr-approximated | pbr-scanned | pbr-multiangle | plain-photo | plain-design */
  oneType?: string;
}

export function slugFor(title: string): string {
  return title.replace(/ /g, "-").toLowerCase();
}

/** Mirrors the site's own thumbnail logic (old renders live on a different CDN path). */
export function thumbnailFor(t: CgTexture): string {
  if (t.id >= NEW_SCHEME_ID) {
    return `https://cgbookcase.b-cdn.net/textures/renders/2024_b/${t.title.replaceAll(" ", "")}_render_default.jpg?width=480`;
  }
  const o = t.title.replace(/ /g, "_").toLowerCase();
  let s = o.charAt(0).toUpperCase() + o.slice(1);
  const fixes: [string, string][] = [
    ["Small", "small"],
    ["Large", "large"],
    ["Medium", "medium"],
    ["3d", "3D"],
    ["lack_ti", "lack_Ti"],
    ["shed_metal_ti", "shed_Metal_Ti"],
    ["ark_ocean_ti", "ark_Ocean_Ti"],
    ["hite_ti", "hite_Ti"],
    ["Snow_white_Tiles", "Snow_white_tiles"],
    ["small_", "Small_"],
    ["large_", "Large_"],
    ["Natural_stone", "Natural_Stone"],
  ];
  for (const [a, b] of fixes) s = s.replace(a, b);
  return `https://cdn.cgbookcase.cloud/file/cgbookcase/textures/renders/bg_white/480w/${s}_default.jpg`;
}

/** Resolution choices the site offers (best effort for listings; getAsset reads the page). */
function resolutionsFor(t: CgTexture): string[] {
  const max = t.resolution ?? 0;
  const steps = t.id >= NEW_SCHEME_ID ? [1, 2, 4, 6, 8] : [1, 2, 3, 4, 5, 6, 7, 8];
  return steps.filter((r) => r <= max).map((r) => `${r}k`);
}

function toAsset(t: CgTexture): Asset {
  const plain = t.oneType?.startsWith("plain");
  return makeAsset({
    provider: "cgbookcase",
    nativeId: slugFor(t.title),
    title: t.title,
    type: plain ? "texture" : "material",
    tags: [...(t.tags ?? []), ...(t.colors ?? []), ...(t.oneType ? [t.oneType.replace(/^pbr-/, "")] : [])],
    categories: t.categories?.length ? t.categories : undefined,
    url: `${SITE}/textures/${slugFor(t.title)}`,
    thumbnailUrl: thumbnailFor(t),
    license: LICENSES.CC0,
    price: { free: true },
    resolutions: resolutionsFor(t),
    downloadable: false,
    createdAt: t.releasedate,
  });
}

async function catalogue(ctx: Parameters<Provider["search"]>[1]): Promise<CgTexture[]> {
  const data = await ctx.fetch.json<CgTexture[]>(`${SITE}/api/textures`, {
    cacheTtlMs: CATALOGUE_TTL,
    signal: ctx.signal,
  });
  if (!Array.isArray(data)) throw new Error("cgbookcase: unexpected catalogue response");
  return data;
}

/**
 * Texture page: `<select id="resolution"><option value="1">1K</option>…` and a download link
 * `/textures/thanks?t=Bark01_MR_4K.zip&r=4&u=Bark01` for the default resolution.
 */
export function parseDownloads(html: string): AssetFile[] {
  const $ = cheerio.load(html);
  const href = $('a[href*="thanks?t="]').first().attr("href");
  if (!href) return [];
  const link = new URL(href, `${SITE}/textures/`);
  const zip = link.searchParams.get("t") ?? "";
  const r = link.searchParams.get("r") ?? "";
  const u = link.searchParams.get("u") ?? "";
  const m = /^(.*_)(\d+)K\.zip$/i.exec(zip);
  if (!m) return [];
  const prefix = m[1]!;
  let res = $("select#resolution option")
    .map((_, el) => $(el).attr("value"))
    .get()
    .filter((v) => /^\d+$/.test(v));
  if (!res.length) res = [r || m[2]!];
  return res.map((k) => {
    const filename = `${prefix}${k}K.zip`;
    return {
      url: `${SITE}/textures/thanks${qs({ t: filename, r: k, u })}`,
      filename,
      format: "zip",
      resolution: `${k}k`,
      group: "textures",
    };
  });
}

export const cgbookcase: Provider = {
  id: "cgbookcase",
  name: "cgbookcase",
  homepage: SITE,
  description: "Free CC0 PBR textures up to 8K (scanned, procedural and approximated).",
  assetTypes: ["material", "texture"],
  access: "api",
  pricing: "free",
  license: LICENSES.CC0,
  supportsDownload: false,

  buildSearchUrl(q: SearchQuery) {
    return `${SITE}/textures${qs({ search: q.query })}`;
  },

  async search(q, ctx) {
    if (!wantsType(q, "material", "texture")) return { assets: [] };
    const all = await catalogue(ctx);
    // Newest first when browsing; filterLocal re-sorts by relevance when a query is given.
    const sorted = [...all].sort((a, b) => b.id - a.id);
    const assets = filterLocal(sorted.map(toAsset), q);
    return { assets: paginate(assets, q), total: assets.length, searchUrl: this.buildSearchUrl(q) };
  },

  async getAsset(nativeId, ctx): Promise<AssetDetails | null> {
    const all = await catalogue(ctx);
    const t = all.find((x) => slugFor(x.title) === nativeId);
    if (!t) return null;
    const asset = toAsset(t);
    const html = await ctx.fetch.text(asset.url, { signal: ctx.signal });
    const files = parseDownloads(html);
    return {
      ...asset,
      resolutions: files.length ? files.map((f) => f.resolution!) : asset.resolutions,
      files,
    };
  },
};
