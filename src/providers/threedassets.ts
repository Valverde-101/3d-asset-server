import type { Asset, AssetDetails, Provider, SearchQuery } from "../core/types.js";
import { LICENSES, makeAsset, qs, wantsType } from "../core/util.js";
import { mapLimit } from "../core/census.js";

/**
 * 3DAssets.dev: an open catalogue of web-optimised GLB models (three.js, Blender, Godot, Unity).
 * New uploads are CC0 1.0. Contributors flag AI-assisted models (`aiGenerated`); we tag those.
 *
 * Search: public REST API `GET /api/v1/assets?q=&page=&limit=` (limit <= 100, no key). Detail:
 * `GET /api/v1/assets/{slug}`, 404 for unknown slugs. Each asset's `cdnUrl` is a plain-GET GLB.
 * The terms allow fetching what a project needs but not mirroring the catalogue.
 */

const SITE = "https://3dassets.dev";
const API = `${SITE}/api/v1`;
const MAX_PAGE_SIZE = 100;

interface TdaAsset {
  slug: string;
  title: string;
  summary?: string;
  description?: string;
  url?: string;
  cdnUrl?: string;
  thumbnailUrl?: string;
  category?: { slug: string; title: string };
  tags?: { slug: string; title: string }[];
  license?: { slug?: string; name?: string; url?: string; attributionRequired?: boolean };
  contributor?: { username?: string; name?: string };
  stats?: { fileSize?: number; triangles?: number; animations?: string[] };
  aiGenerated?: boolean;
  publishedAt?: string;
}

interface TdaList {
  data?: TdaAsset[];
  total?: number;
}

function pageUrl(a: TdaAsset): string {
  return a.url || `${SITE}/assets/${encodeURIComponent(a.slug)}`;
}

function toAsset(a: TdaAsset): Asset {
  const animations = a.stats?.animations;
  return makeAsset({
    provider: "threedassets",
    nativeId: a.slug,
    title: a.title,
    description: a.summary,
    type: "model",
    tags: [...(a.tags ?? []).map((t) => t.title), ...(a.aiGenerated ? ["ai-generated"] : [])],
    categories: a.category ? [a.category.title] : undefined,
    url: pageUrl(a),
    thumbnailUrl: a.thumbnailUrl,
    author: a.contributor?.name || a.contributor?.username,
    license: LICENSES.CC0,
    price: { free: true },
    formats: ["glb"],
    polyCount: a.stats?.triangles || undefined,
    animated: animations ? animations.length > 0 : undefined,
    downloadable: !!a.cdnUrl,
    createdAt: a.publishedAt,
  });
}

export const threedassets: Provider = {
  id: "threedassets",
  name: "3DAssets.dev",
  homepage: SITE,
  description: "Open catalogue of web-optimised CC0 GLB models (props, nature, buildings, vehicles, characters) with a public API.",
  assetTypes: ["model"],
  access: "api",
  pricing: "free",
  license: LICENSES.CC0,
  supportsDownload: true,

  async census(ctx) {
    const count = async (params: Record<string, string | number>) =>
      (await ctx.fetch.json<TdaList>(`${API}/assets${qs({ ...params, limit: 1 })}`, { signal: ctx.signal })).total ?? 0;
    const cats = await ctx.fetch.json<{ data?: { slug: string; title: string }[] }>(`${API}/categories`, {
      cacheTtlMs: 60 * 60_000,
      signal: ctx.signal,
    });
    const [total, perCategory] = await Promise.all([
      count({}),
      mapLimit(cats.data ?? [], 4, async (c) => [c.title, await count({ category: c.slug })] as const),
    ]);
    return {
      total,
      free: total,
      byType: { model: total },
      categories: Object.fromEntries(perCategory.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])),
      method: "3DAssets.dev API: total and per-category counts (/api/v1/assets)",
    };
  },

  buildSearchUrl(q: SearchQuery) {
    return `${SITE}/assets${qs({ q: q.query.trim() })}`;
  },

  async search(q, ctx) {
    if (!wantsType(q, "model")) return { assets: [] };
    const limit = Math.max(1, Math.min(q.limit, MAX_PAGE_SIZE));
    const offset = q.offset ?? 0;
    const first = Math.floor(offset / limit);
    const skip = offset - first * limit;
    const fetchPage = (page: number) =>
      ctx.fetch.json<TdaList>(`${API}/assets${qs({ q: q.query.trim(), page, limit })}`, { cacheTtlMs: 10 * 60_000, signal: ctx.signal });
    const a = await fetchPage(first + 1);
    let rows = a.data ?? [];
    // An offset that is not a multiple of the page size straddles two API pages.
    if (skip > 0 && rows.length === limit && (a.total ?? 0) > (first + 1) * limit) {
      rows = [...rows, ...((await fetchPage(first + 2)).data ?? [])];
    }
    const assets = rows.slice(skip, skip + limit).map(toAsset);
    return { assets, total: a.total, searchUrl: this.buildSearchUrl(q) };
  },

  async getAsset(nativeId, ctx): Promise<AssetDetails | null> {
    let a: TdaAsset | undefined;
    try {
      a = (await ctx.fetch.json<{ data?: TdaAsset }>(`${API}/assets/${encodeURIComponent(nativeId)}`, { signal: ctx.signal })).data;
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
    if (!a?.slug) return null;
    const files = a.cdnUrl
      ? [{ url: a.cdnUrl, filename: `${a.slug}.glb`, format: "glb", group: "glb", sizeBytes: a.stats?.fileSize }]
      : [];
    return { ...toAsset(a), files };
  },
};
