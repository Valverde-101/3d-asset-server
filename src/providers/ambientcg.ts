import type { Asset, AssetDetails, AssetFile, AssetType, Provider, SearchQuery } from "../core/types.js";
import { LICENSES, makeAsset, qs, typeMatches, uniq, wantsType } from "../core/util.js";
import { addedSince, mapLimit } from "../core/census.js";

/**
 * ambientCG (https://ambientcg.com): CC0 PBR materials, HDRIs, decals, atlases,
 * substances, terrains and a few photogrammetry models.
 *
 * Uses the public v3 JSON API (https://docs.ambientcg.com/api/v3/assets/). v2's
 * `full_json` silently ignores `type=3DModel` / `type=PlainTexture` and returns the
 * whole catalogue, so type filtering only works reliably on v3. Every download is
 * a direct `https://ambientcg.com/get?file=...` link that 302-redirects to a CDN
 * with no login or cookies.
 */

const SITE = "https://ambientcg.com";
const API = `${SITE}/api/v3/assets`;
const INCLUDE =
  "type,title,url,tags,shortDescription,releaseDate,maps,technique,downloadStatistics,thumbnails,downloads";
const MAX_LIMIT = 500;

/** ambientCG v3 `type` value -> our AssetType. */
const TYPE_MAP: Record<string, AssetType> = {
  material: "material",
  substance: "material",
  hdri: "hdri",
  "hdri-element": "texture",
  decal: "texture",
  atlas: "texture",
  "plain-image": "texture",
  brush: "texture",
  terrain: "model",
  "3d-model": "model",
};
const ACG_TYPES = Object.keys(TYPE_MAP);

/** Website `/list?type=` values (same vocabulary as the v3 API). */
const SITE_TYPE: Partial<Record<AssetType, string>> = {
  material: "material",
  texture: "material,decal,atlas,plain-image",
  hdri: "hdri",
  model: "3d-model",
};

interface AcgDownload {
  /** e.g. "1K-JPG", "LQ-2K-PNG", "4K", "COMPILED-XL". */
  attributes: string;
  extension: string;
  url: string;
  size?: number;
}

interface AcgAsset {
  id: string;
  type?: string;
  title?: string;
  url?: string;
  tags?: string[];
  shortDescription?: string;
  releaseDate?: string;
  maps?: string[];
  technique?: string;
  downloadStatistics?: { total?: number };
  thumbnails?: Record<string, string>;
  downloads?: AcgDownload[];
}

interface AcgResponse {
  totalResults?: number;
  assets?: AcgAsset[];
}

/** "LQ-2K-PNG" -> "2k"; "COMPILED" -> undefined. */
function resolutionOf(attributes: string): string | undefined {
  const m = /(?:^|-)(\d+)K(?:-|$)/i.exec(attributes);
  return m ? `${m[1]}k` : undefined;
}

/** Formats a download provides. Zips are named by their image format; HDRI zips hold .exr and 3D-model zips .obj. */
function formatsOf(d: AcgDownload, acgType: string | undefined): string[] {
  const ext = d.extension.toLowerCase();
  if (ext !== "zip") return [ext];
  const out: string[] = [];
  if (/(^|-)JPG(-|$)/i.test(d.attributes)) out.push("jpg");
  if (/(^|-)PNG(-|$)/i.test(d.attributes)) out.push("png");
  if (acgType === "hdri" || acgType === "hdri-element") out.push("exr");
  if (acgType === "3d-model") out.push("obj");
  return out;
}

function sortResolutions(res: string[]): string[] {
  return uniq(res).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

function toAsset(a: AcgAsset): Asset {
  const downloads = a.downloads ?? [];
  const thumbs = a.thumbnails ?? {};
  return makeAsset({
    provider: "ambientcg",
    nativeId: a.id,
    title: a.title || a.id,
    description: a.shortDescription || undefined,
    type: TYPE_MAP[a.type ?? ""] ?? "other",
    tags: a.tags ?? [],
    categories: a.type ? [a.type] : undefined,
    url: a.url || `${SITE}/a/${a.id}`,
    thumbnailUrl: thumbs["256-JPG-242424"] ?? thumbs["256-PNG"] ?? Object.values(thumbs)[0],
    license: LICENSES.CC0,
    price: { free: true },
    formats: downloads.length ? uniq(downloads.flatMap((d) => formatsOf(d, a.type))) : undefined,
    resolutions: downloads.length
      ? sortResolutions(downloads.map((d) => resolutionOf(d.attributes)).filter((r): r is string => !!r))
      : undefined,
    downloadable: downloads.length > 0,
    createdAt: a.releaseDate || undefined,
  });
}

function filenameOf(d: AcgDownload, assetId: string): string {
  try {
    const f = new URL(d.url).searchParams.get("file");
    if (f) return f;
  } catch {
    // fall through
  }
  return `${assetId}_${d.attributes}.${d.extension}`;
}

function toFile(d: AcgDownload, assetId: string): AssetFile {
  const ext = d.extension.toLowerCase();
  const res = resolutionOf(d.attributes);
  // Attribute without the resolution: "1K-JPG" -> "jpg", "LQ-1K-PNG" -> "lq-png", "COMPILED-XL" -> "compiled-xl".
  const variant = d.attributes
    .split("-")
    .filter((p) => !/^\d+K$/i.test(p))
    .join("-")
    .toLowerCase();
  return {
    url: d.url,
    filename: filenameOf(d, assetId),
    format: ext === "jpeg" ? "jpg" : ext,
    resolution: res,
    sizeBytes: d.size,
    group: variant || (ext === "zip" ? "archive" : ext),
  };
}

/** ambientCG types acceptable for the query, or null when no filter is needed. */
function acgTypesFor(q: SearchQuery): string[] | null {
  if (!q.types?.length) return null;
  const wanted = ACG_TYPES.filter((t) => typeMatches(TYPE_MAP[t]!, q.types));
  return wanted.length === ACG_TYPES.length ? null : wanted;
}

export const ambientcg: Provider = {
  id: "ambientcg",
  name: "ambientCG",
  homepage: SITE,
  description: "Free CC0 PBR materials, HDRIs, decals and atlases (1K-16K) with a public JSON API and direct downloads.",
  assetTypes: ["material", "texture", "hdri", "model"],
  access: "api",
  pricing: "free",
  license: LICENSES.CC0,
  supportsDownload: true,

  async census(ctx) {
    const count = async (type?: string) =>
      (await ctx.fetch.json<AcgResponse>(`${API}${qs({ type, limit: 1, include: "title" })}`, { signal: ctx.signal })).totalResults ?? 0;
    const [total, perType, latest, popular] = await Promise.all([
      count(),
      mapLimit(ACG_TYPES, 3, async (t) => [t, await count(t)] as const),
      ctx.fetch.json<AcgResponse>(`${API}${qs({ sort: "latest", limit: 100, include: "releaseDate" })}`, { signal: ctx.signal }),
      ctx.fetch.json<AcgResponse>(`${API}${qs({ sort: "popular", limit: 1, include: "title,url,downloadStatistics" })}`, { signal: ctx.signal }),
    ]);
    const byType: Partial<Record<AssetType, number>> = {};
    for (const [t, n] of perType) byType[TYPE_MAP[t]!] = (byType[TYPE_MAP[t]!] ?? 0) + n;
    const hit = popular.assets?.[0];
    return {
      total,
      free: total,
      byType,
      categories: Object.fromEntries(perType.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])),
      addedLast30Days: addedSince((latest.assets ?? []).map((a) => a.releaseDate)),
      highlights: hit ? [{ label: "Most downloaded this month", title: hit.title ?? hit.id, url: hit.url ?? `${SITE}/a/${hit.id}`, value: hit.downloadStatistics?.total }] : [],
      method: "ambientCG API v3: totalResults per asset type",
    };
  },

  buildSearchUrl(q: SearchQuery) {
    const types = uniq((q.types ?? []).map((t) => SITE_TYPE[t]).filter((t): t is string => !!t));
    return `${SITE}/list${qs({ q: q.query.trim(), type: types.join(","), sort: "popular" })}`;
  },

  async search(q, ctx) {
    if (!wantsType(q, "material", "texture", "hdri", "model")) return { assets: [] };
    const types = acgTypesFor(q);
    if (types && types.length === 0) return { assets: [] };
    const url =
      API +
      qs({
        q: q.query.trim(),
        type: types?.join(","),
        // No relevance sort exists; keyword hits are AND-filtered, so popular works for both browse and search.
        sort: "popular",
        limit: Math.min(Math.max(q.limit, 1), MAX_LIMIT),
        offset: q.offset ? q.offset : undefined,
        include: INCLUDE,
      });
    const res = await ctx.fetch.json<AcgResponse>(url, { signal: ctx.signal });
    const assets = (res.assets ?? []).filter((a) => a?.id).map(toAsset);
    return { assets, total: res.totalResults, searchUrl: this.buildSearchUrl(q) };
  },

  async getAsset(nativeId, ctx): Promise<AssetDetails | null> {
    // Ids are alphanumeric (e.g. "Wood096", "3DApple002"); a comma would select several assets.
    if (!/^[A-Za-z0-9_-]+$/.test(nativeId)) return null;
    const res = await ctx.fetch.json<AcgResponse>(`${API}${qs({ id: nativeId, include: INCLUDE })}`, {
      signal: ctx.signal,
    });
    const a = res.assets?.find((x) => x.id === nativeId);
    if (!a) return null;
    return { ...toAsset(a), files: (a.downloads ?? []).map((d) => toFile(d, a.id)) };
  },
};
