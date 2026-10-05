// Renders a 1200×630 Open Graph card for every built page, after `astro build`.
//
// Each page's <head> already names its card (`og:image` = /og/<slug>.png, see
// BaseLayout.astro) and carries the text; this reads the title, description
// and route from the built HTML and draws the card with the server's renderer
// (dist/og/render.js, built by `tsc` before the website). /og.png, the old
// site-wide card, is kept as a copy of the home card for links already shared.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Label above the title, by route (most specific first). */
const KICKERS = [
  ["/docs/api/reference", "API reference"],
  ["/docs/api/playground", "API playground"],
  ["/docs/api/versioning", "API policy"],
  ["/docs/api", "REST API"],
  ["/docs/mcp", "AI agents · MCP"],
  ["/docs/cli", "Command line"],
  ["/docs/self-hosting", "Self-hosting"],
  ["/docs/sources", "Sources & licences"],
  ["/docs", "Docs"],
  ["/stats", "Live stats"],
  ["/search", "Search"],
  ["/about", "About"],
  ["/contact", "Contact"],
  ["/privacy", "Privacy"],
  ["/404", "404"],
];

const CHIPS = {
  "/docs/mcp": ["MCP", "Claude Code", "Cursor", "Copilot"],
  "/docs/api": ["REST", "OpenAPI 3.1", "JSON"],
  "/docs/api/reference": ["OpenAPI 3.1", "Schemas", "curl"],
  "/docs/api/playground": ["Try it live", "OpenAPI 3.1"],
  "/docs/api/versioning": ["/v1", "RateLimit headers", "Deprecation"],
  "/docs/cli": ["npx", "stdio MCP", "Docker"],
  "/docs/self-hosting": ["Docker", "Kubernetes", "Prometheus"],
  "/stats": ["Searches", "Downloads", "Source health"],
};

const attr = (html, re) => {
  const m = html.match(re);
  return m ? m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : undefined;
};

function* htmlFiles(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* htmlFiles(full);
    else if (e.name.endsWith(".html")) yield full;
  }
}

export default function ogImages() {
  return {
    name: "og-images",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        const { pageCard, renderPng } = await import(new URL("../../dist/og/render.js", import.meta.url).href);
        const providers = JSON.parse(readFileSync(join(root, "src/data/providers.json"), "utf8"));
        const out = fileURLToPath(dir);
        const started = Date.now();
        let count = 0;
        for (const file of htmlFiles(out)) {
          const html = readFileSync(file, "utf8");
          const image = attr(html, /<meta property="og:image" content="([^"]+)"/);
          if (!image) continue;
          const { pathname, host } = new URL(image);
          if (!pathname.startsWith("/og/")) continue;
          const rel = relative(out, file).replace(/\\/g, "/");
          const route = "/" + rel.replace(/(^|\/)index\.html$/, "").replace(/\.html$/, "");
          const title = (attr(html, /<meta property="og:title" content="([^"]+)"/) ?? "").replace(/ · 3D Asset Server$/, "");
          const description = attr(html, /<meta property="og:description" content="([^"]+)"/) ?? "";
          const kicker = KICKERS.find(([prefix]) => route === prefix || route.startsWith(prefix + "/"))?.[1];
          const card =
            route === "/"
              ? pageCard({
                  title: "One search for every",
                  highlight: "free 3D asset",
                  subtitle: `${providers.length} sites · glTF models, PBR textures, HDRIs · licences included · REST API & MCP for AI agents`,
                  chips: providers.slice(0, 4).map((p) => p.name),
                  site: host,
                })
              : pageCard({
                  kicker,
                  title,
                  subtitle: description,
                  chips: CHIPS[route] ?? (route === "/docs/sources" || route === "/search" ? providers.slice(0, 4).map((p) => p.name) : ["3D models", "PBR textures", "HDRIs"]),
                  site: host,
                });
          const png = await renderPng(card);
          const target = join(out, pathname);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, png);
          if (route === "/") writeFileSync(join(out, "og.png"), png);
          count++;
        }
        logger.info(`rendered ${count} Open Graph cards in ${Date.now() - started} ms`);
      },
    },
  };
}
