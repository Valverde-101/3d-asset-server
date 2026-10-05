---
layout: ../../layouts/DocsLayout.astro
title: Quick start
crumb: Docs
description: Get started with 3D Asset Server in two minutes. Search 17 3D asset sites from the browser, connect Claude Code or Cursor over MCP, or call the REST API with curl.
---

# Quick start

**3D Asset Server** searches 17 3D asset sites at once and downloads what you pick, ready to drop into a game or a website. Results cover 3D models, PBR materials, textures, HDRIs and game asset packs, and every result shows its licence.

The public server at **https://3d.shep.bot** is free and needs no account or API key.

## Pick how you want to use it

| You want to… | Use | Start here |
| --- | --- | --- |
| Browse and download assets yourself | The web search | [/search](/search) |
| Let Claude Code, Cursor, Copilot or another agent fetch assets | The MCP server at `https://3d.shep.bot/mcp` | [Coding agents & MCP](/docs/mcp) |
| Call it from a script, build tool or backend | The REST API | [REST API guide](/docs/api) |
| Explore every endpoint and try requests | The interactive reference | [API reference](/docs/api/reference) |

## Connect your coding agent (30 seconds)

For **Claude Code**, run this once:

```bash
claude mcp add --transport http 3d-assets https://3d.shep.bot/mcp
```

Then ask for what you need:

```text
Find a CC0 sunset HDRI and a mossy rock PBR material (2k) and put them in ./assets.
Tell me the licence of each.
```

Cursor, VS Code, Windsurf, Codex CLI, Gemini CLI and the Claude apps take the same URL. See [Coding agents & MCP](/docs/mcp) for each one.

## Or call the API

```bash
# Search every source for free low-poly tree models
curl "https://3d.shep.bot/v1/search?q=low+poly+tree&type=model&free=true&limit=5"

# Details and files for one result
curl "https://3d.shep.bot/v1/assets/polyhaven:ArmChair_01"

# Download it as glTF (multi-file assets arrive as one zip)
curl -L -o armchair.zip "https://3d.shep.bot/v1/assets/polyhaven:ArmChair_01/download?format=gltf&resolution=2k"
```

## What a search returns

Every search returns two lists:

- **`results`**: assets merged from all sources, ranked by text match, the source's own ranking, whether they're free and whether files can be downloaded directly. Each one has an `id` like `polyhaven:ArmChair_01`, a `license`, a `price`, known `formats` and `resolutions`, and `downloadable`.
- **`providers`**: one status line per source (`ok`, `error`, `timeout`, `skipped` or `link`). Sites that block bots (Fab, Poliigon, TurboSquid) come back as `link` with a `searchUrl` that runs the same search on their site.

A slow or broken source never fails the search.

## Licences

Assets keep the licence of the site they come from. Poly Haven, ambientCG, Kenney, TextureCan and 3DTextures.me publish under **CC0** (public domain: commercial use, no credit needed). Others are royalty-free, need attribution, or are paid. Check `license.attributionRequired` before you ship. See [Sources & licences](/docs/sources).

## For AI agents reading this

Machine-readable entry points:

- [/AGENTS.md](/AGENTS.md): how to use this service as an agent
- [/llms.txt](/llms.txt) and [/llms-full.txt](/llms-full.txt): site index and full docs as plain text
- [/openapi.json](/openapi.json): OpenAPI 3.1 description of the REST API
