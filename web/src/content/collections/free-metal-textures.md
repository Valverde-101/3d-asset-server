---
title: Free metal textures (PBR)
description: Free metal PBR textures (brushed, painted, rusty, corrugated) with metalness, roughness and normal maps up to 8K, mostly CC0, from Poly Haven and ambientCG.
hub: textures
search:
  q: metal
  types: [material, texture]
  free: true
aliases: [metal texture, rusty metal texture, brushed metal texture, metal pbr, corrugated metal]
related: [free-concrete-textures, free-sci-fi-game-assets, free-car-3d-models, free-space-game-assets]
faq:
  - q: Why does my metal look like plastic?
    a: Bare metal needs a metalness value of 1, so its reflections take the base colour. Most metal materials include a metalness map for that. Painted or rusty patches use 0, because paint and rust are not metallic.
  - q: Do metal materials need an HDRI?
    a: Metal shows almost no colour of its own and mostly reflects its surroundings. Without an environment map it looks dark and flat. Any HDRI, even a simple studio one, makes it read as metal.
addedAt: 2026-10-07
addedBy: human
---

Metal materials cover a wide range: brushed steel and aluminium, painted and chipped panels, rusty sheets, corrugated roofing, diamond plate floors and worn brass. They are the core of industrial, sci-fi and vehicle scenes.

The materials on this page are gathered from twelve texture sites with one live search and refreshed automatically, including Poly Haven, ambientCG, TextureCan, ShareTextures, CGBookcase and 3DTextures.me. Each card shows its source and licence; most are CC0.

## The metalness workflow

Metal is where PBR maps matter most. A metal material usually has:

- **Metalness:** white where the surface is bare metal, black where it is paint, rust or dirt.
- **Roughness:** low for polished or chrome surfaces, high for sandblasted or rusty ones. Scratches and wear show up here first.
- **Colour (albedo):** for bare metal, the tint of the reflection (grey for steel, yellow for gold); for paint, the paint colour.

Light metal with an HDRI so it has something to reflect. Studio HDRIs give clean product-style highlights; outdoor HDRIs give the busy reflections of vehicles and machinery.
