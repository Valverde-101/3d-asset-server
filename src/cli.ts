#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApp } from "./api/app.js";
import { AssetService } from "./core/service.js";
import { createMcpServer } from "./mcp/server.js";
import { allProviders } from "./providers/index.js";

const HELP = `3d-asset-server — search & download 3D assets from many sources

Usage:
  3d-asset-server serve   Start the HTTP API (+ MCP at /mcp)
  3d-asset-server mcp     Run the MCP server over stdio (for Claude Desktop/Code, Cursor, ...)
  3d-asset-server search <query> [--type model,hdri] [--free] [--limit N]

Environment:
  PORT                         HTTP port (default 8787)
  HOST                         Bind address (default 0.0.0.0)
  ASSET_SERVER_API_KEY         Require this key on /v1 and /mcp
  ASSET_SERVER_PUBLIC_URL      Public base URL used in links
  ASSET_SERVER_PROVIDERS       Comma list to enable a subset of providers
  ASSET_DOWNLOAD_DIR           Default folder for MCP downloads (default ./assets)
  ASSET_SERVER_HTTP_DOWNLOADS  "true" to expose download_asset on the HTTP MCP endpoint
  BLENDERKIT_API_KEY           Optional, enables BlenderKit downloads
`;

function buildService(): AssetService {
  const only = process.env.ASSET_SERVER_PROVIDERS?.split(",").map((s) => s.trim()).filter(Boolean);
  const providers = only?.length ? allProviders.filter((p) => only.includes(p.id)) : allProviders;
  return new AssetService({ providers });
}

async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "serve": {
      const service = buildService();
      const port = Number(process.env.PORT ?? 8787);
      const hostname = process.env.HOST ?? "0.0.0.0";
      const app = createApp(service, {
        apiKey: process.env.ASSET_SERVER_API_KEY,
        publicBaseUrl: process.env.ASSET_SERVER_PUBLIC_URL,
        allowServerDownloads: process.env.ASSET_SERVER_HTTP_DOWNLOADS === "true",
        downloadDir: process.env.ASSET_DOWNLOAD_DIR,
      });
      serve({ fetch: app.fetch, port, hostname }, (info) => {
        console.log(`3d-asset-server listening on http://${hostname}:${info.port} (MCP at /mcp)`);
      });
      return;
    }
    case "mcp": {
      const service = buildService();
      const server = createMcpServer(service, {
        allowLocalDownload: true,
        downloadDir: process.env.ASSET_DOWNLOAD_DIR,
        publicBaseUrl: process.env.ASSET_SERVER_PUBLIC_URL,
      });
      await server.connect(new StdioServerTransport());
      // stdout is the protocol channel; log to stderr only.
      console.error("3d-asset-server MCP running on stdio");
      return;
    }
    case "search": {
      const service = buildService();
      const flags = parseFlags(rest);
      const res = await service.search({
        query: flags.positional.join(" "),
        types: flags.type?.split(",") as never,
        providers: flags.providers?.split(","),
        freeOnly: flags.free !== undefined,
        limit: flags.limit ? Number(flags.limit) : 15,
      });
      for (const a of res.results) {
        const price = a.price ? (a.price.free ? "free" : a.price.amount ? `${a.price.amount} ${a.price.currency ?? ""}` : "paid") : "?";
        console.log(`${a.score?.toFixed(2)}  ${a.type.padEnd(8)} ${price.padEnd(6)} ${a.id}\n      ${a.title} — ${a.url}`);
      }
      console.log("\nSources:");
      for (const p of res.providers) {
        console.log(`  ${p.provider.padEnd(16)} ${p.status.padEnd(8)} ${p.count} ${p.error ?? ""} ${p.status === "link" ? p.searchUrl : ""}`);
      }
      return;
    }
    default:
      console.log(HELP);
      if (cmd && cmd !== "help" && cmd !== "--help") process.exitCode = 1;
  }
}

function parseFlags(args: string[]): { positional: string[] } & Record<string, string | undefined> {
  const out: { positional: string[] } & Record<string, string | undefined> = { positional: [] } as never;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else out[key] = "";
    } else out.positional.push(a);
  }
  return out;
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e);
  process.exit(1);
});
