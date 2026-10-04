import type { Asset, AssetType, License, SearchQuery } from "./types.js";

export const LICENSES = {
  CC0: {
    name: "CC0",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    commercialUse: true,
    attributionRequired: false,
  },
  CC_BY_4: {
    name: "CC-BY-4.0",
    url: "https://creativecommons.org/licenses/by/4.0/",
    commercialUse: true,
    attributionRequired: true,
  },
} satisfies Record<string, License>;

export function assetId(provider: string, nativeId: string): string {
  return `${provider}:${nativeId}`;
}

/** Split `provider:nativeId` (nativeId may itself contain colons). */
export function parseAssetId(id: string): { provider: string; nativeId: string } | null {
  const i = id.indexOf(":");
  if (i <= 0 || i === id.length - 1) return null;
  return { provider: id.slice(0, i), nativeId: id.slice(i + 1) };
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t.length > 0);
}

/** Crude singularisation so "trees" matches "tree" and "boxes" matches "box". */
export function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return token.slice(0, -3) + "y";
  if (token.length > 4 && /(ses|xes|zes|ches|shes)$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

export interface Matchable {
  title: string;
  tags?: string[];
  categories?: string[];
  description?: string;
}

/**
 * Score how well an item matches a free-text query, 0..1.
 * Title hits weigh most, then tags/categories, then description.
 * Returns 1 for an empty query so browse results are kept.
 */
export function matchScore(item: Matchable, query: string): number {
  const qTokens = [...new Set(tokenize(query).map(stem))];
  if (qTokens.length === 0) return 1;
  const title = new Set(tokenize(item.title).map(stem));
  const tags = new Set(
    [...(item.tags ?? []), ...(item.categories ?? [])].flatMap((t) => tokenize(t)).map(stem),
  );
  const desc = new Set(tokenize(item.description ?? "").map(stem));
  let score = 0;
  for (const q of qTokens) {
    if (title.has(q)) score += 1;
    else if (tags.has(q)) score += 0.7;
    else if (desc.has(q)) score += 0.35;
    else if ([...title].some((t) => t.startsWith(q) || (q.length > 3 && t.includes(q)))) score += 0.5;
    else if ([...tags].some((t) => t.startsWith(q))) score += 0.3;
  }
  return Math.min(1, score / qTokens.length);
}

/** Filter + rank a local catalogue (used by providers that fetch a full list). */
export function filterLocal<T extends Matchable & { type: AssetType }>(
  items: T[],
  q: SearchQuery,
  minScore = 0.34,
): T[] {
  const typed = items.filter((i) => typeMatches(i.type, q.types));
  if (!q.query.trim()) return typed;
  return typed
    .map((item) => ({ item, s: matchScore(item, q.query) }))
    .filter((x) => x.s >= minScore)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.item);
}

export function paginate<T>(items: T[], q: SearchQuery): T[] {
  const offset = q.offset ?? 0;
  return items.slice(offset, offset + q.limit);
}

/** Types that users usually mean interchangeably. */
const RELATED_TYPES: Partial<Record<AssetType, AssetType[]>> = {
  texture: ["material"],
  material: ["texture"],
};

/** Does an asset of `type` satisfy the requested `types` filter? */
export function typeMatches(type: AssetType, types?: AssetType[]): boolean {
  if (!types?.length) return true;
  return types.some((t) => t === type || RELATED_TYPES[t]?.includes(type));
}

/** Does the query want any of these types? Used to skip whole catalogue sections. */
export function wantsType(q: SearchQuery, ...types: AssetType[]): boolean {
  return types.some((t) => typeMatches(t, q.types));
}

const TYPE_KEYWORDS: [AssetType, RegExp][] = [
  ["hdri", /\b(hdri|hdr|skybox|sky ?dome|panorama|environment map)\b/i],
  ["material", /\b(material|pbr|substance|sbsar|shader)\b/i],
  ["texture", /\b(texture|textures|seamless|tileable|decal|atlas)\b/i],
  ["audio", /\b(audio|sound|sfx|music|soundtrack)\b/i],
  ["font", /\b(font|typeface)\b/i],
  ["ui", /\b(ui|gui|interface|hud|icons?|buttons?)\b/i],
  ["sprite", /\b(sprite|sprites|2d|pixel|tileset|tilemap|tiles)\b/i],
  ["model", /\b(3d|model|models|mesh|low ?poly|lowpoly|character|prop|props|glb|gltf|fbx|obj|blend)\b/i],
];

/** Best-effort asset type from free text (title/tags/category). */
export function inferType(text: string, fallback: AssetType = "other"): AssetType {
  for (const [type, re] of TYPE_KEYWORDS) if (re.test(text)) return type;
  return fallback;
}

const KNOWN_FORMATS = new Set([
  "glb", "gltf", "fbx", "obj", "blend", "usd", "usdz", "usdc", "dae", "stl", "3ds", "max", "c4d", "ma", "mb",
  "png", "jpg", "jpeg", "tif", "tiff", "exr", "hdr", "webp", "tga", "psd",
  "zip", "rar", "7z", "sbsar", "mtlx", "wav", "ogg", "mp3", "ttf", "otf",
]);

export function formatFromFilename(name: string): string {
  const clean = name.split(/[?#]/)[0] ?? name;
  const ext = clean.includes(".") ? clean.slice(clean.lastIndexOf(".") + 1).toLowerCase() : "";
  return ext === "jpeg" ? "jpg" : ext;
}

export function isKnownFormat(ext: string): boolean {
  return KNOWN_FORMATS.has(ext.toLowerCase());
}

export function filenameFromUrl(url: string): string {
  try {
    const p = new URL(url).pathname;
    return decodeURIComponent(p.slice(p.lastIndexOf("/") + 1)) || "download";
  } catch {
    return "download";
  }
}

export function absoluteUrl(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

export function cleanText(s: string | undefined | null): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

export function uniq<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)];
}

/** Drop undefined keys so JSON output stays compact. */
export function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

export function makeAsset(a: Omit<Asset, "id"> & { id?: string }): Asset {
  return compact({ ...a, id: a.id ?? assetId(a.provider, a.nativeId), tags: uniq(a.tags.map((t) => t.toLowerCase())) });
}

export function qs(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}
