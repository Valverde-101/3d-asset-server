#!/usr/bin/env node
// Gate for agent-drafted collection pages (.github/workflows/draft-collections.yml).
//
//   node scripts/collection-gate.mjs [base-ref]
//     Check the staged patch against base-ref (default HEAD): it may only add
//     new topic files (web/src/content/collections/<slug>.md), at most
//     MAX_NEW_TOPICS, each written by the agent, meeting the editorial rules,
//     with its own search (no duplicate of an existing or another new topic)
//     and `related` links to existing collections only. With GITHUB_OUTPUT set,
//     writes `added=<slugs>`. Exits 1 when refused.
//   node scripts/collection-gate.mjs --worktree
//     The same check on the working tree (untracked and modified files), for
//     the drafting agent to check its own work before it hands it over.
//   node scripts/collection-gate.mjs snapshots <slug ...>
//     After scripts/snapshot-collections.mjs ran for the new topics: a topic
//     whose results are below the indexable minimum is withdrawn (its topic
//     file and snapshot are deleted) instead of failing the run. Writes
//     `kept=<slugs>` and `dropped=<slug: reason; ...>`.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SNAPSHOT_DIR, TOPICS_DIR, parseTopic, readHubs, readSnapshot, readTopics, searchKey, topicErrors } from "./lib/topics.mjs";

export const MAX_NEW_TOPICS = 3;
const MIN_INDEXABLE = 12;
const MIN_SOURCES = 2;
const TOPIC_PATH = /^web\/src\/content\/collections\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

/**
 * @param {{ files: { status: string; path: string }[]; existing: any[]; added: any[]; hubs: string[]; providers: string[] }} input
 *   existing: topics on the base branch; added: the new topic files, parsed.
 * @returns {{ errors: string[]; added: string[] }}
 */
export function checkChanges({ files, existing, added, hubs, providers }) {
  const errors = [];
  for (const f of files) {
    if (!TOPIC_PATH.test(f.path)) errors.push(`${f.path}: only new collection topics may be added`);
    else if (f.status !== "A") errors.push(`${f.path}: ${f.status === "D" ? "deleted" : "changed"} (existing collections must not change)`);
  }
  if (!added.length && !errors.length) errors.push("no new collection topics");
  if (added.length > MAX_NEW_TOPICS) errors.push(`${added.length} new topics; at most ${MAX_NEW_TOPICS} per run`);

  const existingSlugs = existing.map((t) => t.slug);
  const keys = new Map(existing.map((t) => [searchKey(t.data.search ?? {}), t.slug]));
  for (const t of added) {
    const ctx = { hubs, providers, slugs: [...existingSlugs, ...added.map((a) => a.slug)] };
    for (const e of topicErrors(t, ctx)) errors.push(`${t.slug}: ${e}`);
    if (existingSlugs.includes(t.slug)) errors.push(`${t.slug}: a collection with this slug exists`);
    if (t.data.addedBy !== "agent") errors.push(`${t.slug}: addedBy must be "agent"`);
    // Related pages must already exist, so withdrawing one new topic never breaks another.
    for (const r of t.data.related ?? []) if (!existingSlugs.includes(r)) errors.push(`${t.slug}: related "${r}" must be an existing collection`);
    const key = searchKey(t.data.search ?? {});
    if (keys.has(key)) errors.push(`${t.slug}: same search as "${keys.get(key)}"`);
    keys.set(key, t.slug);
  }
  return { errors, added: added.map((t) => t.slug) };
}

/** Which new topics have enough results to publish. */
export function checkSnapshots(slugs, read = readSnapshot) {
  const kept = [];
  const dropped = [];
  for (const slug of slugs) {
    const snap = read(slug);
    const n = snap?.assets?.length ?? 0;
    const sources = new Set((snap?.assets ?? []).map((a) => a.provider)).size;
    if (!snap) dropped.push({ slug, reason: "no snapshot" });
    else if (n < MIN_INDEXABLE) dropped.push({ slug, reason: `${n} assets (minimum ${MIN_INDEXABLE})` });
    else if (sources < MIN_SOURCES) dropped.push({ slug, reason: `${sources} source (minimum ${MIN_SOURCES})` });
    else kept.push(slug);
  }
  return { kept, dropped };
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const output = (s) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, s);

function changedFiles(mode, base) {
  if (mode === "worktree") {
    return git("status", "--porcelain=v1", "--untracked-files=all")
      .split("\n")
      .filter(Boolean)
      .map((l) => ({ status: l.startsWith("??") || l[0] === "A" ? "A" : l.includes("D") ? "D" : "M", path: l.slice(3) }))
      // The agent's own snapshot runs leave data files behind; they are not part of the patch.
      .filter((f) => !f.path.startsWith(`${SNAPSHOT_DIR}/`));
  }
  return git("diff", "--cached", "--name-status", "--no-renames", base)
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [status, path] = l.split("\t");
      return { status: status[0], path };
    });
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "snapshots") {
    const { kept, dropped } = checkSnapshots(args.slice(1));
    for (const d of dropped) {
      rmSync(join(TOPICS_DIR, `${d.slug}.md`), { force: true });
      rmSync(join(SNAPSHOT_DIR, `${d.slug}.json`), { force: true });
      console.log(`withdrawn ${d.slug}: ${d.reason}`);
    }
    console.log(`kept: ${kept.join(", ") || "none"}`);
    output(`kept=${kept.join(",")}\ndropped=${dropped.map((d) => `${d.slug}: ${d.reason}`).join("; ")}\n`);
    return;
  }
  const mode = args[0] === "--worktree" ? "worktree" : "staged";
  const base = mode === "staged" ? (args[0] ?? "HEAD") : "HEAD";
  const files = changedFiles(mode, base);
  const addedPaths = files.filter((f) => f.status === "A" && TOPIC_PATH.test(f.path)).map((f) => f.path);
  const addedSet = new Set(addedPaths.map((p) => p.match(TOPIC_PATH)[1]));
  const existing = readTopics().filter((t) => !addedSet.has(t.slug));
  const added = addedPaths.filter((p) => existsSync(p)).map((p) => parseTopic(readFileSync(p, "utf8"), p.match(TOPIC_PATH)[1]));
  const providers = JSON.parse(readFileSync("web/src/data/providers.json", "utf8")).map((p) => p.id);
  const { errors, added: slugs } = checkChanges({ files, existing, added, hubs: readHubs().map((h) => h.id), providers });

  console.log(`changed files (${files.length}):`);
  for (const f of files) console.log(`  ${f.status} ${f.path}`);
  if (errors.length) {
    console.error(`\nrefused:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`\naccepted: ${slugs.join(", ")}`);
  output(`added=${slugs.join(",")}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
