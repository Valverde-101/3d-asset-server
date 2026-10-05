import type { Asset, AssetType, Provider, SearchQuery } from "../core/types.js";
import { cleanText, makeAsset, paginate, qs, typeMatches, wantsType } from "../core/util.js";
import { top } from "../core/census.js";

const ROOT = "https://www.textures.com";
/** The site's SPA calls this unauthenticated JSON search; it returns up to 200 hits per page. */
const SEARCH_API = `${ROOT}/api/v1/texture/search`;
const PAGE_SIZE = 200;

/** rootCategoryId -> type, for the non-texture roots (from /api/v1/category/tree). */
const ROOT_TYPES: Record<number, AssetType> = {
  114570: "model", // 3D Foliage
  114553: "model", // 3D Objects
  114561: "model", // 3D Ornaments
  114552: "hdri", // HDR Environments
  23740: "hdri", // HDR Skies
};

interface TcCategory {
  id: number;
  name: string;
  parentCategoryId: number | null;
  photoSetCount?: number;
  kind?: string;
  enabled?: number;
}

interface TcItem {
  id: number;
  name: string;
  width?: number;
  height?: number;
  picture?: string;
  createdAtUtc?: string;
  rootCategoryId?: number;
  defaultPhotoSet?: {
    id: number;
    slug?: { title?: string };
    titleThumbnail?: string | null;
    holderName?: string | null;
    isSeamless?: boolean;
    resolutionInText?: string | null;
    hasFreeSample?: boolean;
    contentTypeScan?: boolean;
    contentTypeSubstance?: boolean;
  };
}

function typeOf(item: TcItem): AssetType {
  const byRoot = item.rootCategoryId !== undefined ? ROOT_TYPES[item.rootCategoryId] : undefined;
  if (byRoot) return byRoot;
  if (/^PBR/i.test(item.name) || item.defaultPhotoSet?.contentTypeSubstance) return "material";
  return "texture";
}

function toAsset(item: TcItem): Asset | null {
  const set = item.defaultPhotoSet;
  if (!set?.id) return null;
  const title = cleanText(set.titleThumbnail || set.holderName || item.name);
  const slug = set.slug?.title ?? "";
  const tags = [
    set.isSeamless ? "seamless" : undefined,
    set.contentTypeScan ? "3d scanned" : undefined,
    set.hasFreeSample ? "free sample" : undefined,
  ].filter((t): t is string => !!t);
  return makeAsset({
    provider: "texturescom",
    nativeId: String(set.id),
    title,
    description: set.holderName && set.holderName !== title ? cleanText(set.holderName) : undefined,
    type: typeOf(item),
    tags,
    url: `${ROOT}/download/${slug}/${set.id}`,
    thumbnailUrl: item.picture ? `${ROOT}${item.picture}` : undefined,
    license: { name: "Textures.com License", url: `${ROOT}/about/license`, commercialUse: true, attributionRequired: false },
    price: { free: !!set.hasFreeSample },
    resolutions: set.resolutionInText ? [set.resolutionInText] : undefined,
    downloadable: false,
    createdAt: item.createdAtUtc,
  });
}

export const texturescom: Provider = {
  id: "texturescom",
  name: "Textures.com",
  homepage: ROOT,
  description:
    "Huge photo-texture library: PBR materials, scanned 3D foliage/objects, decals, ornaments and HDR skies (credit-based, daily free credits).",
  assetTypes: ["texture", "material", "model", "hdri"],
  access: "api",
  pricing: "freemium",
  supportsDownload: false,

  async census(ctx) {
    const tree = await ctx.fetch.json<{ data?: { categories?: TcCategory[] } }>(`${ROOT}/api/v1/category/tree`, { signal: ctx.signal });
    const roots = (tree.data?.categories ?? []).filter((c) => c.parentCategoryId === null && c.enabled !== 0);
    if (!roots.length) throw new Error("texturescom: empty category tree");
    // Regular roots partition the texture library; "special" roots are curated cross-cuts
    // (Decals, Glass, Sci-Fi…) except the 3D and HDR roots, which hold their own sets.
    const counted = roots.filter((c) => c.kind === "regular" || ROOT_TYPES[c.id]);
    const byType: Partial<Record<AssetType, number>> = {};
    for (const c of counted) {
      const t = ROOT_TYPES[c.id] ?? "texture";
      byType[t] = (byType[t] ?? 0) + (c.photoSetCount ?? 0);
    }
    return {
      total: counted.reduce((n, c) => n + (c.photoSetCount ?? 0), 0),
      byType,
      categories: top(Object.fromEntries(counted.map((c) => [c.name, c.photoSetCount ?? 0])), 12),
      method: "Category tree: photo sets per top-level category",
    };
  },

  buildSearchUrl(q: SearchQuery) {
    return `${ROOT}/search${qs({ q: q.query })}`;
  },

  async search(q, ctx) {
    if (!wantsType(q, "texture", "material", "model", "hdri")) return { assets: [] };
    if (!q.query.trim()) return { assets: [], searchUrl: this.buildSearchUrl(q) };
    const offset = q.offset ?? 0;
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const res = await ctx.fetch.json<{ data?: TcItem[] }>(`${SEARCH_API}${qs({ q: q.query, page })}`, {
      signal: ctx.signal,
    });
    let assets = (res.data ?? []).map(toAsset).filter((a): a is Asset => a !== null);
    // The API returns one row per texture variant; keep one per photo set.
    const seen = new Set<string>();
    assets = assets.filter((a) => !seen.has(a.nativeId) && seen.add(a.nativeId));
    assets = assets.filter((a) => typeMatches(a.type, q.types));
    if (q.freeOnly) assets = assets.filter((a) => a.price?.free);
    return {
      assets: paginate(assets, { ...q, offset: offset % PAGE_SIZE }),
      searchUrl: this.buildSearchUrl(q),
    };
  },
};
