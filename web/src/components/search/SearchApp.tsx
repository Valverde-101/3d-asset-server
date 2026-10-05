import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Download, Filter, Loader2, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { api, getKey, safeUrl, setKey, UnauthorizedError, type Asset, type Provider, type ProviderReport, type SearchResponse } from "./api";
import { AssetDetail } from "./AssetDetail";

const TYPES: [string, string][] = [
  ["model", "Models"],
  ["material", "Materials"],
  ["texture", "Textures"],
  ["hdri", "HDRIs"],
  ["pack", "Packs"],
  ["sprite", "Sprites"],
  ["ui", "UI"],
  ["audio", "Audio"],
];
const PAGE = 24;

interface Filters {
  q: string;
  types: string[];
  free: boolean;
  downloadable: boolean;
  sources: string[] | null;
}

function readUrl(): Filters {
  const p = new URLSearchParams(window.location.search);
  return {
    q: p.get("q") ?? "",
    types: (p.get("type") ?? "").split(",").filter(Boolean),
    free: p.get("free") === "true",
    downloadable: p.get("downloadable") === "true",
    sources: p.get("providers") ? p.get("providers")!.split(",") : null,
  };
}

function toParams(f: Filters, offset = 0): URLSearchParams {
  const p = new URLSearchParams();
  p.set("q", f.q);
  if (f.types.length) p.set("type", f.types.join(","));
  if (f.free) p.set("free", "true");
  if (f.downloadable) p.set("downloadable", "true");
  if (f.sources) p.set("providers", f.sources.join(","));
  if (offset) p.set("offset", String(offset));
  return p;
}

export default function SearchApp() {
  const [filters, setFilters] = useState<Filters>({ q: "", types: [], free: false, downloadable: false, sources: null });
  const [draft, setDraft] = useState("");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [results, setResults] = useState<Asset[]>([]);
  const [reports, setReports] = useState<ProviderReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [needKey, setNeedKey] = useState(false);
  const [canMore, setCanMore] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<Asset | null>(null);
  const offset = useRef(0);
  const seen = useRef(new Set<string>());
  const inputRef = useRef<HTMLInputElement>(null);

  const providerName = useCallback((id: string) => providers.find((p) => p.id === id)?.name ?? id, [providers]);

  const run = useCallback(async (f: Filters, append: boolean) => {
    if (!append) {
      offset.current = 0;
      seen.current = new Set();
      setResults([]);
      setReports([]);
    }
    setLoading(true);
    setError(undefined);
    setSearched(true);
    const qs = toParams(f);
    window.history.replaceState(null, "", `/search?${qs.toString()}`);
    document.title = f.q ? `${f.q} · 3D asset search` : "Search 3D assets · 3D Asset Server";
    try {
      const params = toParams(f, offset.current);
      params.set("limit", String(PAGE));
      const res = await api<SearchResponse>(`/v1/search?${params.toString()}`);
      const fresh = res.results.filter((a) => !seen.current.has(a.id) && seen.current.add(a.id));
      setResults((prev) => (append ? [...prev, ...fresh] : fresh));
      setReports(res.providers);
      setCanMore(fresh.length > 0 && res.providers.some((r) => r.status === "ok" && r.count >= PAGE));
      offset.current += PAGE;
    } catch (e) {
      if (e instanceof UnauthorizedError) setNeedKey(true);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const f = readUrl();
    setFilters(f);
    setDraft(f.q);
    api<{ providers: Provider[] }>("/v1/providers")
      .then((r) => setProviders(r.providers))
      .catch((e) => e instanceof UnauthorizedError && setNeedKey(true));
    if (f.q || f.types.length) void run(f, false);
    else inputRef.current?.focus();
  }, [run]);

  const update = (patch: Partial<Filters>, rerun = true) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    if (rerun && (next.q || next.types.length)) void run(next, false);
  };

  const okReports = useMemo(() => reports.filter((r) => r.status !== "skipped"), [reports]);
  const sourceLabel = filters.sources ? `${filters.sources.length} of ${providers.length}` : "All sources";

  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
      <div className="sticky top-14 z-30 -mx-4 border-b border-border/60 bg-background/80 px-4 pb-4 pt-5 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: draft.trim() });
          }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="low poly tree, brick wall, sunset hdri…"
              aria-label="Search 3D assets"
              className="h-11 rounded-xl pl-10 text-base"
            />
          </div>
          <Button type="submit" size="lg" className="h-11 rounded-xl px-5" disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : "Search"}
          </Button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2.5">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Asset types">
            {TYPES.map(([id, label]) => {
              const on = filters.types.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => update({ types: on ? filters.types.filter((t) => t !== id) : [...filters.types, id] })}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <Switch id="free" checked={filters.free} onCheckedChange={(v) => update({ free: v })} />
            <Label htmlFor="free" className="text-xs text-muted-foreground">Free only</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="dl" checked={filters.downloadable} onCheckedChange={(v) => update({ downloadable: v })} />
            <Label htmlFor="dl" className="text-xs text-muted-foreground">Direct download</Label>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 rounded-full text-xs">
                <SlidersHorizontal className="size-3.5" /> {sourceLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">Sources</p>
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => update({ sources: null })}>
                  Select all
                </button>
              </div>
              <div className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto">
                {providers.map((p) => {
                  const on = !filters.sources || filters.sources.includes(p.id);
                  return (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-accent" title={p.description}>
                      <Checkbox
                        checked={on}
                        onCheckedChange={(v) => {
                          const current = filters.sources ?? providers.map((x) => x.id);
                          const next = v ? [...current, p.id] : current.filter((x) => x !== p.id);
                          update({ sources: next.length === providers.length ? null : next }, false);
                        }}
                      />
                      <span className="flex-1">{p.name}</span>
                      {p.supportsDownload && <Download className="size-3 text-muted-foreground" aria-label="direct downloads" />}
                    </label>
                  );
                })}
              </div>
              <Button size="sm" className="mt-3 w-full" onClick={() => void run(filters, false)} disabled={!filters.q && !filters.types.length}>
                Apply
              </Button>
            </PopoverContent>
          </Popover>
        </div>

        {needKey && (
          <form
            className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              const v = new FormData(e.currentTarget).get("key");
              setKey(String(v ?? ""));
              setNeedKey(false);
              void run(filters, false);
            }}
          >
            <span>This server needs an API key.</span>
            <Input name="key" type="password" defaultValue={getKey()} className="h-8 w-56" placeholder="API key" />
            <Button size="sm" type="submit">Save</Button>
          </form>
        )}
      </div>

      {okReports.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-1.5 text-xs" aria-label="Sources">
          {okReports.map((r) => {
            const url = r.status !== "ok" ? safeUrl(r.searchUrl) : undefined;
            const cls = cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-0.5",
              r.status === "ok" && "text-muted-foreground",
              (r.status === "error" || r.status === "timeout") && "border-destructive/30 text-destructive",
              r.status === "link" && "border-primary/30 text-primary hover:bg-primary/10",
            );
            const body = (
              <>
                {r.name}
                {r.status === "ok" ? <b className="font-semibold text-foreground">{r.count}</b> : r.status === "link" ? <ArrowUpRight className="size-3" /> : ` ${r.status}`}
              </>
            );
            return url ? (
              <a key={r.provider} href={url} target="_blank" rel="noopener noreferrer" className={cls} title={r.error ?? `Open this search on ${r.name}`}>
                {body}
              </a>
            ) : (
              <span key={r.provider} className={cls} title={r.error ?? `${r.tookMs} ms`}>
                {body}
              </span>
            );
          })}
        </div>
      )}

      {error && <p className="mt-8 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</p>}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {results.map((a) => (
          <ResultCard key={a.id} asset={a} providerName={providerName(a.provider)} onOpen={() => setSelected(a)} />
        ))}
        {loading &&
          Array.from({ length: results.length ? 5 : 10 }).map((_, i) => (
            <div key={`s${i}`} className="overflow-hidden rounded-xl border">
              <Skeleton className="aspect-[4/3] rounded-none" />
              <div className="space-y-2 p-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
      </div>

      {!loading && !error && searched && results.length === 0 && (
        <div className="mt-16 text-center text-muted-foreground">
          <Filter className="mx-auto size-8 opacity-50" />
          <p className="mt-3">No results. Try a simpler query, fewer filters, or the source links above.</p>
        </div>
      )}
      {!searched && (
        <div className="mt-16 text-center text-muted-foreground">
          <Sparkles className="mx-auto size-8 text-primary/70" />
          <p className="mt-3">
            Search Poly Haven, ambientCG, Kenney, BlenderKit, itch.io and {Math.max(providers.length - 5, 12)} more sources at once.
          </p>
        </div>
      )}
      {canMore && !loading && (
        <div className="mt-10 text-center">
          <Button variant="outline" onClick={() => void run(filters, true)}>Load more</Button>
        </div>
      )}

      <Sheet open={Boolean(selected)} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected && (
            <>
              <SheetHeader className="px-6 pt-6">
                <SheetDescription>
                  {providerName(selected.provider)} · {selected.type}
                </SheetDescription>
                <SheetTitle className="text-xl">{selected.title}</SheetTitle>
              </SheetHeader>
              <AssetDetail asset={selected} providerName={providerName(selected.provider)} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ResultCard({ asset: a, providerName, onOpen }: { asset: Asset; providerName: string; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  const src = safeUrl(a.thumbnailUrl);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-xl border bg-card/50 text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {src && !broken ? (
          <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-full object-cover transition duration-500 group-hover:scale-[1.04]" />
        ) : (
          <div className="flex size-full items-center justify-center text-xs uppercase tracking-wider text-muted-foreground">{a.type}</div>
        )}
        {a.downloadable && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
            <Download className="size-3" /> direct
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="line-clamp-2 text-sm font-medium leading-snug" title={a.title}>{a.title}</p>
        <div className="mt-auto flex flex-wrap gap-1">
          <Badge variant="secondary" className="text-[10px]">{providerName}</Badge>
          {a.price && (
            <Badge variant="outline" className={cn("text-[10px]", a.price.free ? "border-success/40 text-success" : "border-warning/40 text-warning")}>
              {a.price.free ? "Free" : a.price.amount != null ? `${a.price.amount} ${a.price.currency ?? ""}` : "Paid"}
            </Badge>
          )}
          {a.license && <Badge variant="outline" className="text-[10px]">{a.license.name}</Badge>}
        </div>
      </div>
    </button>
  );
}

