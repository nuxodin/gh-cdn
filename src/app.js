import { Hono } from "hono";
import { cors } from "hono/cors";
import { ensureFile } from "std/fs/mod.ts";
import { typeByExtension } from "std/media_types/mod.ts";
import { extname } from "std/path/mod.ts";
import { renderRepo, renderRoot, renderUser } from "./views.js";
import { tryCompress } from "./compress.js";

const githubApi = (() => {
  const gitUser = Deno.env.get("GITHUB_USER") || Deno.args[0];
  const gitToken = Deno.env.get("GITHUB_TOKEN") || Deno.args[1];
  const headers = new Headers();
  if (gitUser && gitToken) {
    headers.append("Authorization", "Basic " + btoa(gitUser + ":" + gitToken));
  }
  return (path) =>
    fetch("https://api.github.com/" + path, { method: "GET", headers });
})();

const htmlResponse = (html) =>
  new Response(html, { status: 200, headers: { "content-type": "text/html" } });
//const wantsHtml = (c) => new URL(c.req.url).searchParams.has("html");
const wantsHtml = (c) => c.req.query('html') !== undefined;
const readJson = async (path) => JSON.parse(await Deno.readTextFile(path));

class CDNRequest {
  constructor(c, options) {
    this.c = c;
    this.options = options;
    this.maxAge = 30 * 60 * 1000;
  }
  get localFile() {
    return this.options.cachePath + this.pathname;
  }
  async serve() {
    try {
      const stat = await Deno.stat(this.localFile);
      if (stat.isDirectory) throw new Error("is directory");
      const age = Date.now() - stat.mtime;
      if (age > this.maxAge) await this.sync();
      else if (age > this.maxAge / 2) {
        this.sync().catch((err) =>
          console.error(`Background sync failed for ${this.pathname}:`, err)
        );
      }
      return this.response(stat);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        await this.sync();
        const stat = await Deno.stat(this.localFile);
        return this.response(stat);
      }
      throw error;
    }
  }
  async sync() {
    const res = await this.fetch();
    if (res.status === 200) {
      await ensureFile(this.localFile);
      const text = await res.text();
      await Deno.writeTextFile(this.localFile, text);
    } else if (res.status === 404) {
      await this.notFound();
    } else {
      throw new Error(`fail status: ${res.status} (${res.url})`);
    }
  }
  async notFound() {
    throw new Error(`Resource not found: ${this.pathname}`);
  }
  async createEmptyJson() {
    await ensureFile(this.localFile);
    await Deno.writeTextFile(this.localFile, "[]");
  }
  response(stat) {
    return fileToResponse(this.localFile, stat, this.maxAge);
  }
}

class File extends CDNRequest {
  constructor(c, { user, repo, tag, file }, options) {
    super(c, options);
    this.user = user;
    this.repo = repo;
    this.tag = tag;
    tag = tag ? tag.slice(1) : "main";
    this.pathname = `/${user}/${repo}/${tag}/${file}`;
    this.maxAge = tag === "main" ? 2 * 60 * 1000 : Infinity;
    this.file = file; // Store original filename for minification check
  }
  fetch() {
    return fetch("https://raw.githubusercontent.com" + this.pathname);
  }
  
  async serveMin() {
    const minFile = this.localFile; // cache/min/...
    const rawFile = `${this.options.baseCachePath}/full${this.pathname}`;

    // Sicherstellen dass raw vorhanden
    try { await Deno.stat(rawFile); }
    catch {
      const rawReq = new File(this.c, { user: this.user, repo: this.repo, tag: this.tag, file: this.file }, {
        ...this.options,
        serve: "full",
        cachePath: `${this.options.baseCachePath}/full`,
      });
      await rawReq.sync();
    }

    // Komprimieren falls min noch nicht existiert
    try { await Deno.stat(minFile); }
    catch {
      try {
        await tryCompress(rawFile, minFile);
      } catch (error) {
        if (!error.message.includes("Unsupported type")) {
          console.log(`Failed to compress ${rawFile}:`, error);
        }
        // Kein min möglich → raw servieren
        const stat = await Deno.stat(rawFile);
        return fileToResponse(rawFile, stat, this.maxAge);
      }
    }

    const stat = await Deno.stat(minFile);
    return fileToResponse(minFile, stat, this.maxAge);
  }

  async serve() {
    if (this.options.serve === "min") {
      return this.serveMin();
    }
    return super.serve();
  }
}

class User extends CDNRequest {
  constructor(c, { user }, options) {
    super(c, options);
    this.user = user;
    this.pathname = `/${user}/__index.json`;
  }
  fetch() {
    return githubApi(`orgs/${this.user}/repos?per_page=200`).then((r) =>
      r.status === 404 ? githubApi(`users/${this.user}/repos?per_page=200`) : r
    );
  }
  notFound() {
    return this.createEmptyJson();
  }
  async response() {
    if (!wantsHtml(this.c)) return super.response();
    return htmlResponse(renderUser(this.user, await readJson(this.localFile)));
  }
}

class Repo extends CDNRequest {
  constructor(c, { user, repo }, options) {
    super(c, options);
    this.user = user;
    this.repo = repo;
    this.pathname = `/${user}/${repo}/__index.json`;
  }
  fetch() {
    return githubApi(`repos/${this.user}/${this.repo}/releases?per_page=200`);
  }
  notFound() {
    return this.createEmptyJson();
  }
  async response() {
    if (!wantsHtml(this.c)) return super.response();
    return htmlResponse(
      renderRepo(this.user, this.repo, await readJson(this.localFile)),
    );
  }
}

class Root extends CDNRequest {
  constructor(c, _, options) {
    super(c, options);
    this.pathname = "/__index.json";
  }
  fetch() {
    return Promise.resolve(new Response("[]", { status: 200 }));
  }
  notFound() {
    return this.createEmptyJson();
  }
  async response() {
    if (!wantsHtml(this.c)) {
      try {
        return new Response(
          await Deno.readTextFile(this.options.cachePath + "/../README.md"),
          { status: 200, headers: { "Content-Type": "text/plain" } },
        );
      } catch {
        return new Response(
          "# gh-cdn\nA CDN for github, something like jsdelivr\n\nAdd ?html for interactive view",
          { status: 200, headers: { "Content-Type": "text/plain" } },
        );
      }
    }
    const orgs = [];
    try {
      for await (const e of Deno.readDir(this.options.cachePath)) {
        if (e.isDirectory) orgs.push(e.name);
      }
    } catch { /* ignore if directory doesn't exist yet */ }
    return htmlResponse(renderRoot(orgs));
  }
}

async function fileToResponse(path, stat, maxAge) {
  const data = await Deno.readFile(path);
  const response = new Response(data, { status: 200 });
  const ext = extname(path);
  response.headers.set("content-type", typeByExtension(ext));

  if (stat) {
    const etag = `W/"${stat.size}-${stat.mtime.getTime()}"`;
    response.headers.set("etag", etag);
    response.headers.set("last-modified", stat.mtime.toUTCString());
  }

  if (maxAge === Infinity) {
    response.headers.set("cache-control", "public, max-age=31536000, immutable");
  } else if (maxAge) {
    response.headers.set("cache-control", `public, max-age=${Math.floor(maxAge / 1000)}`);
  }

  return response;
}

// Routing setup wrapped in a factory
export function createCDN(options = {}) {
  const baseCachePath = options.cachePath || "./cache";

  function createApp(serveMode) {
    const opts = {
      ...options,
      serve: serveMode,
      baseCachePath,
      cachePath: `${baseCachePath}/${serveMode}`,
    };
    const app = new Hono();

    app.use("*", cors());
    app.use("*", async (c, next) => {
      await next();
      c.res.headers.set("access-control-expose-headers", "*");
    });

    const immutable = (res, r) => {
      if (r.maxAge === Infinity) res.headers.set("cache-control", "immutable");
      return res;
    };
    const run = (Klass, groups) => async (c) => {
      const r = new Klass(c, groups ?? c.req.param(), opts);
      return immutable(await r.serve(), r);
    };

    app.get("/", run(Root));
    app.get("/:user", (c) => run(User)(c));
    app.get("/:user/:repo", (c) => run(Repo)(c));
    app.get("/:user/:repotag{[^/]+@[^/]*}/", (c) => run(Repo)(c));
    app.get("/:user/:repotag{[^/]+@[^/]+}/:file{.+}", (c) => {
      const { user, repotag, file } = c.req.param();
      const atIdx = repotag.lastIndexOf("@");
      return run(File, {
        user,
        repo: repotag.slice(0, atIdx),
        tag: repotag.slice(atIdx),
        file,
      })(c);
    });
    app.get("/:user/:repo/:file{.+}", (c) => {
      const { user, repo, file } = c.req.param();
      return run(File, { user, repo, tag: null, file })(c);
    });

    return app;
  }

  return {
    full: createApp("full"),
    min: createApp("min"),
  };
}
