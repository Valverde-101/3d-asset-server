import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { MIN_INDEXABLE, MIN_SOURCES, isIndexable, selectAssets, snapshotCollection, type CollectionSnapshot, type SnapshotAsset } from "../src/core/collections.js";
import type { SearchResponse } from "../src/core/service.js";
import type { Asset, Pricing } from "../src/core/types.js";
import { makeAsset } from "../src/core/util.js";
import { allProviders } from "../src/providers/index.js";
// @ts-expect-error plain .mjs module without type declarations
import { readHubs, readSnapshot, readTopics, searchKey, topicErrors } from "../scripts/lib/topics.mjs";

const pricing = new Map<string, Pricing>([
  ["polyhaven", "free"],
  ["blenderkit", "freemium"],
  ["itchio", "freemium"],
]);

const asset = (provider: string, n: number, over: Partial<Asset> = {}): Asset =>
  makeAsset({
    provider,
    nativeId: `${provider}-${n}`,
    title: `Sunset ${provider} ${n}`,
    type: "hdri",
    tags: [],
    url: `https://${provider}.example/${n}`,
    thumbnailUrl: `https://${provider}.example/${n}.jpg`,
    downloadable: true,
    ...over,
  });

const search = { q: "sunset", types: ["hdri" as const], free: true };

describe("selectAssets", () => {
  it("keeps relevant, free assets with a thumbnail, once per id and title", () => {
    const picked = selectAssets(
      [
        asset("polyhaven", 1),
        asset("polyhaven", 1), // same id again
        asset("polyhaven", 2, { title: "Sunset polyhaven 1" }), // same title on the same source
        asset("polyhaven", 3, { title: "Studio lights" }), // not about sunsets
        asset("polyhaven", 4, { thumbnailUrl: undefined }),
        asset("polyhaven", 5, { thumbnailUrl: "http://insecure.example/5.jpg" }),
        asset("blenderkit", 1, { price: { free: false } }),
        asset("blenderkit", 2), // freemium source, price unknown: not provably free
        asset("blenderkit", 3, { price: { free: true } }),
      ],
      { search, pricing },
    );
    expect(picked.map((a) => a.id)).toEqual(["polyhaven:polyhaven-1", "blenderkit:blenderkit-3"]);
  });

  it("ignores near misses that only start like the query", () => {
    const picked = selectAssets([asset("polyhaven", 1, { title: "Card kit" }), asset("polyhaven", 2, { title: "Red car" })], { search: { q: "car" }, pricing });
    expect(picked.map((a) => a.title)).toEqual(["Red car"]);
  });

  it("drops excluded title phrases and ids", () => {
    const picked = selectAssets([asset("polyhaven", 1, { title: "Sunset Road Sign" }), asset("polyhaven", 2), asset("polyhaven", 3)], {
      search: { ...search, exclude: ["road sign", "polyhaven:polyhaven-3"] },
      pricing,
    });
    expect(picked.map((a) => a.id)).toEqual(["polyhaven:polyhaven-2"]);
  });

  it("caps one source at 40% of the page", () => {
    const fresh = [...Array.from({ length: 30 }, (_, i) => asset("polyhaven", i)), ...Array.from({ length: 5 }, (_, i) => asset("blenderkit", i, { price: { free: true } }))];
    const picked = selectAssets(fresh, { search, pricing, max: 20 });
    expect(picked.filter((a) => a.provider === "polyhaven")).toHaveLength(8);
    expect(picked.filter((a) => a.provider === "blenderkit")).toHaveLength(5);
  });

  it("keeps previous assets in place, fills gaps with new ones and keeps a failed source's assets", () => {
    const prev = selectAssets([asset("polyhaven", 1), asset("blenderkit", 1, { price: { free: true } }), asset("polyhaven", 2)], { search, pricing });
    // This run: blenderkit failed, polyhaven 2 is gone, polyhaven 9 is new and ranks first.
    const next = selectAssets([asset("polyhaven", 9), asset("polyhaven", 1)], { search, pricing, previous: prev, failed: new Set(["blenderkit"]) });
    expect(next.map((a) => a.id)).toEqual(["polyhaven:polyhaven-1", "blenderkit:blenderkit-1", "polyhaven:polyhaven-9"]);
  });
});

describe("isIndexable", () => {
  const as = (n: number, sources: number) => Array.from({ length: n }, (_, i) => ({ id: `${i}`, provider: `p${i % sources}` }) as SnapshotAsset);
  it("needs enough assets from more than one source", () => {
    expect(isIndexable(as(MIN_INDEXABLE, MIN_SOURCES))).toBe(true);
    expect(isIndexable(as(MIN_INDEXABLE - 1, MIN_SOURCES))).toBe(false);
    expect(isIndexable(as(40, 1))).toBe(false);
  });
});

describe("snapshotCollection", () => {
  const response = (results: Asset[], failed: string[] = []): SearchResponse => ({
    query: "sunset",
    results,
    providers: failed.map((provider) => ({ provider, name: provider, status: "error" as const, count: 0, tookMs: 1 })),
  });
  const fresh = Array.from({ length: 3 }, (_, i) => asset("polyhaven", i));

  it("moves updatedAt only when the list changes", async () => {
    const first = await snapshotCollection(async () => response(fresh), "free-sunset-hdris", search, { pricing, now: new Date("2026-10-01T00:00:00Z") });
    expect(first.changed).toBe(true);
    const again = await snapshotCollection(async () => response(fresh), "free-sunset-hdris", search, { pricing, previous: first.snapshot, now: new Date("2026-10-02T00:00:00Z") });
    expect(again.changed).toBe(false);
    expect(again.snapshot.updatedAt).toBe("2026-10-01T00:00:00.000Z");
    const more = await snapshotCollection(async () => response([...fresh, asset("polyhaven", 7)]), "free-sunset-hdris", search, { pricing, previous: again.snapshot, now: new Date("2026-10-03T00:00:00Z") });
    expect(more).toMatchObject({ changed: true, added: 1, kept: 3, dropped: 0 });
    expect(more.snapshot.updatedAt).toBe("2026-10-03T00:00:00.000Z");
  });

  it("skips assets whose thumbnail is gone and lets the next one take the slot", async () => {
    const results = Array.from({ length: 4 }, (_, i) => asset(i % 2 ? "polyhaven" : "blenderkit", i, { price: { free: true } }));
    const checked: string[] = [];
    const r = await snapshotCollection(async () => response(results), "s", search, {
      pricing,
      checkImage: async (url) => {
        checked.push(url);
        return !url.includes("/1.jpg");
      },
    });
    expect(r.snapshot.assets.map((a) => a.id)).toEqual(["blenderkit:blenderkit-0", "blenderkit:blenderkit-2", "polyhaven:polyhaven-3"]);
    expect(r.brokenImages).toBe(1);
    expect(new Set(checked).size).toBe(checked.length); // each thumbnail checked once
    expect(r.snapshot.search).toEqual(search); // broken ids are not saved into the search
  });

  it("starts over when the search itself changes", async () => {
    const previous: CollectionSnapshot = { slug: "s", search: { q: "night" }, updatedAt: "2026-01-01T00:00:00.000Z", assets: [{ id: "polyhaven:old" } as SnapshotAsset] };
    const r = await snapshotCollection(async () => response(fresh, ["polyhaven"]), "s", search, { pricing, previous });
    expect(r.snapshot.assets.map((a) => a.id)).not.toContain("polyhaven:old");
  });
});

describe("collection topics", () => {
  const topics = readTopics() as { slug: string; data: { search: object; hub: string } }[];
  const hubs = (readHubs() as { id: string }[]).map((h) => h.id);
  const ctx = { hubs, slugs: topics.map((t) => t.slug), providers: allProviders.map((p) => p.id) };

  it("has topics", () => expect(topics.length).toBeGreaterThanOrEqual(20));

  it.each(topics.map((t) => [t.slug, t]))("%s meets the editorial rules", (_, t) => {
    expect(topicErrors(t, ctx)).toEqual([]);
  });

  it("gives every topic its own search", () => {
    const keys = topics.map((t) => searchKey(t.data.search));
    expect(new Set(keys).size).toBe(keys.length);
  });

  // Only that a snapshot exists: how many assets it holds depends on the live
  // sources (a thin page is noindexed by the site), and the daily refresh must
  // never fail CI. New topics are held to the indexable minimum by the gate.
  it.each(topics.map((t) => [t.slug]))("%s has a snapshot", (slug) => {
    const snap = readSnapshot(slug) as CollectionSnapshot | undefined;
    expect(snap, `run: node scripts/snapshot-collections.mjs ${slug}`).toBeDefined();
    expect(snap!.slug).toBe(slug);
    for (const a of snap!.assets) expect(a.thumbnailUrl).toMatch(/^https:\/\//);
  });

  it("has no snapshot without a topic", () => {
    const dir = new URL("../web/src/data/collections/", import.meta.url);
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) expect(ctx.slugs, f).toContain(f.replace(/\.json$/, ""));
  });

  it("keeps the website's thresholds in step with the snapshot's", () => {
    for (const file of ["../web/src/lib/collections.ts", "../web/integrations/sitemap-meta.mjs"]) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(src, file).toContain(`MIN_INDEXABLE = ${MIN_INDEXABLE};`);
      expect(src, file).toContain(`MIN_SOURCES = ${MIN_SOURCES};`);
    }
  });
});
