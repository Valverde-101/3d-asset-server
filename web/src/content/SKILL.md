---
name: 3d-assets
description: Find and download free 3D models, PBR textures/materials, HDRIs and game asset packs (glTF, FBX, Blend, EXR) from 18 sites like Poly Haven, ambientCG, Kenney and BlenderKit via https://3d.shep.bot, with licences. Use when the user needs 3D assets, textures, environment maps or game art for a project.
---

# 3D assets via 3d.shep.bot

Search 18 asset sites in one call and download files into the project. No API key needed.

## Workflow

1. Search (pick a `type`; prefer free and directly downloadable):

   ```bash
   curl -s "https://3d.shep.bot/v1/search?q=QUERY&type=model&free=true&downloadable=true&limit=8"
   ```

   Types: model, material, texture, hdri, sprite, ui, audio, font, pack.
   Each result has `id`, `title`, `provider`, `url`, `thumbnailUrl`, `license`, `formats`, `resolutions`, `downloadable`.

2. Check the files and size for the format you need:

   ```bash
   curl -s "https://3d.shep.bot/v1/assets/ID/files?format=glb&resolution=2k"
   ```

3. Download into the project (zip for multi-file assets, otherwise the file itself):

   ```bash
   curl -L -o assets/NAME.zip "https://3d.shep.bot/v1/assets/ID/download?format=gltf&resolution=2k"
   unzip -o assets/NAME.zip -d assets/
   ```

## Rules

- URL-encode the id (`polyhaven:ArmChair_01` → `polyhaven%3AArmChair_01`).
- Format by target: three.js/web `glb`/`gltf`, Blender `blend`, Unity/Unreal `fbx`, lighting `hdr`/`exr`, textures 2k `jpg`/`png` maps.
- Prefer CC0 sources for commercial projects. Always report the licence; if `attributionRequired`, write the credit line (title, author, source URL, licence) into the project's credits or README.
- `409` from download = no direct files; give the user the asset `url` instead.
- Check `/files` `totalBytes` before pulling 8k textures or 16k HDRIs.

Full guide: https://3d.shep.bot/AGENTS.md · OpenAPI: https://3d.shep.bot/openapi.json
