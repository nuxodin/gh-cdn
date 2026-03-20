import { renderRepo, renderRoot, renderUser } from "./views.js";


const USER = Deno.env.get("GITHUB_USER");
const TOKEN = Deno.env.get("GITHUB_TOKEN");
const headers = new Headers();
if (USER && TOKEN) headers.set("Authorization", "Basic " + btoa(USER + ":" + TOKEN));

const get = (path) => fetch("https://api.github.com/" + path, { headers });

// bad: also in app.js
const wantsHtml = (c) => c.req.query("html") !== undefined;
const html = (body) => new Response(body, { headers: { "content-type": "text/html" } });
const readJson = (path) => Deno.readTextFile(path).then(JSON.parse);


export function file({ user, repo, tag, file }) {
    const pathname = `/${user}/${repo}/${tag ?? "main"}/${file}`;
    return {
        pathname,
        maxAge: tag ? Infinity : 2 * 60 * 1000,
        fetch: () => fetch("https://raw.githubusercontent.com" + pathname),
    };
}

export function tree({ user, repo, tag }) {
    return {
        pathname: `/${user}/${repo}/${tag}/tree.json`,
        meta: true,
        maxAge: tag === "main" ? 2 * 60 * 1000 : Infinity,
        fetch: () => get(`repos/${user}/${repo}/git/trees/${tag}?recursive=1`),
        onNotFound: () => { throw new Error(`Tree not found: ${user}/${repo}@${tag}`); },
    };
}

export function user({ user }, opts, c) {
    return {
        pathname: `/${user}/index.json`,
        meta: true,
        maxAge: 30 * 60 * 1000,
        fetch: () => get(`orgs/${user}/repos?per_page=200`)
            .then(r => r.status === 404 ? get(`users/${user}/repos?per_page=200`) : r),
        respond: wantsHtml(c)
            ? async (path) => html(renderUser(user, await readJson(path)))
            : undefined,
    };
}

export function repo({ user, repo }, opts, c) {
    return {
        pathname: `/${user}/${repo}/index.json`,
        meta: true,
        maxAge: 30 * 60 * 1000,
        fetch: () => get(`repos/${user}/${repo}/releases?per_page=200`),
        respond: wantsHtml(c)
            ? async (path) => html(renderRepo(user, repo, await readJson(path)))
            : undefined,
    };
}

export function root(_, opts, c) {
    return {
        pathname: "/index.json",
        meta: true,
        maxAge: 30 * 60 * 1000,
        fetch: () => Promise.resolve(new Response("[]")),
        respond: async () => {
            if (!wantsHtml(c)) {
                try { return new Response(await Deno.readTextFile(opts.cachePath + "/../README.md"), { headers: { "content-type": "text/plain" } }); }
                catch { return new Response("# gh-cdn\nA CDN for GitHub\n\nAdd ?html for interactive view", { headers: { "content-type": "text/plain" } }); }
            }
            const orgs = [];
            try { for await (const e of Deno.readDir(opts.cachePath + "/full")) if (e.isDirectory) orgs.push(e.name); } catch { }
            return html(renderRoot(orgs));
        },
    };
}