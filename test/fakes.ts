import type { AssetDetails, HttpClient, Provider } from "../src/core/types.js";
import { filterLocal, makeAsset, paginate } from "../src/core/util.js";

export const CRATE: AssetDetails = {
  ...makeAsset({
    provider: "fake",
    nativeId: "crate",
    title: "Wooden Crate",
    type: "model",
    tags: ["wood", "box"],
    url: "https://fake.example/crate",
    license: { name: "CC0", attributionRequired: false },
    price: { free: true },
    downloadable: true,
  }),
  files: [
    {
      url: "https://cdn.fake.example/crate_1k.gltf",
      filename: "crate_1k.gltf",
      format: "gltf",
      resolution: "1k",
      group: "gltf",
      sizeBytes: 4,
      includes: [{ path: "textures/crate_diff_1k.jpg", url: "https://cdn.fake.example/crate_diff_1k.jpg", sizeBytes: 4 }],
    },
    {
      url: "https://cdn.fake.example/crate_2k.gltf",
      filename: "crate_2k.gltf",
      format: "gltf",
      resolution: "2k",
      group: "gltf",
      sizeBytes: 4,
      includes: [{ path: "textures/crate_diff_2k.jpg", url: "https://cdn.fake.example/crate_diff_2k.jpg", sizeBytes: 4 }],
    },
    { url: "https://cdn.fake.example/crate_2k.blend", filename: "crate_2k.blend", format: "blend", resolution: "2k", group: "blend" },
    { url: "https://cdn.fake.example/crate.fbx", filename: "crate.fbx", format: "fbx", group: "fbx" },
  ],
};

const SKY = makeAsset({
  provider: "fake",
  nativeId: "sky",
  title: "Sunset Sky",
  type: "hdri",
  tags: ["sky", "sunset"],
  url: "https://fake.example/sky",
  price: { free: true },
  downloadable: false,
});

export const fakeProvider: Provider = {
  id: "fake",
  name: "Fake",
  homepage: "https://fake.example",
  description: "Test provider",
  assetTypes: ["model", "hdri"],
  access: "api",
  pricing: "free",
  supportsDownload: true,
  buildSearchUrl: (q) => `https://fake.example/search?q=${encodeURIComponent(q.query)}`,
  async search(q) {
    const items = filterLocal([CRATE, SKY], q);
    return { assets: paginate(items, q), total: items.length };
  },
  async getAsset(id) {
    return id === "crate" ? CRATE : null;
  },
};

export const brokenProvider: Provider = {
  ...fakeProvider,
  id: "broken",
  name: "Broken",
  getAsset: undefined,
  async search() {
    throw new Error("boom");
  },
};

export const slowProvider: Provider = {
  ...fakeProvider,
  id: "slow",
  name: "Slow",
  search: () => new Promise(() => undefined),
};

/** HttpClient that serves the bytes "data" for any URL and records requests. */
export function bytesHttp(): HttpClient & { requests: string[] } {
  const requests: string[] = [];
  const body = (url: string) => new TextEncoder().encode(`data:${url.slice(url.lastIndexOf("/") + 1)}`);
  return {
    requests,
    async raw(url) {
      requests.push(url);
      return new Response(body(url));
    },
    async text(url) {
      requests.push(url);
      return new TextDecoder().decode(body(url));
    },
    async json() {
      throw new Error("not used");
    },
  };
}
