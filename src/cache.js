import { ensureFile } from "@std/fs/ensure-file";
import { extname } from "@std/path/extname";
import { tryCompress } from "./compress.js";
import { typeByExtension } from "@std/media-types";

// --- Utilities ---

const writeEmptyJson = async (path) => { await ensureFile(path); await Deno.writeTextFile(path, "[]"); };

async function fileResponse(path, maxAge) {
  const [data, stat] = await Promise.all([Deno.readFile(path), Deno.stat(path)]);
  return new Response(data, { headers: {
    "content-type": typeByExtension(extname(path)),
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

  async function sync() {
    let res;
    try { res = await resource.fetch(); }
    catch (e) { throw new Error(`Upstream unreachable: ${e.message}`); }
    if (res.status === 404) return resource.onNotFound?.(fullPath) ?? writeEmptyJson(fullPath);
    if (res.status !== 200) throw new Error(`Fetch failed: ${res.status} (${res.url})`);
    // The body first, then one atomic move: a reader sees the old file or the whole new one, never
    // the empty one `ensureFile` used to leave behind while the download was still running. An
    // immutable tag is cached forever, so a file written half is a file wrong forever.
    const body = await res.text();
    const part = `${fullPath}.${Math.random().toString(36).slice(2)}.part`;
    await ensureFile(part);
    await Deno.writeTextFile(part, body);
    await Deno.rename(part, fullPath);
  }

  try {
    const stat = await Deno.stat(fullPath);
    if (stat.isDirectory) throw new Error("is directory");
    const age = Date.now() - stat.mtime;
    // An immutable tag is never fetched again, so a torso would be wrong forever. The tree states
    // the size; where it does not, only emptiness gives the write away.
    if (resource.size === undefined ? !stat.size : stat.size !== resource.size) await sync();
    else if (age > resource.maxAge) await sync();
    else if (age > resource.maxAge / 2) sync().catch(console.error);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
    await sync();
  }

  if (!resource.meta && opts.serve === "min") {
    const [source, min] = await Promise.all([Deno.stat(fullPath), Deno.stat(minPath).catch(() => null)]);
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

