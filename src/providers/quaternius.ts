import * as cheerio from "cheerio";
import type { Asset, AssetDetails, AssetFile, License, Provider, ProviderContext, SearchQuery } from "../core/types.js";
import { LICENSES, absoluteUrl, cleanText, makeAsset, matchScore, paginate, stem, tokenize, uniq, wantsType } from "../core/util.js";
import { catalogueCensus } from "../core/census.js";

/**
 * Quaternius (https://quaternius.com): ~80 free low-poly 3D packs and animated characters.
 *
 * Static site, no API or data file: the homepage lists every pack as `.pack` cards (title, thumbnail,
 * public tags, plus a <noscript> blob of hidden search keywords that the site's own client-side
 * filter uses). The homepage is fetched once (cached 1h) and ranked locally. Pack pages
 * (`/packs/<slug>.html`) add description, date, model count, animated/textured flags, formats,
 * license (CC0, or "QAL" on some newer kits) and the download target.
 *
 * Downloads are Google Drive *folders* (older packs) or itch.io pages (newer packs). Neither is a
 * file a plain GET can fetch, so downloads are not supported; getAsset lists them as
 * `requiresAuth` link entries so users can follow them.
 */

const BASE = "https://quaternius.com";
const CATALOGUE_TTL = 60 * 60_000;
const MIN_SCORE = 0.34;

/** Generic words that every Quaternius pack satisfies. */
const STOPWORDS = new Set([
  "pack", "packs", "kit", "kits", "asset", "assets", "game", "free", "cc0", "low", "poly", "lowpoly",
  "3d", "model", "models", "set", "collection", "the", "a", "an", "of", "and", "for", "with",
]);

interface Entry extends Asset {
  /** Hidden keyword blob from the card's <noscript> (words concatenated without spaces). */
  keywords: string;
}

function packUrl(slug: string): string {
  return `${BASE}/packs/${slug}.html`;
}

const RIGGED_RE = /\b(rigged|rig|retarget(able)?)\b/i;

export function parseHomepage(html: string): Entry[] {
  const $ = cheerio.load(html);
  const out: Entry[] = [];
  const seen = new Set<string>();
  $(".pack").each((_, el) => {
    const card = $(el);
    const href = card.find("a[href*='/packs/']").first().attr("href");
    const slug = /\/packs\/([a-z0-9_-]+)\.html$/i.exec(href ?? "")?.[1];
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    const textEl = card.find(".PackText").first();
    const title = cleanText(textEl.clone().children().remove().end().text());
    if (!title) return;
    const tags = card
      .find(".viewtag")
      .map((_, t) => cleanText($(t).text()))
      .get()
      .filter(Boolean);
    const keywords = cleanText(card.find("noscript").text()).toLowerCase();
    const animated = tags.some((t) => /animat/i.test(t)) || /animated/.test(keywords);
    // Animated packs are skeletal (rigged) on Quaternius.
    const rigged = animated || tags.some((t) => RIGGED_RE.test(t)) || /rigged|retarget/.test(keywords);
    out.push({
      ...makeAsset({
        provider: "quaternius",
        nativeId: slug,
        title,
        type: "model",
        tags: [...tags, "pack", "low poly", ...(animated ? ["animated"] : []), ...(rigged ? ["rigged"] : [])],
        url: packUrl(slug),
        thumbnailUrl: absoluteUrl(card.find("img").first().attr("src"), BASE),
        author: "Quaternius",
        // Not in the listing: most packs are CC0, newer kits use the QAL. getAsset has the real one.
        price: { free: true },
        animated: animated || undefined,
        rigged: rigged || undefined,
        downloadable: false,
      }),
      keywords,
    });
  });
  return out;
}

async function loadCatalogue(ctx: ProviderContext): Promise<Entry[]> {
  const html = await ctx.fetch.text(`${BASE}/`, { cacheTtlMs: CATALOGUE_TTL, signal: ctx.signal });
  return parseHomepage(html);
}

function meaningfulTokens(query: string): string[] {
  return uniq(tokenize(query).filter((t) => !STOPWORDS.has(t)));
}

/** matchScore on title/tags, plus substring hits in the hidden keyword blob. */
function score(e: Entry, tokens: string[]): number {
  const q = tokens.join(" ");
  const base = matchScore(e, q);
  let hidden = 0;
  for (const t of tokens) {
    const s = stem(t);
    if (s.length >= 3 && e.keywords.includes(s)) hidden += 1;
  }
  return Math.max(base, (0.6 * hidden) / tokens.length);
}

function stripListing({ keywords: _k, ...a }: Entry): Asset {
  return a;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function parseMonthYear(s: string): string | undefined {
  const m = /([a-z]+)\s+(\d{4})/i.exec(s);
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[1]!.toLowerCase());
  if (month < 0) return undefined;
  return new Date(Date.UTC(Number(m[2]), month, 1)).toISOString();
}

/** Quaternius Asset License: free for commercial use, no credit, no reselling the assets themselves. */
const QAL: License = {
  name: "QAL",
  url: `${BASE}/license.html`,
  commercialUse: true,
  attributionRequired: false,
};

function licenseFrom(name: string, href: string | undefined): License {
  if (/cc0|publicdomain\/zero/i.test(`${name} ${href ?? ""}`)) return LICENSES.CC0;
  if (/^qal$/i.test(name) || /\/license\.html$/.test(href ?? "")) return QAL;
  return { name: name || "Custom", url: absoluteUrl(href, BASE) };
}

export function parsePackPage(html: string, slug: string): AssetDetails | null {
  const $ = cheerio.load(html);
  const titleEl = $(".indPackTitle").first();
  const title =
    cleanText(titleEl.clone().children().remove().end().text()) ||
    cleanText(($("meta[name='title']").attr("content") ?? "").replace(/^Quaternius\s*•\s*/, ""));
  if (!title) return null;

  const info = new Map<string, ReturnType<typeof $>>();
  $(".infoitem").each((_, el) => {
    const item = $(el);
    const label = cleanText(item.clone().children().remove().end().text()).toLowerCase();
    if (label) info.set(label, item);
  });
  const has = (label: string) => info.get(label)?.find("img[src*='check']").length ?? 0;
  const modelCount = parseInt(cleanText(info.get("models")?.find(".text-right").text()), 10);
  const formats = uniq(
    (info.get("formats")?.find(".tags").map((_, t) => cleanText($(t).text()).toLowerCase()).get() ?? []).map((f) =>
      f === "blender" ? "blend" : f,
    ),
  );
  const licEl = info.get("license")?.find("a").first();
  const license = licEl?.length ? licenseFrom(cleanText(licEl.text()), licEl.attr("href")) : LICENSES.CC0;

  const desc = cleanText($(".indPackText").first().text());
  const features = $(".singleFeature")
    .map((_, f) => cleanText($(f).text()))
    .get()
    .filter(Boolean);
  const description = [
    desc || cleanText($("meta[name='description']").attr("content")?.replace(/<[^>]+>/g, "")),
    ...features,
    Number.isFinite(modelCount) ? `Models: ${modelCount}.` : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  const images = uniq(
    $("a[data-lightbox]")
      .map((_, a) => absoluteUrl($(a).attr("href"), BASE))
      .get()
      .filter((u): u is string => !!u),
  );

  // Download targets live in onclick="window.open('<url>', '_blank')" on the Download buttons.
  const links = uniq(
    $("button[onclick*='window.open']")
      .filter((_, b) => /download/i.test($(b).text()))
      .map((_, b) => /window\.open\(\s*'([^']+)'/.exec($(b).attr("onclick") ?? "")?.[1])
      .get()
      .filter((u): u is string => !!u && /^https?:\/\//.test(u)),
  );
  const files: AssetFile[] = links.map((url) => {
    const drive = /drive\.google\.com/.test(url);
    const itch = /itch\.io/.test(url);
    return {
      url,
      filename: drive ? `${title} (Google Drive folder)` : itch ? `${title} (itch.io download page)` : title,
      format: "link",
      group: drive ? "google-drive" : itch ? "itch.io" : "external",
      requiresAuth: true,
    };
  });

  const animated = has("animated") > 0;
  const textured = has("textured") > 0;
  const rigged = animated || /\b(rigged|humanoid rig|retarget\w*)\b/i.test(`${title} ${description}`);
  const asset = makeAsset({
    provider: "quaternius",
    nativeId: slug,
    title,
    description: description || undefined,
    type: "model",
    tags: [
      "pack",
      "low poly",
      ...(license.name === "CC0" ? ["cc0"] : []),
      ...(animated ? ["animated"] : []),
      ...(rigged ? ["rigged"] : []),
      ...(textured ? ["textured"] : []),
      ...formats,
    ],
    url: packUrl(slug),
    thumbnailUrl: images[0] ?? absoluteUrl($("meta[property='og:image']").attr("content"), BASE),
    author: "Quaternius",
    license,
    price: { free: true },
    formats: formats.length ? formats : undefined,
    animated,
    rigged: rigged || undefined,
    downloadable: false,
    createdAt: parseMonthYear(cleanText($(".titleDate").first().text())),
  });
  return { ...asset, files };
}

export const quaternius: Provider = {
  id: "quaternius",
  name: "Quaternius",
  homepage: BASE,
  description: "Free low-poly 3D model packs and animated, rigged characters by Quaternius (CC0 or the similar QAL).",
  assetTypes: ["model"],
  access: "scrape",
  pricing: "free",
  // No uniform license: older packs are CC0, newer kits use the Quaternius Asset License (QAL).
  supportsDownload: false,

  census(ctx) {
    return catalogueCensus(this, ctx, "packs");
  },

  // The site only has a client-side filter box; link to the homepage.
  buildSearchUrl(_q: SearchQuery) {
    return `${BASE}/`;
  },

  async search(q, ctx) {
    if (!wantsType(q, "model")) return { assets: [] };
    const catalogue = await loadCatalogue(ctx);
    const tokens = meaningfulTokens(q.query);
    let ranked: Entry[] = catalogue;
    if (tokens.length) {
      ranked = catalogue
        .map((e) => ({ e, s: score(e, tokens) }))
        .filter((x) => x.s >= MIN_SCORE)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.e);
    }
    const assets = ranked.map(stripListing);
    return { assets: paginate(assets, q), total: assets.length, searchUrl: this.buildSearchUrl(q) };
  },

  async getAsset(nativeId, ctx): Promise<AssetDetails | null> {
    if (!/^[a-z0-9_-]+$/i.test(nativeId)) return null;
    let html: string;
    try {
      html = await ctx.fetch.text(packUrl(nativeId), { signal: ctx.signal });
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
    return parsePackPage(html, nativeId);
  },
};
