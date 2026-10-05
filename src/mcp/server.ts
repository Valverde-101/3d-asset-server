import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  assetFolderName,
  downloadFiles,
  formatBytes,
  selectFiles,
  totalBytes,
} from "../core/download.js";
import { noopAnalytics, type Analytics } from "../core/analytics.js";
import { AssetService, errorMessage } from "../core/service.js";
import { ASSET_TYPES, type Asset, type AssetDetails, type AssetFile } from "../core/types.js";
import { compact } from "../core/util.js";

export interface McpOptions {
  /** Allow `download_asset` to write to the local filesystem (stdio / trusted local use). */
  allowLocalDownload: boolean;
  /** Default destination for downloads. */
  downloadDir?: string;
  /** Public base URL of the HTTP API, used to offer one-click zip bundle links. */
  publicBaseUrl?: string;
  /** Where tool calls are recorded (defaults to no-op). */
  analytics?: Analytics;
  /** Client family of the caller (from its User-Agent), for analytics only. */
  client?: string;
}

const VERSION = "0.1.0";

const typeEnum = z.enum(ASSET_TYPES);

export function createMcpServer(service: AssetService, opts: McpOptions): McpServer {
  const server = new McpServer(
    { name: "3d-asset-server", version: VERSION },
    {
      instructions: [
        "Search and download 3D models, PBR materials/textures, HDRIs and game asset packs from many sources",
        "(Poly Haven, ambientCG, Kenney, Quaternius, BlenderKit, CGTrader, itch.io, Textures.com, and more).",
        "Typical flow: search_assets -> get_asset (see formats/resolutions/licence) -> download_asset.",
        "Prefer CC0 sources for commercial projects; always report the licence and attribution requirement to the user.",
        "Results marked downloadable=false must be obtained from their `url` on the source site.",
      ].join(" "),
    },
  );

  const providerIds = service.listProviders().map((p) => p.id);
  const analytics = opts.analytics ?? noopAnalytics;
  const client = opts.client ?? "unknown";

  /** Wrap a tool handler so every call is counted and timed. */
  const timed =
    <A>(tool: string, handler: (args: A) => Promise<ToolResult>) =>
    async (args: A): Promise<ToolResult> => {
      const started = Date.now();
      let outcome: "ok" | "error" = "error";
      try {
        const res = await handler(args);
        outcome = res.isError ? "error" : "ok";
        return res;
      } finally {
        analytics.toolCall({ tool, client, outcome, tookMs: Date.now() - started });
      }
    };

  server.registerTool(
    "search_assets",
    {
      title: "Search 3D assets",
      description:
        "Search all configured asset sources at once for models, materials/textures, HDRIs, sprites, UI, audio and packs. " +
        "Tips: use short, concrete queries ('wooden crate', 'brick wall', 'sunset sky', 'low poly tree'); filter with `types`; " +
        "set `free_only` for free assets and `downloadable_only` for assets this server can fetch directly. " +
        "The response also lists deep links into sites that can't be searched automatically (e.g. Fab, Poliigon, TurboSquid).",
      inputSchema: {
        query: z.string().describe("What you are looking for, e.g. 'medieval barrel', 'mossy rock', 'night city hdri'."),
        types: z.array(typeEnum).optional().describe("Asset types to include. texture and material match each other."),
        providers: z
          .array(z.string())
          .optional()
          .describe(`Only search these sources. Available: ${providerIds.join(", ")}.`),
        free_only: z.boolean().optional().describe("Exclude paid assets."),
        downloadable_only: z.boolean().optional().describe("Only assets with direct file downloads via this server."),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 12)."),
        offset: z.number().int().min(0).optional().describe("Per-source offset for paging (e.g. 12 for page 2)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    timed("search_assets", async (args) => {
      try {
        const started = Date.now();
        const res = await service.search({
          query: args.query,
          types: args.types,
          providers: args.providers,
          freeOnly: args.free_only,
          downloadableOnly: args.downloadable_only,
          limit: args.limit ?? 12,
          offset: args.offset,
        });
        analytics.search({
          surface: "mcp",
          client,
          query: args.query,
          types: args.types,
          freeOnly: args.free_only,
          downloadableOnly: args.downloadable_only,
          response: res,
          tookMs: Date.now() - started,
        });
        const out = {
          query: res.query,
          results: res.results.map(summarizeAsset),
          sources: res.providers
            .filter((p) => p.status === "ok")
            .map((p) => `${p.provider}: ${p.count}${p.total !== undefined ? `/${p.total}` : ""}`)
            .join(", "),
          also_search_on: res.providers
            .filter((p) => p.status === "link" && p.searchUrl)
            .map((p) => ({ provider: p.name, url: p.searchUrl })),
          unavailable: res.providers
            .filter((p) => p.status === "error" || p.status === "timeout")
            .map((p) => ({ provider: p.provider, reason: p.error, url: p.searchUrl })),
        };
        return json(out);
      } catch (e) {
        return fail(e);
      }
    }),
  );

  server.registerTool(
    "get_asset",
    {
      title: "Get asset details and files",
      description:
        "Full details for an asset id from search_assets (e.g. 'polyhaven:ArmChair_01'): description, licence, " +
        "available formats and resolutions, and direct file URLs. Pass `format`/`resolution` to see exactly which " +
        "files download_asset would fetch.",
      inputSchema: {
        id: z.string().describe("Asset id in the form '<provider>:<id>'."),
        format: z.string().optional().describe("Preferred format or package: glb, gltf, fbx, blend, obj, usd, hdr, exr, jpg, png, zip."),
        resolution: z.string().optional().describe("Preferred resolution: 1k, 2k, 4k, 8k (closest available is used)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    timed("get_asset", async (args) => {
      try {
        const asset = await service.getAsset(args.id);
        analytics.assetView({ surface: "mcp", client, provider: args.id.split(":")[0] ?? "", found: Boolean(asset) });
        if (!asset) return fail(`Asset not found: ${args.id}`);
        const selected = asset.files.length ? selectFiles(asset, { format: args.format, resolution: args.resolution }) : [];
        const size = totalBytes(selected);
        return json({
          ...summarizeAsset(asset),
          description: asset.description,
          available: fileOptions(asset),
          selection: {
            format: args.format ?? "auto",
            resolution: args.resolution ?? "auto (2k)",
            totalSize: size !== undefined ? formatBytes(size) : undefined,
            files: selected.map(describeFile),
            bundleUrl:
              opts.publicBaseUrl && selected.length
                ? `${opts.publicBaseUrl.replace(/\/$/, "")}/v1/assets/${encodeURIComponent(asset.id)}/download${query({ format: args.format, resolution: args.resolution })}`
                : undefined,
          },
          note: asset.files.length
            ? undefined
            : "No direct files: download from the asset page on the source site.",
        });
      } catch (e) {
        return fail(e);
      }
    }),
  );

  if (opts.allowLocalDownload) {
    server.registerTool(
      "download_asset",
      {
        title: "Download asset files",
        description:
          "Download an asset's files to a local folder (default: the project's ./assets directory), keeping companion " +
          "files (glTF .bin/textures) in place. Archives can be extracted. Returns the written paths and licence. " +
          "Only works for assets with downloadable=true.",
        inputSchema: {
          id: z.string().describe("Asset id from search_assets, e.g. 'ambientcg:Wood049'."),
          dest_dir: z.string().optional().describe("Destination directory. A '<provider>-<id>' subfolder is created inside it."),
          format: z.string().optional().describe("Preferred format/package (glb, gltf, fbx, blend, hdr, exr, jpg, png, zip)."),
          resolution: z.string().optional().describe("Preferred resolution: 1k, 2k (default), 4k, 8k."),
          map_types: z
            .array(z.string())
            .optional()
            .describe("For texture-map sets only: e.g. ['diff','nor_gl','rough','ao','disp']."),
          extract: z.boolean().optional().describe("Extract .zip archives (default true)."),
          all_files: z.boolean().optional().describe("Download every file instead of the smart selection (can be huge)."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },
      timed("download_asset", async (args) => {
        try {
          const asset = await service.getAsset(args.id);
          if (!asset) return fail(`Asset not found: ${args.id}`);
          if (!asset.files.length) {
            return fail(`${asset.title} has no direct downloads. Get it from ${asset.url}`);
          }
          const files = selectFiles(asset, {
            format: args.format,
            resolution: args.resolution,
            mapTypes: args.map_types,
            all: args.all_files,
          });
          if (!files.length) {
            return fail(`No files match format=${args.format ?? "auto"}. Available: ${JSON.stringify(fileOptions(asset))}`);
          }
          const baseDir = resolve(args.dest_dir ?? opts.downloadDir ?? "assets");
          const dir = resolve(baseDir, assetFolderName(asset));
          const result = await downloadFiles(service.http, files, dir, { extract: args.extract ?? true });
          analytics.download({ surface: "mcp", client, provider: asset.provider, kind: "local" });
          return json({
            id: asset.id,
            title: asset.title,
            directory: result.directory,
            files: result.files,
            downloaded: formatBytes(result.bytes),
            license: asset.license,
            attribution: asset.license?.attributionRequired
              ? `Credit required: "${asset.title}" by ${asset.author ?? asset.provider} (${asset.url}), ${asset.license.name}`
              : undefined,
            source: asset.url,
          });
        } catch (e) {
          return fail(e);
        }
      }),
    );
  }

  server.registerTool(
    "list_providers",
    {
      title: "List asset sources",
      description: "List every asset source with what it is best for, asset types, pricing, licence and capabilities.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    timed("list_providers", async () =>
      json(
        service.listProviders().map((p) =>
          compact({
            id: p.id,
            name: p.name,
            bestFor: p.description,
            types: p.assetTypes,
            pricing: p.pricing,
            license: p.license?.name,
            search: p.access === "link" ? "deep link only" : p.access,
            downloads: p.supportsDownload,
            enabled: p.enabled ? undefined : `needs ${p.apiKeyEnv}`,
          }),
        ),
      ),
    ),
  );

  return server;
}

function summarizeAsset(a: Asset) {
  return compact({
    id: a.id,
    title: a.title,
    type: a.type,
    source: a.provider,
    url: a.url,
    thumbnail: a.thumbnailUrl,
    free: a.price ? a.price.free : undefined,
    price: a.price?.amount !== undefined ? `${a.price.amount} ${a.price.currency ?? ""}`.trim() : undefined,
    license: a.license?.name,
    author: a.author,
    formats: a.formats?.length ? a.formats : undefined,
    resolutions: a.resolutions?.length ? a.resolutions : undefined,
    polyCount: a.polyCount,
    animated: a.animated,
    rigged: a.rigged,
    downloadable: a.downloadable,
    tags: a.tags.length ? a.tags.slice(0, 10) : undefined,
    score: a.score,
  });
}

function fileOptions(asset: AssetDetails) {
  const formats = new Set<string>();
  const resolutions = new Set<string>();
  const packages = new Set<string>();
  for (const f of asset.files) {
    formats.add(f.format);
    if (f.resolution) resolutions.add(f.resolution);
    if (f.group) packages.add(f.group);
  }
  return compact({
    formats: [...formats],
    resolutions: [...resolutions],
    packages: packages.size ? [...packages] : undefined,
    fileCount: asset.files.length,
  });
}

function describeFile(f: AssetFile) {
  return compact({
    filename: f.filename,
    url: f.url,
    format: f.format,
    resolution: f.resolution,
    map: f.mapType,
    size: f.sizeBytes !== undefined ? formatBytes(f.sizeBytes) : undefined,
    companions: f.includes?.length,
  });
}

function query(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function json(value: unknown): ToolResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 1) }] };
}

function fail(e: unknown): ToolResult {
  return { isError: true, content: [{ type: "text" as const, text: typeof e === "string" ? e : errorMessage(e) }] };
}
