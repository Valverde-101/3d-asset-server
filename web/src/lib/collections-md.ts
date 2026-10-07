/**
 * Markdown twins of the collection, hub and source pages (/assets/<slug>.md,
 * /assets.md, /sources/<id>.md), for agents and LLM crawlers. Same facts as
 * the HTML, plus the asset ids an agent can pass to GET /v1/assets/{id}.
 */
import { HUBS, apiHref, collectionPath, countLabel, hubPath, latest, providerName, searchHref, sourcePath, type Collection, type Hub, type SourcePage } from "./collections";
import { fmt } from "./catalog";
import { SITE } from "./site";

const abs = (path: string) => `${SITE.url}${path}`;
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const day = (d?: Date) => d?.toISOString().slice(0, 10);
/** Root-relative Markdown links become absolute so the file works wherever it is read. */
const absolutize = (md: string) => md.replace(/\]\(\//g, `](${SITE.url}/`);
const footer = (path: string) => `\n---\nSource: ${abs(path)}\n`;

export function collectionMarkdown(c: Collection, related: Collection[]): string {
  const d = c.topic.data;
  const rows = c.assets.map(
    (a) =>
      `| [${cell(a.title)}](${a.url}) | \`${a.id}\` | ${providerName(a.provider)} | ${a.license?.name ?? "see source"} | ${a.free === undefined ? "?" : a.free ? "yes" : "no"} | ${a.downloadable ? "yes" : "no"} |`,
  );
  return [
    `# ${d.title}`,
    "",
    `> ${d.description}`,
    "",
    `${countLabel(c.assets)} from ${c.sources.length} sources (${c.sources.map((s) => `${s.name} ${s.count}`).join(", ")})${c.updatedAt ? `, updated ${day(c.updatedAt)}` : ""}. Picked from a live search and refreshed daily.`,
    "",
    `- Same search in the browser: ${abs(searchHref(d.search))}`,
    `- Same search over the API: \`curl "${apiHref(d.search)}"\``,
    "- Asset details and files: `GET " + SITE.url + "/v1/assets/{id}` with an id from the table below.",
    "",
    absolutize(c.topic.body?.trim() ?? ""),
    "",
    "## Assets",
    "",
    "| Asset | id | Source | Licence | Free | Direct download |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "## Questions",
    "",
    ...d.faq.flatMap((f) => [`**${f.q}**`, "", f.a, ""]),
    "## Related collections",
    "",
    ...related.map((r) => `- [${r.topic.data.title}](${abs(r.path)}.md): ${r.topic.data.description}`),
    footer(c.path),
  ].join("\n");
}

export function hubMarkdown(hub: Hub, cs: Collection[]): string {
  const updated = latest(cs);
  return [
    `# ${hub.title}`,
    "",
    `> ${hub.description}`,
    "",
    hub.intro,
    "",
    ...(updated ? [`Updated ${day(updated)}.`, ""] : []),
    "## Collections",
    "",
    ...cs.map((c) => `- [${c.topic.data.title}](${abs(c.path)}.md): ${countLabel(c.assets)} from ${c.sources.length} sources. ${c.topic.data.description}`),
    "",
    "## Other kinds",
    "",
    ...HUBS.filter((h) => h.id !== hub.id).map((h) => `- [${h.title}](${abs(hubPath(h))}.md)`),
    footer(hubPath(hub)),
  ].join("\n");
}

export function indexMarkdown(all: Collection[]): string {
  const updated = latest(all);
  return [
    "# Free 3D asset collections",
    "",
    `> Curated collections of free HDRIs, PBR textures, 3D models and game assets from many asset sites, with licences, refreshed daily${updated ? ` (last change ${day(updated)})` : ""}. Each collection is a saved search; agents can run the same search with \`GET ${SITE.url}/v1/search\`.`,
    "",
    ...HUBS.flatMap((hub) => {
      const cs = all.filter((c) => c.hub.id === hub.id);
      return cs.length ? [`## ${hub.title}`, "", `[All ${hub.name.toLowerCase()}](${abs(hubPath(hub))}.md)`, "", ...cs.map((c) => `- [${c.topic.data.title}](${abs(collectionPath(c.slug))}.md): ${c.topic.data.description}`), ""] : [];
    }),
    footer("/assets"),
  ].join("\n");
}

export function sourceMarkdown(s: SourcePage): string {
  const p = s.provider;
  const t = s.census;
  const facts = [
    `- Website: ${p.homepage}`,
    `- Best for: ${p.description}`,
    `- Asset types: ${p.assetTypes.join(", ")}`,
    `- Pricing: ${p.pricing}`,
    `- Licence: ${p.license ?? "set per asset"}`,
    `- Direct download through 3D Asset Server: ${p.supportsDownload ? "yes" : "no (results link to the asset page)"}`,
    `- Restrict a search to it: \`${SITE.url}/v1/search?q=...&providers=${p.id}\``,
    ...(t ? [`- Listings counted ${t.countedAt.slice(0, 10)}: ${fmt(t.total, t.atLeast)}${t.unit === "packs" ? " packs" : ""}${t.free !== undefined ? `, ${fmt(t.free)} free` : ""}`] : []),
  ];
  return [
    `# ${p.name}`,
    "",
    `> ${p.name} as searched by 3D Asset Server: ${p.description}`,
    "",
    ...facts,
    "",
    ...(s.collections.length
      ? ["## In these collections", "", ...s.collections.map(({ collection: c, count }) => `- [${c.topic.data.title}](${abs(c.path)}.md): ${count} of ${c.assets.length}`), ""]
      : []),
    ...(s.assets.length ? ["## Examples", "", ...s.assets.map((a) => `- [${a.title}](${a.url}) (\`${a.id}\`, ${a.license?.name ?? "licence on the source page"})`), ""] : []),
    `All sources: ${SITE.url}/docs/sources.md`,
    footer(sourcePath(p.id)),
  ].join("\n");
}
