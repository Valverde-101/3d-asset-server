---
layout: ../layouts/PageLayout.astro
title: About 3D Asset Server
description: What 3D Asset Server is, who runs it, how it finds assets across 19 sites, and how it treats licences and the sites it searches.
schemaType: AboutPage
---

# About 3D Asset Server

**3D Asset Server** (https://3d.shep.bot) is a free search engine and API for 3D assets. One query searches 19 asset sites at once, including Poly Haven, ambientCG, Kenney, BlenderKit, CGTrader and itch.io, and returns 3D models, PBR materials and textures, HDRIs and game asset packs with the licence of every result. Where a source allows it, the server also downloads the files: glTF/GLB, FBX or Blend models with their textures, PBR texture maps at 1k–8k, and HDR/EXR environment maps.

It exists because finding a usable asset usually means opening a dozen tabs, comparing licences by hand, and unpacking archives in different layouts. 3D Asset Server does that comparison once and hands back files that are ready to drop into a game, a website or a Blender scene.

## Who it is for

- **Game and web developers** who need a model, a material or an environment map now, with a licence they can ship.
- **AI coding agents** (Claude Code, Cursor, GitHub Copilot, Windsurf, Codex and others) that build scenes and need to find, vet and fetch assets on their own. The service is an [MCP server](/docs/mcp) and has an [agent guide](/AGENTS.md).
- **Tools and pipelines** that call the [REST API](/docs/api) from scripts or build steps.

## Who runs it

3D Asset Server is open source under the Apache-2.0 licence and developed in the open at [github.com/arielshad/3d-asset-server](https://github.com/arielshad/3d-asset-server). The public instance runs on Shep's infrastructure ([shep.bot](https://shep.bot)). Anyone can [self-host](/docs/self-hosting) their own copy.

## How it treats sources and licences

- **Assets belong to their creators.** The service never re-hosts assets. Downloads either redirect to the source's own CDN or stream files from it, unchanged.
- **Licences come first.** Every result shows its licence, whether commercial use is allowed and whether attribution is required, as published by the source. When a licence is unclear, the result links to the original page.
- **Polite access.** The server identifies itself with a descriptive User-Agent, caches responses for several minutes, deduplicates identical requests and gives every source its own timeout. Sites that ask not to be crawled (Fab, Poliigon, TurboSquid) are never scraped; they only get a deep link to their own search.

See [Sources & licences](/docs/sources) for the full list, [Privacy](/privacy) for what the service records, and [Contact](/contact) to reach the maintainers.
