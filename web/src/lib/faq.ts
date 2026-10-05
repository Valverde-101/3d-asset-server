import { MCP_URL, SOURCE_COUNT } from "./site";

/** Shown on the home page and emitted as FAQPage JSON-LD (answers are plain text). */
export const FAQ = [
  {
    q: "What is 3D Asset Server?",
    a: `3D Asset Server is a free search engine and API for 3D assets. One query searches ${SOURCE_COUNT} sites at once, including Poly Haven, ambientCG, Kenney, BlenderKit, CGTrader and itch.io, and returns models, PBR materials, textures, HDRIs and game asset packs with their licence. It works in the browser, over a REST API, and as an MCP server for AI coding agents.`,
  },
  {
    q: "Is it free to use?",
    a: "Yes. Searching and downloading through 3d.shep.bot is free and needs no account or API key. The assets themselves keep their own licences: many sources are CC0 (public domain), others require attribution or are paid on the source site.",
  },
  {
    q: "How do I connect Claude Code, Cursor or another coding agent?",
    a: `Add the MCP server URL ${MCP_URL}. In Claude Code run: claude mcp add --transport http 3d-assets ${MCP_URL}. Cursor, VS Code, Windsurf, Codex CLI and Gemini CLI take the same URL in their MCP config. The agent then gets the tools search_assets, get_asset and list_providers.`,
  },
  {
    q: "Can I download files directly?",
    a: "Yes, for sources with open downloads (Poly Haven, ambientCG, Kenney, TextureCan, HDRMaps and free BlenderKit assets). You get glTF/GLB, FBX or Blend models with their textures, PBR texture maps at 1k-8k, or HDR/EXR environment maps. Multi-file assets download as one zip. Other sources link to the asset page on their site.",
  },
  {
    q: "Which licence do the assets have?",
    a: "Every result shows its licence and whether attribution is required. Poly Haven, ambientCG, Kenney, TextureCan and 3DTextures.me are CC0, which allows commercial use without credit. Always check the licence on the result before shipping an asset.",
  },
  {
    q: "Is there an API?",
    a: "Yes. GET /v1/search?q=wooden+chair&type=model&free=true searches every source; /v1/assets/{id} returns details and files; /v1/assets/{id}/download returns the file or a zip. The OpenAPI 3.1 description is at /openapi.json and the interactive reference at /docs/api/reference.",
  },
];
