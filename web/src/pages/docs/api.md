---
layout: ../../layouts/DocsLayout.astro
title: REST API guide
crumb: REST API guide
description: Search 3D models, textures and HDRIs across 18 sites with one REST call, read licences and file lists, and download glTF, FBX, PBR maps or EXR files.
---

# 3D Asset Server REST API guide

A small JSON API over HTTPS. No key is needed on `https://3d.shep.bot`. Every endpoint is described in the [OpenAPI 3.1 spec](/openapi.json), which you can explore and try in the [interactive reference](/docs/api/reference).

**Base URL:** `https://3d.shep.bot`

## The flow

1. `GET /v1/search`: find candidates across every source.
2. `GET /v1/assets/{id}`: read the licence, formats and files of one result.
3. `GET /v1/assets/{id}/download`: get the file, or a zip of the file and its companions.

## Search

```bash
curl "https://3d.shep.bot/v1/search?q=wooden+chair&type=model&free=true&limit=10"
```

| Parameter | Description |
| --- | --- |
| `q` | Free-text query. Short and concrete works best. |
| `type` | Comma-separated: `model`, `material`, `texture`, `hdri`, `sprite`, `ui`, `audio`, `font`, `pack`, `other`. |
| `free` | `true` for free assets only. |
| `downloadable` | `true` for assets this server can download directly. |
| `providers` | Comma-separated source ids from `/v1/providers`, e.g. `polyhaven,ambientcg`. |
| `limit` | Max results, 1–100 (default 24). |
| `offset` | Per-source offset for the next page (e.g. `24`). |

The response:

```json
{
  "query": "wooden chair",
  "results": [
    {
      "id": "polyhaven:WoodenChair_01",
      "title": "Wooden Chair 01",
      "type": "model",
      "provider": "polyhaven",
      "url": "https://polyhaven.com/a/WoodenChair_01",
      "thumbnailUrl": "https://cdn.polyhaven.com/...",
      "license": { "name": "CC0", "commercialUse": true, "attributionRequired": false },
      "price": { "free": true },
      "formats": ["gltf", "blend", "fbx", "usd"],
      "resolutions": ["1k", "2k", "4k"],
      "downloadable": true
    }
  ],
  "providers": [
    { "provider": "polyhaven", "name": "Poly Haven", "status": "ok", "count": 6, "tookMs": 412 },
    { "provider": "fab", "name": "Fab", "status": "link", "count": 0, "searchUrl": "https://www.fab.com/search?q=wooden+chair" }
  ]
}
```

## Asset details

```bash
curl "https://3d.shep.bot/v1/assets/polyhaven:WoodenChair_01"
```

Returns the asset plus `files[]`. Each file has `url`, `filename`, `format`, `resolution`, `sizeBytes`, and `includes[]` for companions that must sit next to it (a `.gltf`'s `.bin` and textures).

## Choose files

```bash
curl "https://3d.shep.bot/v1/assets/polyhaven:WoodenChair_01/files?format=gltf&resolution=2k"
```

Smart selection for a `format` (`glb`, `gltf`, `fbx`, `blend`, `obj`, `usd`, `hdr`, `exr`, `jpg`, `png`, `zip`) and a `resolution` (`1k`, `2k`, `4k`, `8k`; the closest available is used). For texture sets, `maps=diff,nor_gl,rough,ao` picks map types. `all=true` returns everything.

## Download

```bash
curl -L -o chair.zip "https://3d.shep.bot/v1/assets/polyhaven:WoodenChair_01/download?format=gltf&resolution=2k"
```

A single self-contained file answers with a `302` redirect to the source CDN (so use `-L`). Multi-file selections stream as one zip with the right folder layout. Assets without direct downloads answer `409` with the asset's `url`.

## List sources

```bash
curl "https://3d.shep.bot/v1/providers"
```

## Usage statistics and source health

```bash
curl "https://3d.shep.bot/v1/stats"
```

Aggregate usage (searches by surface, downloads, MCP tool calls, top clients and asset types) for the last 24 hours and 7 days, plus each source's success rate and p50/p95 latency. Check `providers[]` to see which sources are slow or failing right now. The same data is on the [usage statistics](/stats) page.

## Examples

### JavaScript / TypeScript

```ts
const base = "https://3d.shep.bot";
const res = await fetch(`${base}/v1/search?` + new URLSearchParams({ q: "sunset", type: "hdri", free: "true" }));
const { results } = await res.json();
const hdri = results.find((a) => a.downloadable);
console.log(hdri.title, hdri.license.name);
const fileUrl = `${base}/v1/assets/${encodeURIComponent(hdri.id)}/download?format=exr&resolution=4k`;
```

### Python

```python
import requests

base = "https://3d.shep.bot"
r = requests.get(f"{base}/v1/search", params={"q": "brick wall", "type": "material", "free": "true"})
asset = next(a for a in r.json()["results"] if a["downloadable"])

with requests.get(f"{base}/v1/assets/{asset['id']}/download", params={"resolution": "2k"}, stream=True) as dl:
    dl.raise_for_status()
    with open("brick.zip", "wb") as f:
        for chunk in dl.iter_content(1 << 16):
            f.write(chunk)
```

## Errors

Errors are JSON: `{ "error": "message" }`.

| Status | Meaning |
| --- | --- |
| `400` | Bad parameter or unknown source id. |
| `401` | API key required (self-hosted servers with `ASSET_SERVER_API_KEY` only). |
| `404` | Unknown asset, or no file matches the format/resolution. |
| `409` | The source has no direct downloads; use the returned `url`. |
| `429` | Rate limit exceeded; wait `Retry-After` seconds. |
| `502` | The source site failed. |

## Authentication (self-hosted)

The public server is open. If you run your own with `ASSET_SERVER_API_KEY`, send the key as `Authorization: Bearer <key>` or `x-api-key: <key>` (or `?api_key=` for plain download links).

## Rate limits and versioning

The public server allows 120 requests per minute per client. Every response carries `RateLimit-Policy` and `RateLimit` headers (plus `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`); going over returns `429` with `Retry-After`. The API is versioned in the path (`/v1`), only grows additively within a version, and announces deprecations with `Deprecation` and `Sunset` headers at least 90 days ahead. Details: [Versioning, deprecation & rate limits](/docs/api/versioning).

## Fair use

Please cache results on your side for repeated queries, keep requests to a human pace, and respect each asset's licence. The server already caches source responses for a few minutes and deduplicates identical in-flight requests.
