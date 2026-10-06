import type { Asset, AssetDetails, AssetType, License, Provider, SearchQuery } from "../core/types.js";
import { LICENSES, cleanText, makeAsset, qs, typeMatches } from "../core/util.js";
import { top } from "../core/census.js";

/**
 * 3DTexel — free handmade PBR materials, HDRIs, 3D assets, decals and atlases.
 *
 * Its public read-only API (`/wp-json/3dtexel/v1/public`, no key, 120 requests/min/IP, announced
 * in robots.txt and llms.txt) searches the library. Downloads, even of free CC0 assets, need a
 * free account, so this provider is search-only and users download from the product page.
 * AI-generated community assets (paid with credits) are not searched.
 */

const SITE = "https://3dtexel.com";
const API = `${SITE}/wp-json/3dtexel/v1/public`;
const PAGE_SIZE = 50;

const LICENSE_3DTEXEL: License = {
  name: "3DTexel License",
  url: `${SITE}/asset-license/`,
  commercialUse: true,
  attributionRequired: true,
};

/** Free (handmade) library types -> our types. */
const TYPE_MAP: Record<string, AssetType> = {
  pbr: "material",
  hdri: "hdri",
  "3d": "model",
  "premium-3d": "model",
  decal: "texture",
  atlas: "texture",
  landscape: "other",
  ies: "other",
};

interface TtItem {
  id: number;
  title: string;
  type: string;
  url: string;
  thumbnail?: string;
  license?: string;
  updated?: string;
  price?: { free?: boolean; credits?: number };
  resolutions?: string[];
}
interface TtSearch {
  total?: number;
  items?: TtItem[];
}
interface TtType {
  type: string;
  count: number;
}
interface TtCategory {
  name: string;
  count: number;
}

function slugOf(url: string): string | undefined {
  return /\/product\/([^/?#]+)/.exec(url)?.[1];
}

function toAsset(it: TtItem): Asset | undefined {
  const slug = slugOf(it.url);
  const type = TYPE_MAP[it.type];
  if (!slug || !type) return undefined;
  const cc0 = /cc0/i.test(it.license ?? "");
  return makeAsset({
    provider: "threedtexel",
    nativeId: slug,
    title: cleanText(it.title),
    type,
    tags: [],
    url: it.url,
    thumbnailUrl: it.thumbnail,
    license: cc0 ? LICENSES.CC0 : LICENSE_3DTEXEL,
    price: { free: it.price?.free === true || it.price?.credits === 0 },
    resolutions: it.resolutions?.length ? it.resolutions : undefined,
    downloadable: false,
    createdAt: it.updated,
  });
}

/** Library types that can satisfy the type filter (undefined filter = all). */
function wantedTypes(q: SearchQuery): string[] {
  return Object.entries(TYPE_MAP)
    .filter(([, t]) => typeMatches(t, q.types))
    .map(([k]) => k);
}

export const threedtexel: Provider = {
  id: "threedtexel",
  name: "3DTexel",
  homepage: SITE,
  description: "Free handmade CC0 PBR materials, HDRIs, 3D assets, decals and atlases (search via its public API; download with a free account).",
  assetTypes: ["material", "texture", "hdri", "model", "other"],
  access: "api",
  pricing: "free",
  supportsDownload: false,

  async census(ctx) {
    const [types, cats] = await Promise.all([
      ctx.fetch.json<TtType[]>(`${API}/types`, { signal: ctx.signal }),
      ctx.fetch.json<TtCategory[]>(`${API}/categories?type=pbr`, { signal: ctx.signal }),
    ]);
    const free = types.filter((t) => TYPE_MAP[t.type]);
    const byType: Partial<Record<AssetType, number>> = {};
    for (const t of free) byType[TYPE_MAP[t.type]!] = (byType[TYPE_MAP[t.type]!] ?? 0) + t.count;
    const cc0 = free.filter((t) => t.type !== "premium-3d").reduce((n, t) => n + t.count, 0);
    const premium = free.find((t) => t.type === "premium-3d")?.count ?? 0;
    return {
      total: cc0 + premium,
      free: cc0 + premium,
      byType,
      byLicense: premium ? { CC0: cc0, [LICENSE_3DTEXEL.name]: premium } : { CC0: cc0 },
      categories: top(Object.fromEntries(cats.map((c) => [c.name, c.count])), 12),
      method: "3DTexel public API: /types counts of the free library (AI community assets excluded)",
    };
  },

  buildSearchUrl(q: SearchQuery) {
    return `${SITE}/${qs({ s: q.query, post_type: "product" })}`;
  },

  async search(q, ctx) {
    const wanted = wantedTypes(q);
    if (!wanted.length) return { assets: [] };
    const offset = q.offset ?? 0;
    const url =
      `${API}/search` +
      qs({
        q: q.query.trim(),
        type: wanted.length === 1 ? wanted[0] : undefined,
        free: wanted.length === 1 ? undefined : 1,
        page: Math.floor(offset / PAGE_SIZE) + 1,
        per_page: PAGE_SIZE,
      });
    const res = await ctx.fetch.json<TtSearch>(url, { signal: ctx.signal });
    if (!Array.isArray(res?.items)) throw new Error("threedtexel: unexpected search response");
    const assets = res.items
      .map(toAsset)
      .filter((a): a is Asset => !!a && typeMatches(a.type, q.types))
      .slice(offset % PAGE_SIZE, (offset % PAGE_SIZE) + q.limit);
    return { assets, total: res.total, searchUrl: this.buildSearchUrl(q) };
  },

  async getAsset(nativeId, ctx): Promise<AssetDetails | null> {
    // The public API has no detail endpoint: read the title from the product, then find it in search.
    const products = await ctx.fetch.json<{ title?: { rendered?: string } }[]>(
      `${SITE}/wp-json/wp/v2/product${qs({ slug: nativeId, _fields: "id,slug,title" })}`,
      { signal: ctx.signal },
    );
    const title = cleanText(products[0]?.title?.rendered?.replace(/&#8211;/g, "–").replace(/&amp;/g, "&").replace(/&#\d+;/g, ""));
    if (!title) return null;
    const res = await ctx.fetch.json<TtSearch>(`${API}/search${qs({ q: title, per_page: PAGE_SIZE })}`, { signal: ctx.signal });
    const hit = res.items?.find((i) => slugOf(i.url) === nativeId);
    const asset = hit && toAsset(hit);
    // Files need a free account on the site, so none are exposed.
    return asset ? { ...asset, files: [] } : null;
  },
};
