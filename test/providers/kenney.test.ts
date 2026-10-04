import { describe, expect, it } from "vitest";
import { kenney } from "../../src/providers/kenney.js";
import { fixtureCtx } from "../helpers.js";

const routes: [RegExp, string][] = [
  [/kenney\.nl\/assets\?search=tree$/, "kenney/search_tree.html"],
  [/kenney\.nl\/assets\/page:2$/, "kenney/page2.html"],
  [/kenney\.nl\/assets\/page:3$/, "kenney/page3.html"],
  [/kenney\.nl\/assets\/nature-kit$/, "kenney/nature-kit.html"],
  [/kenney\.nl\/assets$/, "kenney/assets.html"],
];

describe("kenney", () => {
  it("loads every listing page and boosts the site's tag search", async () => {
    const ctx = fixtureCtx(routes);
    const r = await kenney.search({ query: "low poly tree pack", limit: 10 }, ctx);
    const ids = r.assets.map((a) => a.id);
    expect(ids.slice(0, 2).sort()).toEqual(["kenney:holiday-kit", "kenney:nature-kit"]);
    expect(ids).toContain("kenney:foliage-pack");
    expect(r.assets[0]).toMatchObject({
      type: "model",
      downloadable: true,
      license: { name: "CC0" },
      price: { free: true },
      author: "Kenney",
    });
    expect(r.assets[0]!.tags).toContain("pack");
    expect(r.assets[0]!.thumbnailUrl).toMatch(/^https:\/\/kenney\.nl\/media\/pages\/assets\//);
    expect(ctx.fetch.requests).toHaveLength(4); // 3 listing pages + 1 site search
    expect(r.searchUrl).toBe("https://kenney.nl/assets?search=tree");
  });

  it("maps categories to asset types", async () => {
    const all = await kenney.search({ query: "", limit: 50 }, fixtureCtx(routes));
    const byId = Object.fromEntries(all.assets.map((a) => [a.nativeId, a.type]));
    expect(byId).toMatchObject({
      "city-kit-industrial": "model",
      "tiny-factory": "sprite",
      "skyboxes-space": "texture",
      "ui-pack": "ui",
      "crosshair-pack": "ui",
      "kenney-fonts": "font",
      "ui-audio": "audio",
    });
    expect(all.total).toBe(12);
    const ui = await kenney.search({ query: "", types: ["ui"], limit: 10 }, fixtureCtx(routes));
    expect(ui.assets.map((a) => a.nativeId).sort()).toEqual(["crosshair-pack", "ui-pack"]);
  });

  it("treats a bare 'low poly' query as a 3D browse and paginates", async () => {
    const r = await kenney.search({ query: "low poly pack", limit: 2, offset: 1 }, fixtureCtx(routes));
    expect(r.total).toBe(5);
    expect(r.assets).toHaveLength(2);
    expect(r.assets.every((a) => a.type === "model")).toBe(true);
  });

  it("skips requests for types Kenney does not have", async () => {
    const ctx = fixtureCtx(routes);
    const r = await kenney.search({ query: "sky", types: ["hdri"], limit: 10 }, ctx);
    expect(r.assets).toEqual([]);
    expect(ctx.fetch.requests).toEqual([]);
  });

  it("scrapes the asset page for tags and the direct zip", async () => {
    const d = await kenney.getAsset!("nature-kit", fixtureCtx(routes));
    expect(d).toMatchObject({ id: "kenney:nature-kit", title: "Nature Kit", type: "model", downloadable: true });
    expect(d!.tags).toEqual(expect.arrayContaining(["tree", "rock", "foliage", "nature", "3d"]));
    expect(d!.description).toContain("330 files");
    expect(d!.createdAt).toBe("2020-04-29T00:00:00.000Z");
    expect(d!.files[0]).toEqual({
      url: "https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip",
      filename: "kenney_nature-kit.zip",
      format: "zip",
      group: "archive",
    });
    expect(d!.files.filter((f) => f.group === "preview").length).toBeGreaterThan(0);
  });

  it("returns null for unknown or invalid slugs", async () => {
    expect(await kenney.getAsset!("nope", fixtureCtx(routes))).toBeNull();
    expect(await kenney.getAsset!("../etc", fixtureCtx(routes))).toBeNull();
  });
});
