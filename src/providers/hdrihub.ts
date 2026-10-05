import * as cheerio from "cheerio";
import type { Asset, AssetDetails, AssetType, License, Price, Provider, ProviderContext, SearchQuery } from "../core/types.js";
import { cleanText, filterLocal, inferType, makeAsset, paginate, qs, tokenize, typeMatches, wantsType } from "../core/util.js";
import { countBy } from "../core/census.js";

/**
 * HDRI Hub — commercial shop of HDRIs, backplates and 3D people (Next.js App Router), with a
 * "free samples" section.
 *
 * Search scrapes the server-rendered `/search?q=` page (title substring match, up to 100 hits).
 * Result cards are read via stable hooks: product links under `/shop/…`, `<h3>` titles, the
 * image's `alt`/`url=` and CSS-module class *prefixes* (`search_card`, `search_price`), not the
 * hashed class names. Browsing (empty query) reads the schema.org ItemList JSON-LD of the shop
 * category pages. Details come from the product page's schema.org Product JSON-LD.
 *
 * No downloads: paid items need checkout and free samples are delivered through a JS button
 * backed by `/api/…`, which robots.txt disallows.
 */

const SITE = "https://www.hdri-hub.com";

const LICENSE: License = {
  name: "Royalty Free",
  url: `${SITE}/terms-of-use`,
  commercialUse: true,
  attributionRequired: false,
};

/** Asset type from the product path: /shop/<section>/<sub>/<slug>. */
export function typeFromPath(path: string): AssetType {
  const [section = "", sub = ""] = path.replace(/^\/?shop\//, "").split("/");
  switch (section) {
    case "hdri":
      return "hdri";
    case "3d-models":
      return "model";
    case "textures":
      return "texture";
    case "backplates":
      return "other";
    case "free-samples":
      if (/hdr/.test(sub)) return "hdri";
      if (/3d|people|model/.test(sub)) return "model";
      if (/texture/.test(sub)) return "texture";
      return inferType(sub.replace(/-/g, " "), "hdri");
    default:
      return inferType(section.replace(/-/g, " "), "other");
  }
}

/** `/_next/image?url=%2Fapi%2Fmedia%2Ffile%2Fx-400x267.jpg&w=828` -> `https://www.hdri-hub.com/media/x-400x267.jpg`. */
export function mediaUrl(src: string | undefined): string | undefined {
  if (!src) return undefined;
  let inner = src;
  try {
    const u = new URL(src, SITE);
    inner = u.pathname === "/_next/image" ? u.searchParams.get("url") ?? "" : u.pathname;
  } catch {
    return undefined;
  }
  const file = /\/(?:api\/)?media\/(?:file\/)?([^/?#]+)$/.exec(inner)?.[1];
  return file ? `${SITE}/media/${file}` : undefined;
}

/** "From €9.9" / "€19" -> price. A missing price element means a free item. */
function parsePrice(text: string | undefined, path: string): Price {
  const t = cleanText(text);
  const amount = Number(/(\d+(?:[.,]\d+)?)/.exec(t)?.[1]?.replace(",", "."));
  if (!t || !Number.isFinite(amount) || amount === 0 || path.includes("/free-samples/")) return { free: true };
  const currency = t.includes("€") ? "EUR" : t.includes("$") ? "USD" : t.includes("£") ? "GBP" : undefined;
  return { free: false, amount, currency };
}

function nativeIdFromUrl(href: string): string | undefined {
  try {
    const p = new URL(href, SITE).pathname;
    const m = /^\/shop\/([a-z0-9-]+(?:\/[a-z0-9-]+){1,3})\/?$/.exec(p);
    return m?.[1];
  } catch {
    return undefined;
  }
}

function build(nativeId: string, title: string, price: Price | undefined, thumbnailUrl?: string, extra: Partial<Asset> = {}): Asset {
  const parts = nativeId.split("/");
  const category = parts.length > 2 ? parts[parts.length - 2]! : parts[0]!;
  return makeAsset({
    provider: "hdrihub",
    nativeId,
    title,
    type: typeFromPath(nativeId),
    tags: [],
    categories: [category.replace(/-/g, " ")],
    url: `${SITE}/shop/${nativeId}`,
    thumbnailUrl,
    license: LICENSE,
    price,
    downloadable: false,
    ...extra,
  });
}

/** Search page: `<p class="search_count__…">Found 7 products</p>` + `<a class="search_card__…" href="/shop/…">`. */
export function parseSearch(html: string): { assets: Asset[]; total?: number } {
  const $ = cheerio.load(html);
  const assets: Asset[] = [];
  const seen = new Set<string>();
  $('a[class*="search_card"][href^="/shop/"]').each((_, el) => {
    const card = $(el);
    const nativeId = nativeIdFromUrl(card.attr("href") ?? "");
    if (!nativeId || seen.has(nativeId)) return;
    seen.add(nativeId);
    const img = card.find("img").first();
    // React streaming may defer the card body: `<template id="P:1">` is filled from `<div hidden id="S:1">`.
    let info = card.find('[class*="search_info"]').first();
    if (!info.length) {
      const slot = card.find('template[id^="P:"]').attr("id")?.slice(2);
      if (slot) info = $(`[id="S:${slot}"]`).first();
    }
    const title = cleanText(info.find("h3").first().text()) || cleanText(img.attr("alt"));
    if (!title) return;
    // Free items render no price element; without the info block the price is unknown.
    const price = info.length
      ? parsePrice(info.find('[class*="search_price"]').first().text(), nativeId)
      : nativeId.startsWith("free-samples/")
        ? { free: true }
        : undefined;
    assets.push(build(nativeId, title, price, mediaUrl(img.attr("src"))));
  });
  if ($('[class*="search_empty"]').length) return { assets, total: 0 };
  const count = Number(/Found\s+(\d+)/.exec(cleanText($('[class*="search_count"]').first().text()))?.[1]);
  return { assets, total: Number.isFinite(count) ? count : undefined };
}

interface LdOffer {
  price?: number | string;
  lowPrice?: number | string;
  priceCurrency?: string;
  name?: string;
  offers?: LdOffer[];
}
interface LdProduct {
  "@type"?: string;
  name?: string;
  url?: string;
  description?: string;
  image?: string | string[];
  category?: string;
  sku?: string;
  offers?: LdOffer;
}

function jsonLd($: cheerio.CheerioAPI): unknown[] {
  return $('script[type="application/ld+json"]')
    .map((_, el) => {
      try {
        return [JSON.parse($(el).text())];
      } catch {
        return [];
      }
    })
    .get();
}

function ldPrice(offer: LdOffer | undefined, path: string): Price {
  const amount = Number(offer?.lowPrice ?? offer?.price);
  if (!Number.isFinite(amount) || amount === 0 || path.includes("/free-samples/")) return { free: true };
  return { free: false, amount, currency: offer?.priceCurrency };
}

const SECTIONS = new Set(["hdri", "backplates", "3d-models", "textures", "free-samples"]);

/**
 * Category page: schema.org ItemList of Products (first page of the category). Its URLs omit
 * the shop section (`/shop/space/x`, which redirects to `/shop/hdri/space/x`), so the section of
 * the category page is prefixed to keep ids canonical.
 */
export function parseCategory(html: string, section: string): Asset[] {
  const $ = cheerio.load(html);
  const out: Asset[] = [];
  for (const ld of jsonLd($)) {
    const list = ld as { "@type"?: string; itemListElement?: { item?: LdProduct }[]; mainEntity?: unknown };
    const items =
      list["@type"] === "ItemList"
        ? list.itemListElement
        : (list.mainEntity as { itemListElement?: { item?: LdProduct }[] } | undefined)?.itemListElement;
    for (const el of items ?? []) {
      const p = el.item;
      if (!p?.name || !p.url) continue;
      const short = nativeIdFromUrl(p.url);
      if (!short) continue;
      const nativeId = SECTIONS.has(short.split("/")[0]!) ? short : `${section}/${short}`;
      const image = Array.isArray(p.image) ? p.image[0] : p.image;
      out.push(build(nativeId, cleanText(p.name), ldPrice(p.offers, nativeId), image));
    }
  }
  return out;
}

/** Product page: schema.org Product JSON-LD (+ `?tags=` links for tags). */
export function parseProduct(html: string, nativeId: string): AssetDetails | null {
  const $ = cheerio.load(html);
  const product = jsonLd($).find((x) => (x as LdProduct)["@type"] === "Product") as LdProduct | undefined;
  if (!product?.name) return null;
  const tags = new Set<string>();
  $('a[href*="?tags="]').each((_, el) => {
    const t = new URL($(el).attr("href")!, SITE).searchParams.get("tags");
    if (t) tags.add(t.replace(/-/g, " "));
  });
  const offers = product.offers?.offers ?? (product.offers ? [product.offers] : []);
  const resolutions = [
    ...new Set(
      offers.flatMap((o) => {
        const px = Number(/(\d{4,5})/.exec(o.name ?? "")?.[1]);
        return px ? [`${Math.round(px / 1024)}k`] : [];
      }),
    ),
  ];
  const image = Array.isArray(product.image) ? product.image[0] : product.image;
  const asset = build(nativeId, cleanText(product.name), ldPrice(product.offers, nativeId), image, {
    description: cleanText(product.description) || undefined,
    tags: [...tags],
    categories: product.category ? [product.category] : undefined,
    resolutions: resolutions.length ? resolutions : undefined,
  });
  return { ...asset, files: [] };
}

function browsePath(q: SearchQuery): string {
  if (q.freeOnly) return "/shop/free-samples";
  if (q.types?.length) {
    if (wantsType(q, "hdri")) return "/shop/hdri";
    if (wantsType(q, "model")) return "/shop/3d-models";
    if (wantsType(q, "texture")) return "/shop/textures";
    return "/shop/backplates";
  }
  return "/shop/hdri";
}

async function runSearch(query: string, ctx: ProviderContext) {
  const html = await ctx.fetch.text(`${SITE}/search${qs({ q: query })}`, { signal: ctx.signal });
  return parseSearch(html);
}

export const hdrihub: Provider = {
  id: "hdrihub",
  name: "HDRI Hub",
  homepage: SITE,
  description: "Commercial high-resolution HDRIs, backplates and 3D people for archviz, plus a few free samples.",
  assetTypes: ["hdri", "model", "texture", "other"],
  access: "scrape",
  pricing: "freemium",
  license: LICENSE,
  supportsDownload: false,

  async census(ctx) {
    const xml = await ctx.fetch.text(`${SITE}/sitemap.xml`, { signal: ctx.signal });
    // Product pages are /shop/<section>/<sub>/<slug>; shorter paths are listings.
    const products = [...xml.matchAll(/<loc>https:\/\/www\.hdri-hub\.com(\/shop\/[^/<]+\/[^/<]+\/[^/<]+)<\/loc>/g)].map((m) => m[1]!);
    if (!products.length) throw new Error("hdrihub: no products in sitemap");
    const sections = countBy(products, (p) => p.split("/")[2]);
    return {
      total: products.length,
      free: sections["free-samples"] ?? 0,
      byType: countBy(products, typeFromPath),
      categories: sections,
      method: "Sitemap: product pages per shop section",
    };
  },

  buildSearchUrl(q: SearchQuery) {
    return q.query.trim() ? `${SITE}/search${qs({ q: q.query.trim() })}` : `${SITE}${browsePath(q)}`;
  },

  async search(q, ctx) {
    if (!wantsType(q, "hdri", "model", "texture", "other")) return { assets: [] };
    const searchUrl = this.buildSearchUrl(q);
    const query = q.query.trim();
    let assets: Asset[];
    let total: number | undefined;
    if (!query) {
      const path = browsePath(q);
      const html = await ctx.fetch.text(`${SITE}${path}`, { signal: ctx.signal });
      assets = parseCategory(html, path.replace("/shop/", ""));
    } else {
      let r = await runSearch(query, ctx);
      const words = tokenize(query);
      if (!r.assets.length && words.length > 1) {
        // The site matches the whole phrase as a title substring; retry with the most
        // specific word and rank locally so "night city" still finds "City … Night" items.
        const longest = [...words].sort((a, b) => b.length - a.length)[0]!;
        r = await runSearch(longest, ctx);
        r = { assets: filterLocal(r.assets, { ...q, types: undefined }) };
      }
      assets = r.assets;
      total = r.total;
    }
    const filtered = assets.filter((a) => typeMatches(a.type, q.types) && (!q.freeOnly || a.price?.free));
    if (filtered.length !== assets.length) total = filtered.length;
    return { assets: paginate(filtered, q), total, searchUrl };
  },

  async getAsset(nativeId, ctx): Promise<AssetDetails | null> {
    if (!/^[a-z0-9-]+(\/[a-z0-9-]+){1,3}$/.test(nativeId)) return null;
    let html: string;
    try {
      html = await ctx.fetch.text(`${SITE}/shop/${nativeId}`, { signal: ctx.signal });
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
    return parseProduct(html, nativeId);
  },
};
