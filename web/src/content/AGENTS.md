# 3D Asset Server: guide for AI agents

> You are reading the agent guide for https://3d.shep.bot. This service searches 21 3D asset sites at once (Poly Haven, ambientCG, Kenney, BlenderKit, CGTrader, itch.io, CraftPix, Textures.com, HDRMaps and more) and returns 3D models, PBR materials/textures, HDRIs and game asset packs with their licences, plus direct downloads where the source allows. It is free and needs no account or API key.

## When to use this

Reach for 3D Asset Server when the job is one of these:

- **Find an asset for a project**: "get me a low-poly tree", "I need a wooden crate model", "find a sci-fi corridor kit". Search models, packs and sprites across 21 sites in one call instead of browsing each.
- **Get PBR textures or materials**: "mossy rock material", "brick wall 2k textures". Returns map sets (color, normal, roughness, AO, displacement) at 1k–8k.
- **Light a scene with an HDRI**: "sunset HDRI for three.js", "studio environment map". Returns HDR/EXR files at the resolution you ask for.
- **Put files into a codebase**: download glTF/GLB, FBX, Blend, OBJ, textures or HDRIs straight into `./assets` or `./public` for Three.js, Babylon.js, React Three Fiber, Godot, Unity, Unreal, Blender or a website.
- **Check a licence before shipping**: every result carries its licence, whether commercial use is allowed and whether attribution is required.
- **Compare options**: show the user a few candidates (title, source, licence, thumbnail) when the choice is a matter of taste.

## When not to use it

- Generating new 3D models or textures from a prompt (this service finds existing assets; it does not create them).
- Buying paid assets: paid results link to the source site, where the purchase happens.
- Non-3D stock media (photos, video, music libraries); only game-oriented sprites, UI and audio packs are covered.

## Option 1: MCP (best when you can add tools)

MCP endpoint (Streamable HTTP, no auth): `https://3d.shep.bot/mcp`

- Claude Code: `claude mcp add --transport http 3d-assets https://3d.shep.bot/mcp`
- Cursor / Windsurf / VS Code / Codex / Gemini CLI: add an HTTP MCP server with that URL. Per-client snippets: https://3d.shep.bot/docs/mcp

Tools:

- `search_assets(query, types?, free_only?, downloadable_only?, providers?, limit?, offset?)`
- `get_asset(id, format?, resolution?)`: licence, available formats/resolutions, the exact files, and `selection.bundleUrl` to download them
- `list_providers()`

## Option 2: REST API (works with plain HTTP, curl or a fetch tool)

Base URL: `https://3d.shep.bot`. Responses are JSON.

1. Search:
   `GET /v1/search?q=<query>&type=<model|material|texture|hdri|sprite|ui|audio|font|pack>&free=true&limit=10`
   → `results[]` (each has `id`, `title`, `type`, `provider`, `url`, `thumbnailUrl`, `license{name,commercialUse,attributionRequired}`, `price{free}`, `formats`, `resolutions`, `downloadable`) and `providers[]` (per-source status; `status:"link"` entries carry a `searchUrl` for sites that block bots).
2. Inspect one result:
   `GET /v1/assets/{id}` (id like `polyhaven:ArmChair_01`; URL-encode it) → asset + `files[]`.
   `GET /v1/assets/{id}/files?format=gltf&resolution=2k` → the exact files that would be downloaded and `totalBytes`.
3. Download into the project:
   `curl -L -o <name>.zip "https://3d.shep.bot/v1/assets/{id}/download?format=<glb|gltf|fbx|blend|obj|usd|hdr|exr|jpg|png>&resolution=<1k|2k|4k|8k>"`
   A single file redirects (302) to the source CDN (`-L` follows it). Multi-file assets (glTF + .bin + textures, PBR map sets) arrive as one zip; unzip it next to the code that loads it. `409` means no direct download: send the user to the asset's `url`.

Full OpenAPI 3.1 spec: https://3d.shep.bot/openapi.json

## How to do the job well

- Use short, concrete queries: "wooden crate", "brick wall", "sunset", "low poly tree". Add `type` to cut noise; `material` and `texture` match each other.
- Prefer `free=true`, and prefer CC0 sources (Poly Haven, ambientCG, Kenney, TextureCan, 3DTextures.me) for commercial work.
- Prefer `downloadable: true` results when the user wants files in their project.
- Formats: web/three.js → `glb` or `gltf`; Blender → `blend`; Unity/Unreal → `fbx`; environment lighting → `hdr` or `exr` HDRI; PBR textures → `jpg`/`png` maps at `2k` unless asked otherwise.
- Before downloading big files, check `/files` for `totalBytes`; 8k textures and 16k HDRIs can be hundreds of MB.
- Always tell the user each asset's licence, and when `attributionRequired` is true, give the exact credit line (title, author, source URL, licence).
- Show a few options (title, source, licence, thumbnail URL) when the choice is subjective; download directly when the request is specific.
- To let the user see an asset (or share it), link `https://3d.shep.bot/search?asset=<id>`: it opens the asset with its preview, licence and downloads, and unfurls in chat apps with a card showing its thumbnail.
- If a search comes back thin, try a simpler synonym, drop filters, or pass along the `searchUrl` links of `link` sources (Fab, Poliigon, TurboSquid, CraftPix).

## Example

User: "Add a CC0 sunset HDRI to my three.js scene."

```bash
curl -s "https://3d.shep.bot/v1/search?q=sunset&type=hdri&free=true&downloadable=true&limit=5"
# pick e.g. polyhaven:venice_sunset, then:
mkdir -p public/env
curl -L -o public/env/venice_sunset_2k.hdr "https://3d.shep.bot/v1/assets/polyhaven%3Avenice_sunset/download?format=hdr&resolution=2k"
```

Then load it with `RGBELoader` and set `scene.environment`, and tell the user: "Venice Sunset by Greg Zaal, Poly Haven, CC0 (no attribution required)."

## More

- Human docs: https://3d.shep.bot/docs
- Coding agent setup: https://3d.shep.bot/docs/mcp
- REST guide: https://3d.shep.bot/docs/api
- Sources and licences: https://3d.shep.bot/docs/sources
- How many assets each source holds (counted daily): https://3d.shep.bot/stats.md, JSON at https://3d.shep.bot/v1/catalog
- Everything as one text file: https://3d.shep.bot/llms-full.txt
