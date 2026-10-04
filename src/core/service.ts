import { createHttpClient } from "./http.js";
import type {
  Asset,
  AssetDetails,
  AssetType,
  HttpClient,
  Provider,
  ProviderContext,
  ProviderInfo,
} from "./types.js";
import { matchScore, parseAssetId } from "./util.js";

export interface SearchRequest {
  query: string;
  types?: AssetType[];
  /** Restrict to these provider ids. */
  providers?: string[];
  freeOnly?: boolean;
  /** Only return assets this server can download directly. */
  downloadableOnly?: boolean;
  /** Total results to return across providers. */
  limit?: number;
  /** Per-provider result offset (for paging deeper into every source). */
  offset?: number;
  /** Per-provider timeout. */
  timeoutMs?: number;
}

export type ProviderStatus = "ok" | "error" | "timeout" | "skipped" | "link";

export interface ProviderSearchReport {
  provider: string;
  name: string;
  status: ProviderStatus;
  count: number;
  total?: number;
  searchUrl?: string;
  error?: string;
  tookMs: number;
}

export interface SearchResponse {
  query: string;
  types?: AssetType[];
  results: Asset[];
  providers: ProviderSearchReport[];
}

export interface AssetServiceOptions {
  providers: Provider[];
  http?: HttpClient;
  defaultTimeoutMs?: number;
}

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

/** Small boost for sources whose metadata and downloads we trust most. */
const ACCESS_WEIGHT = { api: 1, scrape: 0.8, link: 0 } as const;

export class AssetService {
  readonly http: HttpClient;
  private readonly providers = new Map<string, Provider>();
  private readonly defaultTimeoutMs: number;

  constructor(opts: AssetServiceOptions) {
    this.http = opts.http ?? createHttpClient();
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? Number(process.env.ASSET_SERVER_PROVIDER_TIMEOUT_MS ?? 12_000);
    for (const p of opts.providers) this.providers.set(p.id, p);
  }

  listProviders(): (ProviderInfo & { enabled: boolean })[] {
    return [...this.providers.values()].map((p) => ({
      id: p.id,
      name: p.name,
      homepage: p.homepage,
      description: p.description,
      assetTypes: p.assetTypes,
      access: p.access,
      pricing: p.pricing,
      license: p.license,
      apiKeyEnv: p.apiKeyEnv,
      supportsDownload: p.supportsDownload,
      enabled: p.isEnabled?.() ?? true,
    }));
  }

  getProvider(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  async search(req: SearchRequest): Promise<SearchResponse> {
    const limit = Math.min(Math.max(req.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;
    const types = req.types?.length ? req.types : undefined;
    const wanted = req.providers?.length ? new Set(req.providers) : undefined;
    const unknown = req.providers?.filter((p) => !this.providers.has(p)) ?? [];
    if (unknown.length) throw new UnknownProviderError(unknown);

    // Ask each source for a full page so the merged ranking has enough to choose from.
    const perProvider = Math.min(limit, 50);
    const q = { query: req.query.trim(), types, freeOnly: req.freeOnly, limit: perProvider, offset: req.offset };

    const reports: ProviderSearchReport[] = [];
    const ranked: { asset: Asset; rank: number; provider: Provider }[] = [];

    await Promise.all(
      [...this.providers.values()].map(async (p) => {
        const started = Date.now();
        const base = { provider: p.id, name: p.name, count: 0 };
        const skip = (reason: string): void => {
          reports.push({ ...base, status: "skipped", error: reason, tookMs: 0 });
        };
        if (wanted && !wanted.has(p.id)) return;
        if (p.isEnabled && !p.isEnabled()) return skip(`disabled (set ${p.apiKeyEnv ?? "its API key"})`);
        if (types && !types.some((t) => p.assetTypes.includes(t))) return skip("does not carry the requested types");
        if (req.downloadableOnly && !p.supportsDownload) return skip("no direct downloads");
        if (req.freeOnly && p.pricing === "paid") return skip("paid only");

        const searchUrl = p.buildSearchUrl(q);
        const signal = AbortSignal.timeout(timeoutMs);
        const ctx: ProviderContext = { fetch: this.http, signal };
        try {
          const res = await withTimeout(p.search(q, ctx), timeoutMs, signal);
          let assets = res.assets;
          if (req.downloadableOnly) assets = assets.filter((a) => a.downloadable);
          if (req.freeOnly) assets = assets.filter((a) => a.price?.free !== false);
          assets.forEach((asset, rank) => ranked.push({ asset, rank, provider: p }));
          reports.push({
            ...base,
            status: p.access === "link" ? "link" : "ok",
            count: assets.length,
            total: res.total,
            searchUrl: res.searchUrl ?? searchUrl,
            tookMs: Date.now() - started,
          });
        } catch (e) {
          const timedOut = signal.aborted || e instanceof TimeoutError;
          reports.push({
            ...base,
            status: timedOut ? "timeout" : "error",
            error: timedOut ? `timed out after ${timeoutMs}ms` : errorMessage(e),
            searchUrl,
            tookMs: Date.now() - started,
          });
        }
      }),
    );

    const results = rankResults(ranked, q.query).slice(0, limit);
    const order = [...this.providers.keys()];
    reports.sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
    return { query: q.query, types, results, providers: reports };
  }

  async getAsset(id: string): Promise<AssetDetails | null> {
    const parsed = parseAssetId(id);
    if (!parsed) throw new InvalidAssetIdError(id);
    const p = this.providers.get(parsed.provider);
    if (!p) throw new UnknownProviderError([parsed.provider]);
    if (!p.getAsset) throw new UnsupportedError(`${p.name} does not support asset details; open the source site instead.`);
    const signal = AbortSignal.timeout(this.defaultTimeoutMs * 2);
    return p.getAsset(parsed.nativeId, { fetch: this.http, signal });
  }
}

/**
 * Merge per-provider results into one list.
 * Score = text relevance (dominant) + the source's own ranking + small boosts for
 * free / directly downloadable assets, then a diversity penalty so a single
 * large catalogue can't fill the whole first page.
 */
export function rankResults(
  items: { asset: Asset; rank: number; provider: Pick<Provider, "id" | "access"> }[],
  query: string,
): Asset[] {
  const scored = items.map(({ asset, rank, provider }) => {
    const relevance = matchScore(asset, query);
    const sourceRank = 1 / (1 + rank * 0.15);
    const score =
      0.6 * relevance +
      0.2 * sourceRank +
      0.1 * ACCESS_WEIGHT[provider.access] +
      0.05 * (asset.price?.free ? 1 : 0) +
      0.05 * (asset.downloadable ? 1 : 0);
    return { asset, provider: provider.id, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const seenPerProvider = new Map<string, number>();
  const diversified = scored.map((s) => {
    const n = seenPerProvider.get(s.provider) ?? 0;
    seenPerProvider.set(s.provider, n + 1);
    return { ...s, score: s.score * Math.pow(0.97, n) };
  });
  diversified.sort((a, b) => b.score - a.score);
  return diversified.map((s) => ({ ...s.asset, score: round(s.score) }));
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new TimeoutError(`timed out after ${ms}ms`));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class UnknownProviderError extends Error {
  constructor(readonly ids: string[]) {
    super(`Unknown provider(s): ${ids.join(", ")}`);
    this.name = "UnknownProviderError";
  }
}

export class InvalidAssetIdError extends Error {
  constructor(id: string) {
    super(`Invalid asset id "${id}". Expected "<provider>:<id>", e.g. "polyhaven:ArmChair_01".`);
    this.name = "InvalidAssetIdError";
  }
}

export class UnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedError";
  }
}
