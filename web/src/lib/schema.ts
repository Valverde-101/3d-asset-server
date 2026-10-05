/**
 * schema.org JSON-LD builders. Every page gets WebSite + Organization (via
 * the layout); pages add their own (SoftwareApplication, WebAPI, FAQPage,
 * TechArticle, BreadcrumbList, ItemList).
 */
import { CATALOG } from "./catalog";
import { MCP_URL, ORG, PROVIDERS, SITE } from "./site";

const abs = (path: string) => new URL(path, SITE.url).toString();
const ORG_ID = `${SITE.url}/#organization`;
const SITE_ID = `${SITE.url}/#website`;
const APP_ID = `${SITE.url}/#app`;

export type JsonLd = Record<string, unknown>;

/**
 * Organization with its contact point. `email` and `address` come from
 * src/data/organization.json and are only emitted when filled in, so the
 * markup never claims contact details that don't exist.
 */
export const organization = (): JsonLd => ({
  "@type": "Organization",
  "@id": ORG_ID,
  name: ORG.name,
  url: ORG.url,
  logo: abs("/icon-512.png"),
  sameAs: [SITE.repo],
  contactPoint: [
    {
      "@type": "ContactPoint",
      contactType: "customer support",
      url: ORG.contactUrl,
      availableLanguage: ["en"],
      ...(ORG.email ? { email: ORG.email } : {}),
    },
    { "@type": "ContactPoint", contactType: "technical support", url: ORG.issuesUrl, availableLanguage: ["en"] },
  ],
  ...(ORG.address ? { address: { "@type": "PostalAddress", ...ORG.address } } : {}),
});

export const aboutPage = (a: { title: string; description: string; path: string; type: "AboutPage" | "ContactPage" | "WebPage" }): JsonLd => ({
  "@type": a.type,
  name: a.title,
  description: a.description,
  url: abs(a.path),
  inLanguage: "en",
  isPartOf: { "@id": SITE_ID },
  about: { "@id": a.type === "AboutPage" ? APP_ID : ORG_ID },
  publisher: { "@id": ORG_ID },
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
  screenshot: abs("/img/search-preview.png"),
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

/** The daily catalog census as a schema.org Dataset (for dataset search and citation). */
export const catalogDataset = (): JsonLd => ({
  "@type": "Dataset",
  "@id": `${SITE.url}/stats#catalog`,
  name: "3D Asset Server catalog census",
  description:
    "Daily counts of the 3D models, PBR materials, textures, HDRIs and game asset packs held by the asset sites 3D Asset Server searches: listings per source, by asset type, licence and category, free and CC0 counts, and releases in the last 30 days.",
  url: abs("/stats"),
  isAccessibleForFree: true,
  creator: { "@id": ORG_ID },
  publisher: { "@id": ORG_ID },
  dateModified: CATALOG.countedAt,
  temporalCoverage: `${CATALOG.countedAt.slice(0, 10)}/..`,
  keywords: ["3D assets", "3D models", "PBR textures", "HDRI", "CC0", "game assets", "asset libraries"],
  variableMeasured: ["asset listings", "free listings", "CC0 listings", "listings by asset type", "listings per source", "listings released in the last 30 days"],
  distribution: [
    { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: abs("/catalog.json"), name: "Latest census" },
    { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: abs("/catalog-history.json"), name: "Daily history" },
  ],
});

/** Node types that describe the page itself (they get the share image). */
const PAGE_TYPES = new Set(["WebPage", "AboutPage", "ContactPage", "TechArticle", "CollectionPage", "SearchResultsPage", "FAQPage"]);

export interface PageMeta {
  url: string;
  name: string;
  description: string;
  /** Absolute URL of the page's 1200×630 share card. */
  image: string;
  imageAlt: string;
}

/**
 * Wrap page nodes + the site-wide ones in a single @graph. The page's share
 * card is attached as an ImageObject: `primaryImageOfPage` + `image` on the
 * node that describes the page, or on a WebPage node added for pages that
 * have none (e.g. the home page, whose nodes describe the app and API).
 */
export const graph = (nodes: JsonLd[], page?: PageMeta): string => {
  let out = nodes;
  if (page) {
    const image = { "@type": "ImageObject", "@id": `${page.url}#primaryimage`, url: page.image, contentUrl: page.image, width: 1200, height: 630, caption: page.imageAlt };
    const i = nodes.findIndex((n) => PAGE_TYPES.has(String(n["@type"])) && n["@type"] !== "FAQPage");
    if (i >= 0) {
      out = nodes.map((n, j) => (j === i ? { ...n, image: { "@id": image["@id"] }, ...(n["@type"] === "TechArticle" ? {} : { primaryImageOfPage: { "@id": image["@id"] } }) } : n));
    } else {
      out = [
        { "@type": "WebPage", "@id": `${page.url}#webpage`, url: page.url, name: page.name, description: page.description, inLanguage: "en", isPartOf: { "@id": SITE_ID }, primaryImageOfPage: { "@id": image["@id"] }, image: { "@id": image["@id"] } },
        ...nodes,
      ];
    }
    out = [...out, image];
  }
  return JSON.stringify({ "@context": "https://schema.org", "@graph": [website(), organization(), ...out] }).replace(/</g, "\\u003c");
};
