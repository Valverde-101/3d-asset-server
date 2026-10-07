/**
 * Collections (/assets/<slug>): curated topic pages built from a topic file
 * (src/content/collections/<slug>.md) and its saved search results
 * (src/data/collections/<slug>.json, refreshed by scripts/snapshot-collections.mjs).
 * Hubs (/assets/<hub>) group them by asset kind; source pages (/sources/<id>)
 * show what each site contributes.
 */
import { getCollection, type CollectionEntry } from "astro:content";
import hubsJson from "@/data/collection-hubs.json";
import { CATALOG, type CatalogSource } from "./catalog";
import { PROVIDERS, SITE, type Provider } from "./site";

/** Same thresholds as src/core/collections.ts (MIN_INDEXABLE, MIN_SOURCES). */
const MIN_INDEXABLE = 12;
const MIN_SOURCES = 2;

export interface SnapshotAsset {
  id: string;
  provider: string;
  title: string;
  type: string;
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

interface Snapshot {
  slug: string;
  updatedAt: string;
  assets: SnapshotAsset[];
}

export interface Hub {
  id: string;
  name: string;
  title: string;
  description: string;
  intro: string;
  types: string[];
}

export type Topic = CollectionEntry<"collections">;

export interface Collection {
  slug: string;
  path: string;
  topic: Topic;
  hub: Hub;
  assets: SnapshotAsset[];
  updatedAt?: Date;
  indexable: boolean;
  sources: { id: string; name: string; count: number }[];
  facts: { cc0: number; free: number; direct: number; licences: { name: string; count: number }[] };
}

export const HUBS = hubsJson as Hub[];

const snapshots = import.meta.glob<Snapshot>("../data/collections/*.json", { eager: true, import: "default" });
const snapshotOf = (slug: string) => snapshots[`../data/collections/${slug}.json`];

export const collectionPath = (slug: string) => `/assets/${slug}`;
export const hubPath = (hub: Hub) => `/assets/${hub.id}`;
export const sourcePath = (id: string) => `/sources/${id}`;

export function providerName(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.name ?? id;
}

export function hubById(id: string): Hub {
  const hub = HUBS.find((h) => h.id === id);
  if (!hub) throw new Error(`unknown collection hub "${id}"`);
  return hub;
}

function build(topic: Topic): Collection {
  const snap = snapshotOf(topic.id);
  const assets = snap?.assets ?? [];
  const counts = new Map<string, number>();
  for (const a of assets) counts.set(a.provider, (counts.get(a.provider) ?? 0) + 1);
  const sources = [...counts].map(([id, count]) => ({ id, name: providerName(id), count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const licenceCounts = new Map<string, number>();
  for (const a of assets) if (a.license) licenceCounts.set(a.license.name, (licenceCounts.get(a.license.name) ?? 0) + 1);
  return {
    slug: topic.id,
    path: collectionPath(topic.id),
    topic,
    hub: hubById(topic.data.hub),
    assets,
    updatedAt: snap ? new Date(snap.updatedAt) : undefined,
    indexable: assets.length >= MIN_INDEXABLE && sources.length >= MIN_SOURCES,
    sources,
    facts: {
      cc0: assets.filter((a) => a.license?.name.startsWith("CC0")).length,
      free: assets.filter((a) => a.free !== false).length,
      direct: assets.filter((a) => a.downloadable).length,
      licences: [...licenceCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    },
  };
}

let cache: Collection[] | undefined;

/** Every collection, in hub order, then by title. */
export async function allCollections(): Promise<Collection[]> {
  if (cache) return cache;
  const topics = await getCollection("collections");
  const order = (c: Collection) => HUBS.indexOf(c.hub);
  cache = topics.map(build).sort((a, b) => order(a) - order(b) || a.topic.data.title.localeCompare(b.topic.data.title));
  return cache;
}

export async function collectionsInHub(hub: Hub): Promise<Collection[]> {
  return (await allCollections()).filter((c) => c.hub.id === hub.id);
}

/** A collection's related pages: its own picks first, then others in the same hub. */
export async function relatedTo(c: Collection, n = 6): Promise<Collection[]> {
  const all = await allCollections();
  const picked = c.topic.data.related.map((s) => all.find((x) => x.slug === s)).filter((x): x is Collection => Boolean(x));
  const more = all.filter((x) => x.hub.id === c.hub.id && x.slug !== c.slug && !picked.includes(x));
  return [...picked, ...more].slice(0, n);
}

/** Latest content change among collections (for hub and index pages). */
export function latest(cs: Collection[]): Date | undefined {
  const times = cs.map((c) => c.updatedAt?.getTime()).filter((t): t is number => t !== undefined);
  return times.length ? new Date(Math.max(...times)) : undefined;
}

type Search = Topic["data"]["search"];

/** Same search in the web app: /search?q=sunset&type=hdri&free=true */
export function searchHref(s: Search): string {
  const p = new URLSearchParams({ q: s.q });
  if (s.types?.length) p.set("type", s.types.join(","));
  if (s.free) p.set("free", "true");
  if (s.downloadable) p.set("downloadable", "true");
  if (s.providers?.length) p.set("providers", s.providers.join(","));
  return `/search?${p}`;
}

/** Same search on the REST API, as an absolute URL for curl. */
export function apiHref(s: Search): string {
  const p = new URLSearchParams({ q: s.q });
  if (s.types?.length) p.set("type", s.types.join(","));
  if (s.free) p.set("free", "true");
  if (s.downloadable) p.set("downloadable", "true");
  if (s.providers?.length) p.set("providers", s.providers.join(","));
  return `${SITE.url}/v1/search?${p}`;
}

const TYPE_PLURAL: Record<string, string> = {
  model: "3D models",
  material: "materials",
  texture: "textures",
  hdri: "HDRIs",
  pack: "asset packs",
  sprite: "sprites",
  ui: "UI kits",
  audio: "audio packs",
  font: "fonts",
  other: "assets",
};
const TYPE_SINGULAR: Record<string, string> = {
  model: "3D model",
  material: "PBR material",
  texture: "texture",
  hdri: "HDRI",
  pack: "asset pack",
  sprite: "sprite",
  ui: "UI kit",
  audio: "audio pack",
  font: "font",
  other: "asset",
};

export const typeNoun = (type: string) => TYPE_SINGULAR[type] ?? "asset";

/** "36 HDRIs", or "36 assets" when a page mixes types. */
export function countLabel(assets: SnapshotAsset[]): string {
  const types = new Set(assets.map((a) => a.type));
  const textures = [...types].every((t) => t === "material" || t === "texture");
  const noun = types.size === 1 ? TYPE_PLURAL[[...types][0]!] : textures ? "materials and textures" : "assets";
  return `${assets.length} ${noun ?? "assets"}`;
}

export const dateFmt = new Intl.DateTimeFormat("en", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

export interface SourcePage {
  provider: Provider;
  census?: CatalogSource;
  /** Collections with at least one asset from this source, and how many. */
  collections: { collection: Collection; count: number }[];
  /** A sample of its assets from those collections (one per collection first). */
  assets: SnapshotAsset[];
  indexable: boolean;
}

export async function sourcePages(): Promise<SourcePage[]> {
  const all = await allCollections();
  return PROVIDERS.map((provider) => {
    const census = CATALOG.sources.find((s) => s.id === provider.id);
    const featured = all
      .map((collection) => ({ collection, count: collection.assets.filter((a) => a.provider === provider.id).length }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count);
    const seen = new Set<string>();
    const assets: SnapshotAsset[] = [];
    // Round-robin over the collections so the sample shows the source's range.
    for (let round = 0; assets.length < 12 && round < 12; round++) {
      for (const { collection } of featured) {
        const a = collection.assets.filter((x) => x.provider === provider.id)[round];
        if (a && !seen.has(a.id) && assets.length < 12) {
          seen.add(a.id);
          assets.push(a);
        }
      }
    }
    // A link-only site (no census, nothing in any collection) has too little of its own to index.
    return { provider, census, collections: featured, assets, indexable: Boolean(census) || assets.length >= 4 };
  });
}
