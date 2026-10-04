import { describe, expect, it } from "vitest";
import { quaternius } from "../../src/providers/quaternius.js";
import { fixtureCtx } from "../helpers.js";

const routes: [RegExp, string][] = [
  [/quaternius\.com\/packs\/ultimatenature\.html$/, "quaternius/ultimatenature.html"],
  [/quaternius\.com\/packs\/bestiarydungeonmonsterskit\.html$/, "quaternius/bestiarydungeonmonsterskit.html"],
  [/quaternius\.com\/$/, "quaternius/home.html"],
];

describe("quaternius", () => {
  it("lists packs from the homepage with one request", async () => {
    const ctx = fixtureCtx(routes);
    const r = await quaternius.search({ query: "", limit: 50 }, ctx);
    expect(r.total).toBe(7); // the Patreon "All In One" card is not a pack page
    expect(ctx.fetch.requests).toEqual(["https://quaternius.com/"]);
    expect(r.assets[0]).toMatchObject({
      id: "quaternius:bestiarydungeonmonsterskit",
      type: "model",
      downloadable: false,
      url: "https://quaternius.com/packs/bestiarydungeonmonsterskit.html",
      thumbnailUrl: "https://quaternius.com/assets/images/thumbnails/bestiarydungeonmonsterskit.jpg",
      price: { free: true },
    });
    expect(r.assets[0]).not.toHaveProperty("keywords");
  });

  it("ranks by title, tags and the hidden keyword blob", async () => {
    const r = await quaternius.search({ query: "low poly tree pack", limit: 3 }, fixtureCtx(routes));
    expect(r.assets.map((a) => a.nativeId).slice(0, 2).sort()).toEqual(["stylizedtree", "ultimatenature"]);
    const zombie = await quaternius.search({ query: "zombie", limit: 5 }, fixtureCtx(routes));
    expect(zombie.assets[0]?.nativeId).toBe("animatedzombie");
    // "nyc" only appears in the Downtown City card's hidden keywords
    const nyc = await quaternius.search({ query: "nyc", limit: 5 }, fixtureCtx(routes));
    expect(nyc.assets.map((a) => a.nativeId)).toEqual(["downtowncitymegakit"]);
  });

  it("flags animated / rigged packs", async () => {
    const r = await quaternius.search({ query: "animated character", limit: 5 }, fixtureCtx(routes));
    const ids = r.assets.map((a) => a.nativeId);
    expect(ids.slice(0, 2).sort()).toEqual(["animatedwoman", "animatedzombie"]);
    expect(r.assets[0]).toMatchObject({ animated: true, rigged: true });
    expect(r.assets[0]!.tags).toEqual(expect.arrayContaining(["animated", "rigged", "characters"]));
  });

  it("returns nothing for non-model types without requesting", async () => {
    const ctx = fixtureCtx(routes);
    expect((await quaternius.search({ query: "tree", types: ["texture"], limit: 5 }, ctx)).assets).toEqual([]);
    expect(ctx.fetch.requests).toEqual([]);
  });

  it("scrapes pack details; Drive folders are links, not downloads", async () => {
    const d = await quaternius.getAsset!("ultimatenature", fixtureCtx(routes));
    expect(d).toMatchObject({
      title: "Ultimate Nature Pack",
      formats: ["fbx", "obj", "blend"],
      license: { name: "CC0" },
      animated: false,
      downloadable: false,
      createdAt: "2019-06-01T00:00:00.000Z",
      thumbnailUrl: "https://quaternius.com/assets/images/fullres/ultimatenature.jpg",
    });
    expect(d!.description).toContain("150 models");
    expect(d!.files).toEqual([
      {
        url: "https://drive.google.com/drive/folders/1-Kl0L_Jg8awbh0S5T-z3zxh4mVlnxTpa?usp=sharing",
        filename: "Ultimate Nature Pack (Google Drive folder)",
        format: "link",
        group: "google-drive",
        requiresAuth: true,
      },
    ]);
  });

  it("reads the QAL license and itch.io download page on newer kits", async () => {
    const d = await quaternius.getAsset!("bestiarydungeonmonsterskit", fixtureCtx(routes));
    expect(d!.license).toMatchObject({ name: "QAL", commercialUse: true, attributionRequired: false });
    expect(d!.rigged).toBe(true);
    expect(d!.formats).toContain("gltf");
    expect(d!.files[0]).toMatchObject({ url: "https://quaternius.itch.io/bestiary-dungeon-monsters-kit", group: "itch.io" });
  });

  it("returns null for unknown or invalid slugs", async () => {
    expect(await quaternius.getAsset!("nope", fixtureCtx(routes))).toBeNull();
    expect(await quaternius.getAsset!("../x", fixtureCtx(routes))).toBeNull();
  });
});
