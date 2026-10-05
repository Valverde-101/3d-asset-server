/**
 * Serves the pre-rendered website (web/ → dist/web, built by Astro).
 *
 * Every file is indexed once at startup, so a request can only ever resolve
 * to a file that exists under the site root (no path traversal). Pages use
 * Astro's directory format: /docs/mcp is served from docs/mcp/index.html.
 *
 * Pages get a strict, per-page Content-Security-Policy: instead of
 * 'unsafe-inline', it lists the SHA-256 hash of every inline script, <style>
 * block and style="" attribute the page actually contains. Text files are
 * served Brotli-compressed when the client accepts it.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { brotliCompressSync, constants as zlib } from "node:zlib";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json; charset=utf-8",
};

const COMPRESSIBLE = /^(text\/|application\/(json|xml|manifest\+json)|image\/svg\+xml)/;
const MIN_COMPRESS_BYTES = 1024;

/** Headers every HTML page gets, besides its CSP. */
const PAGE_SECURITY_HEADERS: Record<string, string> = {
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
};

const sha256 = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;

const decodeEntities = (s: string) =>
  s
    .replace(/&quot;|&#34;|&#x22;/gi, '"')
    .replace(/&#39;|&#x27;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");

const EXECUTABLE_SCRIPT = /^(|module|text\/javascript|application\/javascript)$/i;

/**
 * Content-Security-Policy for one HTML document, without 'unsafe-inline':
 * inline scripts and styles are allowed by hash, style="" attributes by hash
 * via 'unsafe-hashes'. Thumbnails may come from any https host (search results
 * span many asset sites); everything else is same-origin.
 */
export function buildCsp(html: string, opts: { styleNonce?: string; inlineStyles?: boolean } = {}): string {
  const scripts = new Set<string>();
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? "";
    if (/\ssrc\s*=/i.test(attrs)) continue;
    const type = /\stype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1] ?? "";
    if (EXECUTABLE_SCRIPT.test(type)) scripts.add(sha256(m[2] ?? ""));
  }
  const styles = new Set<string>();
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) styles.add(sha256(m[1] ?? ""));
  const attrs = new Set<string>();
  for (const m of html.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) attrs.add(sha256(decodeEntities(m[1] ?? m[2] ?? "")));

  const scriptSrc = ["'self'", ...scripts];
  // `inlineStyles` is for third-party apps that inject styles at runtime (the
  // Scalar API playground); content pages always use hashes/nonces.
  const styleSrc = opts.inlineStyles
    ? ["'self'", "'unsafe-inline'"]
    : ["'self'", ...styles, ...(attrs.size ? ["'unsafe-hashes'", ...attrs] : [])];
  if (opts.styleNonce && !opts.inlineStyles) styleSrc.push(`'nonce-${opts.styleNonce}'`);
  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    `style-src ${styleSrc.join(" ")}`,
    "img-src 'self' https: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Replace a page's <title>, description (meta + Open Graph + Twitter) and
 * robots directive. Used for per-query variants of /search.
 */
export function rewriteHead(
  html: string,
  meta: { title?: string; description?: string; robots?: string; image?: string; imageAlt?: string; url?: string },
): string {
  let out = html;
  const set = (re: RegExp, value: string) => {
    out = out.replace(re, `$1${escapeHtml(value)}$2`);
  };
  if (meta.title !== undefined) {
    out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(meta.title)}</title>`);
    set(/(<meta (?:property="og:title"|name="twitter:title") content=")[^"]*(")/gi, meta.title);
  }
  if (meta.description !== undefined) {
    set(/(<meta (?:name="description"|property="og:description"|name="twitter:description") content=")[^"]*(")/gi, meta.description);
  }
  if (meta.robots !== undefined) set(/(<meta name="robots" content=")[^"]*(")/i, meta.robots);
  if (meta.image !== undefined) set(/(<meta (?:property="og:image"|name="twitter:image") content=")[^"]*(")/gi, meta.image);
  if (meta.imageAlt !== undefined) set(/(<meta (?:property="og:image:alt"|name="twitter:image:alt") content=")[^"]*(")/gi, meta.imageAlt);
  if (meta.url !== undefined) set(/(<meta (?:property="og:url"|name="twitter:url") content=")[^"]*(")/gi, meta.url);
  return out;
}

interface Entry {
  file: string;
  type: string;
  etag: string;
  /** Path used as the page-view label for HTML documents. */
  page?: string;
  body?: Buffer;
  br?: Buffer;
  csp?: string;
}

export interface SiteFile {
  status: number;
  body: Buffer;
  headers: Record<string, string>;
  page?: string;
}

export interface ServeOptions {
  ifNoneMatch?: string;
  acceptEncoding?: string;
  /**
   * Rewrite an HTML page before it is sent (e.g. per-query titles). Return
   * undefined to leave it unchanged; `styleNonce` is added to the page's CSP.
   */
  rewrite?: (html: string) => { html: string; styleNonce?: string; inlineStyles?: boolean } | undefined;
}

export class Site {
  private readonly files = new Map<string, Entry>();
  /** Lower-cased path -> real path, so /agents.md finds /AGENTS.md. */
  private readonly folded = new Map<string, string>();
  private readonly notFound?: Entry;

  private constructor(private readonly root: string) {
    for (const file of walk(root)) {
      const rel = "/" + relative(root, file).split(sep).join("/");
      const st = statSync(file);
      const entry: Entry = {
        file,
        type: MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
        etag: `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`,
      };
      if (rel.endsWith("/index.html")) {
        const route = rel.slice(0, -"/index.html".length) || "/";
        this.files.set(route, { ...entry, page: route });
      } else if (rel === "/404.html") {
        this.notFound = { ...entry, page: "404" };
      } else {
        this.files.set(rel, entry);
      }
    }
    for (const route of this.files.keys()) this.folded.set(route.toLowerCase(), route);
  }

  /** True when `route` is an HTML page (the routes that negotiate HTML vs Markdown). */
  isPage(route: string): boolean {
    return Boolean(this.files.get(route)?.page);
  }

  /**
   * Markdown 404 for agents that ask for `text/markdown`: says what went wrong
   * and where to go instead (agent guide, llms.txt, docs, sitemap, OpenAPI).
   */
  markdownNotFound(path: string, origin: string): SiteFile {
    const base = origin.replace(/\/$/, "");
    const shown = path.replace(/[`\r\n]/g, "").slice(0, 200);
    const body = [
      "# 404: page not found",
      "",
      `There is no page at \`${shown}\` on 3D Asset Server (${base}). The address may be mistyped, or the page moved.`,
      "",
      "Where to go instead:",
      "",
      `- [Agent guide (AGENTS.md)](${base}/AGENTS.md): how to search and download 3D assets with this service`,
      `- [llms.txt](${base}/llms.txt): index of every page as Markdown`,
      `- [Docs](${base}/docs): quick start, MCP setup, REST API guide`,
      `- [Sitemap](${base}/sitemap-index.xml)`,
      `- [OpenAPI 3.1](${base}/openapi.json): the REST API (\`GET /v1/search?q=...\`)`,
      "",
    ].join("\n");
    return {
      status: 404,
      body: Buffer.from(body),
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "no-store",
        vary: "Accept",
        "x-content-type-options": "nosniff",
      },
    };
  }

  /**
   * Markdown twin of a page, for agents that ask for `text/markdown`:
   * `/` -> /AGENTS.md, `/docs/mcp` -> /docs/mcp.md.
   */
  markdownFor(route: string): string | undefined {
    const twin = route === "/" ? "/AGENTS.md" : `${route}.md`;
    return this.files.has(twin) ? twin : undefined;
  }

  /** Load the site, or undefined when it was not built (e.g. running from source without web/dist). */
  static load(root: string): Site | undefined {
    try {
      if (!statSync(root).isDirectory()) return undefined;
    } catch {
      return undefined;
    }
    const site = new Site(root);
    return site.files.has("/") ? site : undefined;
  }

  /** HTML page routes, e.g. ["/", "/docs", "/docs/mcp"]. */
  pages(): string[] {
    return [...this.files.entries()].filter(([, e]) => e.page).map(([route]) => route);
  }

  /**
   * Resolve a request path. Returns a redirect for trailing-slash variants of
   * pages (one canonical URL per page), the file, the HTML 404 page, or
   * undefined when nothing matches and there is no 404 page.
   */
  resolve(path: string, opts: ServeOptions = {}): SiteFile | { redirect: string } | undefined {
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      decoded = path;
    }
    if (decoded.length > 1 && decoded.endsWith("/")) {
      const bare = decoded.replace(/\/+$/, "");
      if (this.files.get(bare)?.page) return { redirect: bare };
    }
    const entry = this.files.get(decoded) ?? this.files.get(this.folded.get(decoded.toLowerCase()) ?? "");
    if (entry) return this.serve(entry, 200, opts);
    return this.notFound ? this.serve(this.notFound, 404, { acceptEncoding: opts.acceptEncoding }) : undefined;
  }

  private serve(entry: Entry, status: number, opts: ServeOptions): SiteFile {
    entry.body ??= readFileSync(entry.file);
    const headers: Record<string, string> = {
      "content-type": entry.type,
      etag: entry.etag,
      "x-content-type-options": "nosniff",
      "cache-control": cacheControl(entry),
    };
    let body = entry.body;
    let dynamic = false;
    if (entry.page) {
      Object.assign(headers, PAGE_SECURITY_HEADERS);
      headers.vary = "Accept";
      const twin = entry.page === "404" ? undefined : this.markdownFor(entry.page);
      if (twin) headers.link = `<${twin}>; rel="alternate"; type="text/markdown"`;
      const rewritten = status === 200 ? opts.rewrite?.(body.toString("utf8")) : undefined;
      if (rewritten) {
        dynamic = true;
        body = Buffer.from(rewritten.html);
        headers["content-security-policy"] = buildCsp(rewritten.html, { styleNonce: rewritten.styleNonce, inlineStyles: rewritten.inlineStyles });
        headers["cache-control"] = "private, no-cache";
        delete headers.etag;
      } else {
        entry.csp ??= buildCsp(body.toString("utf8"));
        headers["content-security-policy"] = entry.csp;
      }
    }
    if (!dynamic && status === 200 && opts.ifNoneMatch && opts.ifNoneMatch === entry.etag) {
      return { status: 304, body: Buffer.alloc(0), headers };
    }
    if (COMPRESSIBLE.test(entry.type)) {
      headers.vary = headers.vary ? `${headers.vary}, Accept-Encoding` : "Accept-Encoding";
      if (body.length >= MIN_COMPRESS_BYTES && /\bbr\b/.test(opts.acceptEncoding ?? "")) {
        // Static files are compressed once at maximum quality; per-request variants quickly.
        body = dynamic
          ? brotliCompressSync(body, { params: { [zlib.BROTLI_PARAM_QUALITY]: 5 } })
          : (entry.br ??= brotliCompressSync(body, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11 } }));
        headers["content-encoding"] = "br";
      }
    }
    return { status, body, headers, page: entry.page };
  }
}

function cacheControl(entry: Entry): string {
  // Astro fingerprints everything under /_astro, so it can be cached forever.
  if (entry.file.includes(`${sep}_astro${sep}`)) return "public, max-age=31536000, immutable";
  if (entry.page) return "public, max-age=0, must-revalidate";
  return "public, max-age=86400";
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}
