import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createApp } from "../src/api/app.js";
import { PrometheusAnalytics } from "../src/core/analytics.js";
import { prefersMarkdown } from "../src/api/negotiate.js";
import { openApiSpec } from "../src/api/openapi.js";
import { searchMeta } from "../src/api/search-meta.js";
import { buildCsp, rewriteHead } from "../src/api/site.js";
import { createHash } from "node:crypto";
import { brotliDecompressSync } from "node:zlib";
import { assertPublicUrl, downloadFiles, safeRelative, selectFiles } from "../src/core/download.js";
import { AssetService } from "../src/core/service.js";
import { createMcpServer } from "../src/mcp/server.js";
import { allProviders } from "../src/providers/index.js";
import { fab } from "../src/providers/linked.js";
import { CRATE, brokenProvider, bytesHttp, fakeProvider, slowProvider } from "./fakes.js";

function service(http = bytesHttp()) {
  return new AssetService({ providers: [fakeProvider, brokenProvider, slowProvider, fab], http, defaultTimeoutMs: 200 });
}

describe("AssetService.search", () => {
  it("merges results and reports every provider", async () => {
    const res = await service().search({ query: "wooden crate" });
    expect(res.results.map((a) => a.id)).toEqual(["fake:crate"]);
    const status = Object.fromEntries(res.providers.map((p) => [p.provider, p.status]));
    expect(status).toEqual({ fake: "ok", broken: "error", slow: "timeout", fab: "link" });
    expect(res.providers.find((p) => p.provider === "fab")?.searchUrl).toContain("fab.com/search?q=wooden+crate");
  });

  it("skips providers that cannot match the filters", async () => {
    const res = await service().search({ query: "sky", types: ["audio"] });
    expect(res.results).toEqual([]);
    expect(res.providers.find((p) => p.provider === "fake")?.status).toBe("skipped");
  });

  it("supports provider allow-lists and downloadable-only", async () => {
    const res = await service().search({ query: "", providers: ["fake"], downloadableOnly: true });
    expect(res.providers.map((p) => p.provider)).toEqual(["fake"]);
    expect(res.results.map((a) => a.id)).toEqual(["fake:crate"]);
  });

  it("rejects unknown providers and bad ids", async () => {
    await expect(service().search({ query: "x", providers: ["nope"] })).rejects.toThrow(/Unknown provider/);
    await expect(service().getAsset("no-colon")).rejects.toThrow(/Invalid asset id/);
    await expect(service().getAsset("broken:x")).rejects.toThrow(/does not support/);
  });
});

describe("selectFiles", () => {
  it("defaults to gltf at the closest resolution to 2k", () => {
    expect(selectFiles(CRATE).map((f) => f.filename)).toEqual(["crate_2k.gltf"]);
  });
  it("honours format and resolution", () => {
    expect(selectFiles(CRATE, { resolution: "1k" }).map((f) => f.filename)).toEqual(["crate_1k.gltf"]);
    expect(selectFiles(CRATE, { format: "fbx" }).map((f) => f.filename)).toEqual(["crate.fbx"]);
    expect(selectFiles(CRATE, { format: "gltf", resolution: "8k" }).map((f) => f.filename)).toEqual(["crate_2k.gltf"]);
  });
  it("keeps one package when several share the default format", () => {
    const asset = {
      ...CRATE,
      files: [
        { url: "https://x.example/a.glb", filename: "a.glb", format: "glb", group: "gltf" },
        { url: "https://x.example/a_godot.glb", filename: "a_godot.glb", format: "glb", group: "gltf_godot" },
      ],
    };
    expect(selectFiles(asset).map((f) => f.filename)).toEqual(["a.glb"]);
    expect(selectFiles(asset, { format: "gltf_godot" }).map((f) => f.filename)).toEqual(["a_godot.glb"]);
  });
});

describe("download safety", () => {
  it("rejects path traversal and internal URLs", () => {
    expect(() => safeRelative("../etc/passwd")).toThrow();
    expect(safeRelative("./textures//a.jpg")).toBe("textures/a.jpg");
    expect(() => assertPublicUrl("http://127.0.0.1/x")).toThrow();
    expect(() => assertPublicUrl("http://localhost:8080/x")).toThrow();
    expect(() => assertPublicUrl("file:///etc/passwd")).toThrow();
    expect(assertPublicUrl("https://dl.polyhaven.org/a.jpg").hostname).toBe("dl.polyhaven.org");
  });
});

describe("downloadFiles", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("writes main files and companions with relative paths", async () => {
    dir = await mkdtemp(join(tmpdir(), "assets-"));
    const res = await downloadFiles(bytesHttp(), selectFiles(CRATE), dir);
    expect(res.files.map((f) => f.slice(dir!.length + 1)).sort()).toEqual(["crate_2k.gltf", "textures/crate_diff_2k.jpg"]);
    expect(await readFile(join(dir, "textures/crate_diff_2k.jpg"), "utf8")).toBe("data:crate_diff_2k.jpg");
  });

  it("enforces the size limit before downloading", async () => {
    dir = await mkdtemp(join(tmpdir(), "assets-"));
    await expect(downloadFiles(bytesHttp(), selectFiles(CRATE), dir, { maxBytes: 3 })).rejects.toThrow(/limit/);
  });
});

const SITE = fileURLToPath(new URL("./fixtures/site", import.meta.url));

describe("HTTP API", () => {
  const app = createApp(service(), { siteRoot: SITE });

  it("searches", async () => {
    const res = await app.request("/v1/search?q=crate&type=model&providers=fake");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { id: string }[] };
    expect(body.results[0]?.id).toBe("fake:crate");
  });

  it("validates parameters", async () => {
    expect((await app.request("/v1/search?q=x&type=spaceship")).status).toBe(400);
    expect((await app.request("/v1/search?q=x&providers=nope")).status).toBe(400);
    expect((await app.request("/v1/assets/fake:missing")).status).toBe(404);
  });

  it("streams a zip bundle for multi-file selections", async () => {
    const res = await app.request(`/v1/assets/${encodeURIComponent("fake:crate")}/download?resolution=1k`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const entries = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(["fake-crate/crate_1k.gltf", "fake-crate/textures/crate_diff_1k.jpg"]);
  });

  it("redirects for a single self-contained file", async () => {
    const res = await app.request("/v1/assets/fake:crate/download?format=fbx");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://cdn.fake.example/crate.fbx");
  });

  it("serves the website to browsers and JSON to API clients", async () => {
    const html = await app.request("/", { headers: { accept: "text/html" } });
    expect(html.headers.get("content-type")).toContain("text/html");
    expect(html.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(html.headers.get("link")).toBe('</AGENTS.md>; rel="alternate"; type="text/markdown"');
    expect(await html.text()).toContain("3D Asset Server");
    const json = (await (await app.request("/")).json()) as { name: string; agents: { instructions: string } };
    expect(json.name).toBe("3d-asset-server");
    expect(json.agents.instructions).toBe("/AGENTS.md");
  });

  it("gives agents markdown when they ask for it", async () => {
    const root = await app.request("/", { headers: { accept: "text/markdown, text/html;q=0.9" } });
    expect(root.headers.get("content-type")).toContain("text/markdown");
    expect(await root.text()).toContain("agent guide");
    const mcp = await app.request("/docs/mcp", { headers: { accept: "text/markdown" } });
    expect(await mcp.text()).toBe("# MCP setup\n");
    expect((await app.request("/agents.md")).status).toBe(200);
    expect(await (await app.request("/llms.txt")).text()).toContain("3D Asset Server");
  });

  it("negotiates Markdown vs HTML on the homepage with Vary: Accept", async () => {
    const md = await app.request("/", { headers: { accept: "text/markdown" } });
    expect(md.status).toBe(200);
    expect(md.headers.get("content-type")).toContain("text/markdown");
    expect(md.headers.get("vary")).toContain("Accept");
    expect((await md.text()).length).toBeGreaterThan(0);
    const html = await app.request("/", { headers: { accept: "text/html" } });
    expect(html.headers.get("content-type")).toContain("text/html");
    expect(html.headers.get("vary")).toContain("Accept");
    const json = await app.request("/");
    expect(json.headers.get("vary")).toContain("Accept");
    const twin = await app.request("/docs/mcp", { headers: { accept: "text/markdown" } });
    expect(twin.headers.get("content-type")).toContain("text/markdown");
    expect(twin.headers.get("vary")).toContain("Accept");
    // A client that ranks HTML above Markdown gets HTML.
    const ranked = await app.request("/", { headers: { accept: "text/markdown;q=0.5, text/html" } });
    expect(ranked.headers.get("content-type")).toContain("text/html");
  });

  it("answers unknown paths with a Markdown 404 for agents and HTML for browsers", async () => {
    const md = await app.request("/__ora-404-probe", { headers: { accept: "text/markdown" } });
    expect(md.status).toBe(404);
    expect(md.headers.get("content-type")).toContain("text/markdown");
    expect(md.headers.get("vary")).toContain("Accept");
    const body = await md.text();
    expect(body.length).toBeGreaterThan(20);
    expect(body).toContain("/llms.txt");
    expect(body).toContain("/sitemap-index.xml");
    expect(body).toContain("/__ora-404-probe");
    const html = await app.request("/__ora-404-probe", { headers: { accept: "text/html" } });
    expect(html.status).toBe(404);
    expect(html.headers.get("content-type")).toContain("text/html");
    // Hostile paths can't break out of the inline code span.
    const hostile = await app.request("/a%60%0A%23injected", { headers: { accept: "text/markdown" } });
    expect(hostile.status).toBe(404);
    expect(hostile.headers.get("content-type")).toContain("text/markdown");
    expect(await hostile.text()).not.toMatch(/\n#\s*injected/);
    const backtick = await (await app.request("/x`y", { headers: { accept: "text/markdown" } })).text();
    expect(backtick).toContain("`/xy`");
    // API paths keep JSON errors.
    const api = await app.request("/v1/nope", { headers: { accept: "text/markdown" } });
    expect(api.headers.get("content-type")).toContain("application/json");
  });

  it("redirects predictable developer URLs and browser visits to /mcp", async () => {
    for (const [from, to] of [["/api", "/docs/api"], ["/developers", "/docs"], ["/reference", "/docs/api/reference"], ["/privacy-policy", "/privacy"]]) {
      const res = await app.request(from!);
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe(to);
    }
    const browser = await app.request("/mcp", { headers: { accept: "text/html,application/xhtml+xml" } });
    expect(browser.status).toBe(302);
    expect(browser.headers.get("location")).toBe("/docs/mcp");
  });

  it("serves site pages with canonical URLs, caching and a 404 page", async () => {
    expect((await app.request("/docs/mcp")).status).toBe(200);
    const slash = await app.request("/docs/mcp/?x=1");
    expect(slash.status).toBe(301);
    expect(slash.headers.get("location")).toBe("/docs/mcp?x=1");
    const asset = await app.request("/_astro/app.abc123.js");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    const again = await app.request("/_astro/app.abc123.js", { headers: { "if-none-match": asset.headers.get("etag")! } });
    expect(again.status).toBe(304);
    const missing = await app.request("/no/such/page");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("text/html");
    const apiMissing = await app.request("/v1/nope");
    expect(apiMissing.status).toBe(404);
    expect(apiMissing.headers.get("content-type")).toContain("application/json");
  });

  it("records analytics for searches, downloads and page views", async () => {
    const lines: string[] = [];
    const analytics = new PrometheusAnalytics((l) => lines.push(l));
    const tracked = createApp(service(), { siteRoot: SITE, analytics });
    await tracked.request("/v1/search?q=Crate&providers=fake", { headers: { "x-asset-client": "web", "user-agent": "Mozilla/5.0" } });
    await tracked.request("/v1/assets/fake:crate/download?format=fbx", { headers: { "user-agent": "curl/8.5" } });
    await tracked.request("/docs/mcp");
    const metrics = await analytics.registry.metrics();
    expect(metrics).toContain('asset_server_searches_total{surface="web",client="browser",type="any",free_only="false",has_results="true"} 1');
    expect(metrics).toContain('asset_server_provider_requests_total{provider="fake",status="ok"} 1');
    expect(metrics).toContain('asset_server_downloads_total{surface="api",client="curl",provider="fake",kind="redirect"} 1');
    expect(metrics).toContain('asset_server_page_views_total{page="/docs/mcp"} 1');
    expect(metrics).toContain('asset_server_http_requests_total{route="/v1/search",method="GET",status="2xx"} 1');
    const search = JSON.parse(lines.find((l) => l.includes('"event":"search"'))!);
    expect(search).toMatchObject({ event: "search", surface: "web", query: "crate", results: 1 });
  });

  it("counts MCP tool calls by client", async () => {
    const analytics = new PrometheusAnalytics(() => undefined);
    const tracked = createApp(service(), { siteRoot: SITE, analytics });
    await tracked.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "user-agent": "claude-code/2.1.0" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_providers", arguments: {} } }),
    });
    expect(await analytics.registry.metrics()).toContain(
      'asset_server_mcp_tool_calls_total{tool="list_providers",client="claude-code",outcome="ok"} 1',
    );
  });

  it("requires the API key when configured", async () => {
    const secured = createApp(service(), { apiKey: "s3cret", siteRoot: SITE });
    expect((await secured.request("/v1/providers")).status).toBe(401);
    expect((await secured.request("/v1/providers", { headers: { authorization: "Bearer s3cret" } })).status).toBe(200);
    expect((await secured.request("/v1/providers?api_key=s3cret")).status).toBe(200);
    expect((await secured.request("/health")).status).toBe(200);
    expect((await secured.request("/", { headers: { accept: "text/html" } })).status).toBe(200);
  });

  it("serves MCP over streamable HTTP", async () => {
    const init = await app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      }),
    });
    expect(init.status).toBe(200);
    const list = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const body = (await list.json()) as { result: { tools: { name: string }[] } };
    // download_asset writes to disk, so it is off for the HTTP transport by default.
    expect(body.result.tools.map((t) => t.name).sort()).toEqual(["get_asset", "list_providers", "search_assets"]);
  });
});

describe("MCP tools", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function connect(downloadDir?: string, publicBaseUrl?: string) {
    const server = createMcpServer(service(), { allowLocalDownload: true, downloadDir, publicBaseUrl });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  }

  const text = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0]!.text);

  it("search_assets returns compact results and links", async () => {
    const client = await connect();
    const r = text(await client.callTool({ name: "search_assets", arguments: { query: "crate" } }));
    expect(r.results[0]).toMatchObject({ id: "fake:crate", title: "Wooden Crate", downloadable: true });
    expect(r.also_search_on[0].provider).toBe("Fab");
    expect(r.unavailable.map((u: { provider: string }) => u.provider).sort()).toEqual(["broken", "slow"]);
  });

  it("get_asset shows options and the selection", async () => {
    const client = await connect();
    const r = text(await client.callTool({ name: "get_asset", arguments: { id: "fake:crate", resolution: "1k" } }));
    expect(r.available.formats).toEqual(["gltf", "blend", "fbx"]);
    expect(r.selection.files.map((f: { filename: string }) => f.filename)).toEqual(["crate_1k.gltf"]);
    expect(r.shareUrl).toBeUndefined();
    const linked = text(await (await connect(undefined, "https://3d.shep.bot/")).callTool({ name: "get_asset", arguments: { id: "fake:crate" } }));
    expect(linked.shareUrl).toBe("https://3d.shep.bot/search?asset=fake%3Acrate");
  });

  it("download_asset writes into <dest>/<provider>-<id>", async () => {
    dir = await mkdtemp(join(tmpdir(), "mcp-"));
    const client = await connect(dir);
    const r = text(await client.callTool({ name: "download_asset", arguments: { id: "fake:crate" } }));
    expect(r.directory).toBe(join(dir, "fake-crate"));
    expect(r.files).toHaveLength(2);
  });

  it("reports errors as tool errors", async () => {
    const client = await connect();
    const r = await client.callTool({ name: "get_asset", arguments: { id: "fake:missing" } });
    expect(r.isError).toBe(true);
  });
});

describe("content negotiation", () => {
  it("prefers Markdown only when ranked at least as high as HTML", () => {
    expect(prefersMarkdown("text/markdown")).toBe(true);
    expect(prefersMarkdown("text/markdown, text/html;q=0.9")).toBe(true);
    expect(prefersMarkdown("text/html, text/markdown")).toBe(true);
    expect(prefersMarkdown("text/markdown;q=0.5, text/html")).toBe(false);
    expect(prefersMarkdown("text/markdown;q=0")).toBe(false);
    expect(prefersMarkdown("text/html,application/xhtml+xml,*/*;q=0.8")).toBe(false);
    expect(prefersMarkdown(undefined)).toBe(false);
  });
});

describe("rate limiting", () => {
  const make = (limit = 3) => {
    let now = 1_000_000;
    const app = createApp(service(), { siteRoot: SITE, rateLimit: { limit, windowSec: 60, now: () => now } });
    return { app, tick: (s: number) => (now += s * 1000) };
  };
  const from = (ip: string) => ({ headers: { "x-forwarded-for": `${ip}, 10.42.0.7` } });

  it("sends RateLimit headers and 429 + Retry-After past the limit", async () => {
    const { app } = make(3);
    const first = await app.request("/v1/providers", from("203.0.113.1"));
    expect(first.status).toBe(200);
    expect(first.headers.get("ratelimit-policy")).toBe('"default";q=3;w=60');
    expect(first.headers.get("ratelimit")).toBe('"default";r=2;t=60');
    expect(first.headers.get("ratelimit-limit")).toBe("3");
    expect(first.headers.get("ratelimit-remaining")).toBe("2");
    expect(first.headers.get("ratelimit-reset")).toBe("60");
    expect(first.headers.get("access-control-expose-headers")).toContain("RateLimit");
    await app.request("/v1/providers", from("203.0.113.1"));
    await app.request("/v1/providers", from("203.0.113.1"));
    const over = await app.request("/v1/providers", from("203.0.113.1"));
    expect(over.status).toBe(429);
    expect(over.headers.get("retry-after")).toBe("60");
    expect(over.headers.get("ratelimit-remaining")).toBe("0");
    expect(((await over.json()) as { retryAfter: number }).retryAfter).toBe(60);
  });

  it("counts clients separately, resets per window and leaves pages and health alone", async () => {
    const { app, tick } = make(1);
    expect((await app.request("/v1/providers", from("203.0.113.1"))).status).toBe(200);
    expect((await app.request("/v1/providers", from("203.0.113.1"))).status).toBe(429);
    expect((await app.request("/v1/providers", from("203.0.113.2"))).status).toBe(200);
    tick(61);
    expect((await app.request("/v1/providers", from("203.0.113.1"))).status).toBe(200);
    for (let i = 0; i < 3; i++) {
      expect((await app.request("/health", from("203.0.113.1"))).status).toBe(200);
      expect((await app.request("/docs/mcp", from("203.0.113.1"))).status).toBe(200);
    }
  });

  it("limits the MCP endpoint too", async () => {
    const { app } = make(1);
    const call = () =>
      app.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": "198.51.100.9" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(429);
  });

  it("is documented in the OpenAPI spec with a versioning policy", () => {
    const spec = openApiSpec() as unknown as {
      paths: Record<string, Record<string, { responses: Record<string, { headers?: Record<string, unknown> }> }>>;
      "x-api-lifecycle": { deprecationPolicy: string };
    };
    expect(spec.paths["/v1/search"]!.get!.responses["429"]).toBeDefined();
    expect(spec.paths["/v1/search"]!.get!.responses["200"]!.headers).toHaveProperty("RateLimit");
    expect(spec.paths["/mcp"]!.post!.responses["429"]).toBeDefined();
    expect(spec.paths["/health"]!.get!.responses["429"]).toBeUndefined();
    expect(spec["x-api-lifecycle"].deprecationPolicy).toContain("/docs/api/versioning");
  });
});

describe("site security, compression and SEO variants", () => {
  const app = createApp(service(), { siteRoot: SITE, publicBaseUrl: "https://3d.shep.bot" });
  const html = { headers: { accept: "text/html" } };

  it("sends a strict per-page CSP with hashes instead of 'unsafe-inline'", async () => {
    const res = await app.request("/", html);
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).not.toContain("'unsafe-inline'");
    const hash = (s: string) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;
    expect(csp).toContain(`script-src 'self' ${hash('document.documentElement.dataset.ok="1"')}`);
    expect(csp).toContain(hash("astro-island{display:contents}"));
    expect(csp).toContain(`'unsafe-hashes' ${hash("color:red")}`);
    expect(csp).not.toContain(hash('{"@context":"https://schema.org"}')); // JSON-LD is not executable
    expect(res.headers.get("permissions-policy")).toContain("camera=()");
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });

  it("builds CSPs for nonces and the inline-style exception", () => {
    expect(buildCsp("<p></p>", { styleNonce: "abc" })).toContain("style-src 'self' 'nonce-abc'");
    expect(buildCsp("<p></p>", { inlineStyles: true })).toContain("style-src 'self' 'unsafe-inline'");
    expect(buildCsp('<script src="/a.js"></script>')).toContain("script-src 'self';");
    expect(buildCsp('<p style="a:&quot;b&quot;">')).toContain(`'sha256-${createHash("sha256").update('a:"b"').digest("base64")}'`);
  });

  it("sends HSTS on HTTPS only", async () => {
    expect((await app.request("/", html)).headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    const plain = createApp(service(), { siteRoot: SITE });
    expect((await plain.request("/", html)).headers.get("strict-transport-security")).toBeNull();
    const proxied = await plain.request("/", { headers: { accept: "text/html", "x-forwarded-proto": "https" } });
    expect(proxied.headers.get("strict-transport-security")).toContain("max-age=31536000");
  });

  it("allows CORS on the API and machine-readable files but not on pages", async () => {
    const origin = { headers: { origin: "https://example.com", accept: "text/html" } };
    expect((await app.request("/", origin)).headers.get("access-control-allow-origin")).toBeNull();
    expect((await app.request("/docs/mcp", origin)).headers.get("access-control-allow-origin")).toBeNull();
    expect((await app.request("/v1/providers", origin)).headers.get("access-control-allow-origin")).toBe("*");
    expect((await app.request("/llms.txt", origin)).headers.get("access-control-allow-origin")).toBe("*");
    expect((await app.request("/AGENTS.md", origin)).headers.get("access-control-allow-origin")).toBe("*");
  });

  it("serves Brotli to clients that accept it", async () => {
    const res = await app.request("/", { headers: { accept: "text/html", "accept-encoding": "gzip, br" } });
    expect(res.headers.get("content-encoding")).toBe("br");
    expect(res.headers.get("vary")).toContain("Accept-Encoding");
    expect(brotliDecompressSync(Buffer.from(await res.arrayBuffer())).toString()).toContain("<h1");
    const identity = await app.request("/", html);
    expect(identity.headers.get("content-encoding")).not.toBe("br");
  });

  it("caches unhashed static files for a day and fingerprinted assets forever", async () => {
    expect((await app.request("/llms.txt")).headers.get("cache-control")).toBe("public, max-age=86400");
    expect((await app.request("/_astro/app.abc123.js")).headers.get("cache-control")).toContain("immutable");
    expect((await app.request("/", html)).headers.get("cache-control")).toContain("max-age=0");
  });

  it("gives /search query variants unique, noindex metadata and a style nonce", async () => {
    const res = await app.request("/search?q=brick%20wall&type=material", html);
    const body = await res.text();
    expect(body).toContain("<title>“brick wall”: PBR materials · 3D Asset Server</title>");
    expect(body).toContain('<meta name="robots" content="noindex, follow">');
    expect(body).toContain('<meta property="og:title" content="“brick wall”: PBR materials · 3D Asset Server">');
    const nonce = body.match(/<meta property="csp-nonce" content="([^"]+)">/)![1]!;
    expect(res.headers.get("content-security-policy")).toContain(`'nonce-${nonce}'`);
    expect(res.headers.get("etag")).toBeNull();
    const other = await (await app.request("/search?type=hdri&free=true", html)).text();
    expect(other).toContain(`<title>Free HDRIs: search ${allProviders.length} sites · 3D Asset Server</title>`);
    const plain = await (await app.request("/search", html)).text();
    expect(plain).toContain("<title>Search free 3D models, textures &amp; HDRIs · 3D Asset Server</title>");
    expect(plain).toContain('content="index, follow"');
    const again = await (await app.request("/search", html)).text();
    expect(again.match(/csp-nonce" content="([^"]+)"/)![1]).not.toBe(plain.match(/csp-nonce" content="([^"]+)"/)![1]);
  });

  it("only relaxes inline styles for the API playground", async () => {
    expect((await app.request("/docs/api/playground", html)).headers.get("content-security-policy")).toContain("style-src 'self' 'unsafe-inline'");
    expect((await app.request("/docs/mcp", html)).headers.get("content-security-policy")).not.toContain("'unsafe-inline'");
  });

  it("builds search metadata and escapes it into the head", () => {
    expect(searchMeta(new URLSearchParams(""))).toBeUndefined();
    expect(searchMeta(new URLSearchParams("type=pack&free=true"))!.title).toBe(`Free game asset packs: search ${allProviders.length} sites · 3D Asset Server`);
    const out = rewriteHead('<title>x</title><meta name="description" content="y">', { title: '<b>"t"</b>', description: "d & e" });
    expect(out).toBe('<title>&lt;b&gt;&quot;t&quot;&lt;/b&gt;</title><meta name="description" content="d &amp; e">');
  });
});

