import type { AssetDetails, AssetFile, AssetType, Provider, SearchQuery } from "../core/types.js";
import { LICENSES, filterLocal, makeAsset, paginate, qs, wantsType } from "../core/util.js";

const API = "https://api.polyhaven.com";
const CATALOGUE_TTL = 60 * 60_000;

/** Poly Haven numeric type -> our type. */
const TYPE_MAP: Record<number, AssetType> = { 0: "hdri", 1: "material", 2: "model" };
const PH_TYPE: Partial<Record<AssetType, string>> = { hdri: "hdris", material: "textures", texture: "textures", model: "models" };

interface PhAsset {
  name: string;
  type: number;
  categories?: string[];
  tags?: string[];
  authors?: Record<string, string>;
  description?: string;
  max_resolution?: [number, number];
  polycount?: number;
  date_published?: number;
  download_count?: number;
}

interface PhFileLeaf {
  url: string;
  size?: number;
  include?: Record<string, { url: string; size?: number }>;
}
/** files endpoint: { [group]: { [res]: { [format]: leaf } } } */
type PhFiles = Record<string, Record<string, Record<string, PhFileLeaf>>>;

function resolutionsUpTo(maxPx?: number): string[] {
  if (!maxPx) return [];
  const out: string[] = [];
  for (let k = 1; k * 1024 <= maxPx; k *= 2) out.push(`${k}k`);
  return out;
}

function toAsset(id: string, a: PhAsset) {
  const type = TYPE_MAP[a.type] ?? "other";
  return makeAsset({
    provider: "polyhaven",
    nativeId: id,
    title: a.name,
    description: a.description,
    type,
    tags: a.tags ?? [],
    categories: a.categories,
    url: `https://polyhaven.com/a/${id}`,
    thumbnailUrl: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=512&height=512`,
    author: a.authors ? Object.keys(a.authors).join(", ") : undefined,
    license: LICENSES.CC0,
    price: { free: true },
    formats:
      type === "hdri" ? ["hdr", "exr"] : type === "model" ? ["gltf", "blend", "fbx", "usd"] : ["jpg", "png", "exr", "blend", "gltf"],
    resolutions: resolutionsUpTo(a.max_resolution?.[0]),
    polyCount: a.polycount,
    downloadable: true,
    createdAt: a.date_published ? new Date(a.date_published * 1000).toISOString() : undefined,
  });
}

/** Map-name groups in the files endpoint (anything that isn't a packaged format). */
const PACKAGE_GROUPS = new Set(["gltf", "blend", "fbx", "usd", "mtlx", "hdri", "tonemapped", "backplates", "colorchart"]);

function flattenFiles(files: PhFiles): AssetFile[] {
  const out: AssetFile[] = [];
  for (const [group, byRes] of Object.entries(files)) {
    if (!byRes || typeof byRes !== "object") continue;
    // `tonemapped` / `colorchart` are single leaves rather than res->format maps.
    if ("url" in byRes) {
      const leaf = byRes as unknown as PhFileLeaf;
      out.push(fileFromLeaf(leaf, group));
      continue;
    }
    for (const [res, byFormat] of Object.entries(byRes)) {
      if (!byFormat || typeof byFormat !== "object") continue;
      if ("url" in byFormat) {
        out.push(fileFromLeaf(byFormat as unknown as PhFileLeaf, group, res));
        continue;
      }
      for (const [, leaf] of Object.entries(byFormat)) {
        if (leaf?.url) out.push(fileFromLeaf(leaf, group, res));
      }
    }
  }
  return out;
}

function fileFromLeaf(leaf: PhFileLeaf, group: string, res?: string): AssetFile {
  const filename = decodeURIComponent(leaf.url.slice(leaf.url.lastIndexOf("/") + 1));
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  const isMap = !PACKAGE_GROUPS.has(group);
  return {
    url: leaf.url,
    filename,
    format: ext === "jpeg" ? "jpg" : ext,
    resolution: res && /^\d+k$/.test(res) ? res : undefined,
    mapType: isMap ? group.toLowerCase() : undefined,
    sizeBytes: leaf.size,
    group: isMap ? "maps" : group,
    includes: leaf.include
      ? Object.entries(leaf.include).map(([path, f]) => ({ path, url: f.url, sizeBytes: f.size }))
      : undefined,
  };
}

export const polyhaven: Provider = {
  id: "polyhaven",
  name: "Poly Haven",
  homepage: "https://polyhaven.com",
  description: "Free CC0 HDRIs, PBR textures and photoscanned 3D models with a public API.",
  assetTypes: ["hdri", "material", "texture", "model"],
  access: "api",
  pricing: "free",
  license: LICENSES.CC0,
  supportsDownload: true,

  buildSearchUrl(q: SearchQuery) {
    const t = q.types?.find((x) => PH_TYPE[x]);
    const section = t ? PH_TYPE[t] : "all";
    return `https://polyhaven.com/${section}${qs({ s: q.query })}`;
  },

  async search(q, ctx) {
    if (!wantsType(q, "hdri", "material", "model")) return { assets: [] };
    const all = await ctx.fetch.json<Record<string, PhAsset>>(`${API}/assets?t=all`, {
      cacheTtlMs: CATALOGUE_TTL,
      signal: ctx.signal,
    });
    let assets = Object.entries(all).map(([id, a]) => toAsset(id, a));
    // Popular first when browsing; filterLocal re-sorts by relevance when a query is given.
    const downloads = new Map(Object.entries(all).map(([id, a]) => [id, a.download_count ?? 0]));
    assets.sort((a, b) => (downloads.get(b.nativeId) ?? 0) - (downloads.get(a.nativeId) ?? 0));
    assets = filterLocal(assets, q);
    return { assets: paginate(assets, q), total: assets.length, searchUrl: this.buildSearchUrl(q) };
  },

  async getAsset(nativeId, ctx): Promise<AssetDetails | null> {
    const id = encodeURIComponent(nativeId);
    let info: PhAsset;
    try {
      info = await ctx.fetch.json<PhAsset>(`${API}/info/${id}`, { signal: ctx.signal });
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
    if (!info?.name) return null;
    const files = await ctx.fetch.json<PhFiles>(`${API}/files/${id}`, { signal: ctx.signal });
    return { ...toAsset(nativeId, info), files: flattenFiles(files) };
  },
};
