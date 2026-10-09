import { randomUUID } from "node:crypto";
import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export type FavoriteStatus = "pending" | "reviewed" | "approved";
export type LinkState = "unchecked" | "working" | "broken" | "unknown";

const httpUrl = z.string().trim().max(2048).url().refine((value) => {
  const url = new URL(value);
  return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
}, "Use an HTTP(S) URL without credentials");
const short = z.string().trim().max(180);
const labels = z.array(z.string().trim().min(1).max(80)).max(30);
export const favoriteInput = z.object({
  source: z.enum(["asset", "link"]),
  assetId: short.optional(),
  url: httpUrl,
  title: z.string().trim().min(1).max(180),
  type: z.string().trim().min(1).max(40).default("link"),
  imageUrl: httpUrl.optional(),
  description: z.string().trim().max(1000).default(""),
  note: z.string().trim().max(4000).default(""),
  provider: short.optional(),
  author: short.optional(),
  licenseName: short.optional(),
  licenseUrl: httpUrl.optional(),
  licenseReviewed: z.boolean().default(false),
  priceFree: z.boolean().nullable().default(null),
  downloadable: z.boolean().nullable().default(null),
  projects: labels.default([]),
  categories: labels.default([]),
  tags: labels.default([]),
  status: z.enum(["pending", "reviewed", "approved"]).default("pending"),
});
export type FavoriteInput = z.infer<typeof favoriteInput>;
export const favoritePatch = favoriteInput.omit({ source: true, assetId: true }).partial().extend({ expectedUpdatedAt: z.string().optional() });

export interface Favorite extends FavoriteInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  linkCheck: { state: LinkState; at: string | null; httpStatus: number | null };
}
export interface FavoriteCategory { id: string; name: string }
export interface FavoriteLibrary { schema: 1; revision: number; items: Favorite[]; categories: FavoriteCategory[] }

export class FavoriteError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) { super(message); }
}

export function canonicalUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href;
}

function normaliseLabels(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function checkApproval(item: FavoriteInput): void {
  const resource = item.source === "asset" || ["model", "material", "texture", "hdri", "pack", "sprite", "ui", "audio"].includes(item.type);
  if (resource && item.status === "approved" && (!item.licenseReviewed || !item.licenseName?.trim())) {
    throw new FavoriteError("Para aprobar este recurso, registra y confirma la licencia.");
  }
}

const blank = (): FavoriteLibrary => ({ schema: 1, revision: 0, items: [], categories: [] });

export class FavoriteStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly file: string;
  private readonly backupDir: string;
  constructor(readonly directory: string) {
    this.file = join(directory, "library.json");
    this.backupDir = join(directory, "backups");
  }

  private async read(): Promise<FavoriteLibrary> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.file, "utf8"));
      if (!raw || typeof raw !== "object" || (raw as FavoriteLibrary).schema !== 1 || !Array.isArray((raw as FavoriteLibrary).items) || !Array.isArray((raw as FavoriteLibrary).categories)) {
        throw new Error("Invalid favorites library format");
      }
      return raw as FavoriteLibrary;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return blank();
      throw error;
    }
  }

  async snapshot(): Promise<FavoriteLibrary> {
    await this.queue;
    return this.read();
  }

  private async persist(library: FavoriteLibrary): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await mkdir(this.backupDir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const backup = join(this.backupDir, `${day}.json`);
    try {
      await stat(this.file);
      try { await copyFile(this.file, backup, 1); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const tmp = join(this.directory, `.library-${randomUUID()}.tmp`);
    try {
      const handle = await open(tmp, "wx");
      try { await handle.writeFile(JSON.stringify(library, null, 2) + "\n", "utf8"); await handle.sync(); }
      finally { await handle.close(); }
      await rename(tmp, this.file);
    } finally { await rm(tmp, { force: true }); }
    const backups = (await readdir(this.backupDir)).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort().reverse();
    for (const old of backups.slice(7)) await rm(join(this.backupDir, old), { force: true });
  }

  private mutate<T>(change: (library: FavoriteLibrary) => T | Promise<T>): Promise<T> {
    const task = this.queue.then(async () => {
      const library = await this.read();
      const result = await change(library);
      library.revision++;
      await this.persist(library);
      return result;
    });
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  async add(raw: unknown): Promise<{ item: Favorite; alreadyExists: boolean }> {
    const input = favoriteInput.parse(raw);
    if (input.source === "asset" && !input.assetId) throw new FavoriteError("Falta el ID del recurso.");
    checkApproval(input);
    return this.mutate((library) => {
      const existing = library.items.find((item) => input.assetId && item.assetId === input.assetId || canonicalUrl(item.url) === canonicalUrl(input.url));
      if (existing) {
        if (existing.deletedAt) { existing.deletedAt = null; existing.updatedAt = new Date().toISOString(); }
        return { item: existing, alreadyExists: true };
      }
      if (library.items.length >= 5000) throw new FavoriteError("La biblioteca alcanzó el máximo de 5000 entradas.");
      const now = new Date().toISOString();
      const item: Favorite = { ...input, projects: normaliseLabels(input.projects), categories: normaliseLabels(input.categories), tags: normaliseLabels(input.tags), id: randomUUID(), createdAt: now, updatedAt: now, deletedAt: null, linkCheck: { state: "unchecked", at: null, httpStatus: null } };
      library.items.unshift(item);
      return { item, alreadyExists: false };
    });
  }

  async edit(id: string, raw: unknown): Promise<Favorite> {
    const patch = favoritePatch.parse(raw);
    return this.mutate((library) => {
      const item = library.items.find((i) => i.id === id);
      if (!item) throw new FavoriteError("Favorito no encontrado.", 404);
      if (patch.expectedUpdatedAt && patch.expectedUpdatedAt !== item.updatedAt) throw new FavoriteError("Este favorito cambió en otra ventana. Actualiza la página.", 409);
      const { expectedUpdatedAt: _expected, ...changes } = patch;
      const next = favoriteInput.parse({ ...item, ...changes });
      checkApproval(next);
      if (library.items.some((other) => other.id !== id && canonicalUrl(other.url) === canonicalUrl(next.url))) throw new FavoriteError("Este enlace ya está guardado.", 409);
      Object.assign(item, next, { projects: normaliseLabels(next.projects), categories: normaliseLabels(next.categories), tags: normaliseLabels(next.tags), updatedAt: new Date().toISOString() });
      return item;
    });
  }

  async trash(id: string, restore = false): Promise<Favorite> {
    return this.mutate((library) => {
      const item = library.items.find((i) => i.id === id);
      if (!item) throw new FavoriteError("Favorito no encontrado.", 404);
      item.deletedAt = restore ? null : new Date().toISOString();
      item.updatedAt = new Date().toISOString();
      return item;
    });
  }

  async remove(id: string): Promise<void> {
    return this.mutate((library) => {
      const index = library.items.findIndex((i) => i.id === id && i.deletedAt);
      if (index < 0) throw new FavoriteError("El elemento debe estar en Papelera.", 409);
      library.items.splice(index, 1);
    });
  }

  async addCategory(name: string): Promise<FavoriteCategory> {
    const clean = z.string().trim().min(1).max(80).parse(name);
    return this.mutate((library) => {
      if (library.categories.some((c) => c.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) throw new FavoriteError("La categoría ya existe.", 409);
      const category = { id: randomUUID(), name: clean };
      library.categories.push(category);
      return category;
    });
  }

  async renameCategory(id: string, name: string): Promise<FavoriteCategory> {
    const clean = z.string().trim().min(1).max(80).parse(name);
    return this.mutate((library) => {
      const category = library.categories.find((c) => c.id === id);
      if (!category) throw new FavoriteError("Categoría no encontrada.", 404);
      if (library.categories.some((c) => c.id !== id && c.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) throw new FavoriteError("La categoría ya existe.", 409);
      category.name = clean;
      return category;
    });
  }

  async deleteCategory(id: string): Promise<void> {
    return this.mutate((library) => {
      const index = library.categories.findIndex((c) => c.id === id);
      if (index < 0) throw new FavoriteError("Categoría no encontrada.", 404);
      library.categories.splice(index, 1);
      for (const item of library.items) item.categories = item.categories.filter((c) => c !== id);
    });
  }

  async bulk(ids: string[], action: "trash" | "restore" | "category" | "project" | "status", value?: string): Promise<number> {
    if (ids.length > 100) throw new FavoriteError("Selecciona 100 elementos como máximo.");
    return this.mutate((library) => {
      if (action === "category" && !library.categories.some((c) => c.id === value)) throw new FavoriteError("Categoría no encontrada.");
      let count = 0;
      for (const item of library.items) {
        if (!ids.includes(item.id)) continue;
        if (action === "trash") item.deletedAt = new Date().toISOString();
        if (action === "restore") item.deletedAt = null;
        if (action === "category" && value) item.categories = normaliseLabels([...item.categories, value]);
        if (action === "project" && value) item.projects = normaliseLabels([...item.projects, value]);
        if (action === "status" && value) {
          if (!(["pending", "reviewed", "approved"] as string[]).includes(value)) throw new FavoriteError("Estado no válido.");
          checkApproval({ ...item, status: value as FavoriteStatus });
          item.status = value as FavoriteStatus;
        }
        item.updatedAt = new Date().toISOString();
        count++;
      }
      return count;
    });
  }

  async recordChecks(checks: { id: string; state: LinkState; httpStatus: number | null }[]): Promise<void> {
    await this.mutate((library) => {
      for (const result of checks) {
        const item = library.items.find((i) => i.id === result.id);
        if (item) item.linkCheck = { state: result.state, at: new Date().toISOString(), httpStatus: result.httpStatus };
      }
    });
  }

  async importLibrary(raw: unknown): Promise<{ added: number; skipped: number }> {
    const imported = z.object({ schema: z.literal(1), items: z.array(z.unknown()).max(5000), categories: z.array(z.object({ id: z.string(), name: z.string() })).max(1000) }).parse(raw);
    return this.mutate((library) => {
      const categoryMap = new Map<string, string>();
      for (const category of imported.categories) {
        const name = z.string().trim().min(1).max(80).parse(category.name);
        let current = library.categories.find((c) => c.name.toLocaleLowerCase() === name.toLocaleLowerCase());
        if (!current) { current = { id: randomUUID(), name }; library.categories.push(current); }
        categoryMap.set(category.id, current.id);
      }
      let added = 0, skipped = 0;
      for (const candidate of imported.items) {
        const input = favoriteInput.parse(candidate);
        const metadata = z.object({
          createdAt: z.string().datetime().optional(),
          updatedAt: z.string().datetime().optional(),
          deletedAt: z.string().datetime().nullable().optional(),
          linkCheck: z.object({ state: z.enum(["unchecked", "working", "broken", "unknown"]), at: z.string().datetime().nullable(), httpStatus: z.number().int().nullable() }).optional(),
        }).parse(candidate);
        checkApproval(input);
        if (library.items.some((i) => input.assetId && i.assetId === input.assetId || canonicalUrl(i.url) === canonicalUrl(input.url))) { skipped++; continue; }
        if (library.items.length >= 5000) throw new FavoriteError("La biblioteca alcanzó el máximo de 5000 entradas.");
        const now = new Date().toISOString();
        library.items.push({ ...input, id: randomUUID(), categories: input.categories.map((id) => categoryMap.get(id)).filter((id): id is string => Boolean(id)), projects: normaliseLabels(input.projects), tags: normaliseLabels(input.tags), createdAt: metadata.createdAt ?? now, updatedAt: metadata.updatedAt ?? now, deletedAt: metadata.deletedAt ?? null, linkCheck: metadata.linkCheck ?? { state: "unchecked", at: null, httpStatus: null } });
        added++;
      }
      return { added, skipped };
    });
  }
}
