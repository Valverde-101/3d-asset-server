import { ASSET_TYPES } from "../core/types.js";

/** Hand-written OpenAPI 3.1 description of the REST API. */
export function openApiSpec(baseUrl?: string) {
  const idParam = {
    name: "id",
    in: "path",
    required: true,
    description: "Asset id `<provider>:<nativeId>` (URL-encoded), e.g. `polyhaven:ArmChair_01`.",
    schema: { type: "string" },
  };
  const fileQuery = [
    { name: "format", in: "query", schema: { type: "string" }, description: "glb, gltf, fbx, blend, obj, usd, hdr, exr, jpg, png, zip" },
    { name: "resolution", in: "query", schema: { type: "string" }, description: "1k, 2k, 4k, 8k (closest available)" },
    { name: "maps", in: "query", schema: { type: "string" }, description: "Comma list of texture map types (diff,nor_gl,rough,...)" },
    { name: "all", in: "query", schema: { type: "boolean" }, description: "Return every file" },
  ];
  return {
    openapi: "3.1.0",
    info: {
      title: "3D Asset Server",
      version: "0.1.0",
      description: "Unified search and download for 3D models, materials, textures, HDRIs and game assets.",
    },
    servers: baseUrl ? [{ url: baseUrl }] : undefined,
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer" },
        apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
      },
    },
    paths: {
      "/v1/providers": {
        get: { summary: "List asset sources", responses: { 200: { description: "Providers" } } },
      },
      "/v1/search": {
        get: {
          summary: "Search every source",
          parameters: [
            { name: "q", in: "query", schema: { type: "string" }, description: "Free-text query" },
            {
              name: "type",
              in: "query",
              schema: { type: "string" },
              description: `Comma list of: ${ASSET_TYPES.join(", ")}`,
            },
            { name: "providers", in: "query", schema: { type: "string" }, description: "Comma list of provider ids" },
            { name: "free", in: "query", schema: { type: "boolean" } },
            { name: "downloadable", in: "query", schema: { type: "boolean" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
            { name: "offset", in: "query", schema: { type: "integer", minimum: 0 }, description: "Per-source offset" },
          ],
          responses: { 200: { description: "Ranked results plus a per-provider report" } },
        },
      },
      "/v1/assets/{id}": {
        get: { summary: "Asset details incl. files", parameters: [idParam], responses: { 200: { description: "Asset" }, 404: { description: "Not found" } } },
      },
      "/v1/assets/{id}/files": {
        get: { summary: "Smart file selection", parameters: [idParam, ...fileQuery], responses: { 200: { description: "Selected files" } } },
      },
      "/v1/assets/{id}/download": {
        get: {
          summary: "Download (redirect for a single file, zip bundle otherwise)",
          parameters: [idParam, ...fileQuery],
          responses: { 200: { description: "application/zip" }, 302: { description: "Redirect to file" }, 409: { description: "No direct downloads" } },
        },
      },
      "/mcp": { post: { summary: "Model Context Protocol endpoint (Streamable HTTP, stateless)", responses: { 200: { description: "JSON-RPC" } } } },
    },
  };
}
