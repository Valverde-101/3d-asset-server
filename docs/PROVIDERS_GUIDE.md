# Writing a provider

A provider adapts one asset website to the shared model in `src/core/types.ts`.
`src/providers/polyhaven.ts` is the reference implementation.

## Contract

```ts
export const myprovider: Provider = {
  id: "myprovider",            // lowercase, no spaces; used in asset ids `myprovider:<nativeId>`
  name: "My Provider",
  homepage: "https://…",
  description: "One line: what the site is best for.",
  assetTypes: [...],           // AssetType values it can return
  access: "api" | "scrape" | "link",
  pricing: "free" | "freemium" | "paid",
  license: LICENSES.CC0,       // when uniform across the site
  supportsDownload: true,      // only if getAsset returns direct, unauthenticated file URLs
  apiKeyEnv: "MYPROVIDER_API_KEY", // optional
  isEnabled() {...},           // optional, e.g. requires key
  buildSearchUrl(q) {...},     // deep link to the same search on the website
  async search(q, ctx) {...},  // -> { assets, total?, searchUrl? }
  async getAsset(nativeId, ctx) {...} // -> AssetDetails (asset + files[]) | null
};
```

Rules:

- **All HTTP goes through `ctx.fetch`** (`json`, `text`, `raw`). It sets a User-Agent, timeout and
  an in-memory cache. Pass `signal: ctx.signal`. For catalogue/listing pages that rarely change, pass
  `cacheTtlMs` (e.g. one hour) and filter locally with `filterLocal` + `paginate` from `core/util.ts`.
- **Respect `q.types`** (use `wantsType` / `typeMatches`): return `{ assets: [] }` quickly if the
  provider has nothing of the requested types. Respect `q.freeOnly` for mixed free/paid sites.
  Respect `q.limit` and `q.offset`.
- Build assets with `makeAsset(...)` (adds `id`, lowercases/dedupes tags, drops undefined).
- `nativeId` must be something `getAsset` can resolve on its own (slug / API id / path). It must be
  URL-safe-ish; prefer the site's slug.
- `downloadable: true` on an asset only if `getAsset` will return direct file URLs that can be fetched
  with a plain GET (no login, no cookies). Otherwise `false` and the user follows `url`.
- `AssetFile.includes` lists companion files (e.g. gltf `.bin` + textures) with paths relative to the
  main file.
- Never throw for "no results"; throw for network/parse failures (the aggregator records the error
  per provider and continues with the others).
- Parse HTML with `cheerio` (`import * as cheerio from "cheerio"`). Prefer stable hooks (JSON-LD,
  `__NEXT_DATA__`, WordPress REST `/wp-json/wp/v2/...`, sitemaps, data attributes) over CSS classes.
- Be polite: at most a couple of requests per search. No per-result detail fetches inside `search`.

## Tests

Each provider gets `test/providers/<id>.test.ts` that runs **offline** against fixtures saved under
`test/fixtures/<id>/` (trim fixtures to a few KB–~100KB; strip scripts/styles you don't need). Use
`fixtureHttp` from `test/helpers.ts` to map URLs to fixture files. Optionally add a live smoke test to
`test/live/<id>.live.test.ts` (only runs with `LIVE=1`).
