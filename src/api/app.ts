import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Hono, type Context } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { z } from "zod";
import { clientFamily, noopAnalytics, type Analytics, type Surface } from "../core/analytics.js";
import { assertPublicUrl, assetFolderName, selectFiles, totalBytes, zipStream } from "../core/download.js";
import { HttpError } from "../core/http.js";
import {
  AssetService,
  InvalidAssetIdError,
  UnknownProviderError,
  UnsupportedError,
  errorMessage,
} from "../core/service.js";
import { LocalStats, PrometheusStats, cachedStats, teeAnalytics, type StatsSource } from "../core/stats.js";
import { ASSET_TYPES, type AssetType } from "../core/types.js";
import { createMcpServer } from "../mcp/server.js";
import { prefersMarkdown } from "./negotiate.js";
import { openApiSpec } from "./openapi.js";
import { RATE_LIMIT_HEADERS, rateLimit, type RateLimitOptions } from "./ratelimit.js";
import { OgImages } from "./og.js";
import { assetMeta, searchMeta, searchShare, shareableAssetId, type HeadMeta } from "./search-meta.js";
import { Site, rewriteHead, type ServeOptions } from "./site.js";

export interface AppOptions {
  /** Require this key as `Authorization: Bearer <key>` or `x-api-key` on /v1 and /mcp. */
  apiKey?: string;
  /** Externally reachable base URL (for links handed to MCP clients). */
  publicBaseUrl?: string;
  /** Allow the MCP download tool to write to this server's disk. Off by default for HTTP. */
  allowServerDownloads?: boolean;
  downloadDir?: string;
  /** Product analytics sink (metrics + event log). Defaults to no-op. */
  analytics?: Analytics;
  /** Built website root (web/dist copied to dist/web). Defaults to ../web next to this file. */
  siteRoot?: string;
  /** Per-client limit on /v1/* and /mcp (with RateLimit headers). Off when unset. */
  rateLimit?: RateLimitOptions;
  /**
   * Prometheus that scrapes this server's metrics, for /v1/stats over 24 hours
   * and 7 days. Without it, /v1/stats counts this process since it started.
   */
  prometheus?: { url: string; fetch?: typeof fetch };
}

/** Short, guessable URLs for developer resources. */
const ALIASES: Record<string, string> = {
  "/api": "/docs/api",
  "/api-docs": "/docs/api/reference",
  "/reference": "/docs/api/reference",
  "/developers": "/docs",
  "/about-us": "/about",
  "/privacy-policy": "/privacy",
};

const DEFAULT_SITE_ROOT = fileURLToPath(new URL("../web", import.meta.url));

/** The bundled website marks its API calls so analytics can tell it apart from other API users. */
const WEB_CLIENT_HEADER = "x-asset-client";

/** Bounded route label for metrics (never the raw path). */
function routeLabel(path: string): string {
  if (path === "/v1/search" || path === "/v1/providers" || path === "/v1/stats" || path === "/mcp" || path === "/openapi.json" || path === "/health") {
    return path;
  }
  if (path.startsWith("/v1/assets/")) {
    if (path.endsWith("/download")) return "/v1/assets/:id/download";
    if (path.endsWith("/files")) return "/v1/assets/:id/files";
    return "/v1/assets/:id";
  }
  if (path.startsWith("/v1/")) return "/v1/other";
  if (path === "/og/query.png" || path === "/og/asset.png") return path;
  if (path.startsWith("/_astro/") || path.startsWith("/scalar/") || path.startsWith("/fonts/") || path.startsWith("/og/")) return "static-asset";
  return "site";
}

function tally(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

const csv = z
  .string()
  .optional()
  .transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined));
const bool = z
  .enum(["true", "false", "1", "0", "yes", "no"])
  .optional()
  .transform((v) => (v === undefined ? undefined : ["true", "1", "yes"].includes(v)));

const searchParams = z.object({
  q: z.string().default(""),
  type: csv.pipe(z.array(z.enum(ASSET_TYPES)).optional()),
  providers: csv,
  free: bool,
  downloadable: bool,
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const fileParams = z.object({
  format: z.string().optional(),
  resolution: z.string().optional(),
  maps: csv,
  all: bool,
});

/**
 * Per-request page rewrites:
 * - /search gets a CSP nonce (its sheet's scroll lock injects a <style> tag and
 *   reads the nonce from <meta property="csp-nonce">) and unique metadata for
 *   query variants;
 * - the Scalar API playground injects styles at runtime, so it alone gets
 *   inline styles (it is noindex and disallowed for crawlers).
 */
/**
 * Per-request page changes. /search gets a CSP nonce, and for share links
 * (query variants or `?asset=`) a unique title, description, share card and
 * og:url; `pre` carries metadata looked up ahead of time (the asset).
 */
function pageRewrite(route: string, params: URLSearchParams, origin: string, pre?: HeadMeta): ServeOptions["rewrite"] {
  if (route === "/search") {
    const meta = pre ?? searchMeta(params);
    const share = pre ? `asset=${encodeURIComponent(params.get("asset") ?? "")}` : searchShare(params)?.key;
    return (html) => {
      const nonce = randomBytes(16).toString("base64");
      const withNonce = html.replace("<head>", `<head><meta property="csp-nonce" content="${nonce}">`);
      if (!meta) return { html: withNonce, styleNonce: nonce };
      const head = { ...meta, image: meta.image && origin + meta.image, url: share ? `${origin}/search?${share}` : undefined };
      return { html: rewriteHead(withNonce, head), styleNonce: nonce };
    };
  }
  if (route === "/docs/api/playground") return (html) => ({ html, inlineStyles: true });
  return undefined;
}

const OG_HEADERS = { "content-type": "image/png", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" };
/** Asset lookups for share-link metadata must not hold a page load for long. */
const SHARE_LOOKUP_MS = 3500;

export function createApp(service: AssetService, opts: AppOptions = {}): Hono {
  const app = new Hono();
  // Every event also feeds the in-process tallies behind /v1/stats.
  const localStats = new LocalStats();
  const analytics = teeAnalytics(opts.analytics ?? noopAnalytics, localStats);
  const stats: StatsSource = opts.prometheus
    ? cachedStats(new PrometheusStats({ ...opts.prometheus, fallback: localStats }), 60_000)
    : localStats;
  const site = Site.load(opts.siteRoot ?? DEFAULT_SITE_ROOT);
  const who = (c: Context): { surface: Surface; client: string } => ({
    surface: c.req.header(WEB_CLIENT_HEADER) === "web" ? "web" : "api",
    client: clientFamily(c.req.header("user-agent")),
  });

  app.use("*", async (c, next) => {
    const started = Date.now();
    await next();
    if (c.req.path === "/health") return; // probes would drown everything else
    analytics.httpRequest({ route: routeLabel(c.req.path), method: c.req.method, status: c.res.status, tookMs: Date.now() - started });
  });

  // HSTS on every HTTPS response (TLS terminates at the edge proxy, which sets X-Forwarded-Proto).
  const httpsOrigin = opts.publicBaseUrl?.startsWith("https://") ?? false;
  app.use("*", async (c, next) => {
    await next();
    if (httpsOrigin || c.req.header("x-forwarded-proto") === "https") {
      c.res.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
    }
  });

  // Gzip/deflate text responses that aren't already encoded (site files are
  // Brotli-compressed by Site). Zip downloads are not compressible, so they
  // stream through untouched.
  app.use("*", compress());

  // CORS only where cross-origin reads make sense: the API, MCP and the
  // machine-readable files. HTML pages don't send Access-Control-Allow-Origin.
  const corsMw = cors({ origin: "*", exposeHeaders: ["mcp-session-id", ...RATE_LIMIT_HEADERS] });
  app.use("*", (c, next) => {
    const p = c.req.path;
    const machine = p.startsWith("/v1/") || p === "/mcp" || p === "/health" || /\.(json|md|txt|xml)$/i.test(p);
    return machine ? corsMw(c, next) : next();
  });
  if (opts.rateLimit && opts.rateLimit.limit > 0) {
    const limiter = rateLimit(opts.rateLimit);
    app.use("/v1/*", limiter);
    app.use("/mcp", limiter);
    app.use("/og/query.png", limiter);
    app.use("/og/asset.png", limiter);
  }

  if (opts.apiKey) {
    const key = opts.apiKey;
    const guard = async (c: Context, next: () => Promise<void>) => {
      const auth = c.req.header("authorization");
      // `api_key` query param lets plain links (e.g. the UI's download button) authenticate.
      const given = auth?.startsWith("Bearer ") ? auth.slice(7) : (c.req.header("x-api-key") ?? c.req.query("api_key"));
      if (given !== key) return c.json({ error: "unauthorized" }, 401);
      await next();
    };
    app.use("/v1/*", guard);
    app.use("/mcp", guard);
  }

  app.onError((err, c) => {
    if (err instanceof UnknownProviderError || err instanceof InvalidAssetIdError || err instanceof z.ZodError) {
      return c.json({ error: err instanceof z.ZodError ? z.prettifyError(err) : err.message }, 400);
    }
    if (err instanceof UnsupportedError) return c.json({ error: err.message }, 501);
    if (err instanceof HttpError) return c.json({ error: `Upstream error: ${err.message}` }, err.status === 404 ? 404 : 502);
    console.error(err);
    return c.json({ error: errorMessage(err) }, 500);
  });

  /**
   * Serve a site file, or the 404 page; undefined when there is no site.
   * Pages negotiate HTML vs Markdown on Accept (`/` -> /AGENTS.md, `/docs/mcp`
   * -> /docs/mcp.md) and say so with `Vary: Accept`; unknown paths answer a
   * Markdown 404 to agents and the HTML 404 page to browsers.
   */
  const origin = (c: Context) => (opts.publicBaseUrl ?? new URL(c.req.url).origin).replace(/\/$/, "");
  const serveSite = (c: Context, path: string, pre?: HeadMeta): Response | undefined => {
    if (!site) return undefined;
    const markdown = prefersMarkdown(c.req.header("accept"));
    const route = path.length > 1 ? path.replace(/\/+$/, "") : path;
    const negotiated = site.isPage(route);
    const twin = markdown && negotiated ? site.markdownFor(route) : undefined;
    const serveOpts: ServeOptions = {
      ifNoneMatch: c.req.header("if-none-match"),
      acceptEncoding: c.req.header("accept-encoding"),
      rewrite: twin ? undefined : pageRewrite(route, new URL(c.req.url).searchParams, origin(c), pre),
    };
    let hit = site.resolve(twin ?? path, serveOpts);
    if (markdown && (!hit || ("status" in hit && hit.status === 404))) {
      hit = site.markdownNotFound(path, opts.publicBaseUrl ?? new URL(c.req.url).origin);
    }
    if (!hit) return undefined;
    if ("redirect" in hit) return c.redirect(hit.redirect + (new URL(c.req.url).search || ""), 301);
    const headers = { ...hit.headers };
    if (negotiated && !/\bAccept\b/.test(headers.vary ?? "")) headers.vary = headers.vary ? `Accept, ${headers.vary}` : "Accept";
    if (hit.page && hit.status === 200) analytics.pageView({ page: hit.page });
    else if (twin && hit.status === 200) analytics.pageView({ page: `${route} (markdown)` });
    if (c.req.method === "HEAD") return new Response(null, { status: hit.status, headers });
    return new Response(hit.status === 304 ? null : new Uint8Array(hit.body), { status: hit.status, headers });
  };

  app.get("/", (c) => {
    const accept = c.req.header("accept") ?? "";
    if (site && (accept.includes("text/html") || accept.includes("text/markdown"))) return serveSite(c, "/")!;
    // The same URL serves HTML, Markdown or this JSON index depending on Accept.
    c.header("vary", "Accept");
    return c.json({
      name: "3d-asset-server",
      description: "Search and download 3D models, materials, textures, HDRIs and game assets across many sources.",
      agents: {
        instructions: "/AGENTS.md",
        llms: "/llms.txt",
        mcp: `claude mcp add --transport http 3d-assets ${(opts.publicBaseUrl ?? new URL(c.req.url).origin).replace(/\/$/, "")}/mcp`,
      },
      endpoints: {
        providers: "/v1/providers",
        stats: "/v1/stats",
        search: "/v1/search?q=wooden+chair&type=model&free=true",
        asset: "/v1/assets/{provider}:{id}",
        files: "/v1/assets/{provider}:{id}/files?format=gltf&resolution=2k",
        download: "/v1/assets/{provider}:{id}/download?format=gltf&resolution=2k",
        mcp: "/mcp (Streamable HTTP)",
        openapi: "/openapi.json",
        docs: "/docs",
        apiReference: "/docs/api/reference",
        ui: "/ (open in a browser)",
      },
    });
  });
  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/openapi.json", (c) => c.json(openApiSpec(opts.publicBaseUrl)));

  app.get("/v1/providers", (c) => c.json({ providers: service.listProviders() }));

  app.get("/v1/stats", async (c) => {
    const providers = service.listProviders();
    const usage = await stats.snapshot();
    c.header("cache-control", "public, max-age=60");
    return c.json({
      ...usage,
      catalog: {
        sources: providers.length,
        directDownload: providers.filter((p) => p.supportsDownload).length,
        byAccess: tally(providers.map((p) => p.access)),
        byPricing: tally(providers.map((p) => p.pricing)),
      },
    });
  });

  app.get("/v1/search", async (c) => {
    const p = searchParams.parse(c.req.query());
    const started = Date.now();
    const res = await service.search({
      query: p.q,
      types: p.type as AssetType[] | undefined,
      providers: p.providers,
      freeOnly: p.free,
      downloadableOnly: p.downloadable,
      limit: p.limit,
      offset: p.offset,
    });
    analytics.search({
      ...who(c),
      query: p.q,
      types: p.type as AssetType[] | undefined,
      freeOnly: p.free,
      downloadableOnly: p.downloadable,
      response: res,
      tookMs: Date.now() - started,
    });
    return c.json(res);
  });

  app.get("/v1/assets/:id", async (c) => {
    const id = c.req.param("id");
    const asset = await service.getAsset(id);
    analytics.assetView({ ...who(c), provider: id.split(":")[0] ?? "", found: Boolean(asset) });
    if (!asset) return c.json({ error: "not found" }, 404);
    // A page for people: opens this asset on the website and unfurls with a preview card.
    return c.json({ ...asset, shareUrl: `${origin(c)}/search?asset=${encodeURIComponent(asset.id)}` });
  });

  app.get("/v1/assets/:id/files", async (c) => {
    const p = fileParams.parse(c.req.query());
    const asset = await service.getAsset(c.req.param("id"));
    if (!asset) return c.json({ error: "not found" }, 404);
    const files = selectFiles(asset, { format: p.format, resolution: p.resolution, mapTypes: p.maps, all: p.all });
    return c.json({ id: asset.id, license: asset.license, totalBytes: totalBytes(files), files });
  });

  /**
   * One-click download: redirects to the file when it's a single self-contained
   * file, otherwise streams a zip with the file and its companions.
   */
  app.get("/v1/assets/:id/download", async (c) => {
    const p = fileParams.parse(c.req.query());
    const asset = await service.getAsset(c.req.param("id"));
    if (!asset) return c.json({ error: "not found" }, 404);
    if (!asset.files.length) {
      return c.json({ error: "This asset has no direct downloads; get it from the source page.", url: asset.url }, 409);
    }
    const files = selectFiles(asset, { format: p.format, resolution: p.resolution, mapTypes: p.maps, all: p.all });
    if (!files.length) return c.json({ error: "No files match the requested format/resolution." }, 404);
    const only = files[0]!;
    if (files.length === 1 && !only.includes?.length) {
      assertPublicUrl(only.url);
      analytics.download({ ...who(c), provider: asset.provider, kind: "redirect" });
      return c.redirect(only.url, 302);
    }
    analytics.download({ ...who(c), provider: asset.provider, kind: "zip" });
    const folder = assetFolderName(asset);
    return new Response(zipStream(service.http, files, folder), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${folder}.zip"`,
      },
    });
  });

  // Opening the MCP URL in a browser leads to the setup guide instead of a JSON-RPC error.
  app.get("/mcp", async (c, next) => {
    const accept = c.req.header("accept") ?? "";
    if (accept.includes("text/html") && !accept.includes("text/event-stream")) return c.redirect("/docs/mcp", 302);
    await next();
  });

  // MCP over Streamable HTTP, stateless: a fresh server+transport per request.
  app.all("/mcp", async (c) => {
    const server = createMcpServer(service, {
      allowLocalDownload: opts.allowServerDownloads ?? false,
      downloadDir: opts.downloadDir,
      publicBaseUrl: opts.publicBaseUrl ?? new URL(c.req.url).origin,
      analytics,
      client: clientFamily(c.req.header("user-agent")),
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const res = await transport.handleRequest(c.req.raw);
    // Stateless: release the per-request server once the response is produced.
    void server.close().catch(() => undefined);
    return res;
  });

  // Share cards for search and asset links (static pages have pre-rendered /og/<page>.png files).
  const providerIds = service.listProviders().map((p) => p.id);
  const og = new OgImages(service, { site: new URL(opts.publicBaseUrl ?? "https://3d.shep.bot").host });
  const png = (c: Context, body: Buffer | null) =>
    body ? new Response(c.req.method === "HEAD" ? null : new Uint8Array(body), { headers: OG_HEADERS }) : c.json({ error: "not found" }, 404);
  app.on(["GET", "HEAD"], "/og/query.png", async (c) => png(c, await og.query(new URL(c.req.url).searchParams)));
  app.on(["GET", "HEAD"], "/og/asset.png", async (c) => {
    const id = shareableAssetId(c.req.query("id"), providerIds);
    return png(c, id ? await og.asset(id) : null);
  });

  /** Title, description and card for `/search?asset=<id>` share links (undefined if the asset can't be found quickly). */
  const assetShareMeta = async (c: Context): Promise<HeadMeta | undefined> => {
    const id = shareableAssetId(c.req.query("asset"), providerIds);
    if (!id) return undefined;
    const lookup = service.getAsset(id).catch(() => null);
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), SHARE_LOOKUP_MS).unref());
    const asset = await Promise.race([lookup, timeout]);
    return asset ? assetMeta(asset) : undefined;
  };

  // Everything else is the website (pages, /_astro assets, robots.txt, sitemap, llms.txt, ...).
  app.on(["GET", "HEAD"], "*", async (c) => {
    if (c.req.path.startsWith("/v1/")) return c.json({ error: "not found" }, 404);
    const alias = ALIASES[c.req.path.replace(/\/+$/, "").toLowerCase()];
    if (alias) return c.redirect(alias, 301);
    const pre = c.req.path.replace(/\/+$/, "") === "/search" ? await assetShareMeta(c) : undefined;
    return serveSite(c, c.req.path, pre) ?? c.json({ error: "not found" }, 404);
  });
  // Paths the router can't match (e.g. with encoded control characters) get the same 404 treatment.
  app.notFound((c) => (c.req.path.startsWith("/v1/") ? undefined : serveSite(c, c.req.path)) ?? c.json({ error: "not found" }, 404));

  return app;
}
