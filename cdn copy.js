import { ensureFile } from "https://deno.land/std@0.145.0/fs/mod.ts";
import { typeByExtension } from "https://deno.land/std@0.145.0/media_types/mod.ts";
import { extname } from "https://deno.land/std@0.145.0/path/mod.ts";

export class CDN {
    constructor(options) {
        this.options = options;
    }
    async handle(request) {
        const p1 =  new URLPattern('http://*:*/');
        const match1 = p1.exec(request.url);
        if (match1) return await serveReadme();

        const p2 =  new URLPattern('http://*:*/:user');
        const match2 = p2.exec(request.url);
        if (match2) return await serveRepos(this, match2.pathname.groups.user);

        const cdnR = new CDNRequest(this, request);
        return await cdnR.serve();
    }
    async githubApi(path) {
        const {gitUser,gitToken} = this.options;
        const url = 'https://api.github.com/orgs/'+path;
        const headers = new Headers();
        headers.append('Authorization', 'Basic ' + btoa(gitUser + ":" + gitToken));
        return await fetch(url, {method:'GET', headers}).then(res => res.json());
    }
}


class CDNRequest {
    constructor(cdn, request) {

        let url = new URL(request.url);
        url.search = '';
        url = url.toString();

        const pattern = new URLPattern('http://*:*/:user?/:repo?:tag(@[^/]*)?/:file(.*)?');
        const match = pattern.exec(url);
        let {user,repo,tag,file} = match.pathname.groups;

        if (tag) tag = tag.substring(1); // remove the '@'
        if (!tag) tag = 'main';
        if (tag.match(/^[0-9]/)) tag = 'v' + tag; // prepend 'v' to version numbers

        this.pathname = `/${user}/${repo}/${tag}/${file}`;
        this.localFile = cdn.options.cachePath + this.pathname;

        this.tag = tag;
    }
    async serve(){
        try {
            const stat = await Deno.stat(this.localFile);
            if (stat.isDirectory) {
                return new Response('todo: server directory', { status: 404 });
            }
            console.log(stat.mtime)
            if (this.tag === 'main' && stat.mtime && (Date.now() - stat.mtime) > 2*60*1000) { // 2 minutes
                this.getRemote(); // get original in background if main
            }
            return this.serveFile();
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) {
                const done = await this.getRemote();
                if (done === true) return this.serveFile();
                else return done;
            } else {
                throw error; // unexpected error, maybe permissions, pass it along
            }
        }
    }
    async serveFile(){
        const extension = extname(this.localFile);
        const cType = typeByExtension(extension);
        const text = await Deno.readTextFile(this.localFile);
        const response = new Response(text, { status: 200 });

        // security
        // https://github.com/jsdelivr/jsdelivr/issues/18027#issuecomment-1170052883
        // todo: add csp headers and Feature-Policy-headers?
        response.headers.set('content-type', cType);
        response.headers.set('access-control-allow-origin', '*');
        response.headers.set('access-control-expose-headers', '*');
        //response.headers.set('cross-origin-resource-policy', 'cross-origin'); // needed?
        const immutable = this.tag.match(/^v[0-9]+\.[0-9]+\.[0-9]+/);
        immutable && response.headers.set('cache-control', 'immutable');

        return response;
    }
    async getRemote(){
        const url = 'https://raw.githubusercontent.com' + this.pathname;
        const response = await fetch(url);

        if (response.status === 200) {
            await ensureFile(this.localFile);
            let body;
            const contentLength = parseInt(response.headers.get("content-length"), 10);
            if (contentLength > 10 * 1024) { // 10 KB
                body = 'Error: Remote file size is greater than 10 KB';
            } else {
                body = await response.text();
            }
            await Deno.writeTextFile(this.localFile, body);
            return true;
        } else {
            return new Response('fail status: '+response.status+' ('+url+')', { status: response.status });
        }
    }
}

async function serveRepos(cdn, user) {
    const repos = await cdn.githubApi(user+'/repos?per_page=200');
    let html = htmlHead;
    html += '<h1> Organisation: '+user+'</h1>';
    html += '<ul>';
    for (const repo of repos) {
        html += '<li><a href="./'+user+'/'+repo.name+'">'+repo.name+'</a></li>';
    }
    html += '</ul>';
    return new Response(html, { status:200, headers: { 'Content-Type': 'text/html' } });
}

async function serveReadme(){
    // const md = await Deno.readTextFile(import.meta.url.substring(8) + '/../README.md');
    // const gfm = await import('https://deno.land/x/gfm@0.2.1/mod.ts');
    // const readme =
    //     htmlHead +
    //     `<style>${gfm.CSS} ${gfm.KATEX_CSS}</style>`+
    //     gfm.render(md);
    return new Response(readme, { status:200, headers: { 'Content-Type': 'text/html' } });
}

const htmlHead = `
<!DOCTYPE html>
<html lang=en>
    <head>
        <meta charset=utf-8>
        <meta name=viewport content=width=device-width>
        <title>CDN</title>
        <script type=module src="/u1ui/u1/auto.js"></script>
        <link rel=stylesheet href="/u1ui/classless.css/simple.css">
<body>
`;
