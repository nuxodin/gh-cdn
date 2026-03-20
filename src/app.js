import { Hono } from "hono";
import { cors } from "hono/cors";

import { renderDir } from "./views.js";
import { cached } from "./cache.js";
import * as gh from "./github.js";


const html = (body) => new Response(body, { headers: { "content-type": "text/html" } });
const wantsHtml = (c) => c.req.query("html") !== undefined;
const readJson = (path) => Deno.readTextFile(path).then(JSON.parse);


export async function listDir(pathname, opts, c) {
  const [, user, repo, tag, ...subpath] = pathname.split("/");
  const prefix = subpath.join("/");

  const treeResource = gh.tree({ user, repo, tag });
  await cached(treeResource, opts, c);
  const { tree } = await readJson(opts.cachePath + "/meta" + treeResource.pathname);

  const children = new Set();
  for (const entry of tree) {
    if (prefix && !entry.path.startsWith(prefix + "/")) continue;
    const rest = prefix ? entry.path.slice(prefix.length + 1) : entry.path;
    if (!rest) continue;
    const name = rest.split("/")[0];
    const isDir = entry.type === "tree" || rest.includes("/");
    children.add(name + (isDir ? "/" : ""));
  }

  const entries = [...children].sort();

  if (wantsHtml(c)) return html(renderDir(pathname, entries));
  return new Response(JSON.stringify(entries), { headers: { "content-type": "application/json" } });
}

export async function serveFileOrDir({ user, repo, tag, file }, opts, c) {
  const treeResource = gh.tree({ user, repo, tag });
  await cached(treeResource, opts, c);
  const { tree } = await readJson(opts.cachePath + "/meta" + treeResource.pathname);

  const normalizedFile = file.replace(/\/$/, "")
  const entry = tree.find(e => e.path === normalizedFile);
  if (!entry || entry.type === "tree") return listDir(`/${user}/${repo}/${tag}/${normalizedFile}`, opts, c);
  return cached(gh.file({ user, repo, tag, file: normalizedFile }), opts, c);
}




export function createCDN(options = {}) {
  const opts = { ...options, cachePath: options.cachePath || "./cache" };

  function createApp(serve) {
    const appOpts = { ...opts, serve };

    const run = (fn, params) => async (c) => {
      try {
        const resource = fn(params ?? c.req.param(), appOpts, c);
        const res = await cached(resource, appOpts, c);
        if (resource.maxAge === Infinity) res.headers.set("cache-control", "immutable");
        return res;
      } catch (e) {
        console.error(e.message);
        return c.text(e.message, 502);
      }
    };

    const wrap = (fn) => async (c) => {
      try { return await fn(c); }
      catch (e) { console.error(e.message); return c.text(e.message, 502); }
    };


    const app = new Hono();

    app.use("*", cors());
    app.use("*", async (c, next) => {
      await next(); c.res.headers.set("access-control-expose-headers", "*");
    });


    app.get("/", (c) => run(gh.root)(c));
    app.get("/:user/", (c) => run(gh.user)(c));

    app.get("/:user/:repotag/", wrap((c) => {
      const { user, repo, tag } = extractPathParams(c);
      if (!tag) return run(gh.repo, { user, repo })(c);
      return listDir(`/${user}/${repo}/${tag}`, appOpts, c);
    }));
    
    app.get("/:user/:repotag/:file{.+}", wrap((c) => {
      const { user, repo, tag, file } = extractPathParams(c);
      if (!tag) return cached(gh.file({ user, repo, tag: null, file }), appOpts, c);
      return serveFileOrDir({ user, repo, tag, file }, appOpts, c);
    }));

    return app;
  }

  return { full: createApp("full"), min: createApp("min") };
}


const extractPathParams = (c) => {
  const { user, repotag, file } = c.req.param();
  const at = repotag?.lastIndexOf("@") ?? -1;
  return at === -1
    ? { user, repo: repotag, tag: null, file }
    : { user, repo: repotag.slice(0, at), tag: repotag.slice(at + 1), file };
};
