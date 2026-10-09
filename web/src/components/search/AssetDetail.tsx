import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Bot, Check, Download, FileBox, Loader2, Share2, Terminal, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CopyButton } from "@/components/home/AgentSetup";
import { api, formatBytes, getKey, safeUrl, type Asset, type AssetDetails, type FileSelection } from "./api";

export function AssetDetail({ asset, providerName, saved, onFavorite, favoriteBusy, favoriteUnavailable }: { asset: Asset; providerName: string; saved: boolean; onFavorite: () => void; favoriteBusy: boolean; favoriteUnavailable: boolean }) {
  const [full, setFull] = useState<AssetDetails | null>(null);
  const [failed, setFailed] = useState(false);
  const [format, setFormat] = useState("");
  const [resolution, setResolution] = useState("");
  const [selection, setSelection] = useState<FileSelection | null>(null);
  const [selError, setSelError] = useState<string>();

  useEffect(() => {
    setFull(null);
    setFailed(false);
    setFormat("");
    setResolution("");
    api<AssetDetails>(`/v1/assets/${encodeURIComponent(asset.id)}`)
      .then(setFull)
      .catch(() => setFailed(true));
  }, [asset.id]);

  const files = useMemo(() => (full?.files ?? []).filter((f) => !f.requiresAuth), [full]);
  const options = useMemo(() => {
    const formats = new Set<string>();
    const resolutions = new Set<string>();
    for (const f of files) {
      formats.add(f.group && f.group !== "maps" && f.group !== f.format ? f.group : f.format);
      if (f.resolution) resolutions.add(f.resolution);
    }
    return { formats: [...formats], resolutions: [...resolutions].sort((a, b) => parseFloat(a) - parseFloat(b)) };
  }, [files]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (format) p.set("format", format);
    if (resolution) p.set("resolution", resolution);
    return p.toString() ? `?${p.toString()}` : "";
  }, [format, resolution]);

  const base = `/v1/assets/${encodeURIComponent(asset.id)}`;
  useEffect(() => {
    if (!files.length) return;
    setSelection(null);
    setSelError(undefined);
    api<FileSelection>(`${base}/files${qs}`).then(setSelection).catch((e: Error) => setSelError(e.message));
  }, [base, qs, files.length]);

  const a = full ?? asset;
  const hero = safeUrl(a.thumbnailUrl);
  const source = safeUrl(a.url);
  const key = getKey();
  const downloadHref = `${base}/download${qs}${key ? `${qs ? "&" : "?"}api_key=${encodeURIComponent(key)}` : ""}`;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const curl = `curl -L -o "${asset.id.replace(/[^a-z0-9]+/gi, "-")}.zip" "${origin}${base}/download${qs}"`;
  const agentPrompt = `Use the 3d-assets MCP server: get_asset("${asset.id}")${format ? ` with format ${format}` : ""}${resolution ? ` at ${resolution}` : ""}, download it into ./assets and tell me the licence.`;

  const rows: [string, React.ReactNode][] = [
    ["Price", a.price ? (a.price.free ? "Free" : a.price.amount != null ? `${a.price.amount} ${a.price.currency ?? ""}` : "Paid") : "Unknown"],
    [
      "Licence",
      a.license ? (
        <span>
          {safeUrl(a.license.url) ? (
            <a className="text-primary hover:underline" href={safeUrl(a.license.url)} target="_blank" rel="noopener noreferrer">{a.license.name}</a>
          ) : (
            a.license.name
          )}
          {a.license.commercialUse && " · commercial use OK"}
          {a.license.attributionRequired && " · attribution required"}
        </span>
      ) : undefined,
    ],
    ["Author", a.author],
    ["Formats", a.formats?.join(", ")],
    ["Resolutions", a.resolutions?.join(", ")],
    ["Polygons", a.polyCount?.toLocaleString()],
    ["Animated", a.animated ? "Yes" : undefined],
    ["Rigged", a.rigged ? "Yes" : undefined],
    ["Asset id", <code className="font-mono text-xs">{a.id}</code>],
  ];

  return (
    <div className="space-y-6 px-6 pb-10">
      {hero && <img src={hero} alt={`Preview of ${a.title}`} referrerPolicy="no-referrer" className="aspect-[4/3] w-full rounded-xl border object-cover" />}
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
        {rows
          .filter(([, v]) => v !== undefined && v !== "")
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      {a.description && <p className="text-sm leading-relaxed text-muted-foreground">{a.description}</p>}
      {a.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {a.tags.slice(0, 14).map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onFavorite} disabled={favoriteBusy || favoriteUnavailable} aria-pressed={saved}><Star className="size-4" fill={saved ? "currentColor" : "none"} />{saved ? "Guardado en Favoritos" : "Guardar en Favoritos"}</Button>
        {source && (
          <Button variant="outline" asChild>
            <a href={source} target="_blank" rel="noopener noreferrer">Open on {providerName} <ArrowUpRight className="size-4" /></a>
          </Button>
        )}
        <ShareButton title={a.title} url={`${origin}/search?asset=${encodeURIComponent(asset.id)}`} />
      </div>

      <Separator />

      <section aria-label="Download">
        <h3 className="mb-3 flex items-center gap-2 font-medium"><FileBox className="size-4 text-primary" /> Download</h3>
        {!full && !failed && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading files…</p>}
        {(failed || (full && !files.length)) && (
          <p className="text-sm text-muted-foreground">No direct downloads from this source. Get it on the source page.</p>
        )}
        {files.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                <option value="">Auto format</option>
                {options.formats.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              {options.resolutions.length > 0 && (
                <select aria-label="Resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                  <option value="">Auto (2k)</option>
                  {options.resolutions.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
              <Button asChild disabled={!selection?.files.length}>
                <a href={downloadHref}><Download className="size-4" /> Download</a>
              </Button>
              {selection?.totalBytes != null && <span className="text-xs text-muted-foreground">{formatBytes(selection.totalBytes)}</span>}
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {selError && <li className="text-destructive">{selError}</li>}
              {!selection && !selError && <li>…</li>}
              {selection?.files.length === 0 && <li>Nothing matches this combination.</li>}
              {selection?.files.map((f) => (
                <li key={f.url} className="font-mono">
                  {f.filename}
                  {f.resolution ? ` · ${f.resolution}` : ""}
                  {f.includes?.length ? ` + ${f.includes.length} companion files` : ""}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Multi-file downloads (e.g. glTF with textures) arrive as one zip.</p>
          </div>
        )}
      </section>

      <section aria-label="Use from code or an agent" className="space-y-3">
        <h3 className="flex items-center gap-2 font-medium"><Terminal className="size-4 text-primary" /> Use it from code or an agent</h3>
        <Snippet icon={<Terminal className="size-3.5" />} label="curl" text={curl} />
        <Snippet icon={<Bot className="size-3.5" />} label="Prompt for your agent" text={agentPrompt} />
      </section>
    </div>
  );
}

function Snippet({ icon, label, text }: { icon: React.ReactNode; label: string; text: string }) {
  return (
    <div className="rounded-lg bg-[#0d0d12] p-3 text-zinc-100">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">{icon}{label}</span>
        <CopyButton text={text} />
      </div>
      <pre className="whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed">{text}</pre>
    </div>
  );
}

/** Share link to this asset (`/search?asset=<id>`, which unfurls with its own preview card). */
function ShareButton({ title, url }: { title: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ title, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <Button variant="outline" onClick={() => void share()}>
      {copied ? <Check className="size-4" /> : <Share2 className="size-4" />}
      {copied ? "Link copied" : "Share"}
    </Button>
  );
}
