import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without type declarations
import { MAX_NEW_TOPICS, checkChanges, checkSnapshots } from "../scripts/collection-gate.mjs";
// @ts-expect-error plain .mjs script without type declarations
import { coreTerms, ideasFrom, isCovered, sanitizeQuery } from "../scripts/collection-ideas.mjs";

type Topic = { slug: string; data: Record<string, unknown>; body: string };

const body = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
const topic = (slug: string, over: Record<string, unknown> = {}): Topic => ({
  slug,
  body,
  data: {
    title: "Free mossy rock textures",
    description: "Free mossy rock PBR textures for forest floors, ruins and cliffs, with colour, normal and roughness maps, mostly CC0, from many texture sites.",
    hub: "textures",
    search: { q: slug.replace(/-/g, " "), types: ["material", "texture"], free: true },
    related: ["existing-a", "existing-b"],
    faq: [
      { q: "Are these textures free to use?", a: "Most are CC0, which allows commercial use without credit. Check each card." },
      { q: "Which resolution should I use?", a: "2K is enough for games and the web; use 4K or more for close-up renders." },
    ],
    addedAt: "2026-10-07",
    addedBy: "agent",
    ...over,
  },
});
const existing = [topic("existing-a", { addedBy: "human" }), topic("existing-b", { addedBy: "human" })];
const base = { existing, hubs: ["textures", "hdris"], providers: ["polyhaven"] };
const file = (slug: string, status = "A") => ({ status, path: `web/src/content/collections/${slug}.md` });
const check = checkChanges as (i: { files: { status: string; path: string }[]; existing: Topic[]; added: Topic[]; hubs: string[]; providers: string[] }) => { errors: string[]; added: string[] };

describe("collection gate", () => {
  it("accepts new agent topics that meet the rules", () => {
    expect(check({ ...base, files: [file("mossy-rock")], added: [topic("mossy-rock")] })).toEqual({ errors: [], added: ["mossy-rock"] });
  });

  it("refuses other files, edits to existing topics and deletions", () => {
    const { errors } = check({
      ...base,
      files: [file("mossy-rock"), file("existing-a", "M"), file("existing-b", "D"), { status: "A", path: "src/core/service.ts" }],
      added: [topic("mossy-rock")],
    });
    expect(errors).toHaveLength(3);
  });

  it(`refuses more than ${MAX_NEW_TOPICS} topics per run`, () => {
    const slugs = Array.from({ length: MAX_NEW_TOPICS + 1 }, (_, i) => `topic-${i}`);
    expect(check({ ...base, files: slugs.map((s) => file(s)), added: slugs.map((s) => topic(s)) }).errors.join()).toMatch(/at most/);
  });

  it("refuses duplicates, human authorship and links to new pages", () => {
    const { errors } = check({
      ...base,
      files: [file("mossy-rock"), file("mossy-rock-2")],
      added: [topic("mossy-rock", { addedBy: "human" }), topic("mossy-rock-2", { search: { q: "Mossy  Rock", types: ["texture", "material"], free: true }, related: ["existing-a", "mossy-rock"] })],
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        'mossy-rock: addedBy must be "agent"',
        'mossy-rock-2: related "mossy-rock" must be an existing collection',
        'mossy-rock-2: same search as "mossy-rock"',
      ]),
    );
  });

  it("applies the editorial rules", () => {
    const { errors } = check({ ...base, files: [file("thin")], added: [{ ...topic("thin"), body: "Too short." }] });
    expect(errors.join()).toMatch(/body: 2 words/);
  });

  it("withdraws topics whose search finds too little", () => {
    const assets = (n: number, sources: number) => Array.from({ length: n }, (_, i) => ({ provider: `p${i % sources}` }));
    const snaps: Record<string, unknown> = { good: { assets: assets(20, 3) }, few: { assets: assets(5, 2) }, one: { assets: assets(30, 1) } };
    const r = checkSnapshots(["good", "few", "one", "missing"], (s: string) => snaps[s]);
    expect(r.kept).toEqual(["good"]);
    expect(r.dropped.map((d: { slug: string }) => d.slug)).toEqual(["few", "one", "missing"]);
  });
});

describe("collection ideas", () => {
  it("keeps only plain topic-like queries", () => {
    expect(sanitizeQuery("  Mossy   Rock ")).toBe("mossy rock");
    for (const bad of ["a", "john@example.com", "https://x.io/a", "www example com", "12345", "one two three four five six seven", "<script>"]) expect(sanitizeQuery(bad), bad).toBeUndefined();
  });

  it("matches queries to collections without the filler words", () => {
    expect(coreTerms("Free Sunset HDRIs")).toBe("sunset");
    expect(coreTerms("low poly trees")).toBe("lowpoly tree");
    const topics = [{ q: "sunset", aliases: ["golden hour hdri"] }];
    expect(isCovered("free sunset hdri", topics)).toBe(true);
    expect(isCovered("golden hour", topics)).toBe(true);
    expect(isCovered("free 3d models", topics)).toBe(true); // only filler: the hubs answer it
    expect(isCovered("mossy rock", topics)).toBe(false);
  });

  it("ranks frequent, uncovered queries and drops rare ones", () => {
    const rows = [
      { query: "mossy rock", count: 9 },
      { query: "Mossy Rock ", count: 2 },
      { query: "sunset hdri", count: 50 },
      { query: "rare thing", count: 2 },
      { query: "me@mail.com", count: 40 },
    ];
    const ideas = ideasFrom(rows, [{ query: "mossy rock", count: 4 }], [{ q: "sunset" }], 3);
    expect(ideas).toEqual([{ query: "mossy rock", searches: 11, zeroResults: 4 }]);
  });
});
