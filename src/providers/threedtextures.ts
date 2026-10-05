import * as cheerio from "cheerio";
import type { Asset, AssetDetails, AssetFile, Provider, SearchQuery } from "../core/types.js";
import {
  LICENSES,
  cleanText,
  filenameFromUrl,
  formatFromFilename,
  isKnownFormat,
  makeAsset,
  qs,
  wantsType,
} from "../core/util.js";
import { addedSince, wpTotal } from "../core/census.js";

/**
 * 3DTextures.me — a WordPress blog of free CC0 PBR materials (realistic and stylized).
 *
 * Search uses the WordPress REST API (`/wp-json/wp/v2/posts?search=`), embedding the
 * category/tag terms so one request yields titles, thumbnails and tags. Free downloads are
 * shared Google Drive folders linked from the post body, so nothing is directly downloadable.
 * A handful of posts are Patreon-only (category "Patreon Exclusive").
 */

const SITE = "https://3dtextures.me";
const API = `${SITE}/wp-json/wp/v2`;

/** Category ids on 3dtextures.me (stable WordPress term ids). */
const CAT_TEXTURING_EXAMPLES = 504794035; // showcase posts, not assets
const CAT_PATREON_EXCLUSIVE = 523608841;
const PATREON_SLUG = "patreon-exclusive";

/** Newer posts append " – Free Seamless PBR Texture" to the title. */
const TITLE_SUFFIX = /\s*[–—-]\s*free\s+seamless\s+pbr\s+texture\s*$/i;

/** Generic tags present on nearly every post; they add noise to tag matching. */
const NOISE_TAGS = new Set(["cc0", "free", "texture", "textures", "pbr", "seamless"]);

const SEARCH_FIELDS = [
  "id",
  "slug",
  "title",
  "link",
  "date",
  "excerpt",
  "categories",
  "jetpack_featured_media_url",
  "_links",
  "_embedded",
].join(",");

interface WpTerm {
  id: number;
  name: string;
  slug: string;
  taxonomy: string;
}

interface WpPost {
  id: number;
  slug: string;
  link: string;
  date?: string;
  title?: { rendered?: string };
  excerpt?: { rendered?: string };
  content?: { rendered?: string };
  categories?: number[];
  jetpack_featured_media_url?: string;
  _embedded?: { "wp:term"?: WpTerm[][] };
}

/** WordPress returns HTML-escaped strings (e.g. `&#8211;`); decode to plain text. */
function htmlText(html: string | undefined): string {
  if (!html) return "";
  return cleanText(cheerio.load(`<div>${html}</div>`)("div").first().text());
}

function terms(post: WpPost, taxonomy: string): WpTerm[] {
  return (post._embedded?.["wp:term"] ?? []).flat().filter((t) => t?.taxonomy === taxonomy);
}

/** "…seamless texture, 1024 x 1024, with…" -> "1k". */
function resolutionFromText(text: string): string | undefined {
  const m = /(\d{3,5})\s*[x×]\s*(\d{3,5})/.exec(text);
  if (!m) return undefined;
  const k = Math.round(Number(m[1]) / 1024);
  return k >= 1 ? `${k}k` : undefined;
}

function toAsset(post: WpPost): Asset {
  const categories = terms(post, "category");
  const tags = terms(post, "post_tag")
    .map((t) => t.name)
    .filter((t) => !NOISE_TAGS.has(t.toLowerCase()));
  const description = htmlText(post.excerpt?.rendered);
  const paid =
    categories.some((c) => c.slug === PATREON_SLUG) || (post.categories ?? []).includes(CAT_PATREON_EXCLUSIVE);
  const resolution = resolutionFromText(description);
  return makeAsset({
    provider: "threedtextures",
    nativeId: post.slug,
    title: htmlText(post.title?.rendered).replace(TITLE_SUFFIX, "") || post.slug,
    description: description || undefined,
    type: "material",
    tags,
    categories: categories.length ? categories.map((c) => c.name) : undefined,
    url: post.link,
    thumbnailUrl: post.jetpack_featured_media_url || undefined,
    license: LICENSES.CC0,
    price: { free: !paid },
    resolutions: resolution ? [resolution] : undefined,
    downloadable: false,
    createdAt: post.date ? new Date(`${post.date}Z`).toISOString() : undefined,
  });
}

/** Extract download links (Google Drive folders/files, direct archives) from the post body. */
export function parseDownloadLinks(html: string, slug: string): AssetFile[] {
  const $ = cheerio.load(html);
  const files: AssetFile[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let url: URL;
    try {
      url = new URL(href, SITE);
    } catch {
      return;
    }
    const key = url.toString();
    if (seen.has(key)) return;
    if (url.hostname === "drive.google.com") {
      // Shared folder (or file page) holding the maps; Google needs a browser to fetch it.
      seen.add(key);
      const folder = url.pathname.includes("/folders/");
      files.push({ url: key, filename: slug, format: folder ? "folder" : "link", group: "google-drive" });
      return;
    }
    const ext = formatFromFilename(url.pathname);
    if (ext && isKnownFormat(ext) && !["png", "jpg", "webp"].includes(ext)) {
      seen.add(key);
      files.push({ url: key, filename: filenameFromUrl(key), format: ext, group: "archive" });
    }
  });
  return files;
}

export const threedtextures: Provider = {
  id: "threedtextures",
  name: "3DTextures.me",
  homepage: SITE,
  description: "Free CC0 seamless PBR materials, realistic and stylized (WordPress blog; downloads via Google Drive).",
  assetTypes: ["material"],
  access: "api",
  pricing: "free",
  license: LICENSES.CC0,
  supportsDownload: false,

  async census(ctx) {
    const base = `${API}/posts`;
    const [all, patreon, recent] = await Promise.all([
      wpTotal(ctx.fetch, `${base}${qs({ per_page: 1, categories_exclude: CAT_TEXTURING_EXAMPLES, _fields: "id" })}`, ctx.signal),
      wpTotal(ctx.fetch, `${base}${qs({ per_page: 1, categories: CAT_PATREON_EXCLUSIVE, _fields: "id" })}`, ctx.signal),
      ctx.fetch.json<{ date?: string }[]>(`${base}${qs({ per_page: 100, _fields: "date" })}`, { signal: ctx.signal }),
    ]);
    return {
      total: all,
      free: all - patreon,
      byType: { material: all },
      addedLast30Days: addedSince(recent.map((p) => (p.date ? `${p.date}Z` : undefined))),
      method: "WordPress REST API: X-WP-Total of material posts (excluding showcase posts)",
    };
  },

  buildSearchUrl(q: SearchQuery) {
    return `${SITE}/${qs({ s: q.query })}`;
  },

  async search(q, ctx) {
    if (!wantsType(q, "material")) return { assets: [] };
    const exclude = [CAT_TEXTURING_EXAMPLES, ...(q.freeOnly ? [CAT_PATREON_EXCLUSIVE] : [])];
    const url =
      `${API}/posts` +
      qs({
        search: q.query.trim() || undefined,
        per_page: Math.max(1, Math.min(q.limit, 100)),
        offset: q.offset || undefined,
        categories_exclude: exclude.join(","),
        _embed: "wp:term",
        _fields: SEARCH_FIELDS,
      });
    const posts = await ctx.fetch.json<WpPost[]>(url, { signal: ctx.signal });
    if (!Array.isArray(posts)) throw new Error("3dtextures.me: unexpected search response");
    let assets = posts.map(toAsset);
    if (q.freeOnly) assets = assets.filter((a) => a.price?.free !== false);
    return { assets: assets.slice(0, q.limit), searchUrl: this.buildSearchUrl(q) };
  },

  async getAsset(nativeId, ctx): Promise<AssetDetails | null> {
    const url = `${API}/posts${qs({ slug: nativeId, _embed: "wp:term" })}`;
    const posts = await ctx.fetch.json<WpPost[]>(url, { signal: ctx.signal });
    const post = Array.isArray(posts) ? posts[0] : undefined;
    if (!post) return null;
    const asset = toAsset(post);
    const content = post.content?.rendered ?? "";
    const text = htmlText(content);
    const resolution = resolutionFromText(text);
    return {
      ...asset,
      resolutions: resolution ? [resolution] : asset.resolutions,
      files: parseDownloadLinks(content, nativeId),
    };
  },
};
