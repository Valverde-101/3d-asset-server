// Count what every source holds and save it for the website and API.
//
//   node scripts/census.mjs        (after `npm run build:server`)
//
// Writes web/src/data/catalog.json (today's counts per source, by type,
// licence and category) and appends one point per day to
// web/src/data/catalog-history.json. A source that fails keeps its last good
// count, marked stale. Run daily by .github/workflows/catalog-census.yml.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const { allProviders } = await import("../dist/providers/index.js");
const { createHttpClient } = await import("../dist/core/http.js");
const { runCensus, appendHistory } = await import("../dist/core/census.js");

const CATALOG = "web/src/data/catalog.json";
const HISTORY = "web/src/data/catalog-history.json";
const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);

const previous = readJson(CATALOG, undefined);
const catalog = await runCensus(allProviders, { fetch: createHttpClient() }, { previous, log: (l) => console.log(l) });

const fresh = catalog.sources.filter((s) => !s.stale).length;
if (fresh === 0) {
  console.error("census: every source failed; keeping the previous catalog");
  process.exit(1);
}

writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n");
writeFileSync(HISTORY, JSON.stringify(appendHistory(readJson(HISTORY, []), catalog), null, 2) + "\n");

const t = catalog.totals;
const summary =
  `census: ${t.listings.count}${t.listings.atLeast ? "+" : ""} listings, ${t.free.count}${t.free.atLeast ? "+" : ""} free, ` +
  `${t.cc0.count} CC0 from ${t.sourcesCounted} sources (${catalog.sources.length - fresh} stale)`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
