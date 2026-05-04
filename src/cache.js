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
    await ensureFile(fullPath);
    await Deno.writeTextFile(fullPath, await res.text());
  }

  try {
    const stat = await Deno.stat(fullPath);
    if (stat.isDirectory) throw new Error("is directory");
    const age = Date.now() - stat.mtime;
    if (age > resource.maxAge) await sync();
    else if (age > resource.maxAge / 2) sync().catch(console.error);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
    await sync();
  }

  if (!resource.meta && opts.serve === "min") {
    try {
      await Deno.stat(minPath);
    }
    catch {
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

