/**
 * Serves the pre-rendered website (web/ → dist/web, built by Astro).
 *
 * Every file is indexed once at startup, so a request can only ever resolve
 * to a file that exists under the site root (no path traversal). Pages use
 * Astro's directory format: /docs/mcp is served from docs/mcp/index.html.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

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

/**
 * Pages get a CSP that allows Astro's inline island bootstrap and thumbnails
 * from any https host (search results come from many asset sites). Scripts,
 * fonts and connections stay same-origin.
 */
export const SITE_CSP =
  "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; " +
  "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

interface Entry {
  file: string;
  type: string;
  etag: string;
  /** Path used as the page-view label for HTML documents. */
  page?: string;
  body?: Buffer;
}

export interface SiteFile {
  status: number;
  body: Buffer;
  headers: Record<string, string>;
  page?: string;
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
  resolve(path: string, ifNoneMatch?: string): SiteFile | { redirect: string } | undefined {
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
    if (entry) return this.serve(entry, 200, ifNoneMatch);
    return this.notFound ? this.serve(this.notFound, 404) : undefined;
  }

  private serve(entry: Entry, status: number, ifNoneMatch?: string): SiteFile {
    const headers: Record<string, string> = {
      "content-type": entry.type,
      etag: entry.etag,
      "x-content-type-options": "nosniff",
      "cache-control": cacheControl(entry),
    };
    if (entry.page) {
      headers.vary = "Accept";
      const twin = entry.page === "404" ? undefined : this.markdownFor(entry.page);
      if (twin) headers.link = `<${twin}>; rel="alternate"; type="text/markdown"`;
      headers["content-security-policy"] = SITE_CSP;
      headers["referrer-policy"] = "strict-origin-when-cross-origin";
      headers["x-frame-options"] = "DENY";
    }
    if (status === 200 && ifNoneMatch && ifNoneMatch === entry.etag) {
      return { status: 304, body: Buffer.alloc(0), headers };
    }
    entry.body ??= readFileSync(entry.file);
    return { status, body: entry.body, headers, page: entry.page };
  }
}

function cacheControl(entry: Entry): string {
  // Astro fingerprints everything under /_astro, so it can be cached forever.
  if (entry.file.includes(`${sep}_astro${sep}`)) return "public, max-age=31536000, immutable";
  if (entry.page) return "public, max-age=0, must-revalidate";
  return "public, max-age=3600";
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}
