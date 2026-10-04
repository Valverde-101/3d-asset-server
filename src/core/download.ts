import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { basename, dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Zip, ZipPassThrough, unzipSync } from "fflate";
import type { AssetDetails, AssetFile, AssetType, HttpClient } from "./types.js";

export interface FileSelection {
  /** Desired resolution, e.g. "1k", "2k", "4k". Closest available is used. */
  resolution?: string;
  /** Desired format or package group, e.g. "glb", "gltf", "fbx", "blend", "hdr", "exr", "jpg", "png", "zip". */
  format?: string;
  /** For texture maps: only these map types (diffuse, normal, rough, ...). */
  mapTypes?: string[];
  /** Return every file (ignores the smart defaults). */
  all?: boolean;
}

/** What to fetch when the caller doesn't say: web/game-friendly formats first. */
const DEFAULT_FORMATS: Record<AssetType, string[]> = {
  model: ["glb", "gltf", "fbx", "obj", "blend", "zip", "usd"],
  hdri: ["hdr", "exr", "zip", "jpg"],
  material: ["jpg", "png", "zip", "gltf", "blend"],
  texture: ["jpg", "png", "zip", "exr"],
  sprite: ["zip", "png"],
  ui: ["zip", "png", "svg"],
  audio: ["zip", "ogg", "wav", "mp3"],
  font: ["zip", "ttf", "otf"],
  pack: ["zip"],
  other: ["zip"],
};
const DEFAULT_RESOLUTION = "2k";

function resolutionValue(res: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*k$/i.exec(res.trim());
  if (m) return Number(m[1]) * 1024;
  const px = /^(\d+)/.exec(res.trim());
  return px ? Number(px[1]) : Number.NaN;
}

function matchesFormat(f: AssetFile, fmt: string): boolean {
  const want = fmt.toLowerCase().replace(/^\./, "");
  const norm = want === "jpeg" ? "jpg" : want;
  return f.format === norm || f.group === norm;
}

/**
 * Pick the files to download for an asset.
 * Defaults: the first preferred format available for the asset type, at the
 * resolution closest to 2k. Texture maps (group "maps") come back as a set.
 */
export function selectFiles(asset: AssetDetails, sel: FileSelection = {}): AssetFile[] {
  let files = asset.files.filter((f) => !f.requiresAuth);
  if (sel.all || files.length <= 1) return files;

  if (sel.format) {
    files = files.filter((f) => matchesFormat(f, sel.format!));
  } else {
    for (const fmt of DEFAULT_FORMATS[asset.type] ?? ["zip"]) {
      const hit = files.filter((f) => matchesFormat(f, fmt));
      if (hit.length) {
        files = hit;
        break;
      }
    }
  }

  // Texture-map sets: prefer one map per type (e.g. OpenGL normal over DirectX).
  if (sel.mapTypes?.length) {
    const wanted = sel.mapTypes.map((m) => m.toLowerCase());
    files = files.filter((f) => !f.mapType || wanted.some((w) => f.mapType!.includes(w)));
  }

  const withRes = files.filter((f) => f.resolution && !Number.isNaN(resolutionValue(f.resolution)));
  if (withRes.length) {
    const target = resolutionValue(sel.resolution ?? DEFAULT_RESOLUTION);
    const available = [...new Set(withRes.map((f) => f.resolution!))];
    // Closest resolution; on ties prefer the smaller download.
    available.sort((a, b) => {
      const da = Math.abs(resolutionValue(a) - target);
      const db = Math.abs(resolutionValue(b) - target);
      return da - db || resolutionValue(a) - resolutionValue(b);
    });
    const chosen = available[0];
    files = files.filter((f) => !f.resolution || f.resolution === chosen);
  }

  // Several archives left (e.g. JPG and PNG zips at the same res): keep the first.
  const archives = files.filter((f) => f.format === "zip");
  if (!sel.format && archives.length > 1 && archives.length === files.length) files = archives.slice(0, 1);
  return files;
}

export function totalBytes(files: AssetFile[]): number | undefined {
  let sum = 0;
  for (const f of files) {
    if (f.sizeBytes === undefined) return undefined;
    sum += f.sizeBytes;
    for (const inc of f.includes ?? []) {
      if (inc.sizeBytes === undefined) return undefined;
      sum += inc.sizeBytes;
    }
  }
  return sum;
}

/** Flatten main files + companions into (relativePath, url) pairs. */
export function expandFiles(files: AssetFile[]): { path: string; url: string; sizeBytes?: number }[] {
  const out = new Map<string, { path: string; url: string; sizeBytes?: number }>();
  for (const f of files) {
    out.set(safeRelative(f.filename), { path: safeRelative(f.filename), url: f.url, sizeBytes: f.sizeBytes });
    for (const inc of f.includes ?? []) {
      const p = safeRelative(inc.path);
      out.set(p, { path: p, url: inc.url, sizeBytes: inc.sizeBytes });
    }
  }
  return [...out.values()];
}

/** Normalise a relative path and refuse anything that escapes its root. */
export function safeRelative(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter((s) => s && s !== ".");
  if (parts.some((s) => s === "..")) throw new Error(`Unsafe path in asset file list: ${p}`);
  const joined = parts.join("/");
  if (!joined) throw new Error(`Empty path in asset file list`);
  return joined;
}

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;

/** Refuse non-http(s) URLs and obvious internal targets (scraped pages are untrusted). */
export function assertPublicUrl(url: string): URL {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`Refusing non-HTTP URL: ${url}`);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (PRIVATE_HOST.test(host)) throw new Error(`Refusing internal host: ${host}`);
  if (isIP(host)) {
    const private4 = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;
    if (private4.test(host) || host === "::1" || /^f[cd]|^fe80/i.test(host)) {
      throw new Error(`Refusing private address: ${host}`);
    }
  }
  return u;
}

export interface DownloadOptions {
  /** Extract .zip archives into a folder next to them (and delete the zip). */
  extract?: boolean;
  /** Abort if the selection is known to exceed this many bytes. */
  maxBytes?: number;
  overwrite?: boolean;
}

export interface DownloadResult {
  directory: string;
  files: string[];
  bytes: number;
}

export const DEFAULT_MAX_DOWNLOAD_BYTES = Number(process.env.ASSET_SERVER_MAX_DOWNLOAD_BYTES ?? 2 * 1024 ** 3);

/**
 * Download files (and their companions) into `destDir`, preserving relative
 * paths so e.g. a .gltf finds its textures.
 */
export async function downloadFiles(
  http: HttpClient,
  files: AssetFile[],
  destDir: string,
  opts: DownloadOptions = {},
): Promise<DownloadResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;
  const known = totalBytes(files);
  if (known !== undefined && known > maxBytes) {
    throw new Error(`Selection is ${formatBytes(known)}, above the ${formatBytes(maxBytes)} limit. Pick a lower resolution.`);
  }
  const root = resolve(destDir);
  await mkdir(root, { recursive: true });
  const written: string[] = [];
  let bytes = 0;

  for (const item of expandFiles(files)) {
    assertPublicUrl(item.url);
    const target = resolve(root, item.path);
    if (target !== root && !target.startsWith(root + sep)) throw new Error(`Unsafe path: ${item.path}`);
    if (!opts.overwrite && (await exists(target))) {
      written.push(target);
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    const res = await http.raw(item.url, { headers: { accept: "*/*" } });
    if (!res.body) throw new Error(`Empty response for ${item.url}`);
    let received = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        received += chunk.byteLength;
        if (bytes + received > maxBytes) ctrl.error(new Error(`Download exceeded ${formatBytes(maxBytes)} limit`));
        else ctrl.enqueue(chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body.pipeThrough(counter) as never), createWriteStream(target));
    } catch (e) {
      await rm(target, { force: true });
      throw e;
    }
    bytes += received;

    if (opts.extract && item.path.toLowerCase().endsWith(".zip")) {
      const outDir = target.slice(0, -4);
      written.push(...(await extractZip(target, outDir)));
      await rm(target, { force: true });
    } else {
      written.push(target);
    }
  }
  return { directory: root, files: written, bytes };
}

async function extractZip(zipPath: string, outDir: string): Promise<string[]> {
  const data = new Uint8Array(await readFile(zipPath));
  const entries = unzipSync(data);
  const root = resolve(outDir);
  const out: string[] = [];
  for (const [name, content] of Object.entries(entries)) {
    if (name.endsWith("/") || name.startsWith("__MACOSX/")) continue;
    let rel: string;
    try {
      rel = safeRelative(name);
    } catch {
      continue; // skip zip-slip entries
    }
    const target = join(root, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
    out.push(target);
  }
  return out;
}

/**
 * Stream the selected files as a single zip (no recompression). Used by the
 * HTTP API so a browser gets one ready-to-use bundle.
 */
export function zipStream(http: HttpClient, files: AssetFile[], folder: string): ReadableStream<Uint8Array> {
  const items = expandFiles(files);
  const prefix = safeRelative(folder);
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const zip = new Zip((err, chunk, final) => {
        if (err) return controller.error(err);
        controller.enqueue(chunk);
        if (final) controller.close();
      });
      try {
        for (const item of items) {
          assertPublicUrl(item.url);
          const res = await http.raw(item.url, { headers: { accept: "*/*" } });
          const entry = new ZipPassThrough(`${prefix}/${item.path}`);
          zip.add(entry);
          const reader = res.body!.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            entry.push(value);
          }
          entry.push(new Uint8Array(0), true);
        }
        zip.end();
      } catch (e) {
        zip.terminate();
        controller.error(e);
      }
    },
  });
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** Folder name for an asset: `<provider>-<slug>`. */
export function assetFolderName(asset: { provider: string; nativeId: string }): string {
  const slug = basename(asset.nativeId.replace(/\\/g, "/")).replace(/[^\w.-]+/g, "_").slice(0, 80) || "asset";
  return `${asset.provider}-${slug}`;
}
