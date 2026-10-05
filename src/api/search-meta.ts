/**
 * Head metadata for share links to /search:
 * - query variants (/search?q=brick+wall, /search?type=hdri&free=true) get a
 *   unique title, description and share card (/og/query.png?…);
 * - asset links (/search?asset=polyhaven:ArmChair_01) get the asset's title,
 *   a generated description and a card with its thumbnail (/og/asset.png?id=…).
 * Both are `noindex, follow`: they are share targets, not landing pages.
 */
import type { AssetDetails, AssetType } from "../core/types.js";
import { ASSET_TYPES } from "../core/types.js";
import { allProviders } from "../providers/index.js";

const SITES = `${allProviders.length} sites`;

const TYPE_LABELS: Record<string, string> = {
  model: "3D models",
  material: "PBR materials",
  texture: "textures",
  hdri: "HDRIs",
  sprite: "sprites",
  ui: "UI kits",
  audio: "game audio",
  font: "fonts",
  pack: "game asset packs",
  other: "assets",
};

/** One asset of a type, for asset share cards. */
export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  model: "3D model",
  material: "PBR material",
  texture: "Texture",
  hdri: "HDRI",
  sprite: "Sprite",
  ui: "UI kit",
  audio: "Audio",
  font: "Font",
  pack: "Asset pack",
  other: "Asset",
};

/** Same, mid-sentence ("a 3D model on Poly Haven"). */
const ASSET_TYPE_NOUN: Record<AssetType, string> = {
  model: "3D model",
  material: "PBR material",
  texture: "texture",
  hdri: "HDRI",
  sprite: "sprite",
  ui: "UI kit",
  audio: "audio",
  font: "font",
  pack: "asset pack",
  other: "asset",
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const providerName = (id: string) => allProviders.find((p) => p.id === id)?.name ?? id;

export interface HeadMeta {
  title: string;
  description: string;
  robots: string;
  /** Root-relative share card path. */
  image?: string;
  imageAlt?: string;
}

export interface SearchShare {
  /** Normalised query string identifying the card (also its cache key). */
  key: string;
  kicker: string;
  title: string;
  subtitle: string;
  chips: string[];
}

/** Normalise /search parameters to the few that change what a share card says. */
export function searchShare(params: URLSearchParams): SearchShare | undefined {
  const q = clip((params.get("q") ?? "").replace(/\s+/g, " ").trim(), 80);
  const typeIds = (params.get("type") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t): t is AssetType => (ASSET_TYPES as readonly string[]).includes(t));
  const free = params.get("free") === "true";
  const downloadable = params.get("downloadable") === "true";
  const sources = (params.get("providers") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => allProviders.some((p) => p.id === s))
    .slice(0, 6);
  if (!q && !typeIds.length && !free) return undefined;

  const key = new URLSearchParams();
  if (q) key.set("q", q);
  if (typeIds.length) key.set("type", typeIds.join(","));
  if (free) key.set("free", "true");
  if (downloadable) key.set("downloadable", "true");
  if (sources.length) key.set("providers", sources.join(","));

  const what = typeIds.length ? typeIds.map((t) => TYPE_LABELS[t]).join(" & ") : "3D assets";
  const kind = `${free ? "free " : ""}${what}`;
  const Kind = `${kind[0]!.toUpperCase()}${kind.slice(1)}`;
  return {
    key: key.toString(),
    kicker: typeIds.length ? `Search · ${what}` : "Search",
    title: q ? `“${q}”` : Kind,
    subtitle: `${Kind} from ${sources.length ? sources.map(providerName).join(", ") : SITES}, with licences and direct downloads.`,
    chips: [...(free ? ["Free only"] : []), ...(downloadable ? ["Direct download"] : []), ...(sources.length ? sources.map(providerName) : ["Poly Haven", "ambientCG", "Kenney"])],
  };
}

export function searchMeta(params: URLSearchParams): HeadMeta | undefined {
  const share = searchShare(params);
  if (!share) return undefined;
  const q = (params.get("q") ?? "").replace(/\s+/g, " ").trim();
  const types = (params.get("type") ?? "").split(",").map((t) => TYPE_LABELS[t.trim()]).filter(Boolean) as string[];
  const free = params.get("free") === "true";
  const what = types.length ? types.join(" & ") : "3D assets";
  const kind = `${free ? "free " : ""}${what}`;
  const title = q ? `“${clip(q, 40)}”: ${kind} · 3D Asset Server` : `${kind[0]!.toUpperCase()}${kind.slice(1)}: search ${SITES} · 3D Asset Server`;
  const description = q
    ? `Search results for “${clip(q, 60)}” across ${SITES}: ${kind} with licences and direct downloads from Poly Haven, ambientCG, Kenney and more.`
    : `Browse ${kind} from ${SITES} at once, including Poly Haven, ambientCG, Kenney and BlenderKit, with licences and one-click downloads.`;
  return {
    title,
    description,
    robots: "noindex, follow",
    image: `/og/query.png?${share.key}`,
    imageAlt: `${share.title}: ${share.subtitle}`,
  };
}

/** Asset ids look like `provider:nativeId` with a provider this server runs; reject anything else before touching a source. */
export function shareableAssetId(raw: string | null | undefined, providerIds: readonly string[]): string | undefined {
  if (!raw || raw.length > 300) return undefined;
  const i = raw.indexOf(":");
  if (i <= 0 || i === raw.length - 1) return undefined;
  return providerIds.includes(raw.slice(0, i)) ? raw : undefined;
}

export function assetMeta(a: AssetDetails): HeadMeta {
  const source = providerName(a.provider);
  const type = ASSET_TYPE_LABEL[a.type] ?? "Asset";
  const noun = ASSET_TYPE_NOUN[a.type] ?? "asset";
  const facts = [
    a.license?.name ? `${a.license.name} licence` : undefined,
    a.price ? (a.price.free ? "free" : "paid") : undefined,
    a.formats?.length ? a.formats.slice(0, 5).join(", ").toUpperCase() : undefined,
    a.resolutions?.length ? `up to ${a.resolutions[a.resolutions.length - 1]}` : undefined,
  ].filter(Boolean);
  const lead = `${type} “${clip(a.title, 60)}” on ${source}${a.author ? ` by ${clip(a.author, 40)}` : ""}`;
  return {
    title: `${clip(a.title, 60)}: ${noun} on ${source} · 3D Asset Server`,
    description: clip(`${lead}${facts.length ? ` (${facts.join(", ")})` : ""}. Preview, licence and downloads via 3D Asset Server.`, 200),
    robots: "noindex, follow",
    image: `/og/asset.png?id=${encodeURIComponent(a.id)}`,
    imageAlt: `${a.title}: ${noun} on ${source}`,
  };
}
