import { describe, expect, it } from "vitest";
import { inferType, matchScore, parseAssetId } from "../src/core/util.js";

describe("inferType", () => {
  it.each([
    ["Low Poly Trees with Textures", "model"],
    ["low-poly nature pack", "model"],
    ["Seamless brick textures", "texture"],
    ["Sci-fi PBR materials", "material"],
    ["Sunset HDRI", "hdri"],
    ["RPG sound effects", "audio"],
    ["Pixel art tileset", "sprite"],
    ["Fantasy UI buttons", "ui"],
  ])("%s -> %s", (text, type) => expect(inferType(text)).toBe(type));
});

describe("matchScore", () => {
  it("prefers title over tags and handles plurals", () => {
    expect(matchScore({ title: "Wooden Chairs" }, "wooden chair")).toBe(1);
    expect(matchScore({ title: "Seat", tags: ["chair"] }, "chair")).toBeCloseTo(0.7);
    expect(matchScore({ title: "Table" }, "chair")).toBe(0);
  });
});

describe("parseAssetId", () => {
  it("splits on the first colon only", () => {
    expect(parseAssetId("itchio:user:slug")).toEqual({ provider: "itchio", nativeId: "user:slug" });
    expect(parseAssetId("bad")).toBeNull();
  });
});
