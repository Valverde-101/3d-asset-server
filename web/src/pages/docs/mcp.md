---
layout: ../../layouts/DocsLayout.astro
title: MCP server for coding agents
crumb: Coding agents & MCP
description: Connect Claude Code, Cursor, VS Code, Windsurf, Codex or Gemini CLI to the 3D Asset Server MCP server so your agent finds and downloads 3D assets.
---

# 3D Asset Server MCP server for coding agents

3D Asset Server is a [Model Context Protocol](https://modelcontextprotocol.io) server. Connect it once and your coding agent can search 21 asset sites, check licences and pull models, textures and HDRIs into your project while it writes the code that uses them.

**MCP endpoint:** `https://3d.shep.bot/mcp` (Streamable HTTP, no authentication).

## Claude Code

```bash
claude mcp add --transport http 3d-assets https://3d.shep.bot/mcp
```

Add `--scope user` to make it available in every project, or `--scope project` to share it with your team through `.mcp.json`. Check it with `claude mcp list`, or `/mcp` inside a session.

## Cursor

[Add to Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=3d-assets&config=eyJ1cmwiOiJodHRwczovLzNkLnNoZXAuYm90L21jcCJ9) (opens Cursor), or add this to `.cursor/mcp.json` in your project, or to `~/.cursor/mcp.json` for every project:

```json
{
  "mcpServers": {
    "3d-assets": { "url": "https://3d.shep.bot/mcp" }
  }
}
```

## VS Code (GitHub Copilot)

Add to `.vscode/mcp.json`, then use Copilot Chat in **Agent** mode:

```json
{
  "servers": {
    "3d-assets": { "type": "http", "url": "https://3d.shep.bot/mcp" }
  }
}
```

Or from a terminal: `code --add-mcp '{"name":"3d-assets","type":"http","url":"https://3d.shep.bot/mcp"}'`

## Claude desktop app and claude.ai

Open **Settings → Connectors → Add custom connector**, name it *3D Asset Server* and paste `https://3d.shep.bot/mcp`.

## Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "3d-assets": { "serverUrl": "https://3d.shep.bot/mcp" }
  }
}
```

## OpenAI Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.3d-assets]
url = "https://3d.shep.bot/mcp"
```

## Gemini CLI

```bash
gemini mcp add --transport http 3d-assets https://3d.shep.bot/mcp
```

## Any other client

Clients that only support stdio servers can bridge to the HTTP endpoint with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "3d-assets": { "command": "npx", "args": ["-y", "mcp-remote", "https://3d.shep.bot/mcp"] }
  }
}
```

## Tools your agent gets

| Tool | What it does |
| --- | --- |
| `search_assets` | Search every source. Arguments: `query`, `types` (model, material, texture, hdri, sprite, ui, audio, font, pack), `free_only`, `downloadable_only`, `providers`, `limit`, `offset`. |
| `get_asset` | Details for one `id` from a search: licence, formats, resolutions, and the exact files for a `format` and `resolution`, plus a `bundleUrl` that downloads them as one file or zip. |
| `list_providers` | Every source with what it is best for, pricing, licence and whether it supports direct downloads. |

The remote server never writes to its own disk, so agents download through the `bundleUrl` that `get_asset` returns:

```bash
curl -L -o assets/armchair.zip "https://3d.shep.bot/v1/assets/polyhaven%3AArmChair_01/download?format=gltf&resolution=2k"
unzip -o assets/armchair.zip -d assets/
```

Coding agents with a shell do this on their own.

## Prompts that work well

```text
Find a CC0 sunset HDRI (4k EXR) and add it to ./public/env. Wire it into the Three.js scene as the environment map.
```

```text
I need a low-poly tree pack for a browser game. Search free models, show me 5 options with licences, then download the one I pick as glTF into ./assets/trees.
```

```text
Get a 2k mossy rock PBR material with color, normal, roughness and AO maps and make a MeshStandardMaterial from it.
```

Tips for agents and the people prompting them:

- Use short, concrete queries: "wooden crate", "brick wall", "night city hdri".
- Filter by type. `material` and `texture` match each other.
- Prefer CC0 sources for commercial projects, and always report the licence and any attribution requirement.
- Results with `downloadable: false` must be fetched from their `url` on the source site.

## Local mode: downloads straight to disk

For a `download_asset` tool that writes files (glTF with `.bin` and textures, extracted zips) directly into your project, run the server locally over stdio with Docker:

```bash
claude mcp add 3d-assets-local -- docker run -i --rm \
  --user "$(id -u):$(id -g)" -v "$PWD/assets:/app/assets" \
  ghcr.io/arielshad/3d-asset-server node dist/cli.js mcp
```

Files land in `./assets/<provider>-<id>/`. Add `-e BLENDERKIT_API_KEY=...` to unlock BlenderKit plan assets.

## Agents without MCP

Any agent that can fetch URLs can use the REST API directly. Point it at [/AGENTS.md](/AGENTS.md); it has the whole workflow in a few lines. In Claude Code you can also install the ready-made skill:

```bash
mkdir -p ~/.claude/skills/3d-assets
curl -fsSL https://3d.shep.bot/skill/SKILL.md -o ~/.claude/skills/3d-assets/SKILL.md
```
