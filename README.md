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

| Source | Best for | Search | Direct download | Licence |
|---|---|---|---|---|
| [Poly Haven](https://polyhaven.com) | HDRIs, PBR textures, scanned models | API | ✅ glTF/blend/fbx, maps, HDR/EXR | CC0 |
| [ambientCG](https://ambientcg.com) | Realistic materials, HDRIs, models | API | ✅ per-resolution zips | CC0 |
| [CGBookcase](https://www.cgbookcase.com) | PBR textures | API (catalogue) | – (CDN hotlink protection; link to download page) | CC0 |
| [ShareTextures](https://www.sharetextures.com) | Textures and realistic models | API (tag search) | – (licence forbids automated downloads) | CC0 + site terms |
| [BlenderKit](https://www.blendkit.com) | Blender assets of every kind | API | ✅ free assets (GLB/blend); paid need `BLENDERKIT_API_KEY` | CC0 / royalty free |
| [Fab](https://www.fab.com) | Game assets, environments, characters | deep link (bot wall) | – | per listing |
| [Kenney](https://kenney.nl/assets) | Low-poly 3D, 2D, UI, audio packs | scrape | ✅ pack zips (auto-extracted) | CC0 |
| [Poliigon](https://www.poliigon.com) | Premium materials and models | deep link (bot wall) | – | per listing |
| [Quaternius](https://quaternius.com) | Low-poly and animated characters | scrape | – (Google Drive / itch.io links) | CC0 / QAL |
| [3DTextures.me](https://3dtextures.me) | Realistic and stylized PBR | WordPress API | – (Google Drive folders) | CC0 |
| [TextureCan](https://www.texturecan.com) | PBR materials and a few models | scrape | ✅ 1K–4K zips | CC0 |
| [Textures.com](https://www.textures.com) | Photo textures, 3D foliage, decals, skies | JSON API | – (credit system) | Textures.com licence |
| [HDRMaps](https://hdrmaps.com) | HDRIs and backplates | WooCommerce API | ✅ free HDRIs (EXR) | royalty free |
| [HDRI Hub](https://www.hdri-hub.com) | HDRI environments | scrape | – (checkout) | royalty free |
| [CGTrader](https://www.cgtrader.com/free-3d-models) | Free and paid models | JSON listing | – (login) | per listing |
| [TurboSquid](https://www.turbosquid.com) | Free and paid models | deep link (bot wall) | – | per listing |
| [itch.io](https://itch.io/game-assets) | Indie art, 3D packs, UI, audio | scrape | – (itch download flow) | per listing |

Sources without direct downloads still return full metadata and a link to the asset page. Fab,
Poliigon and TurboSquid block automated access, so they show up as deep links to their own search.
CGTrader uses an IP-based bot wall that often blocks cloud and datacenter IPs. From such hosts, run
behind a proxy (see `NODE_USE_ENV_PROXY` below); when blocked, CGTrader reports the error and its
search link.

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

## Search UI

`npm start`, then open <http://localhost:8787>. It's a single page served by the API: search every
source, filter by type, free only or direct download, and pick which sources to query. Open a result
to see its licence and details, choose a format and resolution, and download it. Multi-file assets
come as one zip. Sources that can't be searched automatically show up as links to their own search.
If `ASSET_SERVER_API_KEY` is set, the page asks for the key once and remembers it in the browser.

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
| `GET /` | Search UI in a browser; JSON endpoint index otherwise. |

```bash
curl 'localhost:8787/v1/search?q=brick+wall&type=material&free=true&limit=5'
curl -OJ 'localhost:8787/v1/assets/polyhaven:WoodenChair_01/download?format=gltf&resolution=1k'
```

## Configuration

| Variable | Default | |
|---|---|---|
| `PORT` / `HOST` | `8787` / `0.0.0.0` | HTTP bind |
| `ASSET_SERVER_API_KEY` | – | Require `Authorization: Bearer <key>`, `x-api-key` or `?api_key=` on `/v1/*` and `/mcp` |
| `ASSET_SERVER_PUBLIC_URL` | request origin | Base URL used in links handed to MCP clients |
| `ASSET_SERVER_PROVIDERS` | all | Comma list to enable only some sources |
| `ASSET_DOWNLOAD_DIR` | `./assets` | Default MCP download folder |
| `ASSET_SERVER_HTTP_DOWNLOADS` | `false` | Expose `download_asset` on the HTTP MCP endpoint (server-side disk) |
| `ASSET_SERVER_MAX_DOWNLOAD_BYTES` | 2 GiB | Per-download size guard |
| `ASSET_SERVER_PROVIDER_TIMEOUT_MS` | `12000` | Per-source search timeout |
| `ASSET_SERVER_CACHE_TTL_MS` | 10 min | In-memory HTTP cache TTL |
| `BLENDERKIT_API_KEY` | – | Optional BlenderKit key (unlocks plan/purchased assets) |
| `NODE_USE_ENV_PROXY` | – | Set to `1` so Node's `fetch` honours `HTTPS_PROXY` |

## How it works

```
src/
  core/        types, HTTP client (timeouts, cache, dedupe), ranking service, file selection & downloads
  providers/   one adapter per site (api / scrape / link)
  api/         Hono REST API + MCP Streamable HTTP mount
  mcp/         MCP tool definitions (shared by stdio and HTTP)
  ui/          the search page (static HTML/CSS/JS, no build step)
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
