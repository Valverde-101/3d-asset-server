# SEO & GEO audit: 3d.shep.bot

Audit of the public site before and after the redesign. *SEO* covers classic search engines;
*GEO* (generative engine optimisation) covers AI answer engines and agents: ChatGPT, Claude,
Perplexity, Gemini, Copilot and coding agents that read the web.

## Before

The site was one JavaScript-rendered page (`src/ui/index.html`).

| Area | Finding | Impact |
|---|---|---|
| Rendering | All content built by client-side JS; the HTML had a search box and an empty grid | Crawlers and AI fetchers saw almost no text |
| `/` for non-browsers | JSON endpoint index | Fine for APIs, but no human-readable content |
| Title | "3D Asset Search" | No keywords, no brand |
| Meta description | Missing | Search engines invent a snippet |
| Canonical URL | Missing | `/?q=…` variants compete with `/` |
| Open Graph / Twitter cards | Missing | Bare link previews when shared |
| Structured data | None | No rich results, no machine-readable entity |
| `robots.txt` / sitemap | Missing (404) | No crawl guidance, no discovery of pages |
| Content depth | One page, no docs | Nothing to rank for "3D asset API", "MCP server 3D models", … |
| Headings | No `<h1>` | Weak topical signal |
| Agent entry points | None (`llms.txt`, `AGENTS.md`, markdown) | Agents told "use 3d.shep.bot" had to reverse-engineer the API |
| API description | OpenAPI with no schemas or examples | Weak for agents and API directories |
| Icons / manifest | Inline SVG favicon only | No touch icon, no manifest |
| Compression | None from the app | Larger transfers when self-hosted |

## Fixes shipped

### Technical SEO

- **Pre-rendered HTML for every page** (Astro static build). Only interactive parts hydrate
  (search app, agent tabs). Content is in the HTML for every crawler.
- **One canonical URL per page**: `<link rel="canonical">`, no trailing slash. The server 301s
  `/docs/mcp/` → `/docs/mcp` and keeps the query string.
- **`robots.txt`**: allows everything except download endpoints (large binary streams), names major
  AI crawlers explicitly (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User,
  Claude-SearchBot, PerplexityBot, Google-Extended, Applebot-Extended, Bingbot, Googlebot), and
  points to the sitemap.
- **XML sitemap** (`/sitemap-index.xml`) generated at build time with `lastmod`, 404 page excluded.
- **Real 404 status** with a helpful HTML page; API paths keep JSON 404s.
- **Caching**: fingerprinted assets (`/_astro/*`) are `immutable` for a year, pages revalidate, ETags
  with `304`.
- **Compression**: gzip/deflate in the app (the homepage goes from 80 KB to 15 KB); the edge adds
  zstd too.
- **Font preloading** for the primary font, which removed layout shift (CLS 0).
- **Security headers** on pages: CSP (same-origin scripts and fonts; the API reference is self-hosted
  with external fonts stripped), `X-Frame-Options`, `Referrer-Policy`, `nosniff`.

### On-page SEO

- **Titles** at 29–57 characters, unique per page, keyword first: "3D Asset Server: Search Free 3D
  Models, Textures & HDRIs", "Use with coding agents (MCP) · 3D Asset Server", ….
- **Meta descriptions** at 130–160 characters, unique, with the main entities (Poly Haven, ambientCG,
  glTF, CC0, MCP, Claude Code, Cursor).
- **One `<h1>` per page** and a clean heading hierarchy. The API reference adds Scalar's own heading
  after hydration, which is intentional: the server-rendered `<h1>` is the one non-JS crawlers see.
- **Content**: 8 indexable pages instead of 1: landing, search, quick start, coding-agent setup
  (8 clients), REST guide with JS/Python examples, interactive API reference, sources and licences
  (17 sources), self-hosting.
- **Internal linking**: header, docs sidebar, breadcrumbs, previous/next links, footer, homepage
  deep links into filtered searches (`/search?type=hdri&free=true`, …). All 27 internal links
  return 200.
- **Open Graph and Twitter cards** with a 1200×630 image (`/og.png`), alt text and locale.
- **Icons**: SVG favicon, 32px PNG, 180px Apple touch icon, 192/512 manifest icons, web manifest,
  light/dark `theme-color`.
- **Accessibility**: skip link, labelled forms, `aria-current` navigation, underlined inline links,
  alt text on images.

### Structured data (schema.org JSON-LD)

One `@graph` per page, with stable `@id`s so entities link up across pages:

| Page | Types |
|---|---|
| All | `WebSite` (with `SearchAction` → `/search?q=`), `Organization` |
| `/` | `WebApplication` (free `Offer`, feature list, licence, repo), `WebAPI` (docs, OpenAPI, MCP endpoint), `FAQPage` (6 Q&As, the same text shown on the page) |
| `/search` | `BreadcrumbList` |
| Docs pages | `TechArticle`, `BreadcrumbList` |
| `/docs/api/reference` | `WebAPI`, `TechArticle`, `BreadcrumbList` |
| `/docs/sources` | `ItemList` of all 17 sources |

### GEO: answer engines and agents

- **`/llms.txt`** following [llmstxt.org](https://llmstxt.org): summary, MCP one-liner, links to every
  doc as markdown, the OpenAPI spec and an example search.
- **`/llms-full.txt`**: the agent guide plus every docs page in one plain-text file.
- **`/AGENTS.md`**: an imperative, agent-facing guide: when to use the service, MCP setup, the
  three-call REST workflow, format choice per engine, licensing duties, and a worked example. Also at
  `/agents.md`.
- **Markdown content negotiation**: `Accept: text/markdown` returns markdown instead of HTML (`/` →
  `/AGENTS.md`, `/docs/mcp` → `/docs/mcp.md`). Every page advertises its twin in a `Link` header and
  `<link rel="alternate" type="text/markdown">`.
- **JSON index for `curl https://3d.shep.bot`** now includes an `agents` block pointing at
  `/AGENTS.md`, `/llms.txt` and the exact `claude mcp add` command.
- **Claude Code skill** at `/skill/SKILL.md`, installable with one `curl`.
- **OpenAPI 3.1 rewritten**: full schemas (Asset, AssetFile, SearchResponse, ProviderReport, …),
  operation IDs, tags, examples, error responses, servers, and a description written for agents.
  Linked from every page with `rel="alternate"`.
- **Answer-first copy**: the FAQ and the quick start lead with a definition ("3D Asset Server is a
  free search engine and API for 3D assets…") and concrete facts (17 sources, which ones are CC0,
  which formats), which answer engines quote directly.
- **Consistent entity naming** ("3D Asset Server", "3d.shep.bot", the MCP URL) across pages, JSON-LD,
  llms.txt and AGENTS.md.

## Results (Lighthouse 12, mobile emulation, local build)

| Page | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| `/` | 99 | 100 | 100 | 100 |
| `/search` | 100 | 100 | 100 | 100 |
| `/docs/mcp` | 99 | 100 | 100 | 100 |
| `/docs/api/reference` | 75 | 97 | 96 | 92 |

The API reference is a heavy interactive app (Scalar). It already uses the lazy-loading ES-module
build (a 0.7 MB entry instead of 4.3 MB), and its SEO deductions come from Scalar's own in-app links.
The crawlable content for the API lives in `/docs/api` and `/openapi.json`.

## Recommended next steps (need an account owner)

1. **Google Search Console and Bing Webmaster Tools**: verify `3d.shep.bot` (DNS TXT record) and
   submit `https://3d.shep.bot/sitemap-index.xml`. Bing also feeds ChatGPT search and Copilot.
2. **List the MCP server** in the official MCP Registry (registry.modelcontextprotocol.io), Smithery,
   Glama and mcp.so, and in "awesome MCP servers" lists. These are where agents and their users
   discover servers.
3. **GitHub repo**: set the homepage to https://3d.shep.bot and add topics (`mcp`, `mcp-server`,
   `3d-assets`, `gltf`, `pbr-textures`, `hdri`, `polyhaven`, `threejs`, `game-assets`).
4. **Backlinks**: post on r/threejs, r/gamedev, r/blender, Hacker News (Show HN) and Product Hunt; ask
   the CC0 sources (Poly Haven, ambientCG, Kenney) whether they list tools that use their APIs.
5. **Indexable landing pages per intent** if search data shows demand: e.g. `/free-hdri`,
   `/cc0-textures`, `/free-low-poly-models` with server-rendered top results.
6. **Watch the Grafana "3D Asset Server" dashboard**: zero-result queries show content gaps, and the
   MCP client breakdown shows which agent setup docs matter most.
