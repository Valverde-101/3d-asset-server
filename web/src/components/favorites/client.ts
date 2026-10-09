import { useCallback, useEffect, useState } from "react";

export type FavoriteStatus = "pending" | "reviewed" | "approved";
export interface FavoriteInput {
  source: "asset" | "link";
  assetId?: string;
  url: string;
  title: string;
  type: string;
  imageUrl?: string;
  description?: string;
  note?: string;
  provider?: string;
  author?: string;
  licenseName?: string;
  licenseUrl?: string;
  licenseReviewed?: boolean;
  priceFree?: boolean | null;
  downloadable?: boolean | null;
  projects?: string[];
  categories?: string[];
  tags?: string[];
  status?: FavoriteStatus;
}
export interface Favorite extends Required<Omit<FavoriteInput, "assetId" | "imageUrl" | "provider" | "author" | "licenseName" | "licenseUrl">> {
  assetId?: string;
  imageUrl?: string;
  provider?: string;
  author?: string;
  licenseName?: string;
  licenseUrl?: string;
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  linkCheck: { state: "unchecked" | "working" | "broken" | "unknown"; at: string | null; httpStatus: number | null };
}
export interface Library { schema: 1; revision: number; items: Favorite[]; categories: { id: string; name: string }[] }
export interface Project { id: string; name: string }

let cache: Promise<Library> | null = null;
const event = "androidbuild-favorites-change";

export async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/local/favorites${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? (response.status === 404 ? "Favoritos no está disponible. Inicia 3D Asset Server desde AndroidBuild." : `Error ${response.status}`));
  return result;
}

export function loadFavorites(force = false): Promise<Library> {
  if (force || !cache) cache = request<Library>("").catch((error) => { cache = null; throw error; });
  return cache;
}

export async function refreshFavorites(): Promise<Library> {
  const data = await loadFavorites(true);
  window.dispatchEvent(new Event(event));
  return data;
}

export function useFavorites() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async (force = false) => {
    try { setLibrary(await loadFavorites(force)); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => {
    void reload();
    const changed = () => { void reload(); };
    window.addEventListener(event, changed);
    return () => window.removeEventListener(event, changed);
  }, [reload]);
  return { library, error, reload };
}

export function assetInput(a: {
  id: string; provider: string; title: string; type: string; url: string;
  thumbnailUrl?: string; description?: string; author?: string;
  license?: { name: string; url?: string }; free?: boolean;
  price?: { free: boolean }; downloadable: boolean;
}): FavoriteInput {
  return {
    source: "asset", assetId: a.id, url: a.url, title: a.title, type: a.type,
    imageUrl: a.thumbnailUrl, description: a.description ?? "", provider: a.provider,
    author: a.author, licenseName: a.license?.name, licenseUrl: a.license?.url,
    licenseReviewed: false, priceFree: a.price?.free ?? a.free ?? null,
    downloadable: a.downloadable, status: "pending", projects: [], categories: [], tags: [], note: "",
  };
}

export function findAssetFavorite(a: { id: string; url: string }, library: Library | null): Favorite | undefined {
  let canonical = a.url;
  try { const url = new URL(a.url); url.hash = ""; if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, ""); canonical = url.href; } catch { /* use literal URL */ }
  return library?.items.find((item) => {
    if (item.assetId === a.id) return true;
    try { const url = new URL(item.url); url.hash = ""; if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, ""); return url.href === canonical; }
    catch { return item.url === canonical; }
  });
}

export async function toggleAsset(a: Parameters<typeof assetInput>[0], library: Library | null): Promise<void> {
  const found = findAssetFavorite(a, library);
  if (found && !found.deletedAt) await request(`/${found.id}/trash`, "POST");
  else if (found) await request(`/${found.id}/restore`, "POST");
  else await request("", "POST", assetInput(a));
  await refreshFavorites();
}
