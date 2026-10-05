import * as cheerio from "cheerio";
import type { Asset, AssetDetails, AssetFile, Provider, ProviderContext, SearchQuery } from "../core/types.js";
import {
  LICENSES,
  absoluteUrl,
  cleanText,
  filenameFromUrl,
  filterLocal,
  formatFromFilename,
  makeAsset,
  tokenize,
  typeMatches,
  wantsType,
} from "../core/util.js";


/**
 * TextureCan — ~650 free CC0 PBR textures plus a few CC0 3D models (server-rendered PHP site).
 *
 * Textures: the site's server-side search (`/search/<words joined by +>/<page>/`, 20 per page);
 * browsing uses `/category/New/`. Models: the single `/models/` listing, cached for an hour and
 * filtered locally. Detail pages carry `tex1:*` meta tags (name, tags, resolution, license,
 * release date) and plain `/downloads/...zip` links that work with a simple GET.
 */

const SITE = "https://www.texturecan.com";
const PAGE_SIZE = 20;
const MODELS_TTL = 60 * 60_000;
const MODEL_PREFIX = "model-";

interface Card {
  nativeId: string;
  title: string;
  code?: string;
  url: string;
  thumbnailUrl?: string;
  description?: string;
  isModel: boolean;
}

/** Listing/search pages: `.article-box` > `.texture-header a[href="/details/591/"]` + img + `.texture-desc`. */
export function parseCards(html: string): { cards: Card[]; lastPage: number } {
  const $ = cheerio.load(html);
  const cards: Card[] = [];
  $(".article-box").each((_, box) => {
    const a = $(box).find('a[href*="/details/"]').first();
    const href = a.attr("href");
    const m = href ? /(\/models)?\/details\/(\d+)\/?$/.exec(href) : null;
    if (!m) return;
    const isModel = Boolean(m[1]);
    // Header is "Title<br />(Wood 0066)".
    const header = a.clone();
    header.find("br").replaceWith("\n");
    const [title = "", code] = header.text().split("\n").map((s) => cleanText(s));
    const desc = $(box).find(".texture-desc").first();
    desc.find("br").replaceWith(" ");
    cards.push({
      nativeId: isModel ? `${MODEL_PREFIX}${m[2]}` : m[2]!,
      title: title || cleanText(a.text()),
      code: code?.replace(/^\(|\)$/g, "") || undefined,
      url: absoluteUrl(href, SITE)!,
      thumbnailUrl: absoluteUrl($(box).find("img").first().attr("src"), SITE),
      description: cleanText(desc.text()) || undefined,
      isModel,
    });
  });
  const pages = $("#pageNumberDiv .pageNumber")
    .map((_, el) => Number($(el).text().trim()))
    .get()
    .filter((n) => Number.isFinite(n));
  return { cards, lastPage: pages.length ? Math.max(...pages) : 1 };
}

function cardToAsset(c: Card): Asset {
  return makeAsset({
    provider: "texturecan",
    nativeId: c.nativeId,
    title: c.title,
    description: c.description,
    type: c.isModel ? "model" : "material",
    tags: c.code ? [c.code.replace(/\s*\d+$/, "")] : [],
    url: c.url,
    thumbnailUrl: c.thumbnailUrl,
    license: LICENSES.CC0,
    price: { free: true },
    downloadable: true,
  });
}

function searchPath(query: string, page: number): string {
  const words = tokenize(query);
  // The site's WAF rejects %20; words are joined with "+" like its own search form does.
  if (!words.length) return `${SITE}/category/New/${page > 1 ? `${page}/` : ""}`;
  return `${SITE}/search/${words.map(encodeURIComponent).join("+")}/${page}/`;
}

async function models(q: SearchQuery, ctx: ProviderContext): Promise<Asset[]> {
  const html = await ctx.fetch.text(`${SITE}/models/`, { cacheTtlMs: MODELS_TTL, signal: ctx.signal });
  return filterLocal(parseCards(html).cards.map(cardToAsset), { ...q, types: undefined });
}

/** Fetch enough 20-item texture pages (max 2) to cover [offset, offset+count). */
async function textures(q: SearchQuery, offset: number, count: number, ctx: ProviderContext) {
  const first = Math.floor(offset / PAGE_SIZE) + 1;
  const last = Math.min(Math.floor((offset + count - 1) / PAGE_SIZE) + 1, first + 1);
  const out: Asset[] = [];
  let lastPage = 1;
  for (let page = first; page <= last; page++) {
    const html = await ctx.fetch.text(searchPath(q.query, page), { signal: ctx.signal });
    const parsed = parseCards(html);
    lastPage = parsed.lastPage;
    out.push(...parsed.cards.filter((c) => !c.isModel).map(cardToAsset));
    if (page >= lastPage) break;
  }
  const start = offset - (first - 1) * PAGE_SIZE;
  // Exact total is only known when page 1 through the last page were all fetched.
  const complete = first === 1 && last >= lastPage;
  return { assets: out.slice(start, start + count), total: complete ? out.length : undefined };
}

function meta($: cheerio.CheerioAPI, name: string): string | undefined {
  return $(`meta[name="${name}"]`).attr("content") ?? $(`meta[property="${name}"]`).attr("content") ?? undefined;
}

/** Detail page: `tex1:*` meta tags + `a.download` links ("1K Maps", "SBSAR", "Download"). */
export function parseDetails(html: string, nativeId: string): AssetDetails | null {
  const $ = cheerio.load(html);
  const name = meta($, "tex1:name") ?? meta($, "og:title");
  const title = cleanText((name ?? "").replace(/\s*\((?:[^)]*\d)?\)\s*$/, ""));
  // Unknown ids still render a page, with an empty name "()".
  if (!title) return null;
  const isModel = nativeId.startsWith(MODEL_PREFIX);
  const id = isModel ? nativeId.slice(MODEL_PREFIX.length) : nativeId;
  const files: AssetFile[] = [];
  $("a.download[href]").each((_, el) => {
    const url = absoluteUrl($(el).attr("href"), SITE);
    if (!url) return;
    const label = cleanText($(el).text());
    const filename = filenameFromUrl(url);
    const res = /(\d+)\s*K\b/i.exec(label)?.[1];
    const group = isModel ? "model" : /sbsar/i.test(label) ? "sbsar" : "textures";
    files.push({ url, filename, format: formatFromFilename(filename), resolution: res ? `${res}k` : undefined, group });
  });
  const tags = (meta($, "tex1:tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const category = $('h3 a[href*="/category/"]').first().text().trim();
  const resPx = Number(meta($, "tex1:resolution"));
  const resolutions = files.flatMap((f) => (f.resolution ? [f.resolution] : []));
  const date = meta($, "tex1:release-date");
  const asset = makeAsset({
    provider: "texturecan",
    nativeId,
    title,
    description: cleanText(meta($, "og:description")) || undefined,
    type: isModel ? "model" : "material",
    tags: [...tags, ...(meta($, "tex1:type") ? [meta($, "tex1:type")!] : [])],
    categories: category ? [category] : undefined,
    url: `${SITE}${isModel ? "/models" : ""}/details/${id}/`,
    thumbnailUrl: meta($, "tex1:preview-image") ?? meta($, "og:image"),
    license: LICENSES.CC0,
    price: { free: true },
    formats: [...new Set(files.map((f) => f.format))],
    resolutions: resolutions.length ? resolutions : resPx ? [`${Math.round(resPx / 1024)}k`] : undefined,
    downloadable: files.length > 0,
    createdAt: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
  });
  return { ...asset, files };
}

export const texturecan: Provider = {
  id: "texturecan",
  name: "TextureCan",
  homepage: SITE,
  description: "Free CC0 PBR textures (4K, many with SBSAR sources) and a few CC0 3D models, direct zip downloads.",
  assetTypes: ["material", "model"],
  access: "scrape",
  pricing: "free",
  license: LICENSES.CC0,
  supportsDownload: true,

  async census(ctx) {
    const first = parseCards(await ctx.fetch.text(searchPath("", 1), { signal: ctx.signal }));
    const last = first.lastPage > 1 ? parseCards(await ctx.fetch.text(searchPath("", first.lastPage), { signal: ctx.signal })) : first;
    const textures = (first.lastPage - 1) * PAGE_SIZE + last.cards.filter((c) => !c.isModel).length;
    const modelCount = parseCards(await ctx.fetch.text(`${SITE}/models/`, { signal: ctx.signal })).cards.length;
    return {
      total: textures + modelCount,
      free: textures + modelCount,
      byType: { material: textures, model: modelCount },
      method: "Listing pages: full pages × 20 + the last page, plus the models page",
    };
  },

  buildSearchUrl(q: SearchQuery) {
    if (q.types?.length && !wantsType(q, "material") && wantsType(q, "model")) return `${SITE}/models/`;
    return searchPath(q.query, 1);
  },

  async search(q, ctx) {
    // Browsing without a query or type filter shows textures; models join when relevant.
    const wantModels = wantsType(q, "model") && (Boolean(q.query.trim()) || Boolean(q.types?.length));
    const wantTextures = wantsType(q, "material");
    if (!wantsType(q, "model") && !wantTextures) return { assets: [] };
    const searchUrl = this.buildSearchUrl(q);
    const offset = q.offset ?? 0;

    // Few models exist; when both kinds are wanted, matching models are listed first.
    const modelHits = wantModels ? await models(q, ctx) : [];
    const assets = modelHits.slice(offset, offset + q.limit);
    let total: number | undefined = wantTextures ? undefined : modelHits.length;

    const need = q.limit - assets.length;
    if (wantTextures && need > 0) {
      const tOffset = Math.max(0, offset - modelHits.length);
      const t = await textures(q, tOffset, need, ctx);
      assets.push(...t.assets);
      if (t.total !== undefined) total = modelHits.length + t.total;
    }
    return { assets: assets.filter((a) => typeMatches(a.type, q.types)), total, searchUrl };
  },

  async getAsset(nativeId, ctx): Promise<AssetDetails | null> {
    const isModel = nativeId.startsWith(MODEL_PREFIX);
    const id = isModel ? nativeId.slice(MODEL_PREFIX.length) : nativeId;
    if (!/^\d+$/.test(id)) return null;
    let html: string;
    try {
      html = await ctx.fetch.text(`${SITE}${isModel ? "/models" : ""}/details/${id}/`, { signal: ctx.signal });
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
    return parseDetails(html, nativeId);
  },
};
