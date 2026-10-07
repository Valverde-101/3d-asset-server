// @ts-check
import react from "@astrojs/react";
import sitemap, { ChangeFreqEnum } from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import agentFiles from "./integrations/agent-files.mjs";
import ogImages from "./integrations/og-images.mjs";
import { sitemapMeta } from "./integrations/sitemap-meta.mjs";

// Canonical origin baked into canonical URLs, sitemap, Open Graph and JSON-LD.
const site = process.env.SITE_URL ?? "https://3d.shep.bot";
// Real per-page lastmod dates and the thin pages to leave out (see the module).
const pages = sitemapMeta();
/** @param {string} url */
const pathOf = (url) => new URL(url).pathname.replace(/\/$/, "") || "/";

export default defineConfig({
  site,
  // One URL per page: /docs/mcp (never /docs/mcp/). The server 301s the slash form.
  trailingSlash: "never",
  build: { format: "directory", assets: "_astro" },
  integrations: [
    react(),
    agentFiles(),
    ogImages(),
    sitemap({
      filter: (page) => !page.includes("/404") && !page.includes("/docs/api/playground") && !pages.noindex.has(pathOf(page)),
      serialize(item) {
        const path = pathOf(item.url);
        const lastmod = pages.lastmod.get(path);
        return { ...item, lastmod, changefreq: path.startsWith("/assets") || path === "/stats" ? ChangeFreqEnum.DAILY : ChangeFreqEnum.WEEKLY };
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    // `npm run dev` here talks to a server started with `npm start` (port 8787).
    server: {
      proxy: Object.fromEntries(["/v1", "/mcp", "/openapi.json"].map((p) => [p, "http://localhost:8787"])),
    },
  },
  markdown: { shikiConfig: { theme: "github-dark-default" } },
  devToolbar: { enabled: false },
});
