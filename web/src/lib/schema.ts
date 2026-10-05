/**
 * schema.org JSON-LD builders. Every page gets WebSite + Organization (via
 * the layout); pages add their own (SoftwareApplication, WebAPI, FAQPage,
 * TechArticle, BreadcrumbList, ItemList).
 */
import { MCP_URL, PROVIDERS, SITE } from "./site";

const abs = (path: string) => new URL(path, SITE.url).toString();
const ORG_ID = `${SITE.url}/#organization`;
const SITE_ID = `${SITE.url}/#website`;
const APP_ID = `${SITE.url}/#app`;

export type JsonLd = Record<string, unknown>;

export const organization = (): JsonLd => ({
  "@type": "Organization",
  "@id": ORG_ID,
  name: "Shep",
  url: "https://shep.bot",
  logo: abs("/icon-512.png"),
  sameAs: [SITE.repo],
});

export const website = (): JsonLd => ({
  "@type": "WebSite",
  "@id": SITE_ID,
  url: SITE.url,
  name: SITE.name,
  description: SITE.description,
  inLanguage: "en",
  publisher: { "@id": ORG_ID },
  potentialAction: {
    "@type": "SearchAction",
    target: { "@type": "EntryPoint", urlTemplate: `${SITE.url}/search?q={search_term_string}` },
    "query-input": "required name=search_term_string",
  },
});

export const softwareApplication = (): JsonLd => ({
  "@type": "WebApplication",
  "@id": APP_ID,
  name: SITE.name,
  url: SITE.url,
  description: SITE.description,
  applicationCategory: "DeveloperApplication",
  applicationSubCategory: "3D asset search",
  operatingSystem: "Any (web browser, HTTP API, MCP)",
  browserRequirements: "Requires JavaScript for live search",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  featureList: [
    `Searches ${PROVIDERS.length} 3D asset sites at once`,
    "Direct downloads of glTF/GLB, FBX, Blend models, PBR texture maps and HDRIs",
    "Licence and attribution shown for every result",
    "REST API with OpenAPI 3.1 description",
    "Model Context Protocol (MCP) server for AI coding agents",
  ],
  softwareHelp: { "@type": "CreativeWork", url: abs("/docs") },
  codeRepository: SITE.repo,
  license: "https://www.apache.org/licenses/LICENSE-2.0",
  publisher: { "@id": ORG_ID },
  screenshot: abs(SITE.image),
});

export const webApi = (): JsonLd => ({
  "@type": "WebAPI",
  "@id": `${SITE.url}/#api`,
  name: `${SITE.name} API`,
  description: "REST and MCP API to search and download 3D models, PBR materials, textures, HDRIs and game assets from many sources.",
  url: abs("/docs/api"),
  documentation: abs("/docs/api/reference"),
  termsOfService: SITE.repo,
  provider: { "@id": ORG_ID },
  isAccessibleForFree: true,
  potentialAction: { "@type": "SearchAction", target: `${SITE.url}/v1/search?q={query}` },
  subjectOf: [
    { "@type": "DigitalDocument", name: "OpenAPI 3.1 description", encodingFormat: "application/json", url: abs("/openapi.json") },
    { "@type": "DigitalDocument", name: "MCP endpoint (Streamable HTTP)", url: MCP_URL },
  ],
});

export const faqPage = (items: { q: string; a: string }[]): JsonLd => ({
  "@type": "FAQPage",
  mainEntity: items.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })),
});

export const breadcrumbs = (trail: { name: string; path: string }[]): JsonLd => ({
  "@type": "BreadcrumbList",
  itemListElement: trail.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, item: abs(t.path) })),
});

export const techArticle = (a: { title: string; description: string; path: string }): JsonLd => ({
  "@type": "TechArticle",
  headline: a.title,
  description: a.description,
  url: abs(a.path),
  mainEntityOfPage: abs(a.path),
  inLanguage: "en",
  isPartOf: { "@id": SITE_ID },
  about: { "@id": APP_ID },
  publisher: { "@id": ORG_ID },
  dateModified: new Date().toISOString().slice(0, 10),
  proficiencyLevel: "Beginner",
});

export const sourcesList = (): JsonLd => ({
  "@type": "ItemList",
  name: "3D asset sources searched by 3D Asset Server",
  numberOfItems: PROVIDERS.length,
  itemListElement: PROVIDERS.map((p, i) => ({
    "@type": "ListItem",
    position: i + 1,
    item: { "@type": "WebSite", name: p.name, url: p.homepage, description: p.description },
  })),
});

/** Wrap page nodes + the site-wide ones in a single @graph. */
export const graph = (nodes: JsonLd[]): string =>
  JSON.stringify({ "@context": "https://schema.org", "@graph": [website(), organization(), ...nodes] }).replace(/</g, "\\u003c");
