import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { assertPublicUrl, assetFolderName, selectFiles, totalBytes, zipStream } from "../core/download.js";
import { HttpError } from "../core/http.js";
import {
  AssetService,
  InvalidAssetIdError,
  UnknownProviderError,
  UnsupportedError,
  errorMessage,
} from "../core/service.js";
import { ASSET_TYPES, type AssetType } from "../core/types.js";
import { createMcpServer } from "../mcp/server.js";
import { openApiSpec } from "./openapi.js";

export interface AppOptions {
  /** Require this key as `Authorization: Bearer <key>` or `x-api-key` on /v1 and /mcp. */
  apiKey?: string;
  /** Externally reachable base URL (for links handed to MCP clients). */
  publicBaseUrl?: string;
  /** Allow the MCP download tool to write to this server's disk. Off by default for HTTP. */
  allowServerDownloads?: boolean;
  downloadDir?: string;
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

export function createApp(service: AssetService, opts: AppOptions = {}): Hono {
  const app = new Hono();

  app.use("*", cors({ origin: "*", exposeHeaders: ["mcp-session-id"] }));

  if (opts.apiKey) {
    const key = opts.apiKey;
    const guard = async (c: Context, next: () => Promise<void>) => {
      const auth = c.req.header("authorization");
      const given = auth?.startsWith("Bearer ") ? auth.slice(7) : c.req.header("x-api-key");
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

  app.get("/", (c) =>
    c.json({
      name: "3d-asset-server",
      description: "Search and download 3D models, materials, textures, HDRIs and game assets across many sources.",
      endpoints: {
        providers: "/v1/providers",
        search: "/v1/search?q=wooden+chair&type=model&free=true",
        asset: "/v1/assets/{provider}:{id}",
        files: "/v1/assets/{provider}:{id}/files?format=gltf&resolution=2k",
        download: "/v1/assets/{provider}:{id}/download?format=gltf&resolution=2k",
        mcp: "/mcp (Streamable HTTP)",
        openapi: "/openapi.json",
      },
    }),
  );
  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/openapi.json", (c) => c.json(openApiSpec(opts.publicBaseUrl)));

  app.get("/v1/providers", (c) => c.json({ providers: service.listProviders() }));

  app.get("/v1/search", async (c) => {
    const p = searchParams.parse(c.req.query());
    const res = await service.search({
      query: p.q,
      types: p.type as AssetType[] | undefined,
      providers: p.providers,
      freeOnly: p.free,
      downloadableOnly: p.downloadable,
      limit: p.limit,
      offset: p.offset,
    });
    return c.json(res);
  });

  app.get("/v1/assets/:id", async (c) => {
    const asset = await service.getAsset(c.req.param("id"));
    if (!asset) return c.json({ error: "not found" }, 404);
    return c.json(asset);
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
      return c.redirect(only.url, 302);
    }
    const folder = assetFolderName(asset);
    return new Response(zipStream(service.http, files, folder), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${folder}.zip"`,
      },
    });
  });

  // MCP over Streamable HTTP, stateless: a fresh server+transport per request.
  app.all("/mcp", async (c) => {
    const server = createMcpServer(service, {
      allowLocalDownload: opts.allowServerDownloads ?? false,
      downloadDir: opts.downloadDir,
      publicBaseUrl: opts.publicBaseUrl ?? new URL(c.req.url).origin,
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

  return app;
}
