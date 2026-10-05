#!/usr/bin/env node
// Gate for the daily discovery workflow (.github/workflows/discover-integrations.yml).
//
// The agent's patch is applied to the index of a clean checkout, then this
// script decides whether it may be committed:
//   - only files a new provider legitimately needs are touched (allowlist);
//   - nothing is deleted or renamed, and existing tests/fixtures are not edited
//     (an agent must not weaken tests to get green);
//   - at most one source is added per run, and the registry's existing entries
//     are not rewritten;
//   - a new source comes with its provider file and offline + live tests.
//
// Usage:
//   node scripts/integration-gate.mjs [base-ref]
//     Check the staged patch against base-ref (default HEAD). Prints the
//     decision; with GITHUB_OUTPUT set, writes `added=<ids>` and
//     `rejected=<count of newly rejected sites>`. Exits 1 when refused.
//   node scripts/integration-gate.mjs demote <patched-registry.json> <reason>
//     After a failed verification: write integrations/registry.json as the
//     base version plus the agent's rejections, with the sources it tried to
//     add moved to `rejected` (recheck in 30 days), so tomorrow's run does
//     not retry the same site.

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ALLOWED = [
  /^src\/providers\/[a-z0-9-]+\.ts$/,
  /^test\/providers\/[a-z0-9-]+\.test\.ts$/,
  /^test\/live\/[a-z0-9-]+\.live\.test\.ts$/,
  /^test\/fixtures\/(?!site\/)[a-z0-9-]+\/[^/]+$/,
  /^integrations\/registry\.json$/,
  /^README\.md$/,
  /^docs\/[A-Za-z0-9_-]+\.md$/,
  /^web\/src\/content\/(AGENTS|SKILL)\.md$/,
  /^web\/src\/pages\/[a-z0-9/_-]+\.md$/,
  /^web\/src\/data\/(providers|integrations|openapi)\.json$/,
];
const MAX_FIXTURE_BYTES = 200 * 1024;
const MAX_NEW_SOURCES = 1;

/**
 * @param {{ files: { status: string; path: string; size?: number }[]; before: any; after: any }} input
 * @returns {{ errors: string[]; added: string[]; rejected: number }}
 */
export function checkChanges({ files, before, after }) {
  const errors = [];
  for (const f of files) {
    if (f.status !== "A" && f.status !== "M") {
      errors.push(`${f.path}: ${f.status === "D" ? "deleted" : `status ${f.status}`} (only additions and edits are allowed)`);
      continue;
    }
    if (!ALLOWED.some((re) => re.test(f.path))) errors.push(`${f.path}: outside the files a new source may touch`);
    if (f.path.startsWith("test/") && f.status !== "A") errors.push(`${f.path}: existing tests and fixtures must not change`);
    if (f.path.startsWith("test/fixtures/") && (f.size ?? 0) > MAX_FIXTURE_BYTES) errors.push(`${f.path}: fixture over ${MAX_FIXTURE_BYTES / 1024} KB`);
  }

  const key = (e) => JSON.stringify(e);
  const beforeIds = new Map(before.integrated.map((e) => [e.id, key(e)]));
  for (const [id, entry] of beforeIds) {
    const now = after.integrated.find((e) => e.id === id);
    if (!now) errors.push(`registry: integrated source "${id}" was removed`);
    else if (key(now) !== entry) errors.push(`registry: integrated source "${id}" was changed`);
  }
  const added = after.integrated.filter((e) => !beforeIds.has(e.id));
  if (added.length > MAX_NEW_SOURCES) errors.push(`registry: ${added.length} sources added; at most ${MAX_NEW_SOURCES} per run`);
  const status = new Map(files.map((f) => [f.path, f.status]));
  for (const e of added) {
    if (e.addedBy !== "agent") errors.push(`registry: new source "${e.id}" must have addedBy "agent"`);
    for (const p of [`src/providers/${e.id}.ts`, `test/providers/${e.id}.test.ts`, `test/live/${e.id}.live.test.ts`]) {
      if (status.get(p) !== "A") errors.push(`${p}: required for new source "${e.id}"`);
    }
    if (status.get("src/providers/index.ts") !== "M") errors.push(`src/providers/index.ts: "${e.id}" is not registered`);
  }
  const host = (u) => new URL(u).hostname.replace(/^www\./, "");
  const knownRejected = new Set(before.rejected.map((r) => host(r.homepage)));
  const rejected = after.rejected.filter((r) => !knownRejected.has(host(r.homepage))).length;
  if (!added.length && files.some((f) => f.path.startsWith("src/"))) errors.push("src/: code changed without adding a source");

  return { errors, added: added.map((e) => e.id), rejected };
}

/** Base registry + the agent's rejections, with its new sources demoted to `rejected`. */
export function demote(base, patched, reason, today) {
  const recheck = new Date(`${today}T00:00:00Z`);
  recheck.setUTCDate(recheck.getUTCDate() + 30);
  const known = new Set(base.integrated.map((e) => e.id));
  const failed = patched.integrated
    .filter((e) => !known.has(e.id))
    .map((e) => ({ name: e.name, homepage: e.homepage, checkedAt: today, reason, recheckAfter: recheck.toISOString().slice(0, 10) }));
  const host = (u) => new URL(u).hostname.replace(/^www\./, "");
  const failedHosts = new Set(failed.map((r) => host(r.homepage)));
  return {
    ...base,
    integrated: base.integrated,
    rejected: [...patched.rejected.filter((r) => !failedHosts.has(host(r.homepage))), ...failed],
  };
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function main() {
  if (process.argv[2] === "demote") {
    const [, , , patchedPath, reason] = process.argv;
    const base = JSON.parse(readFileSync("integrations/registry.json", "utf8"));
    const patched = JSON.parse(readFileSync(patchedPath, "utf8"));
    const next = demote(base, patched, reason, new Date().toISOString().slice(0, 10));
    writeFileSync("integrations/registry.json", JSON.stringify(next, null, 2) + "\n");
    console.log(`registry: ${next.rejected.length - base.rejected.length} site(s) recorded as rejected`);
    return;
  }
  const base = process.argv[2] ?? "HEAD";
  const files = git("diff", "--cached", "--name-status", "--no-renames", base)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, path] = line.split("\t");
      let size;
      try {
        size = statSync(path).size;
      } catch {}
      return { status: status[0], path, size };
    });
  const before = JSON.parse(git("show", `${base}:integrations/registry.json`));
  const after = JSON.parse(readFileSync("integrations/registry.json", "utf8"));
  const { errors, added, rejected } = checkChanges({ files, before, after });

  console.log(`changed files (${files.length}):`);
  for (const f of files) console.log(`  ${f.status} ${f.path}`);
  if (errors.length) {
    console.error(`\npatch refused:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`\npatch accepted: added [${added.join(", ")}], ${rejected} newly rejected site(s)`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `added=${added.join(",")}\nrejected=${rejected}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
