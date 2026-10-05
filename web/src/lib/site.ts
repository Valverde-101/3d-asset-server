import integrations from "@/data/integrations.json";
import organization from "@/data/organization.json";
import providers from "@/data/providers.json";

export const SITE = {
  name: "3D Asset Server",
  shortName: "3D Assets",
  url: (import.meta.env.SITE as string | undefined)?.replace(/\/$/, "") ?? "https://3d.shep.bot",
  tagline: "One search for free 3D models, textures, HDRIs and game assets",
  homeTitle: "3D Asset Server: Search Free 3D Models, Textures & HDRIs",
  description:
    `Search ${providers.length} 3D asset sites at once and download free glTF models, CC0 PBR textures and HDRIs with clear licences. Web search, REST API and MCP for AI agents.`,
  repo: "https://github.com/arielshad/3d-asset-server",
  image: "/og.png",
  locale: "en_US",
};

/** Who runs the site. Fill `email` / `address` in organization.json to publish them. */
export const ORG = organization as {
  name: string;
  url: string;
  contactUrl: string;
  issuesUrl: string;
  securityUrl: string;
  email: string | null;
  address: { streetAddress?: string; addressLocality?: string; postalCode?: string; addressRegion?: string; addressCountry: string } | null;
};

export type Provider = (typeof providers)[number];
export const PROVIDERS: Provider[] = providers;
export const SOURCE_COUNT = PROVIDERS.length;
export const DIRECT_DOWNLOAD_COUNT = PROVIDERS.filter((p) => p.supportsDownload).length;
export const CC0_COUNT = PROVIDERS.filter((p) => p.license?.startsWith("CC0")).length;

/** Sources by date added, newest first (from integrations/registry.json). */
export const INTEGRATIONS = integrations.integrations;

/** Share-card path for a route: "/" -> /og/home.png, "/docs/api" -> /og/docs-api.png. */
export function ogImagePath(route: string): string {
  const slug = route === "/" ? "home" : route.replace(/^\/+|\/+$/g, "").replace(/\//g, "-");
  return `/og/${slug}.png`;
}

export const MCP_URL = `${SITE.url}/mcp`;

export const NAV = [
  { href: "/search", label: "Search" },
  { href: "/docs", label: "Docs" },
  { href: "/docs/mcp", label: "AI agents" },
  { href: "/docs/api", label: "API" },
  { href: "/docs/api/reference", label: "Reference" },
];

export const DOCS_NAV = [
  {
    title: "Get started",
    items: [
      { href: "/docs", label: "Quick start" },
      { href: "/docs/mcp", label: "Coding agents & MCP" },
      { href: "/docs/api", label: "REST API guide" },
      { href: "/docs/api/reference", label: "API reference" },
      { href: "/docs/api/playground", label: "API playground" },
      { href: "/docs/cli", label: "CLI" },
    ],
  },
  {
    title: "Reference",
    items: [
      { href: "/docs/sources", label: "Sources & licences" },
      { href: "/docs/api/versioning", label: "Versioning & rate limits" },
      { href: "/docs/self-hosting", label: "Self-hosting" },
      { href: "/AGENTS.md", label: "AGENTS.md (for agents)" },
      { href: "/llms.txt", label: "llms.txt" },
    ],
  },
];
