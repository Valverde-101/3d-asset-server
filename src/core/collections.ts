/**
 * Collections: curated landing pages (/assets/<slug>) that show a saved
 * search. A topic file (web/src/content/collections/<slug>.md) holds the
 * editorial copy and the search; scripts/snapshot-collections.mjs runs that
 * search and saves the results here as a snapshot
 * (web/src/data/collections/<slug>.json), which the website pre-renders.
 *
 * Snapshots are kept stable on purpose: assets already on a page keep their
 * place while the search still finds them, and new ones only fill free slots.
 * A page that reshuffles every day looks unreliable to search engines and to
 * readers. `updatedAt` moves only when the list really changes, so the
 * sitemap's lastmod stays honest.
 */

import type { SearchRequest, SearchResponse } from "./service.js";
import type { Asset, AssetType, Pricing } from "./types.js";
import { matchScore } from "./util.js";

/** Most assets shown on one collection page. */
export const MAX_ASSETS = 36;
/** Below this many assets (or sources), a page is `noindex` and new topics are refused. */
export const MIN_INDEXABLE = 12;
export const MIN_SOURCES = 2;
/**
 * Results whose text matches less of the query than this are left out: every
 * query word must be in the title or tags (a title that only starts with it,
 * like "Card" for "car", scores 0.5).
 */
const MIN_RELEVANCE = 0.7;
/** No single source may fill more than this share of a page. */
const MAX_SOURCE_SHARE = 0.4;

export interface CollectionSearch {
  q: string;
  types?: AssetType[];
  free?: boolean;
  downloadable?: boolean;
  providers?: string[];
  /** Editorial blocklist: title phrases (case-insensitive) or asset ids that never belong on the page. */
  exclude?: string[];
}

/** The part of an Asset a collection page shows (no descriptions: they are the source's copy). */
export interface SnapshotAsset {
  id: string;
  provider: string;
  title: string;
  type: AssetType;
  url: string;
  thumbnailUrl: string;
  author?: string;
  license?: { name: string; url?: string; commercialUse?: boolean; attributionRequired?: boolean };
  free?: boolean;
  formats?: string[];
  maxResolution?: string;
  polyCount?: number;
  animated?: boolean;
  rigged?: boolean;
  downloadable: boolean;
}

export interface CollectionSnapshot {
  slug: string;
  search: CollectionSearch;
  /** When the list of assets last changed (ISO date-time). */
  updatedAt: string;
  assets: SnapshotAsset[];
}

export interface SnapshotResult {
  snapshot: CollectionSnapshot;
  changed: boolean;
  /** Sources that failed or timed out this run (their previous assets were kept). */
  failed: string[];
  kept: number;
  added: number;
  dropped: number;
  /** Assets skipped because their thumbnail no longer loads. */
  brokenImages: number;
}

export function toSnapshotAsset(a: Asset): SnapshotAsset | undefined {
  if (!a.thumbnailUrl || !a.title?.trim() || !/^https:\/\//.test(a.thumbnailUrl)) return undefined;
  const out: SnapshotAsset = {
    id: a.id,
    provider: a.provider,
    title: a.title.trim(),
    type: a.type,
    url: a.url,
    thumbnailUrl: a.thumbnailUrl,
    downloadable: a.downloadable,
  };
  if (a.author) out.author = a.author;
  if (a.license?.name) {
    const { name, url, commercialUse, attributionRequired } = a.license;
    out.license = { name, ...(url ? { url } : {}), ...(commercialUse !== undefined ? { commercialUse } : {}), ...(attributionRequired !== undefined ? { attributionRequired } : {}) };
  }
  if (a.price) out.free = a.price.free;
  if (a.formats?.length) out.formats = a.formats.slice(0, 6);
  if (a.resolutions?.length) out.maxResolution = a.resolutions[a.resolutions.length - 1];
  if (a.polyCount) out.polyCount = a.polyCount;
  if (a.animated) out.animated = true;
  if (a.rigged) out.rigged = true;
  return out;
}

/** True when an asset belongs on a "free" page: free by its own price, or from a free-only source. */
function isFree(a: Asset, pricing: ReadonlyMap<string, Pricing>): boolean {
  return a.price ? a.price.free : pricing.get(a.provider) === "free";
}

/**
 * Merge this run's results into the previous list.
 *  1. Fresh candidates: relevant, with a thumbnail, free when the search asks for it, one per id and title.
 *  2. Previous assets keep their order while they are still candidates, or while their source failed this run.
 *  3. New candidates fill the remaining slots in ranking order; no source takes more than 40% of the page.
 */
export function selectAssets(
  fresh: Asset[],
  opts: { search: CollectionSearch; previous?: SnapshotAsset[]; failed?: ReadonlySet<string>; pricing: ReadonlyMap<string, Pricing>; max?: number },
): SnapshotAsset[] {
  const max = opts.max ?? MAX_ASSETS;
  const perSource = Math.max(1, Math.floor(max * MAX_SOURCE_SHARE));
  const exclude = (opts.search.exclude ?? []).map((e) => e.toLowerCase());
  const excluded = (a: { id: string; title: string }) => exclude.some((e) => a.id.toLowerCase() === e || a.title.toLowerCase().includes(e));
  const seenTitles = new Set<string>();
  const candidates = new Map<string, SnapshotAsset>();
  for (const a of fresh) {
    if (candidates.has(a.id) || excluded(a)) continue;
    if (matchScore(a, opts.search.q) < MIN_RELEVANCE) continue;
    if (opts.search.free && !isFree(a, opts.pricing)) continue;
    if (opts.search.downloadable && !a.downloadable) continue;
    const s = toSnapshotAsset(a);
    if (!s) continue;
    const titleKey = `${s.provider}:${s.title.toLowerCase()}`;
    if (seenTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);
    candidates.set(s.id, s);
  }

  const out: SnapshotAsset[] = [];
  const bySource = new Map<string, number>();
  const take = (s: SnapshotAsset) => {
    out.push(s);
    bySource.set(s.provider, (bySource.get(s.provider) ?? 0) + 1);
  };
  for (const p of opts.previous ?? []) {
    if (out.length >= max) break;
    const now = candidates.get(p.id);
    if (now) take(now);
    else if (opts.failed?.has(p.provider) && !excluded(p)) take(p);
  }
  const taken = new Set(out.map((s) => s.id));
  for (const s of candidates.values()) {
    if (out.length >= max) break;
    if (taken.has(s.id) || (bySource.get(s.provider) ?? 0) >= perSource) continue;
    take(s);
  }
  return out;
}

export function sourcesOf(assets: SnapshotAsset[]): string[] {
  return [...new Set(assets.map((a) => a.provider))];
}

/** Indexable: enough assets from enough sources to be worth a search engine's time. */
export function isIndexable(assets: SnapshotAsset[]): boolean {
  return assets.length >= MIN_INDEXABLE && sourcesOf(assets).length >= MIN_SOURCES;
}

export function searchRequest(search: CollectionSearch): SearchRequest {
  return {
    query: search.q,
    types: search.types,
    freeOnly: search.free,
    downloadableOnly: search.downloadable,
    providers: search.providers,
    // Ask for more than a page so filtering and the per-source cap still leave enough.
    limit: 100,
  };
}

/**
 * Run one collection's search and merge it into its previous snapshot.
 * With `checkImage`, every chosen thumbnail is checked (once per URL); an
 * asset whose thumbnail is definitely gone is skipped and the next candidate
 * takes its slot, so the static page never shows a broken image.
 */
export async function snapshotCollection(
  run: (req: SearchRequest) => Promise<SearchResponse>,
  slug: string,
  search: CollectionSearch,
  opts: { previous?: CollectionSnapshot; pricing: ReadonlyMap<string, Pricing>; now?: Date; checkImage?: (url: string) => Promise<boolean> },
): Promise<SnapshotResult> {
  const res = await run(searchRequest(search));
  const failed = res.providers.filter((p) => p.status === "error" || p.status === "timeout").map((p) => p.provider);
  const prevAssets = sameSearch(opts.previous?.search, search) ? opts.previous?.assets : undefined;
  const broken: string[] = [];
  const checked = new Map<string, boolean>();
  let assets: SnapshotAsset[] = [];
  for (let round = 0; round < 5; round++) {
    // Broken thumbnails are excluded by id for this run only (not saved with the search).
    const effective = broken.length ? { ...search, exclude: [...(search.exclude ?? []), ...broken] } : search;
    assets = selectAssets(res.results, { search: effective, previous: prevAssets, failed: new Set(failed), pricing: opts.pricing });
    if (!opts.checkImage) break;
    const unchecked = assets.filter((a) => !checked.has(a.thumbnailUrl));
    if (!unchecked.length) break;
    const results = await Promise.all(unchecked.map(async (a) => [a, await opts.checkImage!(a.thumbnailUrl)] as const));
    for (const [a, ok] of results) {
      checked.set(a.thumbnailUrl, ok);
      if (!ok) broken.push(a.id);
    }
    if (results.every(([, ok]) => ok)) break;
  }
  assets = assets.filter((a) => checked.get(a.thumbnailUrl) !== false);
  const before = new Set((prevAssets ?? []).map((a) => a.id));
  const after = new Set(assets.map((a) => a.id));
  const changed = !opts.previous || JSON.stringify(opts.previous.assets) !== JSON.stringify(assets) || JSON.stringify(opts.previous.search) !== JSON.stringify(search);
  return {
    snapshot: {
      slug,
      search,
      updatedAt: changed ? (opts.now ?? new Date()).toISOString() : opts.previous!.updatedAt,
      assets,
    },
    changed,
    failed,
    kept: [...after].filter((id) => before.has(id)).length,
    added: [...after].filter((id) => !before.has(id)).length,
    dropped: [...before].filter((id) => !after.has(id)).length,
    brokenImages: broken.length,
  };
}

/** Same search once normalised (case, spacing, list order). */
export function sameSearch(a: CollectionSearch | undefined, b: CollectionSearch | undefined): boolean {
  if (!a || !b) return false;
  return searchKey(a) === searchKey(b);
}

export function searchKey(s: CollectionSearch): string {
  const list = (l?: string[]) => [...(l ?? [])].sort().join(",");
  return [s.q.trim().toLowerCase().replace(/\s+/g, " "), list(s.types), s.free ? "free" : "", s.downloadable ? "dl" : "", list(s.providers)].join("|");
}
