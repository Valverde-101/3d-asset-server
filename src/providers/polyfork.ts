import type { Asset, AssetDetails, AssetFile, AssetType, License, Provider, SearchQuery } from "../core/types.js";
import { makeAsset, qs, uniq, wantsType } from "../core/util.js";
import { mapLimit } from "../core/census.js";

/**
 * Polyfork (polyfork.dev): low-poly, vertex-coloured 3D models for three.js, Unity, Godot and
 * Blender. Every asset is a small parametric program; the catalogue is a mix of free assets and
 * assets included in the Pro plan.
 *
 * Search: public JSON API `GET /api/assets?q=&free=1&page=&per_page=` (word match on title and
 * description, no key needed). Detail: `GET /api/assets/{id}`, 404 for unknown ids.
 *
 * Downloads: a free asset's GLB is a plain GET on `/cdn/{id}.glb`, and the licence explicitly
 * allows hotlinking it with no account. The licence forbids redistributing the files through a
 * tool, so only that one GLB is offered: the download endpoint redirects to Polyfork's CDN rather
 * than re-packaging it. FBX / USDZ / OBJ exports (`/dl/`) need a Polyfork account and paid assets
 * need Pro; those are listed as requiring auth.
 */

const SITE = "https://polyfork.dev";
const API = `${SITE}/api`;
const MAX_PAGE_SIZE = 100;
const CLASSES = ["prop", "building", "vehicle", "character", "animal", "ultra", "attachment", "terrain", "hand"];

const LICENSE: License = {
  name: "Royalty Free",
  url: `${SITE}/licensing`,
  commercialUse: true,
  attributionRequired: false,
};

interface PfAsset {
  id: string;
  title: string;
  class?: string;
  triangles?: number;
  kit?: string | null;
  free?: boolean;
  page?: string;
  thumbnail?: string;
  has_rig?: boolean;
  has_skeleton?: boolean;
  published_at?: string;
  download?: { glb?: string; mjs?: string; auth?: string } | null;
  export_formats?: Record<string, { url: string }>;
}

interface PfList {
  total?: number;
  assets?: PfAsset[];
}

function pageUrl(a: PfAsset): string {
  return a.page || `${SITE}/asset/${encodeURIComponent(a.id)}`;
}

function toAsset(a: PfAsset): Asset {
  return makeAsset({
    provider: "polyfork",
    nativeId: a.id,
    title: a.title,
    type: "model",
    tags: uniq(["low poly", ...(a.class ? [a.class] : [])]),
    categories: [a.class, a.kit ?? undefined].filter((c): c is string => !!c),
    url: pageUrl(a),
    thumbnailUrl: a.thumbnail || undefined,
    license: LICENSE,
    price: { free: a.free === true },
    formats: ["glb", "fbx", "usdz", "obj"],
    polyCount: typeof a.triangles === "number" && a.triangles > 0 ? a.triangles : undefined,
    rigged: a.has_skeleton === undefined && a.has_rig === undefined ? undefined : !!(a.has_skeleton || a.has_rig),
    downloadable: a.free === true,
    createdAt: a.published_at ? `${a.published_at.replace(" ", "T")}Z` : undefined,
  });
}

function files(a: PfAsset): AssetFile[] {
  const out: AssetFile[] = [];
  const glb = a.download?.glb;
  if (a.free && glb && a.download?.auth === "none") {
    out.push({ url: glb, filename: `${a.id}.glb`, format: "glb", group: "glb" });
  } else {
    out.push({ url: pageUrl(a), filename: `${a.id}.glb`, format: "glb", group: "glb", requiresAuth: true });
  }
  for (const format of Object.keys(a.export_formats ?? {})) {
    out.push({ url: pageUrl(a), filename: `${a.id}.${format}`, format, group: format, requiresAuth: true });
  }
  return out;
}

export const polyfork: Provider = {
  id: "polyfork",
  name: "Polyfork",
  homepage: SITE,
  description:
    "Low-poly, game- and web-ready 3D models (props, buildings, vehicles, characters, themed kits) with a public API; free assets download as GLB.",
  assetTypes: ["model"],
  access: "api",
  pricing: "freemium",
  license: LICENSE,
  supportsDownload: true,

  async census(ctx) {
    const count = async (params: Record<string, string | number>) =>
      (await ctx.fetch.json<PfList>(`${API}/assets${qs({ ...params, per_page: 1, fields: "compact" })}`, { signal: ctx.signal })).total ?? 0;
    const [total, free] = await Promise.all([count({}), count({ free: 1 })]);
    const perClass = await mapLimit(CLASSES, 3, async (c) => [c, await count({ class: c })] as const);
    return {
      total,
      free,
      byType: { model: total },
      categories: Object.fromEntries(perClass.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])),
      method: "Polyfork API: total, free and per-class counts (/api/assets)",
    };
  },

  buildSearchUrl(q: SearchQuery) {
    return `${SITE}/assets${qs({ q: q.query.trim() })}`;
  },

  async search(q, ctx) {
    if (!wantsType(q, "model")) return { assets: [] };
    const offset = q.offset ?? 0;
    const pageSize = Math.min(Math.max(q.limit, 1), MAX_PAGE_SIZE);
    const firstPage = Math.floor(offset / pageSize) + 1;
    const skip = offset - (firstPage - 1) * pageSize;
    const fetchPage = (page: number) =>
      ctx.fetch.json<PfList>(
        `${API}/assets${qs({ q: q.query.trim(), free: q.freeOnly ? 1 : undefined, page: page > 1 ? page : undefined, per_page: pageSize })}`,
        { signal: ctx.signal },
      );
    const first = await fetchPage(firstPage);
    let results = first.assets ?? [];
    // An offset that is not a multiple of the page size straddles two pages.
    if (skip > 0 && results.length === pageSize && (first.total ?? 0) > firstPage * pageSize) {
      results = results.concat((await fetchPage(firstPage + 1)).assets ?? []);
    }
    const assets = results
      .slice(skip, skip + q.limit)
      .filter((a) => a?.id && a.title && (!q.freeOnly || a.free))
      .map(toAsset);
    return { assets, total: first.total, searchUrl: this.buildSearchUrl(q) };
  },

  async getAsset(nativeId, ctx): Promise<AssetDetails | null> {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(nativeId)) return null;
    let a: PfAsset;
    try {
      a = await ctx.fetch.json<PfAsset>(`${API}/assets/${nativeId}`, { signal: ctx.signal });
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
    if (!a?.id || !a.title) return null;
    const list = files(a);
    return { ...toAsset(a), downloadable: list.some((f) => !f.requiresAuth), files: list };
  },
};
