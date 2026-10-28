import { mkdir, readFile, rename, stat as fileStat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getMimeType, mimes as honoMimes } from "hono/utils/mime";
import { tryCompress } from "./compress.js";

// --- Utilities ---

/** Written whole or not at all: a reader sees the old file or the new one, never a half-written one. */
export async function writeAtomic(path, data) {
  const part = `${path}.${Math.random().toString(36).slice(2)}.part`;
  await mkdir(dirname(part), { recursive: true });
  await writeFile(part, data);
  await rename(part, path);
}

const writeEmptyJson = (path) => writeAtomic(path, "[]");

// Hono's table lacks text formats common in repositories.
const yaml = "text/yaml; charset=utf-8";
const mimes = { ...honoMimes, md: "text/markdown; charset=utf-8", yaml, yml: yaml };

async function fileResponse(path, maxAge) {
  const [data, stat] = await Promise.all([readFile(path), fileStat(path)]);
  return new Response(data, { headers: {
    "content-type": getMimeType(path, mimes) ?? "application/octet-stream",
    "etag": `W/"${stat.size}-${stat.mtime.getTime()}"`,
    "last-modified": stat.mtime.toUTCString(),
    "cache-control": maxAge === Infinity ? "public, max-age=31536000, immutable"
      : maxAge ? `public, max-age=${Math.floor(maxAge / 1000)}` : "no-cache",
  }});
}

// --- Cache logic ---

export async function cached(resource, opts, c) {
  const fullPath = opts.cachePath + (resource.meta ? "/meta" : "/full") + resource.pathname;
  const minPath  = opts.cachePath + "/min" + resource.pathname;
  // The pathname comes from the url: a `..` in any encoding would reach other entries or leave the cache.
  if (resource.pathname.split("/").some((s) => s === ".." || s === ".")) throw new Error("Bad path");

  async function sync() {
    let res;
    try { res = await resource.fetch(); }
    catch (e) { throw new Error(`Upstream unreachable: ${e.message}`); }
    if (res.status === 404) return resource.onNotFound?.(fullPath) ?? writeEmptyJson(fullPath);
    if (res.status !== 200) throw new Error(`Fetch failed: ${res.status} (${res.url})`);
    // The body first, then one atomic move: an immutable tag is cached forever, so a file written
    // half is a file wrong forever. Bytes: text() would break images and fonts.
    await writeAtomic(fullPath, new Uint8Array(await res.arrayBuffer()));
  }

  try {
    const stat = await fileStat(fullPath);
    if (stat.isDirectory()) throw new Error("is directory");
    const age = Date.now() - stat.mtime;
    // An immutable tag is never fetched again, so a torso would be wrong forever. The tree states
    // the size; where it does not, only emptiness gives the write away.
    if (resource.size === undefined ? !stat.size : stat.size !== resource.size) await sync();
    else if (age > resource.maxAge) await sync();
    else if (age > resource.maxAge / 2) sync().catch(console.error);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    await sync();
  }

  if (!resource.meta && opts.serve === "min") {
    const [source, min] = await Promise.all([fileStat(fullPath), fileStat(minPath).catch(() => null)]);
    // Compress again when there is nothing usable: no file, an empty one a failed write left behind,
    // or one older than the source it came from. Minifying costs cpu here and nothing upstream.
    if (!min?.size || min.mtime < source.mtime) {
      try {
        await tryCompress(fullPath, minPath);
      }
      catch (e) {
        if (!e.message.includes("Unsupported type")) console.error("Compress failed:", e);
        return resource.respond?.(fullPath) ?? fileResponse(fullPath, resource.maxAge);
      }
    }
    return resource.respond?.(minPath) ?? fileResponse(minPath, resource.maxAge);
  }

  return resource.respond?.(fullPath) ?? fileResponse(fullPath, resource.maxAge);
}

