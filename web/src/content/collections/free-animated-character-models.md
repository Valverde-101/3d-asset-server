---
title: Free animated character models
description: Free rigged and animated 3D characters for games (humans, monsters, robots) with walk, run and idle clips, as glTF, GLB and FBX, from Quaternius and Kenney.
hub: 3d-models
search:
  q: animated character
  types: [model]
  free: true
aliases: [animated character, rigged character, free character model, game character 3d, low poly character]
related: [free-medieval-game-assets, free-sci-fi-game-assets, free-dungeon-game-assets, free-fabric-textures]
faq:
  - q: Which format keeps the animations?
    a: glTF/GLB and FBX both store the skeleton and the animation clips. In Three.js, load a GLB with GLTFLoader and play its clips with AnimationMixer; in Godot, import the GLB and use its AnimationPlayer; Unity and Unreal import FBX directly.
  - q: Can I add more animations to these characters?
    a: If the character uses a standard humanoid rig, you can retarget animations from other sources, such as other packs or motion-capture libraries, in Blender, Unity (Humanoid rig) or Unreal (IK Retargeter). Characters with custom rigs are harder to retarget.
addedAt: 2026-10-07
addedBy: human
---

An animated character is a 3D model with a skeleton (a rig) and ready-made animation clips: idle, walk, run, jump, attack and death. Free animated characters let you prototype and ship a game without rigging and animating everything yourself.

This page collects free animated and rigged characters from several sources with one live search, refreshed automatically. Quaternius and Kenney publish CC0 character packs with full animation sets; BlenderKit and itch.io creators add more, with licences that vary per item and are shown on each card.

## What to look for

- **Animation list.** Check which clips are included. A game character usually needs at least idle, walk, run and one or two actions.
- **Rig type.** Humanoid rigs can share animations between characters; creature rigs usually cannot.
- **Style.** Low-poly characters with flat colours fit together easily. Mixing realistic and stylised characters rarely looks right.
- **Polygon count.** Low-poly characters have a few thousand triangles and run well in browsers and on mobile; detailed ones need more care.

Cards marked as animated or rigged come with a skeleton; open the asset page to see every clip.
