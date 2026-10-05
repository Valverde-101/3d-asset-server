/**
 * The daily catalog census (scripts/census.mjs -> src/data/catalog.json) with
 * formatting helpers, so every page quotes the same numbers the same way.
 */
import catalogJson from "@/data/catalog.json";
import historyJson from "@/data/catalog-history.json";

export interface Count {
  count: number;
  atLeast?: boolean;
}

export interface CatalogSource {
  id: string;
  name: string;
  homepage: string;
  license?: string;
  pricing: string;
  supportsDownload: boolean;
  total: number;
  atLeast?: boolean;
  free?: number;
  byType: Record<string, number>;
  byLicense?: Record<string, number>;
  categories?: Record<string, number>;
  unit?: "assets" | "packs";
  addedLast30Days?: number;
  downloads?: number;
  highlights?: { label: string; title: string; url: string; value?: number }[];
  method: string;
  countedAt: string;
  stale?: { since: string; error: string };
}

export interface Catalog {
  countedAt: string;
  totals: {
    listings: Count;
    free: Count;
    cc0: Count;
    directDownload: Count;
    addedLast30Days: number;
    sourcesCounted: number;
    sourcesLinked: number;
  };
  byType: Record<string, Count>;
  byLicense: Record<string, number>;
  sources: CatalogSource[];
  linked: { id: string; name: string; homepage: string }[];
}

export interface HistoryPoint {
  date: string;
  listings: number;
  free: number;
  byType: Record<string, number>;
  sources: Record<string, number>;
}

export const CATALOG = catalogJson as unknown as Catalog;
export const HISTORY = historyJson as unknown as HistoryPoint[];

export const TYPE_NAMES: Record<string, string> = {
  model: "3D models",
  material: "PBR materials",
  texture: "Textures",
  hdri: "HDRIs",
  pack: "Asset packs",
  sprite: "Sprites",
  ui: "UI kits",
  audio: "Audio",
  font: "Fonts",
  other: "Other",
};

const full = new Intl.NumberFormat("en");

/** 2,951,627+ */
export function fmt(n: number, atLeast?: boolean): string {
  return `${full.format(n)}${atLeast ? "+" : ""}`;
}

/** 2.9M+ (for tiles); exact below 10,000. Rounds down, so a "+" never overstates. */
export function fmtShort(n: number, atLeast?: boolean): string {
  if (n < 10_000) return `${full.format(n)}${atLeast ? "+" : ""}`;
  const [div, suffix] = n >= 1_000_000 ? [1_000_000, "M"] : [1_000, "K"];
  const v = Math.floor((n / div) * 10) / 10;
  const shown = n >= 1_000_000 ? v : Math.floor(n / div);
  return `${shown.toLocaleString("en")}${suffix}${atLeast || shown * div < n ? "+" : ""}`;
}

/** "2.9 million+" for prose. */
export function fmtWords(n: number, atLeast?: boolean): string {
  if (n >= 1_000_000) return `${(Math.floor(n / 100_000) / 10).toLocaleString("en")} million${atLeast || n % 100_000 ? "+" : ""}`;
  if (n >= 10_000) return `${full.format(Math.floor(n / 1000) * 1000)}${atLeast || n % 1000 ? "+" : ""}`;
  return fmt(n, atLeast);
}

export const COUNTED_ON = new Intl.DateTimeFormat("en", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(
  new Date(CATALOG.countedAt),
);

/** Types sorted by count (largest first). */
export const TYPES_BY_SIZE = Object.entries(CATALOG.byType)
  .map(([type, c]) => ({ type, name: TYPE_NAMES[type] ?? type, ...c }))
  .sort((a, b) => b.count - a.count);

/** Free-only sources (every listing free), largest first: the libraries people quote. */
export const FREE_LIBRARIES = CATALOG.sources.filter((s) => s.pricing === "free");

/** One sentence anyone can quote. */
export const CATALOG_SENTENCE =
  `As of ${COUNTED_ON}, 3D Asset Server searches ${fmtWords(CATALOG.totals.listings.count, CATALOG.totals.listings.atLeast)} 3D asset listings ` +
  `from the ${CATALOG.totals.sourcesCounted} sources that publish counts, including ${fmtWords(CATALOG.totals.free.count, CATALOG.totals.free.atLeast)} free ones and ` +
  `${fmt(CATALOG.totals.cc0.count, CATALOG.totals.cc0.atLeast)} CC0 (public-domain) assets.`;
