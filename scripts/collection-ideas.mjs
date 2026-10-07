#!/usr/bin/env node
// Candidate topics for new collection pages, from what people search.
//
//   node scripts/collection-ideas.mjs [--pending pending.json] > ideas.json
//
// Reads the last week's search events from Loki through Grafana's datasource
// proxy (the server logs one JSON line per search; see src/core/analytics.ts)
// and keeps only queries that:
//   - were searched at least MIN_SEARCHES times (rare queries are never used:
//     they could be personal, and one search is no evidence of demand);
//   - look like a plain topic: 2-60 characters of letters, digits, spaces,
//     hyphens and apostrophes, at most 6 words, no URLs or e-mail addresses;
//   - are not already covered by a collection (its query or an alias, once
//     filler words like "free", "3d" or "texture" are set aside) or by a
//     collection waiting in an open pull request (--pending: a JSON list of slugs
//     or of { slug, q } objects).
//
// Without GRAFANA_TOKEN it still prints the existing collections, so the
// drafting agent can work from its own research. The output is for the
// drafting job only; it is not uploaded or logged, because it contains search
// terms (see the privacy policy).
//
// Environment: GRAFANA_TOKEN (a Viewer service-account token),
// GRAFANA_URL (default https://grafana.shep.bot), LOKI_UID (the Loki
// datasource uid), DAYS (default 7), MIN_SEARCHES (default 3).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { readTopics } from "./lib/topics.mjs";

const FILLER = new Set(["free", "cc0", "3d", "model", "models", "texture", "textures", "material", "materials", "pbr", "hdri", "hdris", "hdr", "asset", "assets", "pack", "packs", "seamless", "download", "for", "a", "an", "the", "of", "game", "games"]);

/** A query as a plain topic, or undefined when it should not be used at all. */
export function sanitizeQuery(raw) {
  const q = String(raw ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (q.length < 2 || q.length > 60) return undefined;
  if (!/^[a-z0-9][a-z0-9 '\-]*[a-z0-9]$/.test(q)) return undefined;
  if (q.split(" ").length > 6) return undefined;
  if (/^\d+$/.test(q.replace(/[ -]/g, ""))) return undefined;
  if (/\b(www|http|https|com|net|org)\b/.test(q)) return undefined;
  return q;
}

/** The words that carry the topic, sorted: "free low poly tree models" -> "lowpoly tree". */
export function coreTerms(q) {
  const words = q
    .toLowerCase()
    .replace(/low[ -]poly/g, "lowpoly")
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
  return words.filter((w) => !FILLER.has(w)).sort().join(" ");
}

/** True when a collection (or a pending one) already answers this query. */
export function isCovered(q, topics) {
  const core = coreTerms(q);
  if (!core) return true; // only filler ("free 3d models"): the hubs answer it
  return topics.some((t) => [t.q, ...(t.aliases ?? [])].some((x) => coreTerms(x) === core));
}

/** Loki rows -> ranked, sanitised, uncovered queries. */
export function ideasFrom(rows, zeroRows, topics, minSearches) {
  const zero = new Map();
  for (const r of zeroRows) {
    const q = sanitizeQuery(r.query);
    if (q) zero.set(q, (zero.get(q) ?? 0) + r.count);
  }
  const counts = new Map();
  for (const r of rows) {
    const q = sanitizeQuery(r.query);
    if (q) counts.set(q, (counts.get(q) ?? 0) + r.count);
  }
  return [...counts]
    .filter(([q, n]) => n >= minSearches && !isCovered(q, topics))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 60)
    .map(([query, searches]) => ({ query, searches, zeroResults: zero.get(query) ?? 0 }));
}

async function loki(expr) {
  const base = (process.env.GRAFANA_URL ?? "https://grafana.shep.bot").replace(/\/$/, "");
  const uid = process.env.LOKI_UID ?? "P8E80F9AEF21F6940";
  const url = `${base}/api/datasources/proxy/uid/${uid}/loki/api/v1/query?${new URLSearchParams({ query: expr, time: String(Date.now() * 1e6) })}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${process.env.GRAFANA_TOKEN}` }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Loki query failed: HTTP ${res.status}`);
  const body = await res.json();
  return (body.data?.result ?? []).map((r) => ({ query: r.metric?.query ?? "", count: Number(r.value?.[1] ?? 0) }));
}

async function main() {
  const args = process.argv.slice(2);
  const pendingFile = args.includes("--pending") ? args[args.indexOf("--pending") + 1] : undefined;
  const pendingRaw = pendingFile ? JSON.parse(readFileSync(pendingFile, "utf8")) : [];
  const days = Number(process.env.DAYS ?? 7);
  const minSearches = Number(process.env.MIN_SEARCHES ?? 3);
  const existing = readTopics().map((t) => ({ slug: t.slug, title: t.data.title, hub: t.data.hub, q: t.data.search?.q ?? "", aliases: t.data.aliases ?? [] }));
  const pending = pendingRaw.map((p) => (typeof p === "string" ? { slug: p, q: p.replace(/-/g, " ") } : p));

  let queries = [];
  let source = "none";
  let note = "GRAFANA_TOKEN is not set: no search data this run. Pick topics from your own research.";
  if (process.env.GRAFANA_TOKEN) {
    const stream = `{namespace="asset-server"} |= "\\"event\\":\\"search\\"" | json | __error__="" | query != ""`;
    try {
      const rows = await loki(`topk(300, sum by (query) (count_over_time(${stream} [${days}d])))`);
      const zero = await loki(`topk(300, sum by (query) (count_over_time(${stream} | results == 0 [${days}d])))`);
      queries = ideasFrom(rows, zero, [...existing, ...pending], minSearches);
      source = "loki";
      note = `Searches from the last ${days} days, each made at least ${minSearches} times, not covered by an existing or pending collection.`;
    } catch (e) {
      note = `Search data unavailable (${e instanceof Error ? e.message : e}). Pick topics from your own research.`;
    }
  }
  process.stdout.write(JSON.stringify({ generatedAt: new Date().toISOString(), source, note, queries, existing, pending }, null, 2) + "\n");
  // Counts only: the queries themselves stay out of the (public) workflow log.
  console.error(`collection-ideas: ${source}, ${queries.length} candidate queries, ${existing.length} existing and ${pending.length} pending collections`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
