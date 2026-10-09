import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/api/app.js";
import { checkFavoriteLink } from "../src/api/favorites.js";
import { FavoriteStore } from "../src/core/favorites.js";
import { AssetService } from "../src/core/service.js";
import { fakeProvider } from "./fakes.js";

const dirs: string[] = [];
async function sandbox() { const dir = await mkdtemp(join(tmpdir(), "androidbuild-favorites-")); dirs.push(dir); return dir; }
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const link = (title: string) => ({ source: "link", url: `https://example.com/${title}`, title, type: "link" });

describe("local favorites library", () => {
  it("persists across store instances, deduplicates links, and keeps a daily backup", async () => {
    const dir = await sandbox();
    const store = new FavoriteStore(dir);
    const [first, second] = await Promise.all([store.add(link("one")), store.add(link("two"))]);
    expect(first.alreadyExists).toBe(false);
    expect(second.alreadyExists).toBe(false);
    expect((await store.add(link("one"))).alreadyExists).toBe(true);
    expect((await new FavoriteStore(dir).snapshot()).items).toHaveLength(2);
    expect(JSON.parse(await readFile(join(dir, "backups", `${new Date().toISOString().slice(0, 10)}.json`), "utf8"))).toHaveProperty("schema", 1);
  });

  it("requires reviewed licence for approval and keeps trash recoverable", async () => {
    const store = new FavoriteStore(await sandbox());
    const { item } = await store.add({ source: "asset", assetId: "fake:crate", url: "https://example.com/crate", title: "Crate", type: "model", licenseName: "CC0" });
    await expect(store.edit(item.id, { status: "approved" })).rejects.toThrow(/licencia/);
    const approved = await store.edit(item.id, { status: "approved", licenseReviewed: true, expectedUpdatedAt: item.updatedAt });
    expect(approved.status).toBe("approved");
    await expect(store.edit(item.id, { status: "pending", expectedUpdatedAt: "old" })).rejects.toMatchObject({ status: 409 });
    await store.trash(item.id);
    expect((await store.snapshot()).items[0]?.deletedAt).not.toBeNull();
    await store.trash(item.id, true);
    expect((await store.snapshot()).items[0]?.deletedAt).toBeNull();
  });

  it("retains favorites when categories are renamed/deleted and restores an export", async () => {
    const dir = await sandbox();
    const store = new FavoriteStore(dir);
    const category = await store.addCategory("Personajes");
    const { item } = await store.add({ ...link("knight"), categories: [category.id], projects: ["Godot-Army-Attack"], tags: ["medieval"] });
    await store.renameCategory(category.id, "Ejército");
    const exported = await store.snapshot();
    const other = new FavoriteStore(await sandbox());
    expect((await other.importLibrary(exported)).added).toBe(1);
    expect((await other.snapshot()).categories[0]?.name).toBe("Ejército");
    await store.deleteCategory(category.id);
    expect((await store.snapshot()).items.find((i) => i.id === item.id)?.categories).toEqual([]);
  });

  it("limits write routes to same origin and lists only physical repositories", async () => {
    const root = await sandbox();
    const repos = join(root, "Repositories");
    await mkdir(join(repos, "Game", ".git"), { recursive: true });
    await mkdir(join(repos, "Worktree"), { recursive: true });
    await writeFile(join(repos, "Worktree", ".git"), "gitdir: elsewhere");
    const app = createApp(new AssetService({ providers: [fakeProvider] }), { favoritesDir: join(root, "favorites"), repositoriesDir: repos });
    const url = "http://127.0.0.1/local/favorites";
    const denied = await app.request(url, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify(link("bad")) });
    expect(denied.status).toBe(403);
    const wrongType = await app.request(url, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(link("bad")) });
    expect(wrongType.status).toBe(400);
    const saved = await app.request(url, { method: "POST", headers: { origin: "http://127.0.0.1", "content-type": "application/json" }, body: JSON.stringify(link("good")) });
    expect(saved.status).toBe(201);
    expect((await (await app.request(`${url}/projects`)).json() as { projects: { id: string }[] }).projects.map((p) => p.id)).toEqual(["Game"]);
    expect((await (await app.request(url)).json() as { items: unknown[] }).items).toHaveLength(1);
    expect((await app.request("http://other.example/local/favorites")).status).toBe(403);
  });

  it("does not probe local or private addresses", async () => {
    expect((await checkFavoriteLink("http://127.0.0.1:8787/")).state).toBe("unknown");
    expect((await checkFavoriteLink("http://localhost/")).state).toBe("unknown");
  });
});
