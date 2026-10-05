/**
 * integrations/registry.json is the memory of the daily discovery workflow
 * (.github/workflows/discover-integrations.yml): every live source, when it
 * was added, and every site already evaluated and rejected. These checks keep
 * it in step with the provider registry so an automated integration can't
 * ship half-registered.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { allProviders } from "../src/providers/index.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Registry = z
  .object({
    integrated: z.array(
      z
        .object({
          id: z.string().regex(/^[a-z0-9-]+$/),
          name: z.string().min(1),
          homepage: z.string().url(),
          access: z.enum(["api", "scrape", "link"]),
          addedAt: day,
          addedBy: z.enum(["launch", "human", "agent"]),
          notes: z.string().optional(),
        })
        .strict(),
    ),
    rejected: z.array(
      z
        .object({
          name: z.string().min(1),
          homepage: z.string().url(),
          checkedAt: day,
          reason: z.string().min(10),
          /** Re-evaluate after this date (e.g. an API that is "coming soon"). */
          recheckAfter: day.optional(),
        })
        .strict(),
    ),
  })
  .strict();

const registry = Registry.parse(JSON.parse(readFileSync(new URL("../integrations/registry.json", import.meta.url), "utf8")));
const host = (u: string) => new URL(u).hostname.replace(/^www\./, "");

describe("integrations registry", () => {
  it("lists exactly the registered providers", () => {
    expect(registry.integrated.map((i) => i.id).sort()).toEqual(allProviders.map((p) => p.id).sort());
  });

  it("matches each provider's name, homepage and access method", () => {
    for (const p of allProviders) {
      const i = registry.integrated.find((x) => x.id === p.id)!;
      expect({ id: i.id, name: i.name, homepage: host(i.homepage), access: i.access }).toEqual({ id: p.id, name: p.name, homepage: host(p.homepage), access: p.access });
    }
  });

  it("never lists a site as both integrated and rejected, or twice", () => {
    const integrated = registry.integrated.map((i) => host(i.homepage));
    const rejected = registry.rejected.map((r) => host(r.homepage));
    expect(new Set(integrated).size).toBe(integrated.length);
    expect(new Set(rejected).size).toBe(rejected.length);
    expect(rejected.filter((h) => integrated.includes(h))).toEqual([]);
  });

  it("gives every provider added by the agent offline and live tests", () => {
    for (const i of registry.integrated.filter((x) => x.addedBy === "agent")) {
      expect(existsSync(new URL(`./providers/${i.id}.test.ts`, import.meta.url)), `test/providers/${i.id}.test.ts`).toBe(true);
      expect(existsSync(new URL(`./live/${i.id}.live.test.ts`, import.meta.url)), `test/live/${i.id}.live.test.ts`).toBe(true);
    }
  });
});
