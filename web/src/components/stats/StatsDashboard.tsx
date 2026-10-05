import { useEffect, useState } from "react";
import { cn } from "cn";
import { Skeleton } from "@/components/ui/skeleton";

/** Shape of GET /v1/stats (see the Stats schema in /openapi.json). */
interface UsageWindow {
  key: string;
  label: string;
  searches: number;
  searchesWithResults: number;
  bySurface: { web: number; api: number; mcp: number };
  assetViews: number;
  downloads: number;
  toolCalls: number;
  pageViews: number;
}
interface Ranked { name: string; count: number }
interface ProviderHealth {
  provider: string;
  requests: number;
  ok: number;
  errors: number;
  timeouts: number;
  okRate: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
}
interface Stats {
  generatedAt: string;
  source: "prometheus" | "process";
  since?: string;
  windows: UsageWindow[];
  breakdownLabel: string;
  clients: Ranked[];
  tools: Ranked[];
  assetTypes: Ranked[];
  providers: ProviderHealth[];
}

const CLIENTS: Record<string, string> = {
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  cursor: "Cursor",
  windsurf: "Windsurf",
  vscode: "VS Code / Copilot",
  codex: "Codex",
  gemini: "Gemini",
  zed: "Zed",
  cline: "Cline / Roo Code",
  openai: "OpenAI",
  "mcp-sdk": "Other MCP clients",
  python: "Python",
  curl: "curl",
  node: "Node.js",
  bot: "Bots & crawlers",
  browser: "Web browsers",
  other: "Other",
  unknown: "Unknown",
};
const TYPES: Record<string, string> = {
  any: "All types",
  multi: "Several types",
  model: "3D models",
  texture: "Textures",
  material: "PBR materials",
  hdri: "HDRIs",
  sprite: "Sprites",
  ui: "UI kits",
  audio: "Audio",
  font: "Fonts",
  pack: "Asset packs",
  other: "Other",
};
const SURFACES = [
  { key: "web", label: "Website", className: "bg-primary" },
  { key: "mcp", label: "AI agents (MCP)", className: "bg-brand-2" },
  { key: "api", label: "REST API", className: "bg-muted-foreground" },
] as const;

const fmt = new Intl.NumberFormat("en");
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "–");
const ms = (v: number | null) => (v === null ? "–" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card/40 p-5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{value}</dd>
      {hint && <dd className="mt-1 text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

function Bars({ title, items, labels, empty }: { title: string; items: Ranked[]; labels: Record<string, string>; empty: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="rounded-xl border bg-card/40 p-5">
      <h3 className="text-sm font-medium">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((i) => (
            <li key={i.name}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">{labels[i.name] ?? i.name}</span>
                <span className="tabular-nums text-muted-foreground">{fmt.format(i.count)}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div className="h-full rounded-full bg-primary/80" style={{ width: `${(i.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SurfaceSplit({ w }: { w: UsageWindow }) {
  const total = w.bySurface.web + w.bySurface.api + w.bySurface.mcp;
  return (
    <div className="rounded-xl border bg-card/40 p-5">
      <h3 className="text-sm font-medium">Where searches come from</h3>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {total > 0 &&
          SURFACES.map((s) => (
            <div key={s.key} className={cn("h-full", s.className)} style={{ width: `${(w.bySurface[s.key] / total) * 100}%` }} />
          ))}
      </div>
      <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        {SURFACES.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className={cn("size-2.5 shrink-0 rounded-full", s.className)} aria-hidden="true" />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="ml-auto tabular-nums sm:ml-1">
              {fmt.format(w.bySurface[s.key])} <span className="text-muted-foreground">({pct(w.bySurface[s.key], total)})</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function health(rate: number | null): { label: string; className: string } {
  if (rate === null) return { label: "No traffic", className: "bg-muted-foreground/50" };
  if (rate >= 0.95) return { label: "Healthy", className: "bg-emerald-500" };
  if (rate >= 0.8) return { label: "Degraded", className: "bg-amber-500" };
  return { label: "Failing", className: "bg-red-500" };
}

function SourceHealth({ rows, names }: { rows: ProviderHealth[]; names: Record<string, string> }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <caption className="sr-only">Per-source search health over the last 24 hours</caption>
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">Source</th>
            <th scope="col" className="px-4 py-3 font-medium">Status</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Success</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Median</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">p95</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Requests</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const h = health(r.okRate);
            return (
              <tr key={r.provider}>
                <th scope="row" className="px-4 py-3 text-left font-medium">
                  <a href={`/docs/sources#${r.provider}`} className="hover:underline">{names[r.provider] ?? r.provider}</a>
                </th>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <span className={cn("size-2 rounded-full", h.className)} aria-hidden="true" />
                    {h.label}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{r.okRate === null ? "–" : `${(r.okRate * 100).toFixed(r.okRate === 1 ? 0 : 1)}%`}</td>
                <td className="px-4 py-3 text-right tabular-nums">{ms(r.p50Ms)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{ms(r.p95Ms)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmt.format(r.requests)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading statistics…</span>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
      <Skeleton className="mt-4 h-28 rounded-xl" />
    </div>
  );
}

/** Live usage numbers from /v1/stats; `names` maps source ids to display names. */
export default function StatsDashboard({ names }: { names: Record<string, string> }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [windowKey, setWindowKey] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = () =>
      fetch("/v1/stats", { signal: ctrl.signal, headers: { accept: "application/json" } })
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          setStats((await r.json()) as Stats);
          setError(null);
        })
        .catch((e: unknown) => {
          if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
        });
    void load();
    // The server caches for a minute; refresh on that cadence while the tab is visible.
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 60_000);
    return () => {
      clearInterval(timer);
      ctrl.abort();
    };
  }, []);

  if (error && !stats) {
    return (
      <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-5 text-sm">
        Live statistics are unavailable right now ({error}). The raw numbers are at <a className="text-primary underline" href="/v1/stats">/v1/stats</a>.
      </p>
    );
  }
  if (!stats) return <Loading />;

  const w = stats.windows.find((x) => x.key === windowKey) ?? stats.windows[0]!;
  const updated = new Date(stats.generatedAt);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {stats.windows.length > 1 ? (
          <div role="group" aria-label="Time range" className="inline-flex rounded-lg border bg-card/40 p-1">
            {stats.windows.map((x) => (
              <button
                key={x.key}
                type="button"
                aria-pressed={x.key === w.key}
                onClick={() => setWindowKey(x.key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  x.key === w.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {x.label}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {w.label}
            {stats.since && <> ({new Date(stats.since).toLocaleString()})</>}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Updated <time dateTime={stats.generatedAt}>{updated.toLocaleTimeString()}</time> · refreshes every minute
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Searches" value={fmt.format(w.searches)} hint={`${pct(w.searchesWithResults, w.searches)} found results`} />
        <Kpi label="Downloads" value={fmt.format(w.downloads)} hint={`${fmt.format(w.assetViews)} asset detail views`} />
        <Kpi label="MCP tool calls" value={fmt.format(w.toolCalls)} hint="from AI coding agents" />
        <Kpi label="Page views" value={fmt.format(w.pageViews)} hint="website pages served" />
      </dl>

      <div className="mt-4">
        <SurfaceSplit w={w} />
      </div>

      <h2 id="breakdown" className="mt-12 text-xl font-semibold tracking-tight">What people search for</h2>
      <p className="mt-1 text-sm text-muted-foreground">{stats.breakdownLabel}.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Bars title="Clients" items={stats.clients} labels={CLIENTS} empty="No searches yet." />
        <Bars title="Asset types" items={stats.assetTypes} labels={TYPES} empty="No searches yet." />
        <Bars title="MCP tools" items={stats.tools} labels={{}} empty="No MCP tool calls yet." />
      </div>

      <h2 id="source-health" className="mt-12 text-xl font-semibold tracking-tight">Source health</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        How each site answered searches {stats.source === "prometheus" ? "in the last 24 hours" : "since the last restart"}. Timeouts and errors never fail a search; that source is just missing from the results.
      </p>
      <div className="mt-4">
        {stats.providers.length ? (
          <SourceHealth rows={stats.providers} names={names} />
        ) : (
          <p className="rounded-xl border bg-card/40 p-5 text-sm text-muted-foreground">No searches have reached the sources yet.</p>
        )}
      </div>
    </div>
  );
}
