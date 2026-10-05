import { ASSET_TYPES } from "../core/types.js";

const DEFAULT_PUBLIC_URL = "https://3d.shep.bot";

/** Hand-written OpenAPI 3.1 description of the REST API (rendered at /docs/api/reference). */
export function openApiSpec(baseUrl?: string) {
  const server = (baseUrl ?? DEFAULT_PUBLIC_URL).replace(/\/$/, "");
  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
  const json = (schema: object, example?: unknown) => ({
    "application/json": { schema, ...(example !== undefined ? { example } : {}) },
  });
  const errorResponse = (description: string) => ({ description, content: json(ref("Error")) });

  const idParam = {
    name: "id",
    in: "path",
    required: true,
    description: "Asset id `<provider>:<nativeId>`, URL-encoded (`:` may stay as is). Take it from a search result.",
    schema: { type: "string" },
    example: "polyhaven:ArmChair_01",
  };
  const fileQuery = [
    {
      name: "format",
      in: "query",
      description: "Preferred format or package. Closest match wins; omitted = best default for the asset type.",
      schema: { type: "string", examples: ["glb", "gltf", "fbx", "blend", "obj", "usd", "hdr", "exr", "jpg", "png", "zip"] },
    },
    {
      name: "resolution",
      in: "query",
      description: "Texture/HDRI resolution. The closest available is used (default 2k).",
      schema: { type: "string", examples: ["1k", "2k", "4k", "8k"] },
    },
    {
      name: "maps",
      in: "query",
      description: "Comma-separated texture map types for map sets, e.g. `diff,nor_gl,rough,ao`.",
      schema: { type: "string" },
    },
    { name: "all", in: "query", description: "Return every file instead of the smart selection.", schema: { type: "boolean" } },
  ];

  const exampleAsset = {
    id: "polyhaven:ArmChair_01",
    provider: "polyhaven",
    nativeId: "ArmChair_01",
    title: "Arm Chair 01",
    type: "model",
    tags: ["chair", "furniture", "armchair"],
    url: "https://polyhaven.com/a/ArmChair_01",
    thumbnailUrl: "https://cdn.polyhaven.com/asset_img/thumbs/ArmChair_01.png?width=256",
    author: "Kirill Sannikov",
    license: { name: "CC0", url: "https://creativecommons.org/publicdomain/zero/1.0/", commercialUse: true, attributionRequired: false },
    price: { free: true },
    formats: ["gltf", "blend", "fbx", "usd"],
    resolutions: ["1k", "2k", "4k"],
    downloadable: true,
    score: 0.92,
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "3D Asset Server API",
      version: "0.1.0",
      summary: "One search API for free and paid 3D models, PBR materials, textures, HDRIs and game assets.",
      description: [
        "Search 17 asset sites at once (Poly Haven, ambientCG, Kenney, BlenderKit, CGTrader, itch.io and more),",
        "get licences and file lists, and download glTF/FBX/Blend models, PBR texture maps and HDRIs.",
        "",
        "**Typical flow:** `GET /v1/search` → `GET /v1/assets/{id}` → `GET /v1/assets/{id}/download`.",
        "",
        "**Authentication:** the public server at 3d.shep.bot is open. Self-hosted servers can require a key",
        "(`ASSET_SERVER_API_KEY`); send it as `Authorization: Bearer <key>` or `x-api-key: <key>`.",
        "",
        "**For AI agents:** the same capabilities are exposed as MCP tools at `/mcp` (Streamable HTTP).",
        "See [Use with coding agents](/docs/mcp).",
      ].join("\n"),
      contact: { name: "3D Asset Server", url: "https://github.com/arielshad/3d-asset-server" },
      license: { name: "Apache-2.0", identifier: "Apache-2.0" },
    },
    externalDocs: { description: "Guides: quick start, MCP setup, API usage", url: `${server}/docs` },
    servers: [{ url: server, description: "This server" }],
    tags: [
      { name: "Search", description: "Find assets across every source in one call." },
      { name: "Assets", description: "Details, file selection and downloads for a single asset." },
      { name: "Sources", description: "The asset sites this server searches." },
      { name: "MCP", description: "Model Context Protocol endpoint for AI agents." },
      { name: "System", description: "Health and machine-readable descriptions." },
    ],
    security: [{}, { bearer: [] }, { apiKey: [] }],
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "Only when the server sets ASSET_SERVER_API_KEY." },
        apiKey: { type: "apiKey", in: "header", name: "x-api-key", description: "Same key, as a header." },
      },
      schemas: {
        AssetType: { type: "string", enum: [...ASSET_TYPES] },
        License: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", description: "CC0, CC-BY-4.0, Royalty Free, ...", examples: ["CC0"] },
            url: { type: "string", format: "uri" },
            commercialUse: { type: "boolean" },
            attributionRequired: { type: "boolean" },
          },
        },
        Price: {
          type: "object",
          required: ["free"],
          properties: { free: { type: "boolean" }, amount: { type: "number" }, currency: { type: "string" } },
        },
        Asset: {
          type: "object",
          required: ["id", "provider", "nativeId", "title", "type", "tags", "url", "downloadable"],
          properties: {
            id: { type: "string", description: "Globally unique `<provider>:<nativeId>`." },
            provider: { type: "string" },
            nativeId: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            type: ref("AssetType"),
            tags: { type: "array", items: { type: "string" } },
            categories: { type: "array", items: { type: "string" } },
            url: { type: "string", format: "uri", description: "The asset's page on the source site." },
            thumbnailUrl: { type: "string", format: "uri" },
            author: { type: "string" },
            license: ref("License"),
            price: ref("Price"),
            formats: { type: "array", items: { type: "string" }, description: "Known file formats (glb, fbx, blend, exr, ...)." },
            resolutions: { type: "array", items: { type: "string" }, description: "Texture resolutions (1k, 2k, 4k, ...)." },
            polyCount: { type: "integer" },
            animated: { type: "boolean" },
            rigged: { type: "boolean" },
            downloadable: { type: "boolean", description: "True when this server can fetch the files directly." },
            createdAt: { type: "string" },
            score: { type: "number", description: "Relevance 0..1 assigned by the ranker." },
          },
          example: exampleAsset,
        },
        AssetFile: {
          type: "object",
          required: ["url", "filename", "format"],
          properties: {
            url: { type: "string", format: "uri" },
            filename: { type: "string" },
            format: { type: "string" },
            resolution: { type: "string" },
            mapType: { type: "string", description: "Texture map role: diffuse, normal, roughness, ..." },
            sizeBytes: { type: "integer" },
            group: { type: "string", description: "Package grouping: gltf, blend, textures, archive, ..." },
            includes: {
              type: "array",
              description: "Companion files that must sit next to this one (e.g. a .gltf's .bin and textures).",
              items: {
                type: "object",
                required: ["path", "url"],
                properties: { path: { type: "string" }, url: { type: "string", format: "uri" }, sizeBytes: { type: "integer" } },
              },
            },
            requiresAuth: { type: "boolean", description: "Needs a login or purchase on the source site." },
          },
        },
        AssetDetails: {
          allOf: [ref("Asset"), { type: "object", required: ["files"], properties: { files: { type: "array", items: ref("AssetFile") } } }],
        },
        ProviderReport: {
          type: "object",
          required: ["provider", "name", "status", "count", "tookMs"],
          properties: {
            provider: { type: "string" },
            name: { type: "string" },
            status: {
              type: "string",
              enum: ["ok", "error", "timeout", "skipped", "link"],
              description: "`link` = the site blocks bots; use `searchUrl` to run the same search there.",
            },
            count: { type: "integer" },
            total: { type: "integer" },
            searchUrl: { type: "string", format: "uri" },
            error: { type: "string" },
            tookMs: { type: "integer" },
          },
        },
        SearchResponse: {
          type: "object",
          required: ["query", "results", "providers"],
          properties: {
            query: { type: "string" },
            types: { type: "array", items: ref("AssetType") },
            results: { type: "array", items: ref("Asset"), description: "Merged, ranked and de-duplicated." },
            providers: { type: "array", items: ref("ProviderReport"), description: "One status line per source." },
          },
        },
        Provider: {
          type: "object",
          required: ["id", "name", "homepage", "description", "assetTypes", "access", "pricing", "supportsDownload"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            homepage: { type: "string", format: "uri" },
            description: { type: "string" },
            assetTypes: { type: "array", items: ref("AssetType") },
            access: { type: "string", enum: ["api", "scrape", "link"] },
            pricing: { type: "string", enum: ["free", "freemium", "paid"] },
            license: ref("License"),
            supportsDownload: { type: "boolean" },
            enabled: { type: "boolean" },
          },
        },
        FileSelection: {
          type: "object",
          required: ["id", "files"],
          properties: {
            id: { type: "string" },
            license: ref("License"),
            totalBytes: { type: "integer" },
            files: { type: "array", items: ref("AssetFile") },
          },
        },
        Error: {
          type: "object",
          required: ["error"],
          properties: { error: { type: "string" }, url: { type: "string", format: "uri" } },
        },
      },
    },
    paths: {
      "/v1/search": {
        get: {
          operationId: "searchAssets",
          tags: ["Search"],
          summary: "Search every source",
          description:
            "Fans out to every enabled source in parallel (each with its own timeout), then merges, ranks and de-duplicates. " +
            "A slow or failing source never fails the search: it shows up in `providers` with its status.",
          parameters: [
            { name: "q", in: "query", description: "Short, concrete query.", schema: { type: "string" }, example: "low poly tree" },
            {
              name: "type",
              in: "query",
              description: `Comma-separated asset types: ${ASSET_TYPES.join(", ")}.`,
              schema: { type: "string" },
              example: "model",
            },
            { name: "providers", in: "query", description: "Comma-separated source ids (see /v1/providers).", schema: { type: "string" } },
            { name: "free", in: "query", description: "Only free assets.", schema: { type: "boolean" } },
            { name: "downloadable", in: "query", description: "Only assets this server can download directly.", schema: { type: "boolean" } },
            { name: "limit", in: "query", description: "Max results (default 24).", schema: { type: "integer", minimum: 1, maximum: 100 } },
            { name: "offset", in: "query", description: "Per-source offset for paging (e.g. 24 for page 2).", schema: { type: "integer", minimum: 0 } },
          ],
          responses: {
            200: { description: "Ranked results plus a per-source report.", content: json(ref("SearchResponse")) },
            400: errorResponse("Invalid parameters or unknown source id."),
            401: errorResponse("API key required (self-hosted servers only)."),
          },
        },
      },
      "/v1/assets/{id}": {
        get: {
          operationId: "getAsset",
          tags: ["Assets"],
          summary: "Asset details with files",
          description: "Full metadata, licence and every downloadable file for one asset.",
          parameters: [idParam],
          responses: {
            200: { description: "The asset and its files.", content: json(ref("AssetDetails")) },
            404: errorResponse("Unknown asset."),
            502: errorResponse("The source site failed."),
          },
        },
      },
      "/v1/assets/{id}/files": {
        get: {
          operationId: "selectFiles",
          tags: ["Assets"],
          summary: "Pick the right files",
          description: "Smart selection for a format and resolution (e.g. glTF with its .bin and textures, or a 2k PBR map set).",
          parameters: [idParam, ...fileQuery],
          responses: {
            200: { description: "Selected files and total size.", content: json(ref("FileSelection")) },
            404: errorResponse("Unknown asset."),
          },
        },
      },
      "/v1/assets/{id}/download": {
        get: {
          operationId: "downloadAsset",
          tags: ["Assets"],
          summary: "Download",
          description:
            "A single self-contained file redirects (302) to the source CDN. Multi-file selections stream as one zip " +
            "(e.g. glTF + .bin + textures, ready to drop into a project).",
          parameters: [idParam, ...fileQuery],
          responses: {
            200: { description: "Zip bundle.", content: { "application/zip": { schema: { type: "string", format: "binary" } } } },
            302: { description: "Redirect to the single file." },
            404: errorResponse("Unknown asset or no file matches."),
            409: errorResponse("The source has no direct downloads; `url` is its page."),
          },
        },
      },
      "/v1/providers": {
        get: {
          operationId: "listProviders",
          tags: ["Sources"],
          summary: "List sources",
          description: "Every asset site with what it carries, pricing, licence and whether files can be downloaded directly.",
          responses: {
            200: {
              description: "Sources.",
              content: json({ type: "object", required: ["providers"], properties: { providers: { type: "array", items: ref("Provider") } } }),
            },
          },
        },
      },
      "/mcp": {
        post: {
          operationId: "mcp",
          tags: ["MCP"],
          summary: "MCP endpoint (Streamable HTTP)",
          description:
            "Stateless Model Context Protocol endpoint for AI agents. Tools: `search_assets`, `get_asset`, `list_providers`. " +
            "Point any MCP client at this URL; see /docs/mcp for per-client setup.",
          requestBody: {
            required: true,
            content: json(
              { type: "object", description: "JSON-RPC 2.0 request" },
              { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_assets", arguments: { query: "sunset hdri", types: ["hdri"] } } },
            ),
          },
          responses: { 200: { description: "JSON-RPC 2.0 response.", content: json({ type: "object" }) } },
        },
      },
      "/health": {
        get: {
          operationId: "health",
          tags: ["System"],
          summary: "Health check",
          security: [{}],
          responses: { 200: { description: "OK", content: json({ type: "object", properties: { ok: { type: "boolean" } } }, { ok: true }) } },
        },
      },
      "/openapi.json": {
        get: {
          operationId: "openapi",
          tags: ["System"],
          summary: "This OpenAPI document",
          security: [{}],
          responses: { 200: { description: "OpenAPI 3.1", content: json({ type: "object" }) } },
        },
      },
    },
  };
}
