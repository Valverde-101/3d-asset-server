import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { BlockList, isIP } from "node:net";
import type { Hono } from "hono";
import { z } from "zod";
import { FavoriteError, FavoriteStore, type LinkState } from "../core/favorites.js";

const blocked = new BlockList();
for (const [base, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) blocked.addSubnet(base, bits, "ipv4");
for (const [base, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["::ffff:0:0", 96], ["2001:db8::", 32]] as const) blocked.addSubnet(base, bits, "ipv6");

function publicAddress(address: string): boolean {
  const family = isIP(address);
  return family !== 0 && !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** HEAD only; DNS is pinned for the actual connection and every redirect is checked again. */
export async function checkFavoriteLink(value: string): Promise<{ state: LinkState; httpStatus: number | null }> {
  try {
    let url = new URL(value);
    for (let redirects = 0; redirects < 4; redirects++) {
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || (url.port && url.port !== (url.protocol === "https:" ? "443" : "80"))) return { state: "unknown", httpStatus: null };
      const host = url.hostname.replace(/^\[|\]$/g, "");
      if (/^(localhost|.*\.(local|internal|localhost))$/i.test(host)) return { state: "unknown", httpStatus: null };
      const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await dnsLookup(host, { all: true });
      const target = addresses.find((entry) => publicAddress(entry.address));
      if (!target) return { state: "unknown", httpStatus: null };
      const response = await new Promise<{ status: number; location?: string }>((resolve, reject) => {
        const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
          method: "HEAD",
          timeout: 5000,
          headers: { "user-agent": "3d-asset-server-favorites/1.0" },
          lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
        }, (res) => {
          res.resume();
          resolve({ status: res.statusCode ?? 0, location: res.headers.location });
        });
        request.on("timeout", () => request.destroy(new Error("timeout")));
        request.on("error", reject);
        request.end();
      });
      if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
        url = new URL(response.location, url);
        continue;
      }
      if (response.status === 404 || response.status === 410) return { state: "broken", httpStatus: response.status };
      if (response.status >= 200 && response.status < 300) return { state: "working", httpStatus: response.status };
      return { state: "unknown", httpStatus: response.status || null };
    }
  } catch { /* blocked DNS, timeout, TLS, or offline: inconclusive */ }
  return { state: "unknown", httpStatus: null };
}

async function projects(repositoryDir?: string): Promise<{ id: string; name: string }[]> {
  if (!repositoryDir) return [];
  try {
    const result: { id: string; name: string }[] = [];
    for (const entry of await readdir(repositoryDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
      try {
        const git = await lstat(join(repositoryDir, entry.name, ".git"));
        if (git.isDirectory() && !git.isSymbolicLink()) result.push({ id: entry.name, name: entry.name });
      } catch { /* non-repository or worktree */ }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  } catch { return []; }
}

async function jsonBody(c: { req: { header(name: string): string | undefined; text(): Promise<string> } }, limit = 2_000_000): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(c.req.header("content-type") ?? "")) throw new FavoriteError("Envía JSON.");
  const content = await c.req.text();
  if (Buffer.byteLength(content, "utf8") > limit) throw new FavoriteError("El archivo es demasiado grande.");
  try { return JSON.parse(content) as unknown; } catch { throw new FavoriteError("JSON no válido."); }
}

export function registerFavoritesRoutes(app: Hono, directory: string, repositoryDir?: string): void {
  const store = new FavoriteStore(directory);
  app.use("/local/favorites", async (c, next) => {
    const url = new URL(c.req.url);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return c.json({ error: "Solo disponible en este equipo." }, 403);
    const origin = c.req.header("origin");
    if (origin && origin !== url.origin) return c.json({ error: "Origen no permitido." }, 403);
    const site = c.req.header("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return c.json({ error: "Origen no permitido." }, 403);
    c.header("cache-control", "no-store");
    await next();
  });
  app.use("/local/favorites/*", async (c, next) => {
    const url = new URL(c.req.url);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return c.json({ error: "Solo disponible en este equipo." }, 403);
    const origin = c.req.header("origin");
    if (origin && origin !== url.origin) return c.json({ error: "Origen no permitido." }, 403);
    const site = c.req.header("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return c.json({ error: "Origen no permitido." }, 403);
    c.header("cache-control", "no-store");
    await next();
  });
  app.get("/local/favorites", async (c) => c.json(await store.snapshot()));
  app.post("/local/favorites", async (c) => c.json(await store.add(await jsonBody(c)), 201));
  app.get("/local/favorites/projects", async (c) => c.json({ projects: await projects(repositoryDir) }));
  app.get("/local/favorites/export", async (c) => {
    const data = await store.snapshot();
    c.header("content-disposition", 'attachment; filename="androidbuild-favoritos.json"');
    return c.json(data);
  });
  app.post("/local/favorites/import", async (c) => c.json(await store.importLibrary(await jsonBody(c, 25_000_000))));
  app.post("/local/favorites/bulk", async (c) => {
    const data = z.object({ ids: z.array(z.string().uuid()).min(1).max(100), action: z.enum(["trash", "restore", "category", "project", "status"]), value: z.string().max(80).optional() }).parse(await jsonBody(c));
    return c.json({ count: await store.bulk(data.ids, data.action, data.value) });
  });
  app.post("/local/favorites/check", async (c) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1).max(20) }).parse(await jsonBody(c));
    const library = await store.snapshot();
    const targets = ids.map((id) => library.items.find((item) => item.id === id && !item.deletedAt)).filter((item) => item !== undefined);
    let cursor = 0;
    const checked: { id: string; state: LinkState; httpStatus: number | null }[] = [];
    await Promise.all(Array.from({ length: Math.min(3, targets.length) }, async () => {
      while (cursor < targets.length) {
        const item = targets[cursor++]!;
        checked.push({ id: item.id, ...await checkFavoriteLink(item.url) });
      }
    }));
    await store.recordChecks(checked);
    return c.json({ checked });
  });
  app.post("/local/favorites/categories", async (c) => {
    const { name } = z.object({ name: z.string() }).parse(await jsonBody(c));
    return c.json(await store.addCategory(name), 201);
  });
  app.patch("/local/favorites/categories/:id", async (c) => {
    const { name } = z.object({ name: z.string() }).parse(await jsonBody(c));
    return c.json(await store.renameCategory(c.req.param("id"), name));
  });
  app.delete("/local/favorites/categories/:id", async (c) => { await store.deleteCategory(c.req.param("id")); return c.json({ ok: true }); });
  app.patch("/local/favorites/:id", async (c) => c.json(await store.edit(c.req.param("id"), await jsonBody(c))));
  app.post("/local/favorites/:id/trash", async (c) => c.json(await store.trash(c.req.param("id"))));
  app.post("/local/favorites/:id/restore", async (c) => c.json(await store.trash(c.req.param("id"), true)));
  app.delete("/local/favorites/:id", async (c) => { await store.remove(c.req.param("id")); return c.json({ ok: true }); });
}
