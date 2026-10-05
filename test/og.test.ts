import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createApp } from "../src/api/app.js";
import { OgImages } from "../src/api/og.js";
import { assetMeta, searchMeta, searchShare, shareableAssetId } from "../src/api/search-meta.js";
import { rewriteHead } from "../src/api/site.js";
import { AssetService } from "../src/core/service.js";
import { OG_HEIGHT, OG_WIDTH, clip, fetchImage, pageCard, renderPng } from "../src/og/render.js";
import { CRATE, brokenProvider, bytesHttp, fakeProvider } from "./fakes.js";

const SITE = fileURLToPath(new URL("./fixtures/site", import.meta.url));
const service = () => new AssetService({ providers: [fakeProvider, brokenProvider], http: bytesHttp(), defaultTimeoutMs: 200 });
const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const meta = (html: string, key: string) => html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`))?.[1];

describe("OG renderer", () => {
  it("renders a 1200×630 PNG card", async () => {
    const png = await renderPng(pageCard({ kicker: "Docs", title: "MCP server for coding agents", subtitle: "Connect Claude Code.", chips: ["MCP"], site: "3d.shep.bot" }));
    expect(isPng(png)).toBe(true);
    expect(await sharp(png).metadata()).toMatchObject({ width: OG_WIDTH, height: OG_HEIGHT, format: "png" });
  });

  it("clips long text on a word boundary", () => {
    expect(clip("The quick brown fox jumps over the lazy dog", 20)).toBe("The quick brown…");
    expect(clip("short", 12)).toBe("short");
  });

  it("fetches thumbnails as JPEG data URIs (any image format) and refuses internal hosts", async () => {
    const webp = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#c33" } }).webp().toBuffer();
    const fetchWebp = (async () => new Response(new Uint8Array(webp), { headers: { "content-type": "image/webp" } })) as typeof fetch;
    const uri = await fetchImage("https://cdn.example/t.webp", { fetch: fetchWebp });
    expect(uri?.startsWith("data:image/jpeg;base64,")).toBe(true);
    const jpeg = Buffer.from(uri!.split(",")[1]!, "base64");
    expect(await sharp(jpeg).metadata()).toMatchObject({ width: 420, height: 420, format: "jpeg" });

    let called = false;
    const spy = (async () => ((called = true), new Response("x"))) as typeof fetch;
    expect(await fetchImage("http://127.0.0.1/x.png", { fetch: spy })).toBeUndefined();
    expect(await fetchImage("http://169.254.169.254/latest", { fetch: spy })).toBeUndefined();
    expect(called).toBe(false);
    // A redirect to an internal host is refused too.
    const redirect = (async (u: string | URL) =>
      String(u).includes("cdn.example") ? new Response(null, { status: 302, headers: { location: "http://10.0.0.5/x.png" } }) : ((called = true), new Response("x"))) as typeof fetch;
    expect(await fetchImage("https://cdn.example/a.png", { fetch: redirect })).toBeUndefined();
    expect(called).toBe(false);
    const html = (async () => new Response("<html>", { headers: { "content-type": "text/html" } })) as typeof fetch;
    expect(await fetchImage("https://cdn.example/a.png", { fetch: html })).toBeUndefined();
  });
});

describe("share metadata", () => {
  it("normalises search share links", () => {
    const s = searchShare(new URLSearchParams("q=  brick   wall &type=material,spaceship&free=true&offset=40&providers=polyhaven,nope"))!;
    expect(s.key).toBe("q=brick+wall&type=material&free=true&providers=polyhaven");
    expect(s).toMatchObject({ kicker: "Search · PBR materials", title: "“brick wall”" });
    expect(s.chips).toEqual(["Free only", "Poly Haven"]);
    expect(searchShare(new URLSearchParams("offset=10"))).toBeUndefined();
    expect(searchMeta(new URLSearchParams("q=crate"))).toMatchObject({ image: "/og/query.png?q=crate", robots: "noindex, follow" });
  });

  it("validates asset ids against the running providers", () => {
    expect(shareableAssetId("fake:crate", ["fake"])).toBe("fake:crate");
    expect(shareableAssetId("nope:crate", ["fake"])).toBeUndefined();
    expect(shareableAssetId("fake:", ["fake"])).toBeUndefined();
    expect(shareableAssetId("crate", ["fake"])).toBeUndefined();
    expect(shareableAssetId(`fake:${"x".repeat(400)}`, ["fake"])).toBeUndefined();
  });

  it("describes an asset for its share link", () => {
    const m = assetMeta(CRATE);
    expect(m.title).toBe("Wooden Crate: 3D model on fake · 3D Asset Server");
    expect(m.description).toContain("3D model “Wooden Crate” on fake (CC0 licence, free)");
    expect(m.image).toBe("/og/asset.png?id=fake%3Acrate");
  });

  it("rewrites image, alt and url tags with escaping", () => {
    const html = '<meta property="og:image" content="a"><meta name="twitter:image" content="a"><meta property="og:image:alt" content="a"><meta name="twitter:image:alt" content="a"><meta property="og:url" content="a"><meta name="twitter:url" content="a">';
    const out = rewriteHead(html, { image: "https://x/og.png?q=a&b", imageAlt: '"quoted"', url: "https://x/search?q=a" });
    expect(meta(out, "og:image")).toBe("https://x/og.png?q=a&amp;b");
    expect(meta(out, "twitter:image")).toBe("https://x/og.png?q=a&amp;b");
    expect(meta(out, "og:image:alt")).toBe("&quot;quoted&quot;");
    expect(meta(out, "twitter:url")).toBe("https://x/search?q=a");
  });
});

describe("OG endpoints and share links", () => {
  const app = createApp(service(), { siteRoot: SITE, publicBaseUrl: "https://3d.shep.bot" });

  it("serves search cards, cacheable for a day", async () => {
    const res = await app.request("/og/query.png?q=crate&type=model");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(isPng(new Uint8Array(await res.arrayBuffer()))).toBe(true);
    expect((await app.request("/og/query.png")).status).toBe(404);
    const head = await app.request("/og/query.png?q=crate", { method: "HEAD" });
    expect(head.status).toBe(200);
  });

  it("serves asset cards and 404s unknown or malformed ids", async () => {
    const res = await app.request(`/og/asset.png?id=${encodeURIComponent("fake:crate")}`);
    expect(res.status).toBe(200);
    expect(isPng(new Uint8Array(await res.arrayBuffer()))).toBe(true);
    expect((await app.request("/og/asset.png?id=fake:missing")).status).toBe(404);
    expect((await app.request("/og/asset.png?id=broken:x")).status).toBe(404);
    expect((await app.request("/og/asset.png?id=../../etc")).status).toBe(404);
  });

  it("gives /search?asset= links the asset's title, card and url", async () => {
    const html = await (await app.request("/search?asset=fake%3Acrate", { headers: { accept: "text/html" } })).text();
    expect(html).toContain("<title>Wooden Crate: 3D model on fake · 3D Asset Server</title>");
    expect(meta(html, "og:image")).toBe("https://3d.shep.bot/og/asset.png?id=fake%3Acrate");
    expect(meta(html, "twitter:image")).toBe("https://3d.shep.bot/og/asset.png?id=fake%3Acrate");
    expect(meta(html, "og:url")).toBe("https://3d.shep.bot/search?asset=fake%3Acrate");
    expect(meta(html, "robots")).toBe("noindex, follow");
    // Unknown asset: the plain search page.
    const plain = await (await app.request("/search?asset=fake%3Amissing", { headers: { accept: "text/html" } })).text();
    expect(meta(plain, "og:image")).toBe("https://3d.shep.bot/og/search.png");
  });

  it("gives search links a query card and their own og:url", async () => {
    const html = await (await app.request("/search?q=crate&offset=20", { headers: { accept: "text/html" } })).text();
    expect(meta(html, "og:image")).toBe("https://3d.shep.bot/og/query.png?q=crate");
    expect(meta(html, "og:url")).toBe("https://3d.shep.bot/search?q=crate");
    expect(meta(html, "og:image:alt")).toContain("“crate”");
  });

  it("caches cards and renders at most two at once", async () => {
    let active = 0;
    let peak = 0;
    const slow = {
      ...fakeProvider,
      async getAsset(id: string) {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 30));
        active--;
        return { ...CRATE, nativeId: id, id: `fake:${id}`, thumbnailUrl: undefined };
      },
    };
    const og = new OgImages(new AssetService({ providers: [slow], http: bytesHttp() }), { site: "3d.shep.bot" });
    const first = og.asset("fake:a");
    expect(og.asset("fake:a")).toBe(first);
    await Promise.all([first, og.asset("fake:b"), og.asset("fake:c"), og.asset("fake:d")]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("returns a shareUrl with asset details (REST)", async () => {
    const body = (await (await app.request(`/v1/assets/${encodeURIComponent("fake:crate")}`)).json()) as { shareUrl: string };
    expect(body.shareUrl).toBe("https://3d.shep.bot/search?asset=fake%3Acrate");
  });
});
