import * as cheerio from "cheerio";
import type { Asset, AssetDetails, AssetFile, AssetType, License, Price, Provider, SearchQuery } from "../core/types.js";
import {
  LICENSES,
  absoluteUrl,
  cleanText,
  formatFromFilename,
  inferType,
  isKnownFormat,
  makeAsset,
  paginate,
  qs,
  typeMatches,
  uniq,
  wantsType,
} from "../core/util.js";
import { mapLimit, parseCount } from "../core/census.js";

/**
 * itch.io game assets (https://itch.io/game-assets): indie asset packs, free and paid.
 *
 * - Text queries: `https://itch.io/search?q=...&classification=assets` (HTML, one page of ~50 results;
 *   price/tag facets and further pages need a login, so freeOnly and types are filtered locally, and a
 *   "3d" hint is added to the query when only models are wanted).
 * - Browsing (empty query): `https://itch.io/game-assets[/free][/tag-<tag>]?format=json&page=N`, a JSON
 *   envelope `{ page, num_items, content: "<html of 36 game cells>" }` (the browse pages ignore `q`).
 * - Details: `https://<user>.itch.io/<slug>/data.json` (title, authors, tags, price, cover, screenshots)
 *   plus the game page (description, license, upload list).
 *
 * Downloads go through itch's purchase/download flow (CSRF + cookies), so nothing is directly downloadable.
 */

const ITCH = "https://itch.io";
const PAGE_SIZE = 36;
const MAX_BROWSE_PAGES = 3;

const TYPES: AssetType[] = ["model", "sprite", "texture", "material", "ui", "audio", "font", "pack", "other"];

/** Browse tag per asset type (`/game-assets/tag-<tag>`). */
const TYPE_TAG: Partial<Record<AssetType, string>> = {
  model: "3d",
  sprite: "2d",
  texture: "textures",
  material: "textures",
  ui: "gui",
  audio: "audio",
  font: "fonts",
};

/** itch tag slugs -> type, checked in order. */
const TAG_TYPES: [AssetType, RegExp][] = [
  ["model", /^(3d|3d-models?|low-poly|voxel|blender|fbx|gltf)$/],
  ["font", /^fonts?$/],
  ["audio", /^(audio|music|sound-effects|sfx|sounds?)$/],
  ["ui", /^(gui|user-interface|ui|icons?|hud)$/],
  ["texture", /^(textures?|pbr|materials?|seamless)$/],
  ["sprite", /^(2d|sprites?|pixel-art|tileset|tilemap|spritesheet)$/],
];

const FORMAT_TAGS: Record<string, string> = {
  fbx: "fbx", obj: "obj", gltf: "gltf", glb: "glb", blender: "blend", blend: "blend",
  "unity-package": "unitypackage", png: "png", wav: "wav", ogg: "ogg", mp3: "mp3", ttf: "ttf", otf: "otf",
};

const CURRENCIES: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY" };

/** "$19.95", "4.95€", "£3", "$1.00 USD" -> Price. */
export function parsePrice(text: string | undefined): Price | undefined {
  const t = cleanText(text);
  if (!t) return undefined;
  const amount = Number(/(\d+(?:[.,]\d+)?)/.exec(t)?.[1]?.replace(",", "."));
  if (!Number.isFinite(amount)) return /free/i.test(t) ? { free: true } : undefined;
  const sym = /[$€£¥]/.exec(t)?.[0];
  const code = /\b([A-Z]{3})\b/.exec(t)?.[1];
  return { free: amount === 0, amount, currency: code ?? (sym ? CURRENCIES[sym] : undefined) };
}

/** `https://user.itch.io/slug` -> `user/slug`. */
function nativeIdFromUrl(url: string | undefined): string | undefined {
  const m = /^https?:\/\/([a-z0-9_-]+)\.itch\.io\/([a-z0-9_-]+)\/?$/i.exec(url ?? "");
  return m ? `${m[1]!.toLowerCase()}/${m[2]}` : undefined;
}

function parseNativeId(id: string): { user: string; slug: string } | null {
  const m = /^([a-z0-9_-]+)[/:]([a-z0-9_-]+)$/i.exec(id);
  return m ? { user: m[1]!.toLowerCase(), slug: m[2]! } : null;
}

/** Title wins over the blurb ("Low-Poly Tree Pack" with "PBR textures" in its description is a model pack). */
function inferFromText(title: string, text: string, fallback: AssetType): AssetType {
  const norm = (s: string) => s.replace(/[-_]/g, " ");
  return inferType(norm(title), inferType(norm(text), fallback));
}

const DISTINCT_TYPES = new Set<AssetType>(["audio", "font", "ui"]);
const ANIMATED_RE = /\banimat(ed|ions?)\b/i;
const RIGGED_RE = /\brigged\b/i;

/**
 * Parse itch "game cells" (search results and browse JSON `content`).
 * `typeHint` is the type implied by the listing (e.g. the tag-3d browse page), used when the
 * title/description do not say otherwise.
 */
export function parseCells(html: string, typeHint?: AssetType): Asset[] {
  const $ = cheerio.load(html);
  const out: Asset[] = [];
  const seen = new Set<string>();
  $("[data-game_id]").each((_, el) => {
    const cell = $(el);
    const link = cell.find("a.title.game_link").first();
    const url = link.attr("href");
    const nativeId = nativeIdFromUrl(url);
    if (!url || !nativeId || seen.has(nativeId)) return;
    seen.add(nativeId);
    const title = cleanText(link.text());
    const text = cleanText(cell.find(".game_text").attr("title") ?? cell.find(".game_text").text());
    const priceText = cell.find(".price_value").first().text();
    // No price tag means free / name-your-own-price.
    const price = parsePrice(priceText) ?? { free: true };
    const inferred = inferFromText(title, text, typeHint ?? "pack");
    // Trust the listing's type, except for clearly different content (music in a 3D listing, ...).
    const type = typeHint && !DISTINCT_TYPES.has(inferred) ? typeHint : inferred;
    const img = cell.find(".game_thumb img").first();
    out.push(
      makeAsset({
        provider: "itchio",
        nativeId,
        title,
        description: text || undefined,
        type,
        tags: [...(typeHint && TYPE_TAG[typeHint] ? [TYPE_TAG[typeHint]!] : []), ...(price.free ? ["free"] : [])],
        url,
        thumbnailUrl: absoluteUrl(img.attr("data-lazy_src") ?? img.attr("src"), ITCH),
        author: cleanText(cell.find(".game_author a").first().text()) || undefined,
        price,
        animated: ANIMATED_RE.test(`${title} ${text}`) || undefined,
        rigged: RIGGED_RE.test(`${title} ${text}`) || undefined,
        downloadable: false,
      }),
    );
  });
  return out;
}

/** The single browse tag to use, when the requested types map to exactly one. */
function browseTag(q: SearchQuery): { tag?: string; type?: AssetType } {
  const tags = uniq((q.types ?? []).map((t) => TYPE_TAG[t]));
  if (tags.length !== 1 || !tags[0]) return {};
  const type = q.types!.find((t) => TYPE_TAG[t] === tags[0])!;
  return { tag: tags[0], type: type === "material" ? "texture" : type };
}

function onlyModels(q: SearchQuery): boolean {
  return !!q.types?.length && q.types.every((t) => t === "model");
}

function searchText(q: SearchQuery): string {
  const query = q.query.trim();
  if (!query) return "";
  // The search endpoint has no anonymous tag filter; bias it towards 3D when only models are wanted.
  return onlyModels(q) && !/\b(3d|low[ -]?poly|lowpoly|voxel|model)/i.test(query) ? `${query} 3d` : query;
}

function browsePath(q: SearchQuery): string {
  const { tag } = browseTag(q);
  return `${ITCH}/game-assets${q.freeOnly ? "/free" : ""}${tag ? `/tag-${tag}` : ""}`;
}

function licenseFrom(name: string, href: string | undefined): License | undefined {
  if (!name) return undefined;
  if (/zero|cc0/i.test(`${name} ${href ?? ""}`)) return LICENSES.CC0;
  if (/attribution v4|cc-by-4|assets-cc4-by\b/i.test(`${name} ${href ?? ""}`) && !/share|non|noderiv/i.test(name)) {
    return LICENSES.CC_BY_4;
  }
  return { name, url: absoluteUrl(href, ITCH) };
}

/** "6.1 MB" -> bytes (approximate). */
function parseSize(text: string): number | undefined {
  const m = /([\d.]+)\s*(bytes|kb|mb|gb)/i.exec(text);
  if (!m) return undefined;
  const mult = { bytes: 1, kb: 1e3, mb: 1e6, gb: 1e9 }[m[2]!.toLowerCase() as "bytes" | "kb" | "mb" | "gb"];
  return Math.round(Number(m[1]) * mult);
}

interface ItchData {
  id?: number;
  title?: string;
  authors?: { name: string; url: string }[];
  tags?: string[];
  cover_image?: string;
  screenshots?: string[];
  price?: string;
  links?: { self?: string };
  errors?: string[];
}

function typeFromTags(tags: string[]): AssetType | undefined {
  for (const [type, re] of TAG_TYPES) if (tags.some((t) => re.test(t))) return type;
  return undefined;
}

export function parseGame(nativeId: string, data: ItchData, html: string | undefined): AssetDetails {
  const { user, slug } = parseNativeId(nativeId)!;
  const url = data.links?.self ?? `https://${user}.itch.io/${slug}`;
  const $ = cheerio.load(html ?? "");
  const tags = (data.tags ?? []).map((t) => t.toLowerCase());

  const info = new Map<string, ReturnType<typeof $>>();
  $(".game_info_panel_widget tr").each((_, tr) => {
    const tds = $(tr).find("td");
    info.set(cleanText(tds.first().text()).toLowerCase(), tds.eq(1));
  });
  const licEl = info.get("asset license")?.find("a").first();
  const license = licEl?.length ? licenseFrom(cleanText(licEl.text()), licEl.attr("href")) : undefined;
  const published = info.get("published")?.find("abbr").attr("title") ?? info.get("release date")?.find("abbr").attr("title");
  const createdAt = published ? new Date(published.replace("@", "")) : undefined;

  const longDesc = cleanText($(".formatted_description").first().text());
  const shortDesc = cleanText($("meta[name='description']").attr("content"));
  const description = (shortDesc && shortDesc !== "itch.io" ? shortDesc : "") || longDesc.slice(0, 1000) || undefined;

  const price: Price =
    parsePrice(data.price) ?? parsePrice($(".buy_row .dollars").first().text()) ?? { free: true };

  const buyUrl = absoluteUrl($("a.buy_btn").attr("href"), url) ?? `${url}#download`;
  const files: AssetFile[] = $(".upload_list_widget .upload")
    .map((_, el) => {
      const up = $(el);
      const name = cleanText(up.find(".upload_name .name").attr("title") ?? up.find(".upload_name .name").text());
      if (!name) return undefined;
      const ext = formatFromFilename(name);
      const file: AssetFile = {
        url: buyUrl,
        filename: name,
        format: isKnownFormat(ext) ? ext : "unknown",
        sizeBytes: parseSize(up.find(".file_size").text()),
        group: "itch.io",
        requiresAuth: true,
      };
      return file;
    })
    .get()
    .filter((f): f is AssetFile => !!f);

  const formats = uniq([
    ...tags.map((t) => FORMAT_TAGS[t]).filter((f): f is string => !!f),
    ...files.map((f) => f.format).filter((f) => f !== "unknown" && f !== "zip"),
  ]);
  const text = `${data.title ?? ""} ${description ?? ""}`;
  const type = typeFromTags(tags) ?? inferFromText(data.title ?? "", description ?? "", "pack");

  const asset = makeAsset({
    provider: "itchio",
    nativeId,
    title: data.title ?? cleanText($("h1.game_title").text()),
    description,
    type,
    tags: [...tags, ...(price.free ? ["free"] : [])],
    url,
    thumbnailUrl: data.cover_image ?? absoluteUrl($("meta[property='og:image']").attr("content"), url),
    author: data.authors?.map((a) => a.name).join(", ") || undefined,
    license,
    price,
    formats: formats.length ? formats : undefined,
    animated: tags.includes("animated") || ANIMATED_RE.test(text) || undefined,
    rigged: tags.includes("rigged") || RIGGED_RE.test(text) || undefined,
    downloadable: false,
    createdAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toISOString() : undefined,
  });
  return { ...asset, files };
}

interface BrowsePage {
  page?: number;
  num_items?: number;
  content?: string;
}

export const itchio: Provider = {
  id: "itchio",
  name: "itch.io",
  homepage: "https://itch.io/game-assets",
  description: "Indie game asset packs (3D, 2D sprites, UI, audio, fonts), free and paid, from itch.io creators.",
  assetTypes: TYPES,
  access: "scrape",
  pricing: "freemium",
  supportsDownload: false,

  async census(ctx) {
    const count = async (path: string) => {
      const html = await ctx.fetch.text(`${ITCH}/game-assets${path}`, { signal: ctx.signal });
      const n = parseCount(html, /\(?([\d,]+) results\)?/);
      if (n === undefined) throw new Error(`itchio: no result count on /game-assets${path}`);
      return n;
    };
    const tags = { "3D": "3d", "2D": "2d", Textures: "textures", "UI / GUI": "gui", Audio: "audio", Fonts: "fonts" };
    const [total, free, ...perTag] = await mapLimit(["", "/free", ...Object.values(tags).map((t) => `/tag-${t}`)], 3, count);
    return {
      total: total!,
      free,
      // Listings are packs with overlapping tags, so they count once, as packs; tags go in categories.
      byType: { pack: total },
      categories: Object.fromEntries(Object.keys(tags).map((k, i) => [k, perTag[i]!])),
      unit: "packs",
      method: "itch.io game-assets browse pages: result counts",
    };
  },

  buildSearchUrl(q: SearchQuery) {
    const text = searchText(q);
    if (!text) return browsePath(q);
    return `${ITCH}/search${qs({ q: text, classification: "assets" })}`;
  },

  async search(q, ctx) {
    if (!wantsType(q, ...TYPES)) return { assets: [] };
    const searchUrl = this.buildSearchUrl(q);
    const text = searchText(q);

    if (!text) {
      // Browse the (popular-first) asset listing, page by page.
      const { type: hint } = browseTag(q);
      const offset = q.offset ?? 0;
      const first = Math.floor(offset / PAGE_SIZE) + 1;
      const last = Math.min(Math.floor((offset + Math.max(q.limit, 1) - 1) / PAGE_SIZE) + 1, first + MAX_BROWSE_PAGES - 1);
      const pages = await Promise.all(
        Array.from({ length: last - first + 1 }, (_, i) =>
          ctx.fetch.json<BrowsePage>(`${browsePath(q)}${qs({ format: "json", page: first + i })}`, { signal: ctx.signal }),
        ),
      );
      let assets = pages.flatMap((p) => parseCells(p.content ?? "", hint));
      if (q.freeOnly) assets = assets.filter((a) => a.price?.free);
      if (q.types?.length) assets = assets.filter((a) => typeMatches(a.type, q.types));
      const start = offset - (first - 1) * PAGE_SIZE;
      return { assets: assets.slice(start, start + q.limit), searchUrl };
    }

    const html = await ctx.fetch.text(searchUrl, { signal: ctx.signal });
    let assets = parseCells(html, onlyModels(q) ? "model" : undefined);
    if (q.freeOnly) assets = assets.filter((a) => a.price?.free);
    if (q.types?.length) assets = assets.filter((a) => typeMatches(a.type, q.types));
    return { assets: paginate(assets, q), searchUrl };
  },

  async getAsset(nativeId, ctx): Promise<AssetDetails | null> {
    const id = parseNativeId(nativeId);
    if (!id) return null;
    const base = `https://${id.user}.itch.io/${id.slug}`;
    const [dataRes, pageRes] = await Promise.allSettled([
      ctx.fetch.json<ItchData>(`${base}/data.json`, { signal: ctx.signal }),
      ctx.fetch.text(base, { signal: ctx.signal }),
    ]);
    if (dataRes.status === "rejected") {
      if ((dataRes.reason as { status?: number }).status === 404) return null;
      throw dataRes.reason;
    }
    const data = dataRes.value;
    if (!data || data.errors?.length || !data.title) return null;
    if (pageRes.status === "rejected" && ctx.signal?.aborted) throw pageRes.reason;
    const html = pageRes.status === "fulfilled" ? pageRes.value : undefined;
    return parseGame(`${id.user}/${id.slug}`, data, html);
  },
};
