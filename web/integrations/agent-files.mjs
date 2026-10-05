// Emits the machine-readable side of the site after `astro build`:
//   /AGENTS.md              agent guide (also served for `/` when Accept: text/markdown)
//   /skill/SKILL.md         Claude Code skill
//   /docs.md, /docs/*.md    markdown twins of every docs page
//   /llms.txt               llmstxt.org index
//   /llms-full.txt          every guide in one file
//   /scalar/standalone.js   self-hosted Scalar API reference bundle
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

function stripFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return { meta: {}, body: md };
  const meta = Object.fromEntries(
    m[1].split("\n").map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2]]),
  );
  return { meta, body: md.slice(m[0].length) };
}

function* mdPages(dir) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) yield* mdPages(full);
    else if (name.name.endsWith(".md")) yield full;
  }
}

function sourcesMarkdown(providers) {
  const rows = providers.map(
    (p) => `| [${p.name}](${p.homepage}) | \`${p.id}\` | ${p.description} | ${p.assetTypes.join(", ")} | ${p.pricing} | ${p.license ?? "per asset"} | ${p.supportsDownload ? "yes" : "no"} |`,
  );
  return [
    "# Sources & licences",
    "",
    `3D Asset Server searches ${providers.length} sites. Use the \`id\` with \`providers=\` to restrict a search.`,
    "",
    "| Source | id | Best for | Types | Pricing | Licence | Direct download |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "CC0 = public domain (commercial use, no credit needed). Sources marked \"per asset\" set licences per listing; check each result's `license`.",
    "",
  ].join("\n");
}

function statsMarkdown(providers, integrations, site) {
  const recent = integrations.slice(0, 6).map((i) => `- [${i.name}](${i.homepage}) (\`${i.id}\`), added ${i.addedAt}`);
  return [
    "# Usage statistics",
    "",
    `Live usage of 3D Asset Server and the health of its ${providers.length} sources. The numbers change every minute, so read them as JSON from \`GET ${site}/v1/stats\` (schema \`Stats\` in ${site}/openapi.json):`,
    "",
    "- `windows[]`: searches (by surface: `web`, `api`, `mcp`), searches with results, asset views, downloads, MCP tool calls and page views for the last 24 hours and 7 days (`source: prometheus`), or since the last restart (`source: process`).",
    "- `clients`, `assetTypes`, `tools`: what was searched most, by client family, asset type filter and MCP tool.",
    "- `providers[]`: per-source success rate and p50/p95 latency over the last 24 hours. Use it to see which sources are slow or failing right now.",
    "- `catalog`: number of sources, how many allow direct downloads, by access method and pricing.",
    "",
    "Counts are anonymous totals: no search terms, IP addresses or user agents.",
    "",
    "## Recently added sources",
    "",
    ...recent,
    "",
    `All sources: ${site}/docs/sources.md`,
    "",
  ].join("\n");
}

export default function agentFiles() {
  let site = "https://3d.shep.bot";
  return {
    name: "agent-files",
    hooks: {
      "astro:config:done": ({ config }) => {
        if (config.site) site = config.site.replace(/\/$/, "");
      },
      "astro:build:done": ({ dir, logger }) => {
        const out = fileURLToPath(dir);
        const write = (rel, text) => {
          const file = join(out, rel);
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, text);
        };
        // Root-relative links become absolute so the files work wherever they are read.
        const absolutize = (md) => md.replace(/\]\(\//g, `](${site}/`);

        const agents = read("src/content/AGENTS.md");
        write("AGENTS.md", agents);
        write("skill/SKILL.md", read("src/content/SKILL.md"));

        const pagesDir = join(root, "src/pages");
        const docs = [];
        for (const file of mdPages(pagesDir)) {
          const route = "/" + relative(pagesDir, file).replace(/\\/g, "/").replace(/(\/index)?\.md$/, "");
          const { meta, body } = stripFrontmatter(readFileSync(file, "utf8"));
          const md = `${absolutize(body.trim())}\n\n---\nSource: ${site}${route}\n`;
          write(`${route}.md`, md);
          docs.push({ route, title: meta.title ?? route, description: meta.description ?? "", md });
        }
        const providers = JSON.parse(read("src/data/providers.json"));
        const sources = sourcesMarkdown(providers);
        write("docs/sources.md", `${sources}\n---\nSource: ${site}/docs/sources\n`);
        docs.push({ route: "/docs/sources", title: "Sources & licences", description: `The ${providers.length} sites searched, with licences.`, md: sources });

        const stats = statsMarkdown(providers, JSON.parse(read("src/data/integrations.json")).integrations, site);
        write("stats.md", `${stats}\n---\nSource: ${site}/stats\n`);
        docs.push({ route: "/stats", title: "Usage statistics", description: "Live usage (searches, downloads, MCP tool calls) and per-source health; JSON at /v1/stats.", md: stats });

        const order = ["/docs", "/docs/mcp", "/docs/api", "/docs/api/versioning", "/docs/sources", "/docs/cli", "/docs/self-hosting", "/about", "/stats", "/contact", "/privacy"];
        const rank = (r) => (order.indexOf(r) === -1 ? order.length : order.indexOf(r));
        docs.sort((a, b) => rank(a.route) - rank(b.route));
        const docPages = docs.filter((d) => d.route.startsWith("/docs"));
        const sitePages = docs.filter((d) => !d.route.startsWith("/docs"));
        const listItem = (d) => `- [${d.title}](${site}${d.route}.md): ${d.description}`;

        // llmstxt.org format: H1, blockquote summary, free-form Markdown with no
        // headings (the when-to-use guidance), then H2 sections of link lists.
        write(
          "llms.txt",
          [
            "# 3D Asset Server",
            "",
            `> Free search engine, REST API and MCP server for 3D assets. One query searches ${providers.length} sites (Poly Haven, ambientCG, Kenney, BlenderKit, CGTrader, itch.io and more) for 3D models, PBR materials, textures, HDRIs and game asset packs, returns each asset's licence, and downloads glTF/FBX/Blend models, texture maps and HDR/EXR files. No account or API key needed.`,
            "",
            "**When to use 3D Asset Server.** Use it when a user or task needs existing 3D assets:",
            "",
            "- finding a 3D model, game asset pack or sprite set for a project (\"low-poly tree\", \"sci-fi crate\");",
            "- getting PBR textures/materials (\"mossy rock\", \"brick wall\") as color, normal, roughness and AO maps at 1k-8k;",
            "- getting an HDRI / environment map (\"sunset\", \"studio\") as HDR or EXR;",
            "- downloading those files into a codebase for Three.js, Babylon.js, React Three Fiber, Godot, Unity, Unreal, Blender or a website;",
            "- checking whether an asset's licence allows commercial use or requires attribution.",
            "",
            "Do not use it to generate new models or textures, to buy paid assets (paid results link to their store), or for non-3D stock photos and video.",
            "",
            `**How to call it.** MCP (preferred): add \`${site}/mcp\` (Streamable HTTP, no auth), e.g. \`claude mcp add --transport http 3d-assets ${site}/mcp\`, then call \`search_assets\` → \`get_asset\` → download its \`bundleUrl\`. REST: \`GET ${site}/v1/search?q=...&type=model&free=true\` → \`GET /v1/assets/{id}\` → \`GET /v1/assets/{id}/download?format=glb&resolution=2k\`. Limits: 120 requests/minute per client (RateLimit headers, 429 + Retry-After). Full agent guide: ${site}/AGENTS.md`,
            "",
            "## Docs",
            "",
            `- [Agent guide](${site}/AGENTS.md): when to use the service and how an AI agent should search, choose and download assets`,
            ...docPages.map(listItem),
            "",
            "## API",
            "",
            `- [OpenAPI 3.1](${site}/openapi.json): machine-readable REST API description (rate-limit headers, 429 responses, schemas)`,
            `- [API reference](${site}/docs/api/reference): every endpoint, parameter, response and schema`,
            `- [API playground](${site}/docs/api/playground): send live requests from the browser (interactive Scalar client)`,
            `- [MCP endpoint](${site}/mcp): Streamable HTTP; tools search_assets, get_asset, list_providers`,
            `- [Search endpoint](${site}/v1/search?q=wooden+chair&type=model&free=true): example search`,
            "",
            "## About",
            "",
            ...sitePages.map(listItem),
            "",
            "## Optional",
            "",
            `- [Claude Code skill](${site}/skill/SKILL.md): drop into ~/.claude/skills/3d-assets/SKILL.md`,
            `- [Everything in one file](${site}/llms-full.txt)`,
            `- [Web search](${site}/search)`,
            `- [Sitemap](${site}/sitemap-index.xml)`,
            "",
          ].join("\n"),
        );
        write("llms-full.txt", [agents.trim(), ...docs.map((d) => d.md.trim())].join("\n\n---\n\n") + "\n");

        // Scalar always declares fonts from fonts.scalar.com; drop them so the
        // page stays same-origin (it uses the site's Geist fonts instead).
        // ES-module build: a ~0.7 MB entry plus chunks fetched only when needed
        // (vs. 4.3 MB for the all-in-one bundle). Source maps are skipped.
        const scalarDir = join(root, "node_modules/@scalar/api-reference/dist/browser");
        const entry = readFileSync(join(scalarDir, "standalone.esm.js"), "utf8");
        const stripped = entry.replace(/@font-face \{(?:\\n|[^}])*?fonts\.scalar\.com[^}]*\}/g, "");
        if (stripped.includes("fonts.scalar.com")) logger.warn("scalar bundle still references fonts.scalar.com");
        write("scalar/standalone.esm.js", stripped);
        for (const chunk of readdirSync(join(scalarDir, "chunks")).filter((f) => f.endsWith(".js"))) {
          write(`scalar/chunks/${chunk}`, readFileSync(join(scalarDir, "chunks", chunk)));
        }
        logger.info(`wrote AGENTS.md, llms.txt, llms-full.txt, skill and ${docs.length} markdown twins`);
      },
    },
  };
}
