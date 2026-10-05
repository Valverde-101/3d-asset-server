---
layout: ../../layouts/DocsLayout.astro
title: 3D Asset Server CLI
crumb: CLI
description: Use the 3d-asset-server command line tool to search 17 3D asset sites from a terminal, run the MCP server over stdio, or start your own HTTP server.
---

# 3D Asset Server CLI

The `3d-asset-server` command searches every source from a terminal, runs the MCP server over stdio for desktop agents, and starts the HTTP server. It is the same code that runs https://3d.shep.bot.

## Commands

```text
3d-asset-server search <query> [--type model,hdri] [--free] [--providers polyhaven,kenney] [--limit N]
3d-asset-server mcp      # MCP server over stdio, with download_asset writing to ./assets
3d-asset-server serve    # HTTP API + website + MCP at /mcp on port 8787
```

`search` prints ranked results (score, type, price, asset id, title and URL) followed by one status line per source:

```text
0.92  model    free   polyhaven:ArmChair_01
      Arm Chair 01 — https://polyhaven.com/a/ArmChair_01

Sources:
  polyhaven        ok       12
  fab              link     0  https://www.fab.com/search?q=chair
```

Pass the asset id to the REST API (`/v1/assets/{id}/download`) or the MCP `get_asset` tool to fetch files.

## Run it with Docker (no install)

```bash
docker run --rm ghcr.io/arielshad/3d-asset-server node dist/cli.js search "low poly tree" --type model --free
```

As a local MCP server that writes downloads into your project:

```bash
docker run -i --rm --user "$(id -u):$(id -g)" -v "$PWD/assets:/app/assets" \
  ghcr.io/arielshad/3d-asset-server node dist/cli.js mcp
```

## Run it from source

```bash
git clone https://github.com/arielshad/3d-asset-server
cd 3d-asset-server && npm ci && npm run build:server
node dist/cli.js search "sunset" --type hdri --free
```

## Environment

| Variable | Purpose |
| --- | --- |
| `ASSET_SERVER_PROVIDERS` | Comma list to search only some sources. |
| `ASSET_DOWNLOAD_DIR` | Where `mcp` downloads go (default `./assets`). |
| `BLENDERKIT_API_KEY` | Unlocks BlenderKit plan and purchased assets. |
| `NODE_USE_ENV_PROXY` | Set to `1` so the CLI honours `HTTPS_PROXY`. |

See [Self-hosting](/docs/self-hosting) for every server setting.
