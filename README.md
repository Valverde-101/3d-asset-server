```
       +------------+
      /            /|      _____ ____       _                 _
     /            / |     |___ /|  _ \     / \   ___ ___  ___| |_
    +------------+  |       |_ \| | | |   / _ \ / __/ __|/ _ \ __|
    |            |  |      ___) | |_| |  / ___ \\__ \__ \  __/ |_
    |            |  +     |____/|____/  /_/   \_\___/___/\___|\__|
    |            | /       ____
    |            |/       / ___|  ___ _ ____   _____ _ __
    +------------+        \___ \ / _ \ '__\ \ / / _ \ '__|
                           ___) |  __/ |   \ V /  __/ |
                          |____/ \___|_|    \_/ \___|_|

        one search box for 3D models, materials, textures, HDRIs & game assets
                         HTTP API  *  MCP server  *  web UI  *  CLI
```

**3d-asset-server** searches 17 asset sites at once and downloads what you pick, ready to drop
into a game or a website. Use it from a browser, from `curl`, from the command line, or let your AI
assistant drive it over MCP.

> *"I need a low-poly tree pack, a mossy rock material and a sunset HDRI for my Three.js scene."*
>
> Your assistant calls `search_assets` three times, shows you the options with their licences, and
> `download_asset` puts glTF, textures and the HDRI into your project's `assets/` folder.

- **One query, many sources.** Results are merged and ranked, with a status line for every site.
- **Real downloads.** From free sources you get files directly: glTF with its `.bin` and textures,
  PBR maps at the resolution you ask for, HDRIs, or zipped packs (extracted for you).
- **Licence first.** Every result says what licence it has, whether it is free, and whether you
  must credit the author.
- **Honest about what's blocked.** Sites that block bots come back as links to their own search,
  so you still know where else to look.

---

## Contents

- [How it works](#how-it-works)
- [Sources](#sources)
- [Quick start](#quick-start)
- [Web UI](#web-ui) (and [for AI agents](#for-ai-agents))
- [MCP: use it from an AI assistant](#mcp-use-it-from-an-ai-assistant)
- [HTTP API](#http-api)
- [CLI](#cli)
- [Downloads](#downloads)
- [Configuration](#configuration)
- [Project layout](#project-layout)
- [Development](#development)
- [Licences & etiquette](#licences--etiquette)

---

## How it works

```
   +-----------+   +-----------+   +-----------+   +-----------+
   |  Web UI   |   |   curl /  |   |  Claude,  |   |    CLI    |
   | (browser) |   |  your app |   |  Cursor.. |   |           |
   +-----+-----+   +-----+-----+   +-----+-----+   +-----+-----+
         |               |               |               |
         |   GET /       |  /v1/*        | MCP           | search
         |               |               | stdio or /mcp |
         v               v               v               v
   +-----------------------------------------------------------+
   |                      3d-asset-server                      |
   |                                                           |
   |   +-----------------+   +-------------------------------+ |
   |   |  REST API (Hono)|   |  MCP tools                    | |
   |   |  /v1/search     |   |  search_assets   get_asset    | |
   |   |  /v1/assets/..  |   |  download_asset  list_provid..| |
   |   +--------+--------+   +---------------+---------------+ |
   |            |                            |                 |
   |            +-------------+--------------+                 |
   |                          v                                |
   |   +-------------------------------------------------------+
   |   |  AssetService                                         |
   |   |   fan-out --> per-site timeout --> rank --> dedupe    |
   |   +-------------------------------------------------------+
   |                          |                                |
   |   +----------------------+--------------------------------+
   |   |  HTTP client: User-Agent, timeouts, LRU cache,        |
   |   |  in-flight request dedupe                             |
   |   +-------------------------------------------------------+
   +-----------------------------+-----------------------------+
                                 |
         +-------------+---------+---------+-------------+
         v             v                   v             v
   +-----------+ +-----------+       +-----------+ +-----------+
   | API       | | scrape    |  ...  | scrape    | | link-only |
   | Poly Haven| | Kenney    |       | itch.io   | | Fab       |
   | ambientCG | | TextureCan|       | HDRI Hub  | | Poliigon  |
   | BlenderKit| | Quaternius|       | ...       | | TurboSquid|
   +-----------+ +-----------+       +-----------+ +-----------+
```

What a single search does:

```
  "sunset" type=hdri free=true
           |
           v
  +------------------+   skip sites that don't carry HDRIs, or are paid-only
  |   pick sources   |-----------------------------------------------------+
  +--------+---------+                                                     |
           |  in parallel, each with its own timeout (default 12s)         |
     +-----+------+------------+------------+------------+                 |
     v            v            v            v            v                 v
  Poly Haven   ambientCG   BlenderKit    HDRMaps     Poliigon        cgbookcase,
   ok 24        ok 24        ok 24        ok 12      link ->         kenney, ...
     |            |            |            |            |            skipped
     +------------+-----+------+------------+            |
                        v                                 |
  +---------------------------------------------+         |
  | rank:  60% text match (title > tags > desc) |         |
  |        20% the site's own ranking           |         |
  |        10% API > scrape                     |         |
  |        +free  +direct download              |         |
  |        diversity penalty per site           |         |
  +---------------------+-----------------------+         |
                        v                                 v
           results[]  +  per-site report (ok / error / timeout / skipped / link)
```

A slow or broken site never fails the search. It shows up in the per-site report with its error
and a link to the same search on that site.

---

## Sources

| Source | Best for | Search | Direct download | Licence |
|---|---|---|---|---|
| [Poly Haven](https://polyhaven.com) | HDRIs, PBR textures, scanned models | API | yes: glTF / blend / fbx, maps, HDR / EXR | CC0 |
| [ambientCG](https://ambientcg.com) | Realistic materials, HDRIs, models | API | yes: per-resolution zips | CC0 |
| [CGBookcase](https://www.cgbookcase.com) | PBR textures | API (catalogue) | no: hotlink-protected CDN, links to the download page | CC0 |
| [ShareTextures](https://www.sharetextures.com) | Textures and realistic models | API (tag search) | no: its licence forbids automated downloads | CC0 + site terms |
| [BlenderKit](https://www.blendkit.com) | Blender assets of every kind | API | yes for free assets (GLB / blend); paid ones need `BLENDERKIT_API_KEY` | CC0 / royalty free |
| [Fab](https://www.fab.com) | Game assets, environments, characters | link only (bot wall) | no | per listing |
| [Kenney](https://kenney.nl/assets) | Low-poly 3D, 2D, UI and audio packs | scrape | yes: pack zips, auto-extracted | CC0 |
| [Poliigon](https://www.poliigon.com) | Premium materials and models | link only (bot wall) | no | per listing |
| [Quaternius](https://quaternius.com) | Low-poly models, animated characters | scrape | no: Google Drive / itch.io links | CC0 / QAL |
| [3DTextures.me](https://3dtextures.me) | Realistic and stylized PBR | WordPress API | no: Google Drive folders | CC0 |
| [TextureCan](https://www.texturecan.com) | PBR materials and a few models | scrape | yes: 1K-4K zips | CC0 |
| [Textures.com](https://www.textures.com) | Photo textures, 3D foliage, decals, skies | JSON API | no: credit system | Textures.com licence |
| [HDRMaps](https://hdrmaps.com) | HDRIs and backplates | WooCommerce API | yes for free HDRIs (EXR) | royalty free |
| [HDRI Hub](https://www.hdri-hub.com) | HDRI environments | scrape | no: checkout | royalty free |
| [CGTrader](https://www.cgtrader.com/free-3d-models) | Free and paid models | JSON listing | no: login | per listing |
| [TurboSquid](https://www.turbosquid.com) | Free and paid models | link only (bot wall) | no | per listing |
| [itch.io](https://itch.io/game-assets) | Indie art, 3D packs, UI, audio | scrape | no: itch's download flow | per listing |

```
  search + direct download    Poly Haven, ambientCG, BlenderKit (free), Kenney,
                              TextureCan, HDRMaps (free)

  search + link to the page   CGBookcase, ShareTextures, Quaternius, 3DTextures.me,
                              Textures.com, HDRI Hub, CGTrader, itch.io

  link to the site's search   Fab, Poliigon, TurboSquid
```

Notes:

- Results without direct downloads still have full metadata and a link to the asset page.
- **CGTrader** sits behind an IP-based bot wall that often blocks cloud and datacenter IPs. It works
  from home connections. On a server, run behind a proxy with `NODE_USE_ENV_PROXY=1`. When it is
  blocked, the report says so and links to CGTrader's own search.
- Scraped sites can change their HTML. If one breaks, only that source shows as failed; the others
  keep working. `npm run test:live` checks every site.

---

## Quick start

Needs Node.js 20 or newer.

```bash
git clone https://github.com/arielshad/3d-asset-server.git
cd 3d-asset-server
npm install
npm run build

npm start                    # web UI + HTTP API + MCP on http://localhost:8787
node dist/cli.js mcp         # MCP over stdio, for Claude Desktop / Claude Code / Cursor
node dist/cli.js search "low poly tree" --type model --free
```

With Docker:

```bash
docker build -t 3d-asset-server .
docker run -p 8787:8787 3d-asset-server
```

---

## Web UI

Live at **<https://3d.shep.bot>**, or run `npm start` and open <http://localhost:8787>.

The website lives in [`web/`](web/): Astro with React islands, Tailwind CSS 4, shadcn/ui and Magic UI
components. Every page is pre-rendered HTML, so search engines and AI crawlers see the full content;
only the interactive parts hydrate.

| Page | What it is |
|---|---|
| `/` | Landing page: hero search, sources, agent setup, FAQ |
| `/search` | The search app: type chips, free/direct-download switches, source picker, per-site status, detail sheet with format/resolution picker, download, curl and agent snippets |
| `/docs` | Quick start |
| `/docs/mcp` | Setup for Claude Code, Cursor, VS Code, Windsurf, Codex CLI, Gemini CLI, the Claude apps and any stdio client |
| `/docs/api` | REST API guide with curl, JavaScript and Python examples |
| `/docs/api/reference` | Interactive OpenAPI reference ([Scalar](https://scalar.com), self-hosted) |
| `/docs/sources` | All sources with licences, generated from the provider registry |
| `/docs/self-hosting` | Docker, Node, configuration, metrics |

- **Search state in the URL.** `/search?q=sunset&type=hdri&free=true` can be bookmarked or shared.
- **Detail sheet.** Licence, author, formats, polygon count and tags; pick a format and resolution to see
  exactly which files you'll get and their size; download the file or one zip; copy a curl command or a
  prompt for your agent.
- **API key.** If `ASSET_SERVER_API_KEY` is set, the page asks for the key once and remembers it.

### For AI agents

Point an agent at `https://3d.shep.bot` and it finds its way:

| URL | For |
|---|---|
| `/AGENTS.md` | The agent guide: MCP setup, REST workflow, licensing rules, an example |
| `/llms.txt`, `/llms-full.txt` | [llms.txt](https://llmstxt.org) index and every guide in one file |
| `/docs/*.md` | Markdown twin of every docs page |
| `/skill/SKILL.md` | A Claude Code skill (`~/.claude/skills/3d-assets/SKILL.md`) |
| `/openapi.json` | OpenAPI 3.1 |

Requests with `Accept: text/markdown` get markdown instead of HTML (`/` → `/AGENTS.md`, sent with
`Vary: Accept`), unknown paths answer agents with a Markdown 404 that links to the docs, `llms.txt` and
the sitemap, every page advertises its twin with `Link: <…>; rel="alternate"; type="text/markdown"`,
and `curl https://3d.shep.bot` returns a JSON index that points at all of the above. `/about`,
`/contact` and `/privacy` describe who runs the service and what it records; `/docs/api/versioning`
is the versioning, deprecation and rate-limit policy.

---

## MCP: use it from an AI assistant

```
  you: "find me a free sci-fi crate model and put it in the project"
   |
   v
  assistant --search_assets("sci-fi crate", types=[model], free_only)--> ranked results
   |
   +--------get_asset("polyhaven:...", format="gltf")-----------------> formats, licence,
   |                                                                     files, size
   +--------download_asset("polyhaven:...", resolution="2k")----------> ./assets/polyhaven-.../
   |
   v
  "Done: CC0, no credit needed. Saved to assets/polyhaven-.../crate_2k.gltf"
```

### Claude Code

```bash
claude mcp add 3d-assets -e ASSET_DOWNLOAD_DIR="$PWD/assets" -- node /path/to/3d-asset-server/dist/cli.js mcp
```

### Claude Desktop, Cursor, or any stdio MCP client

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

The public server needs no setup or key:

```bash
claude mcp add --transport http 3d-assets https://3d.shep.bot/mcp
```

Other clients: see <https://3d.shep.bot/docs/mcp>. For your own server, point the client at
`http://<host>:8787/mcp`. If you set `ASSET_SERVER_API_KEY`, send
`Authorization: Bearer <key>`.

Over HTTP, `download_asset` is off by default because it would write to the server's disk, not
yours. Instead, `get_asset` returns direct file URLs plus a one-click `bundleUrl` zip. Set
`ASSET_SERVER_HTTP_DOWNLOADS=true` if the server and the files should live on the same machine.

### Tools

| Tool | What it does |
|---|---|
| `search_assets` | `query`, plus optional `types` (model, texture, material, hdri, sprite, ui, audio, font, pack), `providers`, `free_only`, `downloadable_only`, `limit`, `offset`. Returns ranked results, `also_search_on` links for link-only sites, and any sites that failed. |
| `get_asset` | Details for an id such as `polyhaven:ArmChair_01`: description, licence, available formats and resolutions, and exactly which files a download would fetch for a given `format` / `resolution`. |
| `download_asset` | Saves into `<dest_dir>/<provider>-<id>/` (default `./assets`), keeps companion files in place and extracts zips. Returns the paths, licence and an attribution line when credit is required. |
| `list_providers` | Every source: what it's best for, asset types, pricing, licence, and whether it supports direct downloads. |

---

## HTTP API

| Endpoint | |
|---|---|
| `GET /v1/search?q=&type=&providers=&free=&downloadable=&limit=&offset=` | Ranked, merged results plus a per-site report (`ok`, `error`, `timeout`, `skipped`, `link`). |
| `GET /v1/providers` | The source catalogue. |
| `GET /og/query.png?q=&type=&free=` · `GET /og/asset.png?id=` | 1200×630 share cards for search and asset links (see below). |
| `GET /v1/stats` | Usage totals (searches by surface, downloads, MCP tool calls, top clients and asset types) and per-source health (success rate, p50/p95 latency). Shown on [/stats](https://3d.shep.bot/stats). |
| `GET /v1/assets/{provider}:{id}` | Full details, including every file. |
| `GET /v1/assets/{id}/files?format=&resolution=&maps=&all=` | The files a download would fetch. |
| `GET /v1/assets/{id}/download?format=&resolution=` | `302` to the file when it is one self-contained file; otherwise a streamed zip with its companions. |
| `POST /mcp` | MCP endpoint (Streamable HTTP, stateless). |
| `GET /openapi.json` | OpenAPI 3.1 description. |
| `GET /` | Web UI in a browser; a JSON index of endpoints for API clients. |
| `GET /health` | Liveness check. |

```bash
curl 'localhost:8787/v1/search?q=brick+wall&type=material&free=true&limit=5'
curl -OJ 'localhost:8787/v1/assets/polyhaven:WoodenChair_01/download?format=gltf&resolution=1k'
```

Search response (shortened):

```json
{
  "query": "brick wall",
  "results": [
    {
      "id": "polyhaven:brick_wall_001",
      "title": "Brick Wall 001",
      "type": "material",
      "url": "https://polyhaven.com/a/brick_wall_001",
      "license": { "name": "CC0", "commercialUse": true, "attributionRequired": false },
      "price": { "free": true },
      "resolutions": ["1k", "2k", "4k", "8k"],
      "downloadable": true,
      "score": 1
    }
  ],
  "providers": [
    { "provider": "polyhaven", "status": "ok", "count": 5, "tookMs": 210 },
    { "provider": "fab", "status": "link", "searchUrl": "https://www.fab.com/search?q=brick+wall&is_free=1" }
  ]
}
```

---

## CLI

```
$ node dist/cli.js search "low poly tree" --type model --free --limit 5

1.00  model    free   blenderkit:72fac4cb-901c-4a48-8fc8-84a0baa0bd21
      Low poly tree — https://www.blendkit.com/asset-gallery-detail/72fac4cb-.../
0.93  model    free   cgtrader:lowpoly-tree-collection-01-200-trees-lowpoly-collection
      Low Poly Trees Mega Pack - 200 Trees — https://www.cgtrader.com/free-3d-models/...
0.93  model    free   itchio:brokenvector/low-poly-tree-pack
      Low Poly Tree Pack — https://brokenvector.itch.io/low-poly-tree-pack
0.91  model    free   blenderkit:346d99d8-36fb-4f9d-a4a1-2f9ad9233e79
      Low poly tree — https://www.blendkit.com/asset-gallery-detail/346d99d8-.../
0.84  model    free   itchio:mark-auman/low-poly-trees-asset-pack
      Low-Poly Trees Asset Pack — https://mark-auman.itch.io/low-poly-trees-asset-pack

Sources:
  polyhaven        ok       1
  blenderkit       ok       5
  fab              link     0  https://www.fab.com/search?q=low+poly+tree&is_free=1
  kenney           ok       2
  quaternius       ok       5
  cgtrader         ok       5
  turbosquid       link     0  https://www.turbosquid.com/Search/3D-Models/free/low-poly-tree
  itchio           ok       5
  ...
```

```
3d-asset-server serve                    HTTP API + web UI + MCP at /mcp
3d-asset-server mcp                      MCP over stdio
3d-asset-server search <query> [--type model,hdri] [--providers a,b] [--free] [--limit N]
```

---

## Downloads

Unless you say otherwise, a download picks game- and web-friendly files:

```
  asset type   preferred format, in order          resolution
  ----------   ---------------------------------   --------------------------
  model        glb > gltf > fbx > obj > blend      closest to 2k
  hdri         hdr > exr                           closest to 2k
  material     jpg maps > png maps > zip           closest to 2k
  texture      jpg > png > zip > exr               closest to 2k
  packs        zip (extracted)                     -
```

Companion files keep their relative paths, so a glTF loads straight away:

```
  assets/
  `-- polyhaven-WoodenChair_01/
      |-- WoodenChair_01_2k.gltf
      |-- WoodenChair_01.bin
      `-- textures/
          |-- WoodenChair_01_diff_2k.jpg
          |-- WoodenChair_01_nor_gl_2k.jpg
          `-- WoodenChair_01_arm_2k.jpg

  assets/
  `-- kenney-nature-kit/              <- zip downloaded and extracted
      `-- kenney_nature-kit/
          |-- Models/GLTF format/...
          `-- License.txt
```

Safety:

- Only `http(s)` URLs to public hosts are fetched. Private and loopback addresses are refused.
- Paths that try to escape the target folder (zip-slip, `../`) are rejected or skipped.
- Each download has a size guard (`ASSET_SERVER_MAX_DOWNLOAD_BYTES`, default 2 GiB).
- Login, checkout and hotlink protection are never bypassed.

---

## Configuration

| Variable | Default | |
|---|---|---|
| `PORT` / `HOST` | `8787` / `0.0.0.0` | HTTP bind address |
| `ASSET_SERVER_API_KEY` | – | Require `Authorization: Bearer <key>`, `x-api-key` or `?api_key=` on `/v1/*` and `/mcp` |
| `ASSET_SERVER_PUBLIC_URL` | request origin | Base URL used in links handed to MCP clients |
| `ASSET_SERVER_PROVIDERS` | all | Comma list to enable only some sources, e.g. `polyhaven,ambientcg,kenney` |
| `ASSET_DOWNLOAD_DIR` | `./assets` | Default download folder for MCP |
| `ASSET_SERVER_HTTP_DOWNLOADS` | `false` | Expose `download_asset` on the HTTP MCP endpoint (writes to the server's disk) |
| `ASSET_SERVER_MAX_DOWNLOAD_BYTES` | 2 GiB | Per-download size guard |
| `ASSET_SERVER_PROVIDER_TIMEOUT_MS` | `12000` | Per-site search timeout |
| `ASSET_SERVER_HTTP_TIMEOUT_MS` | `15000` | Per-request HTTP timeout |
| `ASSET_SERVER_CACHE_TTL_MS` | 10 min | In-memory HTTP cache TTL |
| `ASSET_SERVER_USER_AGENT` | `3d-asset-server/0.1` | User-Agent sent to the sites |
| `BLENDERKIT_API_KEY` | – | Optional; unlocks plan and purchased BlenderKit assets |
| `NODE_USE_ENV_PROXY` | – | Set to `1` so Node's `fetch` uses `HTTPS_PROXY` |
| `ASSET_SERVER_RATE_LIMIT` | `120` | Requests per client per window on `/v1/*` and `/mcp`; responses carry `RateLimit-Policy` / `RateLimit` (+ `RateLimit-Limit/Remaining/Reset`), and `429` adds `Retry-After`. `0` = off |
| `ASSET_SERVER_RATE_LIMIT_WINDOW` | `60` | Rate-limit window in seconds |
| `METRICS_PORT` | – | Serve Prometheus metrics on this port at `/metrics` and log one JSON line per search, download and MCP tool call (see below) |
| `PROMETHEUS_URL` | – | Prometheus that scrapes `METRICS_PORT`. `/v1/stats` (and the `/stats` page) then report the last 24 hours and 7 days across replicas; without it they count this process since it started |

> If you set `ASSET_SERVER_API_KEY` on a public server, note that `?api_key=` (used by the web UI's
> download button) can end up in browser history and server logs.

### Analytics

With `METRICS_PORT` set ([`src/core/analytics.ts`](src/core/analytics.ts)), metrics are served on that
separate port (never on the public listener), with bounded labels only:

| Metric | Labels |
|---|---|
| `asset_server_searches_total` | surface (`web`, `api`, `mcp`), client family, type, free_only, has_results |
| `asset_server_search_duration_seconds`, `asset_server_search_results` | surface |
| `asset_server_provider_requests_total`, `asset_server_provider_duration_seconds` | provider, status |
| `asset_server_downloads_total`, `asset_server_asset_views_total` | surface, client, provider |
| `asset_server_mcp_tool_calls_total`, `asset_server_mcp_tool_duration_seconds` | tool, client (claude-code, cursor, vscode, …) |
| `asset_server_http_requests_total`, `asset_server_page_views_total` | route / page |

Each search also logs `{"event":"search","query":…,"results":…,"surface":…}` to stdout for top-query and
zero-result analysis in a log store. No IPs, keys or cookies are recorded. In the shep.bot cluster a
ServiceMonitor ([`deploy/servicemonitor.yaml`](deploy/servicemonitor.yaml)) feeds Prometheus, Loki
collects the event lines, and the *3D Asset Server* Grafana dashboard shows both.

The public [/stats](https://3d.shep.bot/stats) page reads the same counters back through `GET /v1/stats`
([`src/core/stats.ts`](src/core/stats.ts)): from Prometheus when `PROMETHEUS_URL` is set (cached for a
minute), otherwise from in-process tallies since the last restart. It shows aggregate counts only.

### Share previews (Open Graph)

Every page has its own 1200×630 card (`og:image` = `/og/<page>.png`), rendered at build time by
[`web/integrations/og-images.mjs`](web/integrations/og-images.mjs) from the page's title and
description, with matching `og:image:alt`, `twitter:*` tags and a `primaryImageOfPage` ImageObject in
the JSON-LD. Share links get cards rendered on request ([`src/og/render.ts`](src/og/render.ts): satori +
resvg, Geist font; [`src/api/og.ts`](src/api/og.ts): LRU cache, two renders at a time, rate-limited):

- `/search?q=brick+wall&type=material`: title, description, `og:url` and a card for the query
  (`/og/query.png?…`).
- `/search?asset=polyhaven:ArmChair_01`: opens that asset in the search app (the detail panel's
  **Share** button copies this link) and unfurls with the asset's title, licence, formats and thumbnail
  (`/og/asset.png?id=…`; the thumbnail is fetched from public hosts only and re-encoded with sharp).

### Daily source discovery

[`.github/workflows/discover-integrations.yml`](.github/workflows/discover-integrations.yml) runs once a
day (and on demand from the Actions tab):

1. A Claude Code agent follows [`prompts/discover-integrations.md`](prompts/discover-integrations.md). It
   searches the web for 3D asset sites that are not yet in
   [`integrations/registry.json`](integrations/registry.json), checks their robots.txt and terms,
   integrates the best one as a provider with offline and live tests, and records the others as
   rejected with a reason. It works in a read-only checkout and hands over a patch.
2. A separate job without Claude credentials applies the patch and gates it
   ([`scripts/integration-gate.mjs`](scripts/integration-gate.mjs)):
   - only provider, test, fixture, registry and docs files may change;
   - nothing may be deleted, and existing tests may not be edited;
   - at most one new source per run.

   It then runs the build, typecheck, the full test suite and the new source's live test.
3. If everything passes, it commits to `main` and dispatches CI, which builds the image and pins it in
   `deploy/`, so ArgoCD rolls the new source out to 3d.shep.bot. If a check fails, the site is recorded
   as rejected with a 30-day recheck instead.

It needs one repository secret: `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) or
`ANTHROPIC_API_KEY`.

---

## Project layout

```
src/
|-- cli.ts               serve | mcp | search
|-- index.ts             library exports
|-- core/
|   |-- types.ts         Asset, AssetFile, Provider, SearchQuery ...
|   |-- http.ts          fetch wrapper: UA, timeouts, LRU cache, in-flight dedupe
|   |-- service.ts       fan-out search, ranking, per-site reports
|   |-- download.ts      file selection, safe downloads, zip extraction, zip streaming
|   `-- util.ts          matching/scoring, type inference, helpers
|-- providers/           one adapter per site, plus index.ts (the registry)
|   |-- polyhaven.ts  ambientcg.ts  blenderkit.ts  kenney.ts  quaternius.ts
|   |-- itchio.ts  cgtrader.ts  texturescom.ts  threedtextures.ts  hdrmaps.ts
|   |-- sharetextures.ts  cgbookcase.ts  texturecan.ts  hdrihub.ts
|   `-- linked.ts        Fab, Poliigon, TurboSquid (link-only)
|-- api/
|   |-- app.ts           Hono REST API, website, MCP Streamable HTTP mount, request metrics
|   |-- site.ts          serves the pre-rendered site: caching, 404, markdown twins for agents
|   `-- openapi.ts       OpenAPI 3.1 with full schemas (rendered at /docs/api/reference)
|-- core/analytics.ts    Prometheus metrics + JSON event log
|-- core/stats.ts        /v1/stats: Prometheus queries or in-process tallies
`-- mcp/
    `-- server.ts        MCP tool definitions (shared by stdio and HTTP)
web/                     the website (Astro + React + Tailwind + shadcn/ui)
|-- src/pages/           index, search, stats, docs (markdown), sources, API reference, 404
|-- src/components/      ui/ (shadcn + Magic UI), search/ (the search app), home/
|-- src/content/         AGENTS.md and the Claude Code skill
|-- src/lib/             site constants, schema.org JSON-LD, agent client configs, FAQ
`-- integrations/        emits AGENTS.md, llms.txt, llms-full.txt, markdown twins, Scalar bundle
deploy/                  Kubernetes manifests for 3d.shep.bot (synced by ArgoCD)
integrations/            registry.json: live sources (with date added) and evaluated/rejected sites
prompts/                 instructions for the daily source-discovery agent
scripts/                 site data export, integration gate
test/
|-- providers/           offline tests per site, against trimmed fixtures
|-- live/                live smoke tests (LIVE=1)
`-- service.test.ts      ranking, downloads, API, MCP
```

Adding a source: implement the `Provider` interface (see
[docs/PROVIDERS_GUIDE.md](docs/PROVIDERS_GUIDE.md)), add it to `src/providers/index.ts`, and add an
offline test with fixtures.

```
  interface Provider
    id, name, homepage, description, assetTypes, access: api | scrape | link, pricing, license
    search(query, ctx)     -> { assets, total?, searchUrl? }
    getAsset?(id, ctx)     -> { ...asset, files[] } | null
    buildSearchUrl(query)  -> link to the same search on the site
```

---

## Development

```bash
npm ci && npm --prefix web ci
npm test            # offline tests (fixtures, no network)
npm run test:live   # live smoke tests against the real sites
npm run typecheck   # server + website (astro check)
npm run build       # server to dist/, then the website to dist/web
npm run dev         # watch-mode server
npm --prefix web run dev   # website dev server; proxies /v1 and /mcp to `npm start` on :8787
```

CI (`.github/workflows/ci.yml`) runs build, typecheck and tests on every push and pull request; on
`main` it also publishes the image and pins it in `deploy/`, which ArgoCD rolls out to 3d.shep.bot.

---

## Licences & etiquette

```
  +----------------------------------------------------------------------+
  |  This server finds and fetches assets. It does not own them.         |
  |  Every result shows its licence: respect it, and credit authors      |
  |  when it says so.                                                    |
  +----------------------------------------------------------------------+
```

- Sites are queried gently: responses are cached, there are a few requests per search, and the
  User-Agent identifies the server.
- Paid, login-gated and hotlink-protected content is never bypassed; those results link to the
  source site.
- ShareTextures' terms forbid automated downloads, so it is search-only.

The server's own code is licensed under [Apache-2.0](LICENSE).
