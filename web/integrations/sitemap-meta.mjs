// Per-URL sitemap facts, read from the site's data files at build time:
//
//   lastmod  only where the date is known and honest: a collection's last
//            content change, the newest change in a hub (and in /assets), the
//            census date for /stats and the source pages. Other pages get no
//            lastmod rather than the build time, which would claim every page
//            changed on every deploy and teach crawlers to ignore the field.
//   noindex  collections and source pages too thin to index (the same rules
//            as src/lib/collections.ts); they stay reachable but are left out
//            of the sitemap.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

/** Same thresholds as src/core/collections.ts (MIN_INDEXABLE, MIN_SOURCES). */
const MIN_INDEXABLE = 12;
const MIN_SOURCES = 2;

export function sitemapMeta() {
  const lastmod = new Map();
  const noindex = new Set();
  const catalog = read("src/data/catalog.json");
  const providers = read("src/data/providers.json");
  const topicsDir = join(root, "src/content/collections");
  const snapDir = join(root, "src/data/collections");

  const hubOf = new Map();
  if (existsSync(topicsDir)) {
    for (const f of readdirSync(topicsDir).filter((f) => f.endsWith(".md"))) {
      const hub = readFileSync(join(topicsDir, f), "utf8").match(/^hub:\s*([\w-]+)\s*$/m)?.[1];
      if (hub) hubOf.set(f.slice(0, -3), hub);
    }
  }
  const newest = (a, b) => (!a || b > a ? b : a);
  const perSource = new Map();
  let all;
  for (const [slug, hub] of hubOf) {
    const file = join(snapDir, `${slug}.json`);
    const snap = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
    const assets = snap?.assets ?? [];
    for (const a of assets) perSource.set(a.provider, (perSource.get(a.provider) ?? 0) + 1);
    if (assets.length < MIN_INDEXABLE || new Set(assets.map((a) => a.provider)).size < MIN_SOURCES) noindex.add(`/assets/${slug}`);
    if (!snap) continue;
    lastmod.set(`/assets/${slug}`, snap.updatedAt);
    lastmod.set(`/assets/${hub}`, newest(lastmod.get(`/assets/${hub}`), snap.updatedAt));
    all = newest(all, snap.updatedAt);
  }
  if (all) lastmod.set("/assets", all);

  lastmod.set("/stats", catalog.countedAt);
  for (const p of providers) {
    const census = catalog.sources.find((s) => s.id === p.id);
    if (census) lastmod.set(`/sources/${p.id}`, census.countedAt);
    // Same rule as sourcePages(): a census, or at least 4 assets in collections.
    if (!census && (perSource.get(p.id) ?? 0) < 4) noindex.add(`/sources/${p.id}`);
  }
  return { lastmod, noindex };
}
