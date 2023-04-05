import { ensureFile } from "https://deno.land/std@0.145.0/fs/mod.ts";
import { typeByExtension } from "https://deno.land/std@0.145.0/media_types/mod.ts";
import { extname } from "https://deno.land/std@0.145.0/path/mod.ts";

export class CDN {
    constructor(options) {
        this.options = options;
    }
    async handle(request) {
        let url = new URL(request.url);
        if (url.pathname === '/favicon.ico') return new Response('not found', { status: 404 });
        url.search = '';
        url = url.toString();

        const pattern = new URLPattern('http://*:*/:user?/:repo?:tag(@[^/]*)?/:file(.*)?');
        const match = pattern.exec(url);
        const groups = match.pathname.groups;
        const {user,repo,_tag,file} = groups;

        let Klass = File;
        if (file === '') Klass = Repo;
        if (repo === '') Klass = User;
        if (user === '') Klass = Root;
        const cdnR = new Klass(this, groups, request);

        const response = await cdnR.serve();
        if (response) {
            response.headers.set('access-control-allow-origin', '*');
            response.headers.set('access-control-expose-headers', '*');
            // response.headers.set('cross-origin-resource-policy', 'cross-origin'); // needed?
            // https://github.com/jsdelivr/jsdelivr/issues/18027#issuecomment-1170052883 security
            // todo: add csp headers and Feature-Policy-headers?
            cdnR.maxAge === Infinity && response.headers.set('cache-control', 'immutable');
        }

        return response;
    }
    githubApi(path) {
        const {gitUser,gitToken} = this.options;
        const url = 'https://api.github.com/'+path;
        const headers = new Headers();
        headers.append('Authorization', 'Basic ' + btoa(gitUser + ":" + gitToken));
        return fetch(url, {method:'GET', headers});
    }
}

class CDNRequest {
    constructor(cdn, groups, request) {
        this.cdn = cdn;
        this.request = request;
        this.maxAge = 30*60*1000; // 30 minutes
    }
    async serve(){
        try {
            const stat = await Deno.stat(this.localFile);
            if (stat.isDirectory) throw new Error('is directory');
            const age = Date.now() - stat.mtime;
            if (age > this.maxAge/2) {
                this.sync(); // sync in background
            } else if (age > this.maxAge) {
                await this.sync(); // sync now
            }
            return this.response();
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) {
                await this.sync();
                return this.response();
            } else {
                throw error; // unexpected error, maybe permissions, pass it along
            }
        }
    }
    async sync(){
        const response = await this.fetch();

        if (response.status === 200) {
            await ensureFile(this.localFile);
            const body = await response.text();
            //const contentLength = parseInt(response.headers.get("content-length"), 10); if (contentLength > 20 * 1024) {}
            await Deno.writeTextFile(this.localFile, body);
        } else if (response.status === 404) {
            await this.notFound();
        } else {
            //const body = await response.text();
            throw new Error('fail status: '+response.status+' ('+response.url+')');
        }
    }
    response(){
        return fileToResponse(this.localFile);
    }
    get localFile(){
        return this.cdn.options.cachePath + this.pathname;
    }
}


class File extends CDNRequest {
    constructor(cdn, groups, request) {
        super(cdn, groups, request);

        let {user,repo,tag,file} = groups;
        if (tag) tag = tag.substring(1); // remove the '@'
        if (!tag) tag = 'main';
        if (tag.match(/^[0-9]/)) tag = 'v' + tag; // prepend 'v' to version numbers

        this.pathname = `/${user}/${repo}/${tag}/${file}`;

        if (tag === 'main') this.maxAge = 2*60*1000; // 2 minutes
        else this.maxAge = Infinity; // never expire

        this.tag = tag;
    }
    fetch(){
        return fetch('https://raw.githubusercontent.com' + this.pathname);
    }
    async notFound(){
        if (this.request.url.endsWith('min.js')) {
            const realFile = this.localFile.replace(/\.min\.js$/, '.js');
            const contents = await Deno.readTextFile(realFile);
            const terser = await import('https://cdn.skypack.dev/terser@v5.16.8');
            const result = await terser.minify(contents, {module: true, ecma: 2016});
            const minified = result.code;
            return await Deno.writeTextFile(this.localFile, minified);
        }
    }
}



class User extends CDNRequest {
    constructor(cdn, groups, request) {
        super(cdn, groups, request);
        this.user = groups.user;
        this.pathname = `/${this.user}/__index.json`;
    }
    fetch(){
        return this.cdn.githubApi(`orgs/${this.user}/repos?per_page=200`).then(response => {
            if (response.status === 404) {
                return this.cdn.githubApi(`users/${this.user}/repos?per_page=200`);
            } else {
                return response;
            }
        });
    }
    async response(){
        const url = new URL(this.request.url);

        if (url.searchParams.has('html')) {
            const text = await Deno.readTextFile(this.localFile);
            const obj = JSON.parse(text);
            let html = htmlHead;
            html +=
            `<h1> Organisation: ${this.user}</h1>
            <u1-table sortable>
            <table>
                <thead>
                    <tr>
                        <th>Repo
                        <th>Description
                        <th>Stars
                        <th>Last change
                <tbody>`;

            for (const repo of obj) {
                html += '<tr u1-href="./'+repo.name+'/?html">';
                html +=      '<td style="white-space:nowrap"><a href="./'+repo.name+'/?html">'+repo.name+'</a>';
                html +=      '<td><small>'+(repo.description??'')+'</small>';
                html +=      '<td>'+repo.stargazers_count;
                html +=      '<td data-sortby='+ new Date(repo.pushed_at).getTime() +' style="white-space:nowrap">'+
                                    '<u1-time datetime="'+repo.pushed_at+'" type=relative></u1-time>';

            }
            html += '</table>';
            html += '</u1-table>';
            return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
        } else {
            return await super.response();
        }
    }
}



class Repo extends CDNRequest {
    constructor(cdn, groups, request) {
        super(cdn, groups, request);
        this.user = groups.user;
        this.repo = groups.repo;
        this.pathname = `/${this.user}/${this.repo}/__index.json`;
    }
    fetch(){
        return this.cdn.githubApi(`repos/${this.user}/${this.repo}/releases?per_page=200`);
    }
    async response(){
        const url = new URL(this.request.url);

        if (url.searchParams.has('html')) {
            const text = await Deno.readTextFile(this.localFile);
            const obj = JSON.parse(text);
            let html = htmlHead;
            html +=
            `<h1> Repo: ${this.user}/${this.repo}</h1>
            <u1-table>
            <table>
                <thead>
                    <tr>
                        <th>Tag
                        <th>Published
                <tbody>`;

            for (const release of obj) {
                html += '<tr u1-href="./'+release.tag_name+'/?html">';
                html +=      '<td><a href="./'+release.tag_name+'/?html">'+release.tag_name+'</a>';
                html +=      '<td><u1-time datetime="'+release.published_at+'" type=relative>'+release.published_at+'</u1-time>';
            }
            html += '</table>';
            html += '</u1-table>';
            return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
        } else {
            return await super.response();
        }
    }
}

class Root extends CDNRequest {
    constructor(cdn, groups, request) {
        super(cdn, groups, request);
        this.pathname = '/__index.json';
    }
    fetch(){
        return this.cdn.githubApi('orgs/u1ui/repos?per_page=200');
    }
    async response(){
        let html =
        `<h1> Popular Origanisations</h1>
        <u1-table>
        <table>
            <tbody>`;
        for await (const dirEntry of Deno.readDir(this.cdn.options.cachePath)) {
            if (dirEntry.isDirectory) {
                const org = dirEntry.name;
                html += '<tr u1-href="./'+org+'/?html">';
                html +=      '<td><a href="./'+org+'/?html">'+org+'</a>';
            }
        }
        html += '</table>';
        html += '</u1-table>';
        const readme = htmlHead + html;
        return new Response(readme, { status:200, headers: { 'Content-Type': 'text/html' } });
    }
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
        <style>body { display:block; --width:60rem; }</style>
<body>
`;


async function fileToResponse(path){
    const extension = extname(path);
    const cType = typeByExtension(extension);
    const text = await Deno.readTextFile(path);
    const response = new Response(text, { status: 200 });
    response.headers.set('content-type', cType);
    return response;
}
