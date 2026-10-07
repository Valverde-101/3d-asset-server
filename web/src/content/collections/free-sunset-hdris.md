---
title: Free sunset HDRIs
description: Free sunset and golden-hour HDRIs for Blender, Three.js and game engines, as HDR or EXR files, mostly CC0, from Poly Haven, ambientCG and more.
hub: hdris
search:
  q: sunset
  types: [hdri]
  free: true
aliases: [sunset hdri, golden hour hdri, sunset sky hdri]
related: [free-overcast-sky-hdris, free-night-sky-hdris, free-forest-hdris, free-studio-hdris]
faq:
  - q: Can I use these sunset HDRIs in commercial work?
    a: Most of them, yes. Poly Haven and ambientCG publish every HDRI under CC0, which allows commercial use without credit. Check the licence on each card, because other sources can mark individual items as royalty free instead.
  - q: Which file format and resolution should I download?
    a: Take .hdr or .exr, which keep the full brightness of the sun so it casts real shadows. 2K is enough when the HDRI only lights the scene; take 8K or more when the sky is visible as a sharp background.
addedAt: 2026-10-07
addedBy: human
---

A sunset HDRI lights a scene with a low, warm sun and long shadows, and puts a glowing sky behind your model. It is the quickest way to give a product shot, an architectural render or a game level a golden-hour mood without placing a single light.

This page collects free sunset and golden-hour HDRIs from several libraries at once and is refreshed from a live search. Most come from Poly Haven and ambientCG, which shoot their own panoramas and release them under CC0, alongside BlenderKit and other sources.

## How to choose one

- **Sun in frame or just set.** With the sun disc visible you get crisp, directional shadows. Once the sun has dipped below the horizon the light turns soft and orange, with almost no shadows.
- **What is on the ground.** Panoramas shot on open fields, beaches or rooftops leave the lower half clean, which helps when you add your own ground plane.
- **Resolution.** For lighting alone, 1K or 2K is plenty. If the sky fills the background at full screen, use 8K or larger.

In Three.js, load an .hdr file with `RGBELoader` (or an .exr with `EXRLoader`) and assign it to `scene.environment`. In Blender, connect it to an Environment Texture node in the World shader and rotate it with a Mapping node until the sun sits where you want it.
