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
import { assertPublicUrl, downloadFiles, safeRelative, selectFiles } from "../src/core/download.js";
import { AssetService } from "../src/core/service.js";
import { createMcpServer } from "../src/mcp/server.js";
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

  async function connect(downloadDir?: string) {
    const server = createMcpServer(service(), { allowLocalDownload: true, downloadDir });
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
