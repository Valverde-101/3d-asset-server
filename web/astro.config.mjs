// @ts-check
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import agentFiles from "./integrations/agent-files.mjs";

// Canonical origin baked into canonical URLs, sitemap, Open Graph and JSON-LD.
const site = process.env.SITE_URL ?? "https://3d.shep.bot";

export default defineConfig({
  site,
  // One URL per page: /docs/mcp (never /docs/mcp/). The server 301s the slash form.
  trailingSlash: "never",
  build: { format: "directory", assets: "_astro" },
  integrations: [
    react(),
    agentFiles(),
    sitemap({
      filter: (page) => !page.includes("/404"),
      changefreq: "weekly",
      lastmod: new Date(),
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
