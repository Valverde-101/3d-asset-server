import { useEffect, useMemo, useState } from "react";
import { ArchiveRestore, Check, Download, ExternalLink, Filter, Grid2X2, Link2, List, Plus, Search, Star, Trash2, Upload } from "lucide-react";
import { safeUrl } from "@/components/search/api";
import { refreshFavorites, request, useFavorites, type Favorite, type FavoriteInput, type FavoriteStatus, type Project } from "./client";
import { FavoritePreview } from "./FavoritePreview";

const field = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const compactField = "h-10 max-w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const button = "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium transition hover:border-primary/40 hover:bg-accent disabled:opacity-50";
const primary = "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50";
const label = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const statusNames: Record<FavoriteStatus, string> = { pending: "Pendiente", reviewed: "Evaluado", approved: "Aprobado" };
const typeNames: Record<string, string> = { link: "Enlace", model: "Modelo", material: "Material", texture: "Textura", hdri: "HDRI", pack: "Paquete", sprite: "Sprite", ui: "Interfaz", audio: "Audio", tutorial: "Tutorial", inspiration: "Inspiración", tool: "Herramienta" };
const checkNames = { unchecked: "Sin comprobar", working: "Disponible", broken: "Enlace roto", unknown: "No concluyente" };
const manual: FavoriteInput = { source: "link", url: "", title: "", type: "link", imageUrl: undefined, note: "", description: "", projects: [], categories: [], tags: [], status: "pending", licenseReviewed: false, priceFree: null, downloadable: null };

function host(url: string): string { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Enlace"; } }
function date(value: string): string { return new Date(value).toLocaleDateString("es-PE", { year: "numeric", month: "short", day: "numeric" }); }
function multi(values: string[] | undefined, id: string): string[] { return values?.includes(id) ? values.filter((v) => v !== id) : [...(values ?? []), id]; }

export default function FavoritesApp() {
  const { library, error } = useFavorites();
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<Favorite | "new" | null>(null);
  const [form, setForm] = useState<FavoriteInput>(manual);
  const [showCategories, setShowCategories] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [tag, setTag] = useState("");
  const [kind, setKind] = useState("");
  const [source, setSource] = useState("");
  const [license, setLicense] = useState("");
  const [price, setPrice] = useState("");
  const [download, setDownload] = useState("");
  const [age, setAge] = useState("");
  const [linkState, setLinkState] = useState("");
  const [sort, setSort] = useState("newest");
  const [trash, setTrash] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState("category");
  const [bulkValue, setBulkValue] = useState("");
  const [importPayload, setImportPayload] = useState<{ schema: number; items: unknown[]; categories: unknown[] } | null>(null);

  useEffect(() => { request<{ projects: Project[] }>("/projects").then((data) => setProjects(data.projects)).catch(() => undefined); }, []);

  const active = library?.items.filter((item) => !item.deletedAt) ?? [];
  const allProjects = useMemo(() => [...new Set([...projects.map((p) => p.id), ...(library?.items.flatMap((i) => i.projects) ?? [])])].sort(), [projects, library]);
  const allTags = useMemo(() => [...new Set(library?.items.flatMap((i) => i.tags) ?? [])].sort(), [library]);
  const allKinds = useMemo(() => [...new Set(library?.items.map((i) => i.type) ?? [])].sort(), [library]);
  const allSources = useMemo(() => [...new Set(library?.items.map((i) => i.provider || host(i.url)) ?? [])].sort(), [library]);
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const min = age ? Date.now() - Number(age) * 86400000 : 0;
    const result = (library?.items ?? []).filter((item) => {
      if (Boolean(item.deletedAt) !== trash) return false;
      if (q && ![item.title, item.url, item.note, item.author, item.provider, ...item.tags].join(" ").toLocaleLowerCase().includes(q)) return false;
      if (project && !item.projects.includes(project)) return false;
      if (category && !item.categories.includes(category)) return false;
      if (status && item.status !== status) return false;
      if (tag && !item.tags.includes(tag)) return false;
      if (kind && item.type !== kind) return false;
      if (source && (item.provider || host(item.url)) !== source) return false;
      if (license === "verified" && !item.licenseReviewed || license === "known" && !item.licenseName || license === "missing" && item.licenseName) return false;
      if (price === "free" && item.priceFree !== true || price === "paid" && item.priceFree !== false || price === "unknown" && item.priceFree !== null) return false;
      if (download === "yes" && item.downloadable !== true || download === "no" && item.downloadable !== false) return false;
      if (min && new Date(item.createdAt).getTime() < min) return false;
      if (linkState && item.linkCheck.state !== linkState) return false;
      return true;
    });
    return result.sort((a, b) => sort === "oldest" ? a.createdAt.localeCompare(b.createdAt) : sort === "title" ? a.title.localeCompare(b.title) : sort === "source" ? (a.provider || host(a.url)).localeCompare(b.provider || host(b.url)) : b.createdAt.localeCompare(a.createdAt));
  }, [library, query, project, category, status, tag, kind, source, license, price, download, age, linkState, sort, trash]);

  const run = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true); setMessage("");
    try { await work(); await refreshFavorites(); setMessage(success); }
    catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const startNew = () => { setEditing("new"); setForm({ ...manual, projects: [], categories: [], tags: [] }); setTimeout(() => document.getElementById("favorite-editor")?.scrollIntoView({ behavior: "smooth" }), 0); };
  const startEdit = (item: Favorite) => { setEditing(item); setForm({ source: item.source, assetId: item.assetId, url: item.url, title: item.title, type: item.type, imageUrl: item.imageUrl, description: item.description, note: item.note, provider: item.provider, author: item.author, licenseName: item.licenseName, licenseUrl: item.licenseUrl, licenseReviewed: item.licenseReviewed, priceFree: item.priceFree, downloadable: item.downloadable, projects: [...item.projects], categories: [...item.categories], tags: [...item.tags], status: item.status }); setTimeout(() => document.getElementById("favorite-editor")?.scrollIntoView({ behavior: "smooth" }), 0); };
  const save = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    await run(async () => {
      if (editing === "new") await request("", "POST", form);
      else await request(`/${editing.id}`, "PATCH", { ...form, expectedUpdatedAt: editing.updatedAt });
      setEditing(null);
    }, "Favorito guardado.");
  };
  const checkLinks = async () => {
    const ids = (selected.length ? selected : visible.map((i) => i.id)).filter((id) => active.some((i) => i.id === id));
    if (!ids.length) { setMessage("No hay enlaces activos para comprobar."); return; }
    await run(async () => { for (let i = 0; i < ids.length; i += 20) await request("/check", "POST", { ids: ids.slice(i, i + 20) }); }, `${ids.length} enlaces comprobados.`);
  };
  const performBulk = async () => {
    if (!selected.length) { setMessage("Selecciona al menos un favorito."); return; }
    const count = selected.length;
    await run(async () => { await request("/bulk", "POST", { ids: selected, action: bulkAction, value: bulkAction === "trash" || bulkAction === "restore" ? undefined : bulkValue }); setSelected([]); }, `${count} elementos actualizados.`);
  };

  return <div className="mx-auto max-w-7xl px-4 pb-24 pt-9 sm:px-6">
    <div className="flex flex-wrap items-start justify-between gap-5">
      <div><p className="text-xs font-semibold uppercase tracking-[.2em] text-primary">Tu biblioteca local</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Favoritos</h1><p className="mt-3 max-w-2xl text-sm text-muted-foreground">Guarda recursos y enlaces, organízalos por proyecto y revisa su licencia antes de utilizarlos.</p></div>
      <div className="flex flex-wrap gap-2"><button className={primary} onClick={startNew}><Plus className="size-4" /> Añadir enlace</button><a className={button} href="/local/favorites/export" download="androidbuild-favoritos.json"><Download className="size-4" /> Exportar</a><label className={button}><Upload className="size-4" /> Importar<input type="file" accept="application/json,.json" className="sr-only" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; try { const data = JSON.parse(await file.text()) as { schema: number; items: unknown[]; categories: unknown[] }; if (data.schema !== 1 || !Array.isArray(data.items) || !Array.isArray(data.categories)) throw new Error("Archivo de Favoritos no válido."); setImportPayload(data); } catch (err) { setMessage(err instanceof Error ? err.message : String(err)); } e.target.value = ""; }} /></label></div>
    </div>
    <div className="mt-7 grid gap-3 sm:grid-cols-3"><Stat title="Guardados" value={active.length} /><Stat title="Aprobados" value={active.filter((i) => i.status === "approved").length} /><Stat title="En Papelera" value={(library?.items.length ?? 0) - active.length} /></div>
    {error && <p role="alert" className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="mt-5 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">{message}</p>}
    {importPayload && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-card p-4 text-sm"><span>Importar {importPayload.items.length} enlaces y {importPayload.categories.length} categorías. Los duplicados se omitirán.</span><div className="flex gap-2"><button className={button} onClick={() => setImportPayload(null)}>Cancelar</button><button className={primary} disabled={busy} onClick={() => void run(async () => { await request<{ added: number; skipped: number }>("/import", "POST", importPayload); setImportPayload(null); }, "Importación terminada; los duplicados se omitieron.")}>Importar</button></div></div>}

    {editing && <section id="favorite-editor" className="mt-7 rounded-2xl border border-primary/25 bg-card p-5 shadow-sm sm:p-6" aria-label="Editar favorito"><div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-semibold">{editing === "new" ? "Añadir enlace" : "Editar favorito"}</h2><button className={button} onClick={() => setEditing(null)}>Cerrar</button></div><form onSubmit={(e) => void save(e)} className="grid gap-4 sm:grid-cols-2">
      <Field title="URL *"><input className={field} type="url" required value={form.url} disabled={editing !== "new" && editing.source === "asset"} onChange={(e) => setForm({ ...form, url: e.target.value })} /></Field>
      <Field title="Título *"><input className={field} required maxLength={180} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
      <Field title="Tipo"><select className={field} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{Object.entries(typeNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
      <Field title="Imagen (URL opcional)"><input className={field} type="url" value={form.imageUrl ?? ""} onChange={(e) => setForm({ ...form, imageUrl: e.target.value || undefined })} /><span className="mt-1 block text-xs text-muted-foreground">Si la dejas vacía, se mostrará el icono del sitio.</span></Field>
      <Field title="Proyectos"><div className="max-h-32 overflow-y-auto rounded-lg border p-2 text-sm">{allProjects.length ? allProjects.map((p) => <label key={p} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-accent"><input type="checkbox" checked={form.projects?.includes(p) ?? false} onChange={() => setForm({ ...form, projects: multi(form.projects, p) })} />{p}</label>) : <span className="text-muted-foreground">No se encontraron repositorios físicos.</span>}</div></Field>
      <Field title="Categorías"><div className="max-h-32 overflow-y-auto rounded-lg border p-2 text-sm">{library?.categories.length ? library.categories.map((c) => <label key={c.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-accent"><input type="checkbox" checked={form.categories?.includes(c.id) ?? false} onChange={() => setForm({ ...form, categories: multi(form.categories, c.id) })} />{c.name}</label>) : <span className="text-muted-foreground">Crea una categoría desde «Administrar categorías».</span>}</div></Field>
      <Field title="Etiquetas (separadas por coma)"><input className={field} value={form.tags?.join(", ") ?? ""} onChange={(e) => setForm({ ...form, tags: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })} placeholder="medieval, personaje, 2D" /></Field>
      <Field title="Estado"><select className={field} value={form.status ?? "pending"} onChange={(e) => setForm({ ...form, status: e.target.value as FavoriteStatus })}>{Object.entries(statusNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
      <Field title="Licencia"><input className={field} value={form.licenseName ?? ""} onChange={(e) => setForm({ ...form, licenseName: e.target.value || undefined, licenseReviewed: false })} placeholder="CC0, CC BY 4.0, licencia del autor…" /></Field>
      <Field title="Enlace a la licencia"><input className={field} type="url" value={form.licenseUrl ?? ""} onChange={(e) => setForm({ ...form, licenseUrl: e.target.value || undefined })} /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={form.licenseReviewed ?? false} onChange={(e) => setForm({ ...form, licenseReviewed: e.target.checked })} />He revisado la licencia en la página de origen.</label>
      <details className="sm:col-span-2"><summary className="cursor-pointer text-sm font-medium text-muted-foreground">Más datos del recurso</summary><div className="mt-3 grid gap-4 sm:grid-cols-3"><Field title="Autor"><input className={field} value={form.author ?? ""} onChange={(e) => setForm({ ...form, author: e.target.value || undefined })} /></Field><Field title="Precio"><select className={field} value={form.priceFree === true ? "free" : form.priceFree === false ? "paid" : "unknown"} onChange={(e) => setForm({ ...form, priceFree: e.target.value === "unknown" ? null : e.target.value === "free" })}><option value="unknown">Sin dato</option><option value="free">Gratis</option><option value="paid">De pago</option></select></Field><Field title="Descarga directa"><select className={field} value={form.downloadable === true ? "yes" : form.downloadable === false ? "no" : "unknown"} onChange={(e) => setForm({ ...form, downloadable: e.target.value === "unknown" ? null : e.target.value === "yes" })}><option value="unknown">Sin dato</option><option value="yes">Sí</option><option value="no">No</option></select></Field></div></details>
      <Field title="Notas" wide><textarea className="min-h-24 w-full rounded-lg border bg-background p-3 text-sm" maxLength={4000} value={form.note ?? ""} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Por qué te interesa, restricciones, idea de uso…" /></Field>
      <div className="flex gap-2 sm:col-span-2"><button type="submit" disabled={busy} className={primary}><Check className="size-4" /> Guardar favorito</button><button type="button" className={button} onClick={() => setEditing(null)}>Cancelar</button></div>
    </form></section>}

    <section className="mt-7 rounded-2xl border bg-card/60 p-4 sm:p-5" aria-label="Filtros de Favoritos">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><div className="relative lg:col-span-2"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" /><input className={`${field} pl-9`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar título, URL, nota o etiqueta" aria-label="Buscar favoritos" /></div><select className={field} value={project} onChange={(e) => setProject(e.target.value)} aria-label="Filtrar por proyecto"><option value="">Todos los proyectos</option>{allProjects.map((p) => <option key={p} value={p}>{p}</option>)}</select><select className={field} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filtrar por categoría"><option value="">Todas las categorías</option>{library?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><select className={field} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrar por estado"><option value="">Todos los estados</option>{Object.entries(statusNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>
      <details className="mt-3"><summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-muted-foreground"><Filter className="size-4" /> Más filtros</summary><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Select label="Etiqueta" value={tag} set={setTag} options={allTags} /><Select label="Tipo" value={kind} set={setKind} options={allKinds} names={typeNames} /><Select label="Fuente" value={source} set={setSource} options={allSources} /><Select label="Licencia" value={license} set={setLicense} options={["verified", "known", "missing"]} names={{ verified: "Revisada", known: "Conocida", missing: "Sin datos" }} /><Select label="Precio" value={price} set={setPrice} options={["free", "paid", "unknown"]} names={{ free: "Gratis", paid: "De pago", unknown: "Sin dato" }} /><Select label="Descarga directa" value={download} set={setDownload} options={["yes", "no"]} names={{ yes: "Sí", no: "No" }} /><Select label="Guardado" value={age} set={setAge} options={["7", "30", "90"]} names={{ "7": "Últimos 7 días", "30": "Últimos 30 días", "90": "Últimos 90 días" }} /><Select label="Enlace" value={linkState} set={setLinkState} options={Object.keys(checkNames)} names={checkNames} /></div></details>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4"><div className="flex flex-wrap items-center gap-2"><button className={`${button} ${!trash ? "border-primary text-primary" : ""}`} onClick={() => { setTrash(false); setSelected([]); }}>Guardados</button><button className={`${button} ${trash ? "border-primary text-primary" : ""}`} onClick={() => { setTrash(true); setSelected([]); }}><Trash2 className="size-4" /> Papelera</button><button className={button} onClick={() => setShowCategories(!showCategories)}>Administrar categorías</button></div><div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{visible.length} resultados</span><select className={field} aria-label="Ordenar favoritos" value={sort} onChange={(e) => setSort(e.target.value)}><option value="newest">Más recientes</option><option value="oldest">Más antiguos</option><option value="title">Título A–Z</option><option value="source">Fuente A–Z</option></select><button className={`${button} ${view === "grid" ? "border-primary" : ""}`} aria-label="Vista de tarjetas" aria-pressed={view === "grid"} onClick={() => setView("grid")}><Grid2X2 className="size-4" /></button><button className={`${button} ${view === "list" ? "border-primary" : ""}`} aria-label="Vista de lista" aria-pressed={view === "list"} onClick={() => setView("list")}><List className="size-4" /></button></div></div>
    </section>

    {showCategories && <section className="mt-4 rounded-2xl border bg-card p-5" aria-label="Administrar categorías"><h2 className="text-lg font-semibold">Categorías personalizadas</h2><form className="mt-3 flex max-w-lg gap-2" onSubmit={(e) => { e.preventDefault(); void run(async () => { await request("/categories", "POST", { name: categoryName }); setCategoryName(""); }, "Categoría creada."); }}><input className={field} value={categoryName} onChange={(e) => setCategoryName(e.target.value)} maxLength={80} placeholder="Nueva categoría" aria-label="Nombre de nueva categoría" required /><button className={primary} disabled={busy}>Crear</button></form><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{library?.categories.map((c) => <div className="flex gap-2" key={c.id}><input className={field} value={categoryDrafts[c.id] ?? c.name} onChange={(e) => setCategoryDrafts({ ...categoryDrafts, [c.id]: e.target.value })} aria-label={`Renombrar ${c.name}`} /><button className={button} disabled={busy} onClick={() => void run(() => request(`/categories/${c.id}`, "PATCH", { name: categoryDrafts[c.id] ?? c.name }), "Categoría renombrada.")}>Guardar</button><button className={button} disabled={busy} aria-label={`Eliminar categoría ${c.name}`} onClick={() => void run(() => request(`/categories/${c.id}`, "DELETE"), "Categoría eliminada; los favoritos se conservan.")}><Trash2 className="size-4" /></button></div>)}</div></section>}

    <div className="mt-5 flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={visible.length > 0 && visible.every((i) => selected.includes(i.id))} onChange={(e) => setSelected(e.target.checked ? visible.map((i) => i.id) : [])} />Seleccionar visibles</label><span className="mr-2 text-xs text-muted-foreground">{selected.length} seleccionados</span><select className={compactField} aria-label="Acción masiva" value={bulkAction} onChange={(e) => { setBulkAction(e.target.value); setBulkValue(""); }}><option value="category">Añadir categoría</option><option value="project">Añadir proyecto</option><option value="status">Cambiar estado</option><option value={trash ? "restore" : "trash"}>{trash ? "Restaurar" : "Mover a Papelera"}</option></select>{bulkAction === "category" && <select className={compactField} value={bulkValue} aria-label="Categoría masiva" onChange={(e) => setBulkValue(e.target.value)}><option value="">Elige categoría</option>{library?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}{bulkAction === "project" && <select className={compactField} value={bulkValue} aria-label="Proyecto masivo" onChange={(e) => setBulkValue(e.target.value)}><option value="">Elige proyecto</option>{allProjects.map((p) => <option key={p} value={p}>{p}</option>)}</select>}{bulkAction === "status" && <select className={compactField} value={bulkValue} aria-label="Estado masivo" onChange={(e) => setBulkValue(e.target.value)}><option value="">Elige estado</option>{Object.entries(statusNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>}<button className={button} disabled={busy || !selected.length || !["trash", "restore"].includes(bulkAction) && !bulkValue} onClick={() => void performBulk()}>Aplicar</button><button className={button} disabled={busy || trash || !visible.length} onClick={() => void checkLinks()}><Link2 className="size-4" /> Comprobar {selected.length ? "seleccionados" : "visibles"}</button></div>

    {!library && !error && <p className="mt-12 text-center text-sm text-muted-foreground">Cargando biblioteca…</p>}
    {library && !visible.length && <div className="mt-8 rounded-2xl border border-dashed p-12 text-center"><Star className="mx-auto size-9 text-primary" /><h2 className="mt-3 text-lg font-semibold">{trash ? "La Papelera está vacía" : active.length ? "No hay resultados con estos filtros" : "Tu biblioteca está lista"}</h2><p className="mt-2 text-sm text-muted-foreground">{trash ? "Los enlaces eliminados aparecerán aquí para restaurarlos." : "Guarda recursos con la estrella o añade el enlace de cualquier página."}</p>{!trash && !active.length && <button className={`${primary} mt-5`} onClick={startNew}>Añadir primer enlace</button>}</div>}
    <div className={`mt-6 grid gap-4 ${view === "grid" ? "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-1"}`}>
      {visible.map((item) => <FavoriteCard key={item.id} item={item} categoryNames={library?.categories ?? []} view={view} selected={selected.includes(item.id)} onSelect={() => setSelected(multi(selected, item.id))} onEdit={() => startEdit(item)} onCheck={() => void run(() => request("/check", "POST", { ids: [item.id] }), "Enlace comprobado.")} onTrash={() => void run(() => request(`/${item.id}/trash`, "POST"), "Movido a Papelera. Puedes restaurarlo.")} onRestore={() => void run(() => request(`/${item.id}/restore`, "POST"), "Favorito restaurado.")} onDelete={() => { if (window.confirm(`¿Eliminar definitivamente «${item.title}»?`)) void run(() => request(`/${item.id}`, "DELETE"), "Eliminado definitivamente."); }} busy={busy} />)}
    </div>
  </div>;
}

function Stat({ title, value }: { title: string; value: number }) { return <div className="rounded-xl border bg-card/70 p-4"><small className="text-xs uppercase tracking-wider text-muted-foreground">{title}</small><strong className="mt-2 block text-2xl">{value}</strong></div>; }
function Field({ title, wide, children }: { title: string; wide?: boolean; children: React.ReactNode }) { return <label className={wide ? "sm:col-span-2" : ""}><span className={label}>{title}</span>{children}</label>; }
function Select({ label: title, value, set, options, names = {} }: { label: string; value: string; set: (value: string) => void; options: string[]; names?: Record<string, string> }) { return <label><span className={label}>{title}</span><select className={field} value={value} onChange={(e) => set(e.target.value)}><option value="">Todos</option>{options.map((option) => <option key={option} value={option}>{names[option] ?? option}</option>)}</select></label>; }

function FavoriteCard({ item, categoryNames, view, selected, onSelect, onEdit, onCheck, onTrash, onRestore, onDelete, busy }: { item: Favorite; categoryNames: { id: string; name: string }[]; view: "grid" | "list"; selected: boolean; onSelect: () => void; onEdit: () => void; onCheck: () => void; onTrash: () => void; onRestore: () => void; onDelete: () => void; busy: boolean }) {
  const href = safeUrl(item.url);
  return <article className={`overflow-hidden rounded-xl border bg-card/70 transition hover:border-primary/40 ${view === "list" ? "sm:flex" : ""}`}>
    <div className={`relative shrink-0 bg-muted ${view === "list" ? "h-44 sm:h-auto sm:w-48" : "aspect-[4/3]"}`}><FavoritePreview key={`${item.url}|${item.imageUrl ?? ""}`} imageUrl={item.imageUrl} url={item.url} title={item.title} domain={host(item.url)} /><label className="absolute left-2 top-2 flex size-9 items-center justify-center rounded-full border bg-background/90 shadow-sm" title="Seleccionar"><input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Seleccionar ${item.title}`} /></label></div>
    <div className="flex min-w-0 flex-1 flex-col p-4"><div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"><span>{item.provider || host(item.url)}</span><span>·</span><span>{typeNames[item.type] ?? item.type}</span><span>·</span><span>{date(item.createdAt)}</span></div><h2 className="mt-2 line-clamp-2 text-base font-semibold leading-snug">{item.title}</h2>{item.note && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{item.note}</p>}
      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]"><span className={`rounded-full border px-2 py-0.5 ${item.status === "approved" ? "border-success/40 text-success" : ""}`}>{statusNames[item.status]}</span>{item.licenseName && <span className="rounded-full border px-2 py-0.5">{item.licenseName}{item.licenseReviewed ? " ✓" : ""}</span>}{item.projects.map((p) => <span key={p} className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">{p}</span>)}{item.categories.map((id) => <span key={id} className="rounded-full bg-accent px-2 py-0.5">{categoryNames.find((c) => c.id === id)?.name ?? id}</span>)}{item.tags.map((t) => <span key={t} className="rounded-full border px-2 py-0.5">#{t}</span>)}</div>
      <div className="mt-3 text-xs text-muted-foreground">Enlace: {checkNames[item.linkCheck.state]}{item.linkCheck.at && ` · ${date(item.linkCheck.at)}`}</div>
      <div className="mt-auto flex flex-wrap gap-2 pt-4">{href && <a href={href} target="_blank" rel="noopener noreferrer" className={button}>Abrir <ExternalLink className="size-3.5" /></a>}{item.deletedAt ? <><button className={button} disabled={busy} onClick={onRestore}><ArchiveRestore className="size-4" /> Restaurar</button><button className={button} disabled={busy} onClick={onDelete}>Eliminar definitivamente</button></> : <><button className={button} onClick={onEdit}>Editar</button><button className={button} disabled={busy} onClick={onCheck} title="Comprobar ahora">Comprobar</button><button className={button} disabled={busy} onClick={onTrash} aria-label={`Mover ${item.title} a Papelera`}><Trash2 className="size-4" /></button></>}</div>
    </div>
  </article>;
}
