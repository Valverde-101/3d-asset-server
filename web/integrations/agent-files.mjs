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

        const order = ["/docs", "/docs/mcp", "/docs/api", "/docs/sources", "/docs/self-hosting"];
        docs.sort((a, b) => order.indexOf(a.route) - order.indexOf(b.route));

        write(
          "llms.txt",
          [
            "# 3D Asset Server",
            "",
            `> Free search engine, REST API and MCP server for 3D assets. One query searches ${providers.length} sites (Poly Haven, ambientCG, Kenney, BlenderKit, CGTrader, itch.io and more) for 3D models, PBR materials, textures, HDRIs and game asset packs, returns each asset's licence, and downloads glTF/FBX/Blend models, texture maps and HDR/EXR files. No account or API key needed.`,
            "",
            `AI agents: read ${site}/AGENTS.md first. MCP endpoint: ${site}/mcp (Streamable HTTP). Claude Code: \`claude mcp add --transport http 3d-assets ${site}/mcp\`.`,
            "",
            "## Docs",
            "",
            `- [Agent guide](${site}/AGENTS.md): how an AI agent should search, choose and download assets`,
            ...docs.map((d) => `- [${d.title}](${site}${d.route}.md): ${d.description}`),
            "",
            "## API",
            "",
            `- [OpenAPI 3.1](${site}/openapi.json): machine-readable REST API description`,
            `- [API reference](${site}/docs/api/reference): interactive reference`,
            `- [Search endpoint](${site}/v1/search?q=wooden+chair&type=model&free=true): example search`,
            "",
            "## Optional",
            "",
            `- [Claude Code skill](${site}/skill/SKILL.md): drop into ~/.claude/skills/3d-assets/SKILL.md`,
            `- [Everything in one file](${site}/llms-full.txt)`,
            `- [Web search](${site}/search)`,
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
