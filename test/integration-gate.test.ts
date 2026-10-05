import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without type declarations
import { checkChanges, demote } from "../scripts/integration-gate.mjs";

type Entry = { id: string; name: string; homepage: string; access: string; addedAt: string; addedBy: string };
type Registry = { integrated: Entry[]; rejected: { name: string; homepage: string; checkedAt: string; reason: string }[] };
const check = checkChanges as (i: { files: { status: string; path: string; size?: number }[]; before: Registry; after: Registry }) => {
  errors: string[];
  added: string[];
  rejected: number;
};

const poly: Entry = { id: "polyhaven", name: "Poly Haven", homepage: "https://polyhaven.com", access: "api", addedAt: "2026-10-04", addedBy: "launch" };
const neu: Entry = { id: "newsite", name: "New Site", homepage: "https://new.example", access: "api", addedAt: "2026-10-06", addedBy: "agent" };
const before: Registry = { integrated: [poly], rejected: [] };
const withNew: Registry = { integrated: [poly, neu], rejected: [] };
const newSourceFiles = [
  { status: "A", path: "src/providers/newsite.ts" },
  { status: "M", path: "src/providers/index.ts" },
  { status: "A", path: "test/providers/newsite.test.ts" },
  { status: "A", path: "test/live/newsite.live.test.ts" },
  { status: "A", path: "test/fixtures/newsite/search.json", size: 4000 },
  { status: "M", path: "integrations/registry.json" },
  { status: "M", path: "README.md" },
  { status: "M", path: "web/src/content/AGENTS.md" },
  { status: "M", path: "web/src/pages/docs/index.md" },
  { status: "M", path: "web/src/data/providers.json" },
];

describe("integration gate", () => {
  it("accepts a complete new source", () => {
    expect(check({ files: newSourceFiles, before, after: withNew })).toEqual({ errors: [], added: ["newsite"], rejected: 0 });
  });

  it("accepts a run that only records rejected sites", () => {
    const after = { ...before, rejected: [{ name: "X", homepage: "https://www.x.example", checkedAt: "2026-10-06", reason: "search requires login" }] };
    expect(check({ files: [{ status: "M", path: "integrations/registry.json" }], before, after })).toEqual({ errors: [], added: [], rejected: 1 });
  });

  it("refuses files outside the allowlist, deletions and edited tests", () => {
    const { errors } = check({
      files: [
        ...newSourceFiles,
        { status: "M", path: ".github/workflows/ci.yml" },
        { status: "M", path: "package.json" },
        { status: "M", path: "src/api/app.ts" },
        { status: "D", path: "test/providers/kenney.test.ts" },
        { status: "M", path: "test/providers/polyhaven.test.ts" },
        { status: "A", path: "test/fixtures/site/index.html" },
        { status: "A", path: "test/fixtures/newsite/huge.json", size: 500_000 },
      ],
      before,
      after: withNew,
    });
    expect(errors.join("\n")).toMatch(/ci\.yml: outside/);
    expect(errors.join("\n")).toMatch(/package\.json: outside/);
    expect(errors.join("\n")).toMatch(/src\/api\/app\.ts: outside/);
    expect(errors.join("\n")).toMatch(/kenney\.test\.ts: deleted/);
    expect(errors.join("\n")).toMatch(/polyhaven\.test\.ts: existing tests/);
    expect(errors.join("\n")).toMatch(/fixtures\/site\/index\.html: outside/);
    expect(errors.join("\n")).toMatch(/huge\.json: fixture over/);
  });

  it("requires provider, tests and registration for a new source", () => {
    const { errors } = check({ files: [{ status: "M", path: "integrations/registry.json" }], before, after: withNew });
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("src/providers/newsite.ts: required"),
        expect.stringContaining("test/providers/newsite.test.ts: required"),
        expect.stringContaining("test/live/newsite.live.test.ts: required"),
        expect.stringContaining("not registered"),
      ]),
    );
  });

  it("allows one new source per run and protects existing registry entries", () => {
    const two = { ...withNew, integrated: [poly, neu, { ...neu, id: "other", homepage: "https://other.example" }] };
    expect(check({ files: newSourceFiles, before, after: two }).errors).toContainEqual(expect.stringContaining("2 sources added"));
    const changed = { ...withNew, integrated: [{ ...poly, addedAt: "2020-01-01" }, neu] };
    expect(check({ files: newSourceFiles, before, after: changed }).errors).toContainEqual(expect.stringContaining('"polyhaven" was changed'));
    expect(check({ files: newSourceFiles, before, after: { ...withNew, integrated: [neu] } }).errors).toContainEqual(expect.stringContaining('"polyhaven" was removed'));
  });

  it("refuses provider code changes that add no source", () => {
    const { errors } = check({ files: [{ status: "M", path: "src/providers/kenney.ts" }], before, after: before });
    expect(errors).toContainEqual(expect.stringContaining("without adding a source"));
  });

  it("demotes a source that failed verification and keeps the agent's rejections", () => {
    const rejectedX = { name: "X", homepage: "https://x.example", checkedAt: "2026-10-06", reason: "search requires login" };
    const patched = { integrated: [poly, neu], rejected: [rejectedX] };
    const next = (demote as (b: Registry, p: Registry, r: string, t: string) => Registry)(before, patched, "failed workflow verification", "2026-10-06");
    expect(next.integrated).toEqual([poly]);
    expect(next.rejected).toEqual([
      rejectedX,
      { name: "New Site", homepage: "https://new.example", checkedAt: "2026-10-06", reason: "failed workflow verification", recheckAfter: "2026-11-05" },
    ]);
  });
});
