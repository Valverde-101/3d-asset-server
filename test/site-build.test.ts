/**
 * Checks the built website (dist/web) for the machine-readable promises the
 * site makes to agents. Runs after `npm run build` (as in CI); skipped when
 * the site has not been built.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../dist/web/", import.meta.url);
const built = existsSync(new URL("index.html", root));
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const text = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<header[\s\S]*?<\/header>/g, "")
    .replace(/<footer[\s\S]*?<\/footer>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const jsonLd = (html: string) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!) as { "@graph": Record<string, unknown>[] };

describe.skipIf(!built)("built website", () => {
  it.each(["about", "contact", "privacy"])("has a substantial /%s trust page with a Markdown twin", (page) => {
    expect(text(read(`${page}/index.html`)).length).toBeGreaterThan(500);
    expect(read(`${page}.md`).length).toBeGreaterThan(500);
  });

  it("lists the trust and policy pages in the sitemap", () => {
    const sitemap = read("sitemap-0.xml");
    for (const p of ["/about", "/contact", "/privacy", "/docs/api/versioning", "/docs/cli"]) expect(sitemap).toContain(`https://3d.shep.bot${p}<`);
  });

  it("gives agents when-to-use guidance in llms.txt (llmstxt.org layout) and AGENTS.md", () => {
    const llms = read("llms.txt");
    expect(llms.startsWith("# 3D Asset Server\n\n> ")).toBe(true);
    const beforeSections = llms.slice(0, llms.indexOf("\n## "));
    expect(beforeSections).toContain("When to use 3D Asset Server");
    expect(beforeSections).not.toMatch(/\n#{1,6} /); // free-form part has no headings
    expect(llms).toContain("/about.md");
    const agents = read("AGENTS.md");
    expect(agents).toContain("## When to use this");
    expect(agents).toContain("## When not to use it");
  });

  it("publishes an Organization with contact points", () => {
    const org = jsonLd(read("index.html"))["@graph"].find((n) => n["@type"] === "Organization") as { contactPoint: { url: string }[] };
    expect(org.contactPoint.length).toBeGreaterThan(0);
    expect(org.contactPoint[0]!.url).toBe("https://3d.shep.bot/contact");
  });

  it("documents versioning, deprecation and rate limits", () => {
    const page = text(read("docs/api/versioning/index.html"));
    for (const term of ["Deprecation", "Sunset", "Retry-After", "RateLimit-Policy", "90 days"]) expect(page).toContain(term);
  });

  it("names the product in the homepage title and H1", () => {
    const home = read("index.html");
    expect(home).toMatch(/<title>3D Asset Server[^<]*<\/title>/);
    expect(home.match(/<h1[\s\S]*?<\/h1>/)![0]).toContain("3D Asset Server");
  });

  it("has no duplicate ids and labels every form control", () => {
    for (const page of ["index.html", "search/index.html", "docs/api/reference/index.html", "docs/mcp/index.html"]) {
      const html = read(page);
      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      expect(ids.filter((id, i) => ids.indexOf(id) !== i), page).toEqual([]);
    }
    const search = read("search/index.html");
    for (const input of search.match(/<input\b[^>]*>/g) ?? []) {
      if (/type="hidden"/.test(input)) continue;
      expect(/aria-label=|aria-labelledby=|title=/.test(input) || search.includes(`<label`), input).toBe(true);
    }
    expect(search).not.toMatch(/<button[^>]*role="switch"/); // switches are native, labelled checkboxes
  });

  it("serves the product screenshot as AVIF and WebP with a PNG fallback", () => {
    const home = read("index.html");
    expect(home).toContain('<source type="image/avif" srcset="/img/search-preview.avif"');
    expect(home).toContain('<source type="image/webp" srcset="/img/search-preview.webp"');
    expect(home).toMatch(/<img[^>]+src="\/img\/search-preview\.png"[^>]+width="1280"[^>]+height="800"/);
    for (const ext of ["avif", "webp", "png"]) expect(existsSync(new URL(`img/search-preview.${ext}`, root))).toBe(true);
  });

  it("keeps the API playground out of crawls and renders the full reference statically", () => {
    const robots = read("robots.txt");
    expect(robots).toMatch(/User-agent: \*\nDisallow: \/v1\/assets\/\*\/download\nDisallow: \/docs\/api\/playground/);
    expect(robots).not.toContain("Allow: /");
    expect(read("sitemap-0.xml")).not.toContain("playground");
    const reference = read("docs/api/reference/index.html");
    for (const id of ["searchAssets", "getAsset", "selectFiles", "downloadAsset", "listProviders", "mcp"]) expect(reference).toContain(`id="op-${id}"`);
    for (const schema of ["asset", "assetfile", "searchresponse", "providerreport"]) expect(reference).toContain(`id="schema-${schema}"`);
    expect(read("docs/api/playground/index.html")).toContain('content="noindex, follow"');
  });

  it("publishes a /stats page with a Markdown twin, footer link and llms.txt entry", () => {
    const html = read("stats/index.html");
    expect(html).toMatch(/<h1[^>]*>Usage statistics<\/h1>/);
    expect(html).toContain("StatsDashboard"); // the live island
    expect(read("sitemap-0.xml")).toContain("https://3d.shep.bot/stats<");
    expect(read("index.html")).toContain('href="/stats"');
    expect(read("stats.md")).toContain("/v1/stats");
    expect(read("llms.txt")).toContain("https://3d.shep.bot/stats.md");
  });

  it("states the same source count everywhere", async () => {
    const { allProviders } = await import("../src/providers/index.js");
    const n = allProviders.length;
    const files = ["index.html", "docs/index.html", "about.md", "docs/mcp.md", "docs/api.md", "docs/cli.md", "AGENTS.md", "skill/SKILL.md", "llms.txt", "stats/index.html"];
    const sources = [...files.map((f) => [f, read(f)]), ["README.md", readFileSync(new URL("../README.md", import.meta.url), "utf8")]];
    for (const [f, body] of sources) {
      for (const m of body!.matchAll(/\b(\d+) (?:3D )?(?:asset )?sites\b/g)) expect(`${f}: ${m[0]}`).toBe(`${f}: ${m[1] === String(n) ? m[0] : `${n} … sites`}`);
    }
  });

  it("gives every page its own 1200×630 share card, alt text and schema image", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const sharp = (await import("sharp")).default;
    const pages: string[] = [];
    const walk = (dir: URL) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(new URL(`${e.name}/`, dir));
        else if (e.name === "index.html" || e.name === "404.html") pages.push(new URL(e.name, dir).pathname.slice(root.pathname.length));
      }
    };
    walk(root);
    expect(pages.length).toBeGreaterThan(10);
    const images = new Set<string>();
    for (const page of pages) {
      const html = read(page);
      const image = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
      expect(image, page).toMatch(/^https:\/\/3d\.shep\.bot\/og\/[a-z0-9-]+\.png$/);
      images.add(image!);
      const file = new URL(`.${new URL(image!).pathname}`, root);
      expect(statSync(file).size, image).toBeGreaterThan(10_000);
      expect(await sharp(file.pathname).metadata(), image).toMatchObject({ width: 1200, height: 630, format: "png" });
      for (const tag of ['property="og:image:alt"', 'name="twitter:image:alt"', 'property="og:image:type" content="image/png"', 'name="twitter:card" content="summary_large_image"']) {
        expect(html, `${page} ${tag}`).toContain(tag);
      }
      const nodes = jsonLd(html)["@graph"];
      const img = nodes.find((n) => n["@type"] === "ImageObject");
      expect(img?.url, page).toBe(image);
      expect(nodes.some((n) => (n.primaryImageOfPage as { "@id"?: string } | undefined)?.["@id"] === img?.["@id"] || (n.image as { "@id"?: string } | undefined)?.["@id"] === img?.["@id"]), page).toBe(true);
    }
    expect(images.size).toBe(pages.length); // one card per page
    expect(statSync(new URL("og.png", root)).size).toBeGreaterThan(10_000); // legacy URL still served
    expect(read("docs/mcp/index.html")).toContain('<meta property="article:section" content="Docs"');
  });
});

