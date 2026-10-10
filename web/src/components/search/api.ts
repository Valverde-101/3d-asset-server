/** Minimal typed client for the server's REST API (same origin). */

export interface License { name: string; url?: string; commercialUse?: boolean; attributionRequired?: boolean }
export interface Price { free: boolean; amount?: number; currency?: string }
export interface Asset {
  id: string;
  provider: string;
  title: string;
  description?: string;
  type: string;
  tags: string[];
  url: string;
  thumbnailUrl?: string;
  author?: string;
  license?: License;
  price?: Price;
  formats?: string[];
  resolutions?: string[];
  polyCount?: number;
  animated?: boolean;
  rigged?: boolean;
  downloadable: boolean;
}
export interface AssetFile {
  url: string;
  filename: string;
  format: string;
  resolution?: string;
  mapType?: string;
  sizeBytes?: number;
  group?: string;
  includes?: { path: string; url: string }[];
  requiresAuth?: boolean;
}
export interface AssetDetails extends Asset { files: AssetFile[] }
export interface ProviderReport {
  provider: string;
  name: string;
  status: "ok" | "error" | "timeout" | "skipped" | "link";
  count: number;
  searchUrl?: string;
  error?: string;
  tookMs: number;
}
export interface SearchResponse { query: string; results: Asset[]; providers: ProviderReport[] }
export interface Provider {
  id: string;
  name: string;
  homepage: string;
  description: string;
  assetTypes: string[];
  access: "api" | "scrape" | "link";
  pricing: "free" | "freemium" | "paid";
  license?: { name: string };
  supportsDownload: boolean;
}
export interface FileSelection { id: string; totalBytes?: number; files: AssetFile[] }

const KEY_STORE = "asset-server-key";
export class UnauthorizedError extends Error {}

export function getKey(): string {
  try {
    return localStorage.getItem(KEY_STORE) ?? "";
  } catch {
    return "";
  }
}
export function setKey(k: string): void {
  try {
    localStorage.setItem(KEY_STORE, k);
  } catch {
    /* private mode */
  }
}

export async function api<T>(path: string): Promise<T> {
  // x-asset-client lets the server's analytics tell website traffic from other API users.
  const headers: Record<string, string> = { "x-asset-client": "web" };
  const key = getKey();
  if (key) headers["x-api-key"] = key;
  const res = await fetch(path, { headers });
  if (res.status === 401) throw new UnauthorizedError("This server needs an API key.");
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}

export function formatBytes(n?: number): string {
  if (n == null) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

/** Only ever put http(s) URLs into href/src: results come from third-party sites. */
export function safeUrl(u?: string): string | undefined {
  if (!u) return undefined;
  try {
    const p = new URL(u, typeof window === "undefined" ? "https://localhost" : window.location.href);
    return p.protocol === "https:" || p.protocol === "http:" ? p.href : undefined;
  } catch {
    return undefined;
  }
}
