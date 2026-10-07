---
layout: ../../../layouts/DocsLayout.astro
title: Versioning, deprecation & rate limits
crumb: Versioning & rate limits
description: How the 3D Asset Server API is versioned, how deprecations are announced with Deprecation and Sunset headers, and how rate limits and RateLimit headers work.
---

# Versioning, deprecation & rate limits

The rules below let agents and integrations build on the 3D Asset Server API without surprises.

## Versioning

- The major version is part of the path: every REST endpoint lives under **`/v1`**.
- Within `/v1`, changes are **additive only**: new endpoints, new optional parameters, new fields in responses. Clients must ignore fields they don't know.
- **Breaking changes** (removing or renaming a field or endpoint, changing a type or a default) only ship under a new major version (`/v2`). The previous version keeps working during its deprecation period.
- The MCP tools follow the same rule: tool names and existing arguments stay stable; new optional arguments may appear.
- The OpenAPI document at [/openapi.json](/openapi.json) always describes the current version. Its `info.version` follows semantic versioning.

## Deprecation and sunset

When an endpoint, parameter or whole API version is going away:

1. It is marked `deprecated: true` in the OpenAPI document and listed in the changelog on GitHub.
2. Its responses carry a **`Deprecation`** header ([RFC 9745](https://www.rfc-editor.org/rfc/rfc9745)) with the date it was deprecated, a **`Sunset`** header ([RFC 8594](https://www.rfc-editor.org/rfc/rfc8594)) with the date it stops working, and a `Link: <…>; rel="deprecation"` header pointing at migration notes.
3. The sunset date is **at least 90 days** after the deprecation is announced.
4. After the sunset date the endpoint answers `410 Gone` with a JSON body naming its replacement.

Example of a deprecated response:

```http
HTTP/1.1 200 OK
Deprecation: @1767225600
Sunset: Wed, 01 Apr 2026 00:00:00 GMT
Link: <https://3d.shep.bot/docs/api/versioning>; rel="deprecation"
```

Nothing in `/v1` is deprecated today.

## Rate limits

The public server allows **120 requests per minute per client** across `/v1/*` and `/mcp`. Every response tells you where you stand, using the IETF RateLimit header fields plus their widely used single-value forms:

| Header | Example | Meaning |
| --- | --- | --- |
| `RateLimit-Policy` | `"default";q=120;w=60` | Quota: 120 requests (`q`) per 60-second window (`w`). |
| `RateLimit` | `"default";r=117;t=42` | 117 requests remaining (`r`), window resets in 42 seconds (`t`). |
| `RateLimit-Limit` | `120` | Requests per window. |
| `RateLimit-Remaining` | `117` | Requests left in this window. |
| `RateLimit-Reset` | `42` | Seconds until the window resets. |

Going over the limit returns **`429 Too Many Requests`** with a **`Retry-After`** header (seconds) and a JSON body:

```json
{ "error": "Rate limit exceeded: 120 requests per 60s. Retry after 12s.", "retryAfter": 12 }
```

How to behave:

- Read `RateLimit-Remaining` (or `r=` in `RateLimit`) and slow down before it reaches zero.
- On `429`, wait `Retry-After` seconds, then retry once. Don't retry in a tight loop.
- Cache search results you reuse; a search fans out to 20 sites, so repeating it costs everyone.

All rate-limit headers are exposed to browsers through CORS. Self-hosted servers set their own limit with `ASSET_SERVER_RATE_LIMIT` and `ASSET_SERVER_RATE_LIMIT_WINDOW` (see [Self-hosting](/docs/self-hosting)).
