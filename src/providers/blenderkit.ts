import { randomUUID } from "node:crypto";
import type {
  Asset,
  AssetDetails,
  AssetFile,
  AssetType,
  License,
  Provider,
  ProviderContext,
  SearchQuery,
} from "../core/types.js";
import { LICENSES, formatFromFilename, makeAsset, qs, typeMatches, uniq, wantsType } from "../core/util.js";
import { mapLimit } from "../core/census.js";


/**
 * BlenderKit (now branded "Blendkit", www.blendkit.com): Blender-native models, materials,
 * HDRIs, scenes, brushes, node groups, printables and add-ons; free and paid ("Full Plan"
 * subscription or one-off purchase).
 *
 * Search: public JSON API `GET /api/v1/search/?query=<words> asset_type:a,b is_free:true`.
 * Download (same flow as the Blender add-on): `GET <file.downloadUrl>?scene_uuid=<any uuid>`
 * returns `{ filePath }`, a signed CDN URL that is fetchable with a plain GET. Free assets
 * resolve anonymously; with `BLENDERKIT_API_KEY` (sent as `Authorization: Bearer`) the API
 * also unlocks assets included in the user's plan or purchased. The API reports this per
 * asset as `canDownload`.
 */

const API = "https://www.blenderkit.com/api/v1";
const SITE = "https://www.blendkit.com";
const API_KEY_ENV = "BLENDERKIT_API_KEY";
const MAX_PAGE_SIZE = 100;

/** BlenderKit asset_type -> our AssetType. */
const TYPE_MAP: Record<string, AssetType> = {
  model: "model",
  printable: "model",
  scene: "model",
  material: "material",
  hdr: "hdri",
  brush: "other",
  nodegroup: "other",
  addon: "other",
};
const BK_TYPES = Object.keys(TYPE_MAP);

/** File types that are actual payloads (thumbnails, previews and proxies are skipped). */
const PAYLOAD = /^(blend|gltf|gltf_godot|zip_file|resolution_[\d_]+K)$/;

const LICENSE_MAP: Record<string, License> = {
  cc_zero: LICENSES.CC0,
  royalty_free: {
    name: "Royalty Free",
    url: `${SITE}/docs/licenses/`,
    commercialUse: true,
    attributionRequired: false,
  },
  gpl: { name: "GPL", url: "https://www.gnu.org/licenses/gpl-3.0.html", commercialUse: true },
};

interface BkFile {
  fileType: string;
  downloadUrl?: string;
  filename?: string | null;
  fileUploadSize?: number | null;
  isThumbnail?: boolean;
}

interface BkAsset {
  id: string;
  assetBaseId: string;
  name: string;
  displayName?: string;
  description?: string;
  assetType: string;
  category?: string;
  isFree?: boolean;
  isForSale?: boolean;
  basePrice?: string | null;
  access?: string;
  canDownload?: boolean;
  tags?: string[];
  license?: string;
  created?: string;
  author?: { fullName?: string; firstName?: string; lastName?: string };
  files?: BkFile[];
  dictParameters?: {
    faceCount?: number;
    rig?: boolean;
    animated?: boolean;
    textureResolutionMax?: number;
  };
  thumbnailMiddleUrl?: string;
  thumbnailSmallUrl?: string;
}

interface BkSearchResponse {
  count?: number;
  results?: BkAsset[];
}

function apiKey(): string | undefined {
  return process.env[API_KEY_ENV]?.trim() || undefined;
}

function authHeaders(): Record<string, string> | undefined {
  const key = apiKey();
  return key ? { authorization: `Bearer ${key}` } : undefined;
}

/** "resolution_0_5K" -> "0.5k", "resolution_2K" -> "2k". */
function resolutionOf(fileType: string): string | undefined {
  const m = /^resolution_(\d+)(?:_(\d+))?K$/i.exec(fileType);
  if (!m) return undefined;
  return m[2] ? `${m[1]}.${m[2]}k` : `${m[1]}k`;
}

function payloadFiles(a: BkAsset): BkFile[] {
  return (a.files ?? []).filter((f) => !f.isThumbnail && PAYLOAD.test(f.fileType) && f.downloadUrl);
}

function fileFormat(f: BkFile): string {
  const ext = f.filename ? formatFromFilename(f.filename) : "";
  if (ext) return ext;
  if (f.fileType.startsWith("gltf")) return "glb";
  if (f.fileType === "zip_file") return "zip";
  return "blend";
}

function pageUrl(a: Pick<BkAsset, "assetBaseId" | "id">): string {
  return `${SITE}/asset-gallery-detail/${a.assetBaseId || a.id}/`;
}

function authorName(a: BkAsset): string | undefined {
  const au = a.author;
  if (!au) return undefined;
  return au.fullName?.trim() || [au.firstName, au.lastName].filter(Boolean).join(" ").trim() || undefined;
}

function toAsset(a: BkAsset): Asset {
  const files = payloadFiles(a);
  const p = a.dictParameters ?? {};
  const price = Number(a.basePrice);
  return makeAsset({
    provider: "blenderkit",
    nativeId: a.assetBaseId || a.id,
    title: a.displayName || a.name,
    description: a.description || undefined,
    type: TYPE_MAP[a.assetType] ?? "other",
    tags: a.tags ?? [],
    categories: uniq([a.assetType, a.category].filter((c): c is string => !!c)),
    url: pageUrl(a),
    thumbnailUrl: a.thumbnailMiddleUrl || a.thumbnailSmallUrl || undefined,
    author: authorName(a),
    license: a.license ? (LICENSE_MAP[a.license] ?? { name: "Custom", url: `${SITE}/docs/licenses/` }) : undefined,
    price: a.isFree
      ? { free: true }
      : a.isForSale && price > 0
        ? { free: false, amount: price, currency: "USD" }
        : { free: false },
    formats: files.length ? uniq(files.map(fileFormat)) : undefined,
    resolutions: files.length
      ? uniq(files.map((f) => resolutionOf(f.fileType)).filter((r): r is string => !!r)).sort(
          (x, y) => parseFloat(x) - parseFloat(y),
        )
      : undefined,
    polyCount: typeof p.faceCount === "number" && p.faceCount > 0 ? p.faceCount : undefined,
    animated: typeof p.animated === "boolean" ? p.animated : undefined,
    rigged: typeof p.rig === "boolean" ? p.rig : undefined,
    downloadable: a.canDownload === true && files.length > 0,
    createdAt: a.created,
  });
}

/** BlenderKit types acceptable for the query; null = no filter needed. */
function bkTypesFor(q: SearchQuery): string[] | null {
  if (!q.types?.length) return null;
  const wanted = BK_TYPES.filter((t) => typeMatches(TYPE_MAP[t]!, q.types));
  return wanted.length === BK_TYPES.length ? null : wanted;
}

/** Elasticsearch-style query string the API and the website gallery both understand. */
function queryString(q: SearchQuery, types: string[] | null): string {
  const parts = [q.query.trim()];
  if (types) parts.push(`asset_type:${types.join(",")}`);
  if (q.freeOnly) parts.push("is_free:true");
  return parts.filter(Boolean).join(" ");
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "asset"
  );
}

async function resolveFile(a: BkAsset, f: BkFile, ctx: ProviderContext): Promise<AssetFile> {
  const format = fileFormat(f);
  const res = resolutionOf(f.fileType);
  const base: AssetFile = {
    url: pageUrl(a),
    filename: `${slugify(a.displayName || a.name)}_${f.fileType}.${format}`,
    format,
    resolution: res,
    sizeBytes: f.fileUploadSize ?? undefined,
    group: res ? "resolutions" : f.fileType === "zip_file" ? "archive" : f.fileType,
  };
  if (!a.canDownload) return { ...base, requiresAuth: true };
  const sep = f.downloadUrl!.includes("?") ? "&" : "?";
  let r: { filePath?: string };
  try {
    r = await ctx.fetch.json<{ filePath?: string }>(`${f.downloadUrl}${sep}scene_uuid=${randomUUID()}`, {
      headers: authHeaders(),
      signal: ctx.signal,
      // Signed URLs must not be served from cache.
      cacheTtlMs: 0,
    });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401 || status === 403) return { ...base, requiresAuth: true };
    throw e;
  }
  if (!r.filePath) throw new Error(`BlenderKit returned no filePath for ${f.downloadUrl}`);
  return { ...base, url: r.filePath };
}

export const blenderkit: Provider = {
  id: "blenderkit",
  name: "BlenderKit",
  homepage: SITE,
  description:
    "Blender-native models, materials, HDRIs, scenes and brushes (free + Full Plan) with a public search API; free assets download as .blend/.glb.",
  assetTypes: ["model", "material", "hdri", "other"],
  access: "api",
  pricing: "freemium",
  apiKeyEnv: API_KEY_ENV,
  supportsDownload: true,

  async census(ctx) {
    const count = async (query: string) =>
      (await ctx.fetch.json<BkSearchResponse>(`${API}/search/${qs({ query, page_size: 1 })}`, { signal: ctx.signal })).count ?? 0;
    const rows = await mapLimit(BK_TYPES, 3, async (t) => [t, await count(`asset_type:${t}`), await count(`asset_type:${t} is_free:true`)] as const);
    // The API caps every count at 10,000 (an Elasticsearch default): those numbers are lower bounds.
    const capped = rows.some(([, all, free]) => all >= 10_000 || free >= 10_000);
    const byType: Partial<Record<AssetType, number>> = {};
    for (const [t, n] of rows) byType[TYPE_MAP[t]!] = (byType[TYPE_MAP[t]!] ?? 0) + n;
    return {
      total: rows.reduce((n, [, all]) => n + all, 0),
      atLeast: capped || undefined,
      free: rows.reduce((n, [, , free]) => n + free, 0),
      byType,
      categories: Object.fromEntries(rows.filter(([, n]) => n > 0).map(([t, n]) => [t, n])),
      method: "BlenderKit search API: count per asset type, free and all (capped at 10,000 each)",
    };
  },

  buildSearchUrl(q: SearchQuery) {
    return `${SITE}/asset-gallery${qs({ query: queryString(q, bkTypesFor(q)) })}`;
  },

  async search(q, ctx) {
    if (!wantsType(q, "model", "material", "hdri", "other")) return { assets: [] };
    const types = bkTypesFor(q);
    if (types && types.length === 0) return { assets: [] };
    const query = queryString(q, types);
    const offset = q.offset ?? 0;
    const pageSize = Math.min(Math.max(q.limit, 1), MAX_PAGE_SIZE);
    const firstPage = Math.floor(offset / pageSize) + 1;
    const skip = offset - (firstPage - 1) * pageSize;
    const fetchPage = (page: number) =>
      ctx.fetch.json<BkSearchResponse>(`${API}/search/${qs({ query, page: page > 1 ? page : undefined, page_size: pageSize })}`, {
        headers: authHeaders(),
        signal: ctx.signal,
      });
    const first = await fetchPage(firstPage);
    let results = first.results ?? [];
    // An offset that is not a multiple of the page size straddles two pages.
    if (skip > 0 && results.length === pageSize && (first.count ?? 0) > firstPage * pageSize) {
      results = results.concat((await fetchPage(firstPage + 1)).results ?? []);
    }
    const assets = results
      .slice(skip, skip + q.limit)
      .filter((a) => a?.id && (!q.freeOnly || a.isFree))
      .map(toAsset);
    return { assets, total: first.count, searchUrl: this.buildSearchUrl(q) };
  },

  async getAsset(nativeId, ctx): Promise<AssetDetails | null> {
    if (!/^[0-9a-f-]{36}$/i.test(nativeId)) return null;
    // nativeId is the version-independent assetBaseId; fall back to a version id.
    const found = await ctx.fetch.json<BkSearchResponse>(
      `${API}/search/${qs({ query: `asset_base_id:${nativeId}` })}`,
      { headers: authHeaders(), signal: ctx.signal },
    );
    let a = found.results?.find((x) => x.assetBaseId === nativeId);
    if (!a) {
      try {
        a = await ctx.fetch.json<BkAsset>(`${API}/assets/${nativeId}/`, { headers: authHeaders(), signal: ctx.signal });
      } catch (e) {
        if ((e as { status?: number }).status === 404) return null;
        throw e;
      }
      if (!a?.id) return null;
    }
    const asset = a;
    const settled = await Promise.allSettled(payloadFiles(asset).map((f) => resolveFile(asset, f, ctx)));
    const files: AssetFile[] = [];
    for (const s of settled) {
      if (s.status === "fulfilled") files.push(s.value);
    }
    // If every resolution failed for a downloadable asset, surface the error instead of an empty list.
    const failed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
    if (files.length === 0 && failed) throw failed.reason;
    const details = toAsset(asset);
    return { ...details, downloadable: details.downloadable && files.some((f) => !f.requiresAuth), files };
  },
};
