import * as cheerio from "cheerio";
import type { Asset, AssetDetails, AssetFile, AssetType, Provider, ProviderContext, SearchQuery } from "../core/types.js";
import {
  LICENSES,
  absoluteUrl,
  cleanText,
  filenameFromUrl,
  formatFromFilename,
  inferType,
  makeAsset,
  matchScore,
  paginate,
  qs,
  typeMatches,
  uniq,
  wantsType,
} from "../core/util.js";

/**
 * Kenney (https://kenney.nl/assets): ~220 CC0 game asset packs (2D, 3D, audio, textures, UI, fonts).
 *
 * No API. The listing (`/assets`, `/assets/page:N`, 16 packs per page, newest update first) gives
 * slug, title, cover, category and series. The whole catalogue is fetched once (pages in parallel,
 * cached 1h) and ranked locally. Tags only exist on detail pages, so for text queries we also run
 * the site's own search (`/assets?search=...`, which matches tags) and boost its hits.
 * Asset pages expose a direct, unauthenticated zip link behind the "Continue without donating" link.
 */

const BASE = "https://kenney.nl";
const CATALOGUE_TTL = 60 * 60_000;
const MAX_PAGES = 40;

const TYPES: AssetType[] = ["model", "sprite", "ui", "audio", "font", "texture", "other"];

/** Words that carry no signal on Kenney (everything is a free low-poly/2D "pack"/"kit"). */
const STOPWORDS = new Set([
  "pack", "packs", "kit", "kits", "asset", "assets", "game", "games", "free", "cc0",
  "low", "poly", "lowpoly", "3d", "set", "collection", "the", "a", "an", "of", "and", "for", "with",
]);
const WANTS_3D = /\b(3d|low[ -]?poly|lowpoly)\b/i;
const UI_RE = /\b(ui|gui|interface|hud|icons?|cursors?|crosshairs?|input prompts?|buttons?|emotes?|controls)\b/i;

interface Entry {
  slug: string;
  title: string;
  category?: string;
  series?: string;
  thumbnailUrl?: string;
}

function kenneyType(category: string | undefined, title: string, series?: string): AssetType {
  const text = `${title} ${series ?? ""}`;
  switch ((category ?? "").toLowerCase()) {
    case "3d":
      return "model";
    case "audio":
      return "audio";
    case "textures":
      return "texture";
    case "2d":
      if (/\bfonts?\b/i.test(text)) return "font";
      if (UI_RE.test(text)) return "ui";
      return "sprite";
    default:
      return inferType(text, "other");
  }
}

function slugFromHref(href: string | undefined): string | undefined {
  const m = /\/assets\/([a-z0-9][a-z0-9-]*)\/?$/i.exec(href ?? "");
  return m?.[1];
}

/** Parse a listing page (`/assets`, `/assets/page:N`, `/assets?search=`). */
export function parseListing(html: string): { entries: Entry[]; lastPage: number } {
  const $ = cheerio.load(html);
  const entries: Entry[] = [];
  $(".asset").each((_, el) => {
    const card = $(el);
    const link = card.find("h2 a").first();
    const slug = slugFromHref(link.attr("href"));
    if (!slug) return;
    const style = card.find(".cover").attr("style") ?? "";
    const thumb = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(style)?.[1];
    entries.push({
      slug,
      title: cleanText(link.text()),
      category: cleanText(card.find("a[href*='/assets/category:']").first().text()) || undefined,
      series: cleanText(card.find("a[href*='/assets/series:']").first().text()) || undefined,
      thumbnailUrl: absoluteUrl(thumb, BASE),
    });
  });
  let lastPage = 1;
  $("a[href*='/assets/page:']").each((_, a) => {
    const n = Number(/\/page:(\d+)/.exec($(a).attr("href") ?? "")?.[1]);
    if (n > lastPage) lastPage = n;
  });
  return { entries, lastPage };
}

function toAsset(e: Entry): Asset {
  const type = kenneyType(e.category, e.title, e.series);
  return makeAsset({
    provider: "kenney",
    nativeId: e.slug,
    title: e.title,
    type,
    tags: ["pack", "cc0", ...(e.category ? [e.category] : []), ...(e.series ? [e.series] : [])],
    categories: [e.category, e.series].filter((x): x is string => !!x),
    url: `${BASE}/assets/${e.slug}`,
    thumbnailUrl: e.thumbnailUrl,
    author: "Kenney",
    license: LICENSES.CC0,
    price: { free: true },
    downloadable: true,
  });
}

async function loadCatalogue(ctx: ProviderContext): Promise<Asset[]> {
  const opts = { cacheTtlMs: CATALOGUE_TTL, signal: ctx.signal };
  const first = parseListing(await ctx.fetch.text(`${BASE}/assets`, opts));
  const last = Math.min(first.lastPage, MAX_PAGES);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, last - 1) }, (_, i) =>
      ctx.fetch.text(`${BASE}/assets/page:${i + 2}`, opts).then((h) => parseListing(h).entries),
    ),
  );
  const seen = new Set<string>();
  const out: Asset[] = [];
  for (const e of [first.entries, ...rest].flat()) {
    if (seen.has(e.slug)) continue;
    seen.add(e.slug);
    out.push(toAsset(e));
  }
  return out;
}

function meaningfulQuery(query: string): string {
  return query
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w.toLowerCase()))
    .join(" ");
}

/** dd/mm/yyyy -> ISO date. */
function parseDmy(s: string | undefined): string | undefined {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((s ?? "").trim());
  if (!m) return undefined;
  return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))).toISOString();
}

export function parseAssetPage(html: string, slug: string): AssetDetails | null {
  const $ = cheerio.load(html);
  const title = cleanText($("h1").first().text());
  if (!title) return null;
  // Main info table; "You might also like" cards use `?category=` links, so these selectors stay scoped.
  const category = cleanText($("a[href*='/assets/category:']").first().text()) || undefined;
  const series = cleanText($("a[href*='/assets/series:']").first().text()) || undefined;
  const tags = $("a.tag")
    .map((_, a) => cleanText($(a).text()))
    .get()
    .filter(Boolean);
  let fileCount: number | undefined;
  $("td.title").each((_, td) => {
    if (cleanText($(td).text()).toLowerCase() === "files") {
      const n = parseInt(cleanText($(td).next().text()).replace(/[^\d]/g, ""), 10);
      if (Number.isFinite(n)) fileCount = n;
    }
  });
  const updates = $("td[title]")
    .map((_, td) => ({
      date: parseDmy($(td).attr("title")),
      version: cleanText($(td).find(".type").text()),
      text: cleanText($(td).find(".description").text()),
    }))
    .get();
  const release = updates.at(-1);
  const latest = updates[0];

  const download =
    absoluteUrl($("#donate-text").attr("href"), BASE) ??
    absoluteUrl($("a[href$='.zip']").first().attr("href"), BASE);
  const previews = uniq(
    $("a.screenshot")
      .map((_, a) => absoluteUrl($(a).attr("href"), BASE))
      .get()
      .filter((u): u is string => !!u),
  );
  const audioPreviews = uniq(
    $("audio source")
      .map((_, s) => absoluteUrl($(s).attr("src"), BASE))
      .get()
      .filter((u): u is string => !!u),
  );

  const parts = [
    `${category ?? "Game"} asset pack by Kenney${series ? ` (${series} series)` : ""}`,
    fileCount ? `${fileCount} files` : undefined,
    tags.length ? `tags: ${tags.join(", ")}` : undefined,
  ].filter(Boolean);
  let description = parts.join(", ") + ".";
  if (latest && updates.length > 1 && latest.text) description += ` Latest update (${latest.version}): ${latest.text}.`;

  const files: AssetFile[] = [];
  if (download) {
    files.push({ url: download, filename: filenameFromUrl(download), format: formatFromFilename(download) || "zip", group: "archive" });
  }
  for (const url of [...previews, ...audioPreviews]) {
    files.push({ url, filename: filenameFromUrl(url), format: formatFromFilename(url), group: "preview" });
  }

  const og = absoluteUrl($("meta[property='og:image']").attr("content"), BASE);
  const asset = makeAsset({
    provider: "kenney",
    nativeId: slug,
    title,
    description,
    type: kenneyType(category, `${title} ${tags.join(" ")}`, series),
    tags: ["pack", "cc0", ...tags, ...(category ? [category] : []), ...(series ? [series] : [])],
    categories: [category, series].filter((x): x is string => !!x),
    url: `${BASE}/assets/${slug}`,
    thumbnailUrl: previews[0] ?? og,
    author: "Kenney",
    license: LICENSES.CC0,
    price: { free: true },
    formats: download ? ["zip"] : undefined,
    downloadable: !!download,
    createdAt: release?.date,
  });
  return { ...asset, files };
}

export const kenney: Provider = {
  id: "kenney",
  name: "Kenney",
  homepage: "https://kenney.nl/assets",
  description: "Hundreds of CC0 game asset packs (low-poly 3D kits, 2D sprites, UI, audio, fonts) by Kenney.",
  assetTypes: TYPES,
  access: "scrape",
  pricing: "free",
  license: LICENSES.CC0,
  supportsDownload: true,

  buildSearchUrl(q: SearchQuery) {
    return `${BASE}/assets${qs({ search: meaningfulQuery(q.query) || q.query.trim() })}`;
  },

  async search(q, ctx) {
    if (!wantsType(q, ...TYPES)) return { assets: [], searchUrl: this.buildSearchUrl(q) };
    const terms = meaningfulQuery(q.query);
    const wants3d = !q.types?.length && WANTS_3D.test(q.query);
    const types: AssetType[] | undefined = q.types?.length ? q.types : wants3d && !terms ? ["model"] : undefined;

    const [catalogue, siteHits] = await Promise.all([
      loadCatalogue(ctx),
      terms
        ? ctx.fetch
            .text(`${BASE}/assets${qs({ search: terms })}`, { cacheTtlMs: CATALOGUE_TTL, signal: ctx.signal })
            .then((h) => parseListing(h).entries.map((e) => e.slug))
            // The site search only boosts tag matches; the local catalogue still answers without it.
            .catch((e: unknown) => {
              if (ctx.signal?.aborted) throw e;
              return [] as string[];
            })
        : Promise.resolve([] as string[]),
    ]);

    const typed = catalogue.filter((a) => typeMatches(a.type, types));
    let assets: Asset[];
    if (!terms) {
      assets = typed; // listing order: most recently updated first
    } else {
      const rank = new Map(siteHits.map((slug, i) => [slug, i]));
      assets = typed
        .map((a) => {
          let s = matchScore(a, terms);
          const r = rank.get(a.nativeId);
          if (r !== undefined) s = Math.max(s, 0.5) + 0.2 * (1 - r / Math.max(siteHits.length, 1));
          if (wants3d && a.type === "model") s += 0.3;
          return { a, s };
        })
        .filter((x) => x.s >= 0.34)
        .sort((x, y) => y.s - x.s)
        .map((x) => x.a);
    }
    return { assets: paginate(assets, q), total: assets.length, searchUrl: this.buildSearchUrl(q) };
  },

  async getAsset(nativeId, ctx): Promise<AssetDetails | null> {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(nativeId)) return null;
    let html: string;
    try {
      html = await ctx.fetch.text(`${BASE}/assets/${nativeId}`, { signal: ctx.signal });
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
    return parseAssetPage(html, nativeId);
  },
};
