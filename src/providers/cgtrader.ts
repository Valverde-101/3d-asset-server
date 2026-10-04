import * as cheerio from "cheerio";
import type { Asset, AssetDetails, AssetFile, License, Provider, ProviderContext, SearchQuery } from "../core/types.js";
import { cleanText, makeAsset, qs, uniq, wantsType } from "../core/util.js";

/**
 * CGTrader (https://www.cgtrader.com): marketplace of free and paid 3D models.
 *
 * Search: the listing pages (`/search?free=1&keywords=...`) are a React app that serves
 * its own state as JSON when requested with `Accept: application/json` (the same request
 * the site's client-side navigation makes). Results come in fixed pages of 120.
 * Details: the product page HTML carries schema.org JSON-LD plus the item data as
 * `data-react-props` on the `ItemPage/TopSection/TopSection` component.
 * Downloads (even free ones) need a logged-in account, so files are listed with
 * `requiresAuth: true`.
 */

const SITE = "https://www.cgtrader.com";
const PAGE_SIZE = 120;
const DESCRIPTION_MAX = 600;

const ROYALTY_FREE: License = {
  name: "Royalty Free",
  url: `${SITE}/pages/terms-and-conditions#royalty-free-license`,
  commercialUse: true,
  attributionRequired: false,
};

const LICENSE_MAP: Record<string, License> = {
  royalty_free: ROYALTY_FREE,
  royalty_free_no_ai: { ...ROYALTY_FREE, name: "Royalty Free (no AI)" },
  editorial: { name: "Editorial", url: `${SITE}/pages/terms-and-conditions`, commercialUse: false },
};

/** Product-page format titles that are not simply the extension. */
const FORMAT_ALIASES: Record<string, string> = {
  blender: "blend",
  "cinema 4d": "c4d",
  "3ds max": "max",
  "autodesk 3ds max": "max",
  maya: "ma",
  collada: "dae",
  sketchup: "skp",
  "autodesk fbx": "fbx",
  jpeg: "jpg",
  tiff: "tif",
};
const NOT_FORMATS = new Set(["textures", "other", "materials"]);

function normFormat(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  const n = name.trim().toLowerCase().replace(/^\./, "");
  if (!n || NOT_FORMATS.has(n)) return undefined;
  if (FORMAT_ALIASES[n]) return FORMAT_ALIASES[n];
  return /^[a-z0-9]{1,12}$/.test(n) ? n : undefined;
}

interface CgListingItem {
  id: string;
  type: string;
  attributes: {
    id: number;
    title: string;
    price: number;
    description?: string;
    url: string;
    primaryImage?: { gridFallbackUrl?: string; gridUrl?: string };
    schemaImageUrl?: string;
    modelInfo?: { types?: { animated?: boolean; rigged?: boolean; printReady?: boolean; pbr?: boolean; lowPoly?: boolean } };
    metaverseFormatsList?: { name: string | null }[];
    categorySlug?: string;
    subcategorySlug?: string;
    categoryTitle?: string;
    subcategoryTitle?: string;
  };
}

interface CgListing {
  data?: CgListingItem[];
  meta?: { totalCount?: number; currentPage?: number | string; totalPages?: number; perPage?: number };
}

/** Last path segment of a product URL; `/3d-model/<slug>` redirects to the canonical page. */
function slugOf(url: string): string {
  const path = new URL(url, SITE).pathname.replace(/\/+$/, "");
  return path.slice(path.lastIndexOf("/") + 1);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function listingToAsset(item: CgListingItem): Asset {
  const a = item.attributes;
  const t = a.modelInfo?.types ?? {};
  const free = !a.price;
  const desc = cleanText(a.description);
  return makeAsset({
    provider: "cgtrader",
    nativeId: slugOf(a.url),
    title: cleanText(a.title),
    description: desc ? truncate(desc, DESCRIPTION_MAX) : undefined,
    type: "model",
    tags: [a.categorySlug, a.subcategorySlug, t.printReady ? "3d print" : undefined, t.pbr ? "pbr" : undefined, t.lowPoly ? "low poly" : undefined].filter(
      (x): x is string => !!x,
    ),
    categories: uniq([a.categoryTitle, a.subcategoryTitle].filter((x): x is string => !!x)),
    url: a.url,
    thumbnailUrl: a.primaryImage?.gridFallbackUrl || a.primaryImage?.gridUrl || a.schemaImageUrl,
    price: free ? { free: true } : { free: false, amount: a.price, currency: "USD" },
    formats: uniq((a.metaverseFormatsList ?? []).map((f) => normFormat(f.name)).filter((f): f is string => !!f)),
    animated: t.animated,
    rigged: t.rigged,
    downloadable: false,
  });
}

function searchUrl(q: SearchQuery, page: number): string {
  // Parameter order matters: anything else is 301-redirected to page, free, keywords.
  return `${SITE}/search${qs({ page: page > 1 ? page : undefined, free: q.freeOnly ? 1 : undefined, keywords: q.query.trim() })}`;
}

// ---------- product page ----------

interface CgFormat {
  title?: string;
  fileSize?: string;
  fileCount?: number;
}

interface CgTopSection {
  pricingArea?: { productId?: number; title?: string; price?: string; free?: boolean; license?: string };
  sellerArea?: { designerName?: string };
  descriptionArea?: {
    description?: string;
    relatedTags?: { text?: string }[];
    breadcrumbs?: { title?: string; url?: string }[];
  };
  detailsArea?: {
    publishDate?: string;
    polygons?: number | null;
    animated?: boolean;
    rigged?: boolean;
    readyFor3dPrinting?: boolean;
    pbr?: boolean;
    nativeFormats?: CgFormat[] | null;
    exchangeFormats?: CgFormat[] | null;
  };
  galleryArea?: { medias?: { imageName?: string; imageNameThumb?: string }[] };
}

interface JsonLdProduct {
  "@type"?: string;
  name?: string;
  url?: string;
  sku?: string;
  image?: { contentUrl?: string }[] | { contentUrl?: string };
  brand?: { name?: string };
  offers?: { price?: string; priceCurrency?: string };
}

function parseSize(s: string | undefined): number | undefined {
  const m = /^([\d.]+)\s*(B|KB|MB|GB)$/i.exec(s?.trim() ?? "");
  if (!m) return undefined;
  const mult = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[m[2]!.toUpperCase() as "B"]!;
  return Math.round(parseFloat(m[1]!) * mult);
}

function findProduct($: cheerio.CheerioAPI): JsonLdProduct | undefined {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const data = JSON.parse($(el).text()) as { "@graph"?: JsonLdProduct[] } & JsonLdProduct;
      const nodes = Array.isArray(data["@graph"]) ? data["@graph"] : [data];
      const p = nodes.find((n) => n?.["@type"] === "Product");
      if (p) return p;
    } catch {
      // ignore malformed blocks
    }
  }
  return undefined;
}

function parseProductPage(html: string, fallbackSlug: string): AssetDetails | null {
  const $ = cheerio.load(html);
  const product = findProduct($);
  const propsRaw = $('[data-react-class="ItemPage/TopSection/TopSection"]').attr("data-react-props");
  if (!product && !propsRaw) return null;
  let top: CgTopSection = {};
  if (propsRaw) {
    try {
      top = JSON.parse(propsRaw) as CgTopSection;
    } catch {
      top = {};
    }
  }
  const url = product?.url || $('link[rel="canonical"]').attr("href") || `${SITE}/3d-model/${fallbackSlug}`;
  const pricing = top.pricingArea ?? {};
  const details = top.detailsArea ?? {};
  const title = cleanText((product?.name ?? pricing.title ?? fallbackSlug).replace(/\s*\|\s*3D model\s*$/i, ""));
  const offerPrice = Number(product?.offers?.price ?? pricing.price?.replace(/[^\d.]/g, ""));
  const free = pricing.free ?? !(offerPrice > 0);
  const images = Array.isArray(product?.image) ? product.image : product?.image ? [product.image] : [];
  const thumb =
    top.galleryArea?.medias?.[0]?.imageNameThumb || images[0]?.contentUrl || $('meta[property="og:image"]').attr("content");
  const descHtml = top.descriptionArea?.description;
  // Keep block/line breaks as spaces so "Name: X<br>Type: Y" does not run together.
  const descText = descHtml ? cleanText(cheerio.load(descHtml.replace(/<br\s*\/?>|<\/(?:p|div|li|h\d)>/gi, " $&")).text()) : "";
  const description = descText ? truncate(descText, DESCRIPTION_MAX * 3) : undefined;
  const crumbs = (top.descriptionArea?.breadcrumbs ?? []).map((b) => cleanText(b.title)).filter(Boolean);
  // Breadcrumbs: [section, category, subcategory, item title].
  const categories = crumbs.slice(1, -1);

  const nativeFormats = new Set((details.nativeFormats ?? []).map((f) => normFormat(f.title)));
  const formatsList = [...(details.nativeFormats ?? []), ...(details.exchangeFormats ?? [])];
  const files: AssetFile[] = [];
  const seen = new Set<string>();
  for (const f of formatsList) {
    const format = normFormat(f.title);
    if (!format || seen.has(format)) continue;
    seen.add(format);
    files.push({
      url,
      filename: `${slugOf(url)}.${format}`,
      format,
      sizeBytes: parseSize(f.fileSize),
      group: nativeFormats.has(format) ? "native" : "exchange",
      requiresAuth: true,
    });
  }

  const asset = makeAsset({
    provider: "cgtrader",
    nativeId: slugOf(url),
    title,
    description,
    type: "model",
    tags: [
      ...(top.descriptionArea?.relatedTags ?? []).map((t) => cleanText(t.text)).filter(Boolean),
      ...(details.readyFor3dPrinting ? ["3d print"] : []),
      ...(details.pbr ? ["pbr"] : []),
    ],
    categories: categories.length ? categories : undefined,
    url,
    thumbnailUrl: thumb,
    author: top.sellerArea?.designerName || product?.brand?.name,
    license: pricing.license ? (LICENSE_MAP[pricing.license] ?? { name: "Custom", url: `${SITE}/pages/terms-and-conditions` }) : undefined,
    price: free
      ? { free: true }
      : { free: false, amount: offerPrice > 0 ? offerPrice : undefined, currency: product?.offers?.priceCurrency ?? "USD" },
    formats: files.length ? files.map((f) => f.format) : undefined,
    polyCount: details.polygons ?? undefined,
    animated: details.animated,
    rigged: details.rigged,
    downloadable: false,
    createdAt: details.publishDate,
  });
  return { ...asset, files };
}

const WAF_MARKERS = /awsWafCookieDomainList|AwsWafIntegration|\.awswaf\.com\//;

/** Thrown when CGTrader's AWS WAF answers with a JavaScript challenge instead of content. */
export class CgtraderBlockedError extends Error {
  constructor(readonly url: string) {
    super(
      `CGTrader bot protection (AWS WAF challenge) blocked automated access from this network (common for cloud/datacenter IPs). Open ${url} in a browser instead.`,
    );
    this.name = "CgtraderBlockedError";
  }
}

/**
 * GET via `raw` rather than `text`/`json` so a WAF challenge (HTTP 202, empty or JS body)
 * is detected and never stored in the response cache.
 */
async function fetchBody(url: string, accept: string, ctx: ProviderContext, humanUrl = url): Promise<string> {
  const res = await ctx.fetch.raw(url, { headers: { accept }, signal: ctx.signal });
  const body = await res.text();
  if (res.headers.get("x-amzn-waf-action") || (res.status === 202 && !body) || WAF_MARKERS.test(body.slice(0, 4000))) {
    throw new CgtraderBlockedError(humanUrl);
  }
  return body;
}

export const cgtrader: Provider = {
  id: "cgtrader",
  name: "CGTrader",
  homepage: SITE,
  description: "Large marketplace of free and paid 3D models (game, archviz, 3D print); downloads need a CGTrader account.",
  assetTypes: ["model"],
  access: "scrape",
  pricing: "freemium",
  supportsDownload: false,

  buildSearchUrl(q: SearchQuery) {
    if (!q.query.trim()) return `${SITE}/${q.freeOnly ? "free-3d-models" : "3d-models"}`;
    return searchUrl(q, 1);
  },

  async search(q, ctx) {
    if (!wantsType(q, "model")) return { assets: [] };
    const offset = q.offset ?? 0;
    const firstPage = Math.floor(offset / PAGE_SIZE) + 1;
    const skip = offset - (firstPage - 1) * PAGE_SIZE;
    const fetchPage = async (page: number): Promise<CgListing> => {
      const url = searchUrl(q, page);
      // The listing page serves its React state as JSON for `Accept: application/json`.
      const body = await fetchBody(url, "application/json", ctx, this.buildSearchUrl(q));
      try {
        return JSON.parse(body) as CgListing;
      } catch {
        throw new Error(`Invalid JSON from ${url}: ${body.slice(0, 120)}`);
      }
    };
    const first = await fetchPage(firstPage);
    let items = (first.data ?? []).filter((d) => d?.type === "listingItem" && d.attributes?.url);
    const totalPages = first.meta?.totalPages ?? 0;
    if (skip + q.limit > PAGE_SIZE && firstPage < totalPages) {
      const next = await fetchPage(firstPage + 1);
      items = items.concat((next.data ?? []).filter((d) => d?.type === "listingItem" && d.attributes?.url));
    }
    let assets = items.slice(skip, skip + q.limit).map(listingToAsset);
    if (q.freeOnly) assets = assets.filter((a) => a.price?.free);
    return { assets, total: first.meta?.totalCount, searchUrl: this.buildSearchUrl(q) };
  },

  async getAsset(nativeId, ctx): Promise<AssetDetails | null> {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(nativeId)) return null;
    let html: string;
    try {
      // `/3d-model/<slug>` 301s to the canonical product URL; it returns 406 for application/json.
      html = await fetchBody(`${SITE}/3d-model/${nativeId}`, "text/html", ctx);
    } catch (e) {
      // Unknown slugs redirect to /not_found (404).
      const status = (e as { status?: number }).status;
      if (status === 404 || status === 410) return null;
      throw e;
    }
    return parseProductPage(html, nativeId);
  },
};
