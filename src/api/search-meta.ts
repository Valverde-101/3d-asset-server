/**
 * Title/description for query variants of /search (e.g. /search?q=brick+wall,
 * /search?type=hdri&free=true), so every crawlable URL has unique metadata.
 * Variants are `noindex, follow`: internal search results are not landing
 * pages, but their links (to docs and sources) should still be followed.
 */

import { allProviders } from "../providers/index.js";

const SITES = `${allProviders.length} sites`;

const TYPE_LABELS: Record<string, string> = {
  model: "3D models",
  material: "PBR materials",
  texture: "textures",
  hdri: "HDRIs",
  sprite: "sprites",
  ui: "UI kits",
  audio: "game audio",
  font: "fonts",
  pack: "game asset packs",
  other: "assets",
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function searchMeta(params: URLSearchParams): { title: string; description: string; robots: string } | undefined {
  const q = (params.get("q") ?? "").replace(/\s+/g, " ").trim();
  const types = (params.get("type") ?? "").split(",").map((t) => TYPE_LABELS[t.trim()]).filter(Boolean) as string[];
  const free = params.get("free") === "true";
  if (!q && !types.length && !free) return undefined;
  const what = types.length ? types.join(" & ") : "3D assets";
  const kind = `${free ? "free " : ""}${what}`;
  const title = q ? `“${clip(q, 40)}”: ${kind} · 3D Asset Server` : `${kind[0]!.toUpperCase()}${kind.slice(1)}: search ${SITES} · 3D Asset Server`;
  const description = q
    ? `Search results for “${clip(q, 60)}” across ${SITES}: ${kind} with licences and direct downloads from Poly Haven, ambientCG, Kenney and more.`
    : `Browse ${kind} from ${SITES} at once, including Poly Haven, ambientCG, Kenney and BlenderKit, with licences and one-click downloads.`;
  return { title, description, robots: "noindex, follow" };
}
