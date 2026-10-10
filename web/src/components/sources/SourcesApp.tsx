import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Check, Download, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, getKey, setKey, UnauthorizedError, type Provider } from "@/components/search/api";
import { enabledSources, readDisabledSources, writeDisabledSources } from "@/lib/source-preferences";

const accessName: Record<string, string> = { api: "API", scrape: "Site search", link: "Search link" };
const pricingName: Record<string, string> = { free: "Free", freemium: "Free + paid", paid: "Paid" };

export default function SourcesApp() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [keyRequired, setKeyRequired] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDisabled(readDisabledSources());
    api<{ providers: Provider[] }>("/v1/providers")
      .then((data) => setProviders(data.providers))
      .catch((e) => {
        if (e instanceof UnauthorizedError) setKeyRequired(true);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return providers.filter((p) => !q || `${p.name} ${p.id} ${p.description} ${p.homepage}`.toLocaleLowerCase().includes(q));
  }, [providers, query]);
  const activeIds = enabledSources(providers.map((p) => p.id), disabled);

  const saveDisabled = (next: string[]) => {
    if (!writeDisabledSources(next)) {
      setError("This browser could not save the source preferences. Check its storage settings and try again.");
      setSaved(false);
      return;
    }
    setError("");
    setDisabled(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2400);
  };

  const toggle = (id: string, on: boolean) => saveDisabled(on ? disabled.filter((x) => x !== id) : [...disabled, id]);
  const sourceCountLabel = `${activeIds.length} of ${providers.length} enabled`;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Search settings</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Sources</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Choose which sites this website includes by default. Changes are saved in this browser and affect website searches only; REST API and MCP searches are unchanged.
          </p>
        </div>
        <Badge variant="secondary" className="mt-1 px-3 py-1">{sourceCountLabel}</Badge>
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-2 rounded-xl border bg-card/60 p-3">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by site or asset type" aria-label="Filter sources" className="pl-9" />
        </div>
        <Button type="button" variant="outline" onClick={() => saveDisabled([])} disabled={!providers.length}>
          <Check /> Enable all
        </Button>
        <Button type="button" variant="outline" onClick={() => saveDisabled(providers.map((p) => p.id))} disabled={!providers.length}>
          Disable all
        </Button>
      </div>

      {saved && <p role="status" className="mt-3 text-sm text-success">Saved in this browser.</p>}
      {error && <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {keyRequired && (
        <form className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" onSubmit={(e) => {
          e.preventDefault();
          const value = new FormData(e.currentTarget).get("key");
          setKey(String(value ?? ""));
          setKeyRequired(false);
          setError("");
          api<{ providers: Provider[] }>("/v1/providers").then((data) => setProviders(data.providers)).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
        }}>
          <span>This server needs an API key to list sources.</span>
          <Input name="key" type="password" defaultValue={getKey()} className="h-9 w-56" placeholder="API key" />
          <Button size="sm" type="submit">Save</Button>
        </form>
      )}

      <div className="mt-4 divide-y overflow-hidden rounded-xl border bg-card/40">
        {visible.map((p) => {
          const on = !disabled.includes(p.id);
          return (
            <article key={p.id} className="flex flex-wrap items-start gap-4 p-4 sm:items-center sm:p-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{p.name}</h2>
                  <Badge variant="outline">{accessName[p.access] ?? p.access}</Badge>
                  <Badge variant="secondary">{pricingName[p.pricing] ?? p.pricing}</Badge>
                  {p.supportsDownload && <Badge variant="outline" className="gap-1"><Download className="size-3" /> Direct downloads</Badge>}
                </div>
                <p className="mt-1.5 max-w-3xl text-sm leading-5 text-muted-foreground">{p.description}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{p.assetTypes?.join(" · ")}</span>
                  <span aria-hidden="true">•</span>
                  <a href={p.homepage} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    {new URL(p.homepage).hostname}<ArrowUpRight className="size-3" />
                  </a>
                </div>
              </div>
              <Switch
                className="shrink-0"
                label={on ? "Enabled" : "Disabled"}
                labelClassName="min-w-16 text-sm font-medium"
                checked={on}
                onCheckedChange={(value) => toggle(p.id, value)}
                aria-label={`${on ? "Disable" : "Enable"} ${p.name} for website searches`}
              />
            </article>
          );
        })}
        {!visible.length && !providers.length && !error && <p className="p-6 text-sm text-muted-foreground">Loading sources…</p>}
        {!visible.length && providers.length > 0 && <p className="p-6 text-sm text-muted-foreground">No source matches this filter.</p>}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Sources marked “Search link” open the site’s own results page. We do not copy listings or files from those sites.
      </p>
    </div>
  );
}
