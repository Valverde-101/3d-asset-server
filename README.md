# 3d-asset-server

One search box for free and paid 3D assets: an **HTTP API** and an **MCP server** that search many
asset sites at once and download what you pick, ready to drop into a game or website.

> "I need a low-poly tree pack, a mossy rock material and a sunset HDRI for my Three.js scene."
> Your AI assistant calls `search_assets` three times, shows you the options with licences, and
> `download_asset` drops glTF/textures/HDRI files into your project's `assets/` folder.

- **One query, many sources.** Results are merged and ranked, with a status line for every source.
- **Real downloads.** For CC0/free sources you get files directly: glTF with its `.bin` and
  textures, PBR texture maps at the resolution you ask for, HDRIs, or zipped packs (extracted
  for you). The API can also stream a single zip bundle.
- **Licence first.** Every result has its licence, whether it is free, and whether attribution is
  required.
- **Honest about what's blocked.** Sites that block bots (Fab, Poliigon, TurboSquid) come back as
  deep search links, so you still know where else to look.

## Sources

<!-- PROVIDERS_TABLE -->

## Quick start

```bash
npm install
npm run build

# CLI search
node dist/cli.js search "low poly tree" --type model --free

# HTTP API + MCP (Streamable HTTP) on :8787
npm start

# MCP over stdio (for Claude Desktop / Claude Code / Cursor ...)
node dist/cli.js mcp
```

Or run it with Docker: `docker build -t 3d-asset-server . && docker run -p 8787:8787 3d-asset-server`.

## Use it from an AI assistant (MCP)

### Claude Code

```bash
claude mcp add 3d-assets -e ASSET_DOWNLOAD_DIR="$PWD/assets" -- node /path/to/3d-asset-server/dist/cli.js mcp
```

### Claude Desktop / Cursor / any MCP client (stdio)

```json
{
  "mcpServers": {
    "3d-assets": {
      "command": "node",
      "args": ["/path/to/3d-asset-server/dist/cli.js", "mcp"],
      "env": { "ASSET_DOWNLOAD_DIR": "/path/to/your/game/assets" }
    }
  }
}
```

### Remote (Streamable HTTP)

Point the client at `http://<host>:8787/mcp` (send `Authorization: Bearer <key>` if you set
`ASSET_SERVER_API_KEY`). Over HTTP, `download_asset` is off by default, because it would write to
the server's disk rather than yours. Instead, `get_asset` returns direct file URLs and a one-click
`bundleUrl` zip.

### Tools

| Tool | What it does |
|---|---|
| `search_assets` | `query`, optional `types` (model, texture, material, hdri, sprite, ui, audio, font, pack), `providers`, `free_only`, `downloadable_only`, `limit`, `offset`. Returns ranked results plus `also_search_on` deep links and any sources that failed. |
| `get_asset` | Details for an id such as `polyhaven:ArmChair_01`: description, licence, available formats and resolutions, and exactly which files a download would fetch for a given `format`/`resolution`. |
| `download_asset` | Downloads into `<dest_dir>/<provider>-<id>/` (default `./assets`), keeping companion files in place and extracting zips. Picks web/game-friendly defaults (glTF/GLB for models, HDR for HDRIs, JPG maps for materials, at 2k) unless you pass `format`/`resolution`/`map_types`. |
| `list_providers` | Every source: what it's best for, types, pricing, licence, and whether it supports direct downloads. |

## HTTP API

| Endpoint | |
|---|---|
| `GET /v1/search?q=&type=&providers=&free=&downloadable=&limit=&offset=` | Ranked, merged results + a per-provider report (`ok`, `error`, `timeout`, `skipped`, `link`). |
| `GET /v1/providers` | Source catalogue. |
| `GET /v1/assets/{provider}:{id}` | Full details incl. every file. |
| `GET /v1/assets/{id}/files?format=&resolution=&maps=&all=` | The smart file selection. |
| `GET /v1/assets/{id}/download?format=&resolution=` | `302` to the file when it is a single file; otherwise a streamed zip with companions. |
| `POST /mcp` | MCP Streamable HTTP endpoint (stateless). |
| `GET /openapi.json` | OpenAPI 3.1 description. |

```bash
curl 'localhost:8787/v1/search?q=brick+wall&type=material&free=true&limit=5'
curl -OJ 'localhost:8787/v1/assets/polyhaven:WoodenChair_01/download?format=gltf&resolution=1k'
```

## Configuration

| Variable | Default | |
|---|---|---|
| `PORT` / `HOST` | `8787` / `0.0.0.0` | HTTP bind |
| `ASSET_SERVER_API_KEY` | – | Require `Authorization: Bearer <key>` or `x-api-key` on `/v1/*` and `/mcp` |
| `ASSET_SERVER_PUBLIC_URL` | request origin | Base URL used in links handed to MCP clients |
| `ASSET_SERVER_PROVIDERS` | all | Comma list to enable only some sources |
| `ASSET_DOWNLOAD_DIR` | `./assets` | Default MCP download folder |
| `ASSET_SERVER_HTTP_DOWNLOADS` | `false` | Expose `download_asset` on the HTTP MCP endpoint (server-side disk) |
| `ASSET_SERVER_MAX_DOWNLOAD_BYTES` | 2 GiB | Per-download size guard |
| `ASSET_SERVER_PROVIDER_TIMEOUT_MS` | `12000` | Per-source search timeout |
| `ASSET_SERVER_CACHE_TTL_MS` | 10 min | In-memory HTTP cache TTL |
| `BLENDERKIT_API_KEY` | – | Optional BlenderKit key |

## How it works

```
src/
  core/        types, HTTP client (timeouts, cache, dedupe), ranking service, file selection & downloads
  providers/   one adapter per site (api / scrape / link)
  api/         Hono REST API + MCP Streamable HTTP mount
  mcp/         MCP tool definitions (shared by stdio and HTTP)
  cli.ts       serve | mcp | search
```

Each search fans out to every relevant provider in parallel, each with its own timeout. A slow or
broken site never fails the whole search; it shows up in the per-provider report instead. Results
are ranked by text relevance (title > tags > description), then the source's own ranking, then
small boosts for free and directly downloadable assets. A diversity penalty keeps one big catalogue
from filling the first page. Providers that ship a whole catalogue (Poly Haven, Kenney, Quaternius,
…) are fetched once, cached, and filtered locally.

Adding a source: see [docs/PROVIDERS_GUIDE.md](docs/PROVIDERS_GUIDE.md).

## Development

```bash
npm test            # offline tests (fixtures)
npm run test:live   # live smoke tests against the real sites
npm run typecheck
npm run dev         # watch mode server
```

## Licences & etiquette

This server only finds and fetches assets. Each asset keeps its own licence, which is shown on
every result; respect it, and credit authors when required. Scraped sources are queried gently:
cached, a few requests per search, with an identifying User-Agent. Paid and login-gated content is
never bypassed; those results link to the source site.
