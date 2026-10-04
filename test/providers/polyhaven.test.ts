import { describe, expect, it } from "vitest";
import { polyhaven } from "../../src/providers/polyhaven.js";
import { fixtureCtx } from "../helpers.js";

const routes: [string, string][] = [
  ["/assets?t=all", "polyhaven/assets.json"],
  ["/info/ArmChair_01", "polyhaven/info_ArmChair_01.json"],
  ["/files/ArmChair_01", "polyhaven/files_ArmChair_01.json"],
];

describe("polyhaven", () => {
  it("searches the catalogue by relevance", async () => {
    const r = await polyhaven.search({ query: "wooden chair", limit: 5 }, fixtureCtx(routes));
    expect(r.assets[0]?.id).toBe("polyhaven:WoodenChair_01");
    expect(r.assets[0]).toMatchObject({ type: "model", downloadable: true, license: { name: "CC0" } });
  });

  it("filters by type", async () => {
    const r = await polyhaven.search({ query: "", types: ["hdri"], limit: 10 }, fixtureCtx(routes));
    expect(r.assets.map((a) => a.type)).toEqual(["hdri", "hdri"]);
  });

  it("skips the request when types do not apply", async () => {
    const ctx = fixtureCtx(routes);
    const r = await polyhaven.search({ query: "x", types: ["audio"], limit: 10 }, ctx);
    expect(r.assets).toEqual([]);
    expect(ctx.fetch.requests).toEqual([]);
  });

  it("returns files with gltf companions", async () => {
    const d = await polyhaven.getAsset!("ArmChair_01", fixtureCtx(routes));
    const gltf2k = d!.files.find((f) => f.group === "gltf" && f.resolution === "2k");
    expect(gltf2k?.format).toBe("gltf");
    expect(gltf2k?.includes?.some((i) => i.path.endsWith(".bin"))).toBe(true);
  });
});
