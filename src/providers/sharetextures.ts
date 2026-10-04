import type { Asset, AssetDetails, AssetType, License, Provider, SearchQuery } from "../core/types.js";
import { cleanText, makeAsset, qs, stem, tokenize, typeMatches, wantsType } from "../core/util.js";

/**
 * ShareTextures — free textures, 3D models and atlases (Next.js front end over a JSON API).
 *
 * The site's own backend (`https://api2.sharetextures.com/api/v0`) serves listings and item
 * details. Its free-text `q` parameter is ignored server-side; the site's search box filters by
 * tag slugs (`tag=wood,floor`, AND-ed). Unknown tags are silently ignored by the API (returning
 * everything), so query words are first matched against the tag list (`for-frontend/tag-paths`).
 *
 * Downloads: item details do include plain file URLs, but the ShareTextures license explicitly
 * forbids "automated downloads, hotlinking, or embedding direct downloads in third-party apps",
 * so this provider is search-only and users download from the item page.
 */

const SITE = "https://www.sharetextures.com";
const API = "https://api2.sharetextures.com/api/v0";
const IMAGES = "https://images.sharetextures.com";
const TAGS_TTL = 60 * 60_000;

const LICENSE: License = {
  name: "CC0 (ShareTextures custom terms)",
  url: `${SITE}/p/license`,
  commercialUse: true,
  attributionRequired: false,
};

/** Site item types -> our types. "products" are paid Patreon/shop packages. */
const TYPE_MAP: Record<string, AssetType> = {
  textures: "material",
  models: "model",
  atlases: "texture",
  products: "pack",
};

interface StImage {
  originalObjectKey?: string | null;
  thumbObjectKey?: string | null;
  alt?: string;
}
interface StRef {
  _id?: string;
  name: string;
  slug: string;
}
interface StTagDetail {
  name?: string;
  text?: string;
  slug: string;
}
interface StDownloadLink {
  icon?: string | null;
  title: string;
  value: string;
}
interface StItem {
  _id: string;
  title: string;
  slug: string;
  itemType?: StRef;
  category?: StRef;
  publishDate?: string;
  downloadCount?: number;
  previewImage1?: StImage | null;
  tagDetails?: StTagDetail[];
  tags?: StTagDetail[];
  isEarlyAccess?: boolean;
  // detail-only
  description?: string;
  metaDescription?: string;
  downloadLinks?: StDownloadLink[];
  text1Resolution?: number;
  text1Licence?: string;
  authors?: { author?: { name?: { firstName?: string; lastName?: string }; username?: string } }[];
}
interface StResponse<T> {
  success: boolean;
  data: T;
  error?: unknown[];
}
interface StListing {
  items: StItem[];
  pagination?: { totalCount?: number; totalPage?: number; currentPage?: number };
}

function imageUrl(img: StImage | null | undefined): string | undefined {
  const key = img?.thumbObjectKey || img?.originalObjectKey;
  return key ? `${IMAGES}/${key}` : undefined;
}

/** "1K Textures" -> "1k"; "Blender" -> blend; "FBX" -> fbx. */
function linkInfo(links: StDownloadLink[]): { formats: string[]; resolutions: string[] } {
  const formats = new Set<string>();
  const resolutions = new Set<string>();
  for (const l of links) {
    const t = l.title.toLowerCase();
    const res = /(\d+)\s*k\b/.exec(t)?.[1];
    if (res) {
      resolutions.add(`${res}k`);
      formats.add("zip");
    }
    if (l.icon === "blender" || t.includes("blend")) formats.add("blend");
    for (const f of ["fbx", "obj", "glb", "gltf", "usdz", "sbsar"]) if (t.includes(f)) formats.add(f);
  }
  return { formats: [...formats], resolutions: [...resolutions] };
}

function toAsset(it: StItem): Asset {
  const typeSlug = it.itemType?.slug ?? "textures";
  const type = TYPE_MAP[typeSlug] ?? "other";
  const tags = (it.tagDetails ?? it.tags ?? []).map((t) => t.name ?? t.text ?? t.slug);
  const author = it.authors
    ?.map((a) => cleanText([a.author?.name?.firstName, a.author?.name?.lastName].filter(Boolean).join(" ")) || a.author?.username)
    .filter(Boolean)
    .join(", ");
  const links = it.downloadLinks ? linkInfo(it.downloadLinks) : undefined;
  const maxRes = it.text1Resolution ? `${Math.round(it.text1Resolution / 1024)}k` : undefined;
  return makeAsset({
    provider: "sharetextures",
    nativeId: it.slug,
    title: cleanText(it.title),
    description: cleanText(it.metaDescription) || undefined,
    type,
    tags,
    categories: it.category ? [it.category.name] : undefined,
    url: `${SITE}/${typeSlug}/${it.category?.slug ?? "all"}/${it.slug}`,
    thumbnailUrl: imageUrl(it.previewImage1),
    author: author || undefined,
    license: LICENSE,
    price: { free: typeSlug !== "products" && !it.isEarlyAccess },
    formats: links?.formats.length ? links.formats : undefined,
    resolutions: links?.resolutions.length ? links.resolutions : maxRes ? [maxRes] : undefined,
    downloadable: false,
    createdAt: it.publishDate,
  });
}

/**
 * Map free text to existing tag slugs: the whole phrase as one slug if it exists
 * ("brick wall" -> "brick-wall"), otherwise each word (or its singular) that is a tag.
 */
export function queryToTags(query: string, known: Set<string>): string[] {
  const words = tokenize(query);
  if (!words.length) return [];
  const phrase = words.join("-");
  if (words.length > 1 && known.has(phrase)) return [phrase];
  const tags: string[] = [];
  for (const w of words) {
    const candidates = [w, stem(w)];
    const hit = candidates.find((c) => known.has(c));
    if (hit && !tags.includes(hit)) tags.push(hit);
  }
  return tags;
}

/** Site item types to request for the query (undefined = all). */
function itemTypeFor(q: SearchQuery): string | undefined {
  if (!q.types?.length) return undefined;
  const slugs = Object.entries(TYPE_MAP)
    .filter(([slug, type]) => typeMatches(type, q.types) && !(q.freeOnly && slug === "products"))
    .map(([slug]) => slug);
  return slugs.length === 1 ? slugs[0] : undefined;
}

export const sharetextures: Provider = {
  id: "sharetextures",
  name: "ShareTextures",
  homepage: SITE,
  description: "Free CC0-style PBR textures, scanned 3D models and atlases (search by tag; download on the site).",
  assetTypes: ["material", "texture", "model", "pack"],
  access: "api",
  pricing: "free",
  license: LICENSE,
  supportsDownload: false,

  buildSearchUrl(q: SearchQuery) {
    const words = tokenize(q.query);
    if (words.length) return `${SITE}/tag/${words.join("-")}`;
    const type = itemTypeFor(q);
    return type ? `${SITE}/${type}` : SITE;
  },

  async search(q, ctx) {
    if (!wantsType(q, "material", "texture", "model", "pack")) return { assets: [] };
    const searchUrl = this.buildSearchUrl(q);
    let tags: string[] = [];
    if (q.query.trim()) {
      const known = await ctx.fetch.json<StResponse<string[]>>(`${API}/for-frontend/tag-paths`, {
        cacheTtlMs: TAGS_TTL,
        signal: ctx.signal,
      });
      tags = queryToTags(q.query, new Set(known?.data ?? []));
      // Unknown tags would make the API return everything; report no match instead.
      if (!tags.length) return { assets: [], total: 0, searchUrl };
    }
    const offset = q.offset ?? 0;
    const aligned = offset % q.limit === 0;
    const perPage = Math.min(aligned ? q.limit : offset + q.limit, 100);
    const page = aligned ? offset / q.limit + 1 : 1;
    const url =
      `${API}/for-frontend/items` +
      qs({
        itemType: itemTypeFor(q),
        tag: tags.length ? tags.join(",") : undefined,
        sortBy: "most_download",
        page,
        perPage,
      });
    const res = await ctx.fetch.json<StResponse<StListing>>(url, { signal: ctx.signal });
    if (!res?.success || !Array.isArray(res.data?.items)) throw new Error("sharetextures: unexpected listing response");
    let assets = res.data.items.map(toAsset);
    if (!aligned) assets = assets.slice(offset);
    assets = assets.filter((a) => typeMatches(a.type, q.types));
    if (q.freeOnly) assets = assets.filter((a) => a.price?.free);
    return { assets: assets.slice(0, q.limit), total: res.data.pagination?.totalCount, searchUrl };
  },

  async getAsset(nativeId, ctx): Promise<AssetDetails | null> {
    let res: StResponse<StItem | null>;
    try {
      res = await ctx.fetch.json<StResponse<StItem | null>>(
        `${API}/for-frontend/item/${encodeURIComponent(nativeId)}`,
        { signal: ctx.signal },
      );
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
    if (!res?.data?.slug) return null;
    // Download links are deliberately not exposed (license forbids automated downloads/hotlinking).
    return { ...toAsset(res.data), files: [] };
  },
};
