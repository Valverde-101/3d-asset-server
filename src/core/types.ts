/**
 * Shared domain model for every asset source.
 *
 * Providers translate their native data into these shapes so the aggregator,
 * HTTP API and MCP server never need to know which site an asset came from.
 */

export const ASSET_TYPES = [
  "model",
  "texture",
  "material",
  "hdri",
  "sprite",
  "ui",
  "audio",
  "font",
  "pack",
  "other",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

/**
 * How a provider is reached.
 * - api:    official/public JSON API, structured metadata and often direct files
 * - scrape: HTML/WordPress pages parsed into assets
 * - link:   site blocks automated access; we only build deep search links
 */
export type AccessMethod = "api" | "scrape" | "link";

/** Pricing model of a source as a whole. */
export type Pricing = "free" | "freemium" | "paid";

export interface License {
  /** Short identifier, e.g. "CC0", "CC-BY-4.0", "Royalty Free", "Custom". */
  name: string;
  url?: string;
  commercialUse?: boolean;
  attributionRequired?: boolean;
}

export interface Price {
  free: boolean;
  amount?: number;
  currency?: string;
}

export interface Asset {
  /** Globally unique id: `${provider}:${nativeId}`. */
  id: string;
  provider: string;
  nativeId: string;
  title: string;
  description?: string;
  type: AssetType;
  tags: string[];
  categories?: string[];
  /** Human-facing page for the asset on the source site. */
  url: string;
  thumbnailUrl?: string;
  author?: string;
  license?: License;
  price?: Price;
  /** File formats known to be available (lowercase, no dot): glb, fbx, blend, png, exr... */
  formats?: string[];
  /** Max texture resolutions available, e.g. ["1k","2k","4k"]. */
  resolutions?: string[];
  polyCount?: number;
  animated?: boolean;
  rigged?: boolean;
  /** True when `getAsset` can return direct file URLs that `download` can fetch. */
  downloadable: boolean;
  createdAt?: string;
  /** Relevance score assigned by the aggregator (0..1). */
  score?: number;
}

export interface AssetFile {
  url: string;
  filename: string;
  /** Lowercase extension without the dot: glb, gltf, fbx, blend, zip, png, jpg, exr, hdr... */
  format: string;
  /** e.g. "1k", "2k", "4k", "8k". */
  resolution?: string;
  /** Texture map role when the file is a single map: diffuse, normal, roughness, ... */
  mapType?: string;
  sizeBytes?: number;
  /** Optional free-form grouping, e.g. "gltf", "blend", "textures", "archive". */
  group?: string;
  /**
   * Companion files that must sit next to this one (e.g. a .gltf's .bin and textures).
   * `path` is relative to the main file's directory.
   */
  includes?: { path: string; url: string; sizeBytes?: number }[];
  /** True when the URL needs the user to be logged in / pay on the source site. */
  requiresAuth?: boolean;
}

export interface AssetDetails extends Asset {
  files: AssetFile[];
}

export interface SearchQuery {
  /** Free-text query. May be empty to browse. */
  query: string;
  /** Restrict to these asset types. Empty/undefined = any. */
  types?: AssetType[];
  /** Exclude paid assets. */
  freeOnly?: boolean;
  /** Max results per provider. */
  limit: number;
  /** Page offset per provider (0-based item offset). */
  offset?: number;
}

export interface ProviderSearchResult {
  assets: Asset[];
  /** Total hits reported by the source if known. */
  total?: number;
  /** Link to the same search on the source website. */
  searchUrl?: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  homepage: string;
  description: string;
  assetTypes: AssetType[];
  access: AccessMethod;
  pricing: Pricing;
  /** Default license for the source's assets, if uniform. */
  license?: License;
  /** Env var holding an optional/required API key. */
  apiKeyEnv?: string;
  /** Whether this server can fetch the files for assets of this provider. */
  supportsDownload: boolean;
}

/** One "notable" asset a census can point at (most downloaded, newest…). */
export interface CensusHighlight {
  label: string;
  title: string;
  url: string;
  value?: number;
}

/**
 * What a source holds, counted by `Provider.census` (run daily, see
 * scripts/census.mjs). Every count is the source's own number of listings:
 * single assets on most sites, packs on Kenney, Quaternius and itch.io.
 */
export interface SourceCensus {
  /** Every listing on the source (free and paid). */
  total: number;
  /** True when a number is a lower bound (the source caps its counts, e.g. 10,000). */
  atLeast?: boolean;
  /** Free listings, when known. */
  free?: number;
  /** Listings per asset type; each listing counts once. */
  byType: Partial<Record<AssetType, number>>;
  /** Listings per licence, when the source mixes licences. */
  byLicense?: Record<string, number>;
  /** The source's own categories or tags (may overlap). */
  categories?: Record<string, number>;
  /** What a listing is on this source. */
  unit?: "assets" | "packs";
  /** Listings released in the 30 days before the count, when the source dates them. */
  addedLast30Days?: number;
  /** Total downloads, when the source publishes them. */
  downloads?: number;
  highlights?: CensusHighlight[];
  /** One line on how this was counted. */
  method: string;
}

export interface ProviderContext {
  fetch: HttpClient;
  signal?: AbortSignal;
}

export interface Provider extends ProviderInfo {
  /** Search the source. Link-only providers return an empty list plus `searchUrl`. */
  search(query: SearchQuery, ctx: ProviderContext): Promise<ProviderSearchResult>;
  /** Fetch full details, including downloadable files when possible. */
  getAsset?(nativeId: string, ctx: ProviderContext): Promise<AssetDetails | null>;
  /** Deep link to run the query on the source website. */
  buildSearchUrl(query: SearchQuery): string;
  /** Count what the source holds (a few requests; run daily, not per search). */
  census?(ctx: ProviderContext): Promise<SourceCensus>;
  /** Whether the provider is usable right now (e.g. API key configured). */
  isEnabled?(): boolean;
}

export interface HttpClient {
  json<T = unknown>(url: string, init?: HttpRequestInit): Promise<T>;
  text(url: string, init?: HttpRequestInit): Promise<string>;
  raw(url: string, init?: HttpRequestInit): Promise<Response>;
}

export interface HttpRequestInit {
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  signal?: AbortSignal;
  /** Cache TTL in ms for GET responses (text/json only). 0 disables. */
  cacheTtlMs?: number;
}
