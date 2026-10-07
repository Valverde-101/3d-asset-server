// Refresh the saved results behind every collection page.
//
//   node scripts/snapshot-collections.mjs [slug ...]   (after `npm run build:server`)
//
// For each topic in web/src/content/collections/ (or only the slugs given),
// runs its search against the live sources and merges the results into
// web/src/data/collections/<slug>.json (src/core/collections.ts keeps the
// list stable and only moves `updatedAt` when it really changes). Snapshots
// of deleted topics are removed. Run daily by .github/workflows/catalog-census.yml;
// exits 1 only when every search failed.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SNAPSHOT_DIR, readSnapshot, readTopics } from "./lib/topics.mjs";

const { allProviders } = await import("../dist/providers/index.js");
const { AssetService } = await import("../dist/core/service.js");
const { createHttpClient } = await import("../dist/core/http.js");
const { snapshotCollection, isIndexable } = await import("../dist/core/collections.js");

const only = process.argv.slice(2);
const topics = readTopics().filter((t) => !only.length || only.includes(t.slug));
const unknown = only.filter((s) => !topics.some((t) => t.slug === s));
if (unknown.length) {
  console.error(`snapshot: no topic file for ${unknown.join(", ")}`);
  process.exit(1);
}

const service = new AssetService({ providers: allProviders, http: createHttpClient(), defaultTimeoutMs: 20_000 });
const pricing = new Map(allProviders.map((p) => [p.id, p.pricing]));

// A thumbnail counts as broken only on a definite answer (404/410, or a
// non-image response); timeouts and network errors keep the asset, so a
// flaky CDN can't empty a page. Checked once per URL per run, 8 at a time.
const imageCache = new Map();
let inFlight = 0;
const waiting = [];
async function checkImage(url) {
  if (imageCache.has(url)) return imageCache.get(url);
  const result = (async () => {
    while (inFlight >= 8) await new Promise((r) => waiting.push(r));
    inFlight++;
    try {
      const signal = AbortSignal.timeout(10_000);
      let res = await fetch(url, { method: "HEAD", redirect: "follow", signal });
      if (res.status === 405 || res.status === 403) res = await fetch(url, { headers: { range: "bytes=0-0" }, redirect: "follow", signal });
      if (res.status === 404 || res.status === 410) return false;
      const type = res.headers.get("content-type") ?? "";
      return !(res.ok && type && !type.startsWith("image/") && !type.startsWith("application/octet-stream"));
    } catch {
      return true;
    } finally {
      inFlight--;
      waiting.shift()?.();
    }
  })();
  imageCache.set(url, result);
  return result;
}
mkdirSync(SNAPSHOT_DIR, { recursive: true });

let ok = 0;
let changed = 0;
for (const t of topics) {
  try {
    const r = await snapshotCollection((req) => service.search(req), t.slug, t.data.search, { previous: readSnapshot(t.slug), pricing, checkImage });
    if (r.changed) {
      writeFileSync(join(SNAPSHOT_DIR, `${t.slug}.json`), JSON.stringify(r.snapshot, null, 2) + "\n");
      changed++;
    }
    ok++;
    const n = r.snapshot.assets.length;
    console.log(
      `${t.slug}: ${n} assets from ${new Set(r.snapshot.assets.map((a) => a.provider)).size} sources` +
        ` (+${r.added} -${r.dropped})${r.brokenImages ? `, ${r.brokenImages} broken thumbnail(s) skipped` : ""}${r.failed.length ? `, failed: ${r.failed.join(", ")}` : ""}${isIndexable(r.snapshot.assets) ? "" : " [below the indexable minimum]"}`,
    );
  } catch (e) {
    console.error(`${t.slug}: ${e instanceof Error ? e.message : e}`);
  }
}

// A deleted topic takes its snapshot with it (full runs only).
if (!only.length && existsSync(SNAPSHOT_DIR)) {
  const live = new Set(topics.map((t) => t.slug));
  for (const f of readdirSync(SNAPSHOT_DIR).filter((f) => f.endsWith(".json"))) {
    if (!live.has(f.slice(0, -5))) {
      rmSync(join(SNAPSHOT_DIR, f));
      console.log(`${f.slice(0, -5)}: topic removed, snapshot deleted`);
    }
  }
}

console.log(`snapshot: ${ok}/${topics.length} collections searched, ${changed} changed`);
if (topics.length && ok === 0) process.exit(1);
