import { ensureFile } from "https://deno.land/std@0.145.0/fs/mod.ts";
import { typeByExtension } from "https://deno.land/std@0.145.0/media_types/mod.ts";
import { extname } from "https://deno.land/std@0.145.0/path/mod.ts";



export class CDN {
    constructor(options) {
        this.options = options;
    }
    async handle(request) {
        const p1 =  new URLPattern('http://*:*/:user');
        const match1 = p1.exec(request.url);
        if (match1) {
            return await serveRepos(this, match1.pathname.groups.user);
        }

        const cdnR = new cdn_request(this, request);
        return await cdnR.serve();
    }
}



class cdn_request {
    constructor(cdn, request) {

        let url = new URL(request.url);
        url.search = '';
        url = url.toString();
        console.log(url)

        const pattern = new URLPattern('http://*:*/:user/:repo:tag(@[^/]*)?/:file(.*)');
        const match = pattern.exec(url);
        //if (!match) return new Response('not found (patter not match)', { status: 404 });
        let {user, repo, tag, file} = match.pathname.groups;
        // tag corrections
        if ( tag ) tag = tag.substring(1); // remove the '@'
        if ( !tag ) tag = 'main';
        if ( tag.match(/^[0-9]/) ) tag = 'v' + tag; // prepend 'v' to version numbers

        this.immutable = tag.match(/^v[0-9]+\.[0-9]+\.[0-9]+/);

        this.ghUrlPathname = `/${user}/${repo}/${tag}/${file}`;
        this.localFile = cdn.options.cachePath + this.ghUrlPathname;

        this.tag = tag;
    }
    async serve(){
        try {
            const stat = await Deno.stat(this.localFile);
            if (stat.isDirectory) {
                return new Response('todo: server directory', { status: 404 });
            } else {
				if (this.tag === 'main') this.getOriginal(); // get original in background if main
                return this.serveFile();
            }
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) {
                const done = await this.getOriginal();
                if (done) {
                    return this.serveFile();
                } else {
                    return new Response('fail status: '+ghResponse.status+' ('+ghFile+')', { status: ghResponse.status });
                }
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

        this.immutable && response.headers.set('cache-control', 'immutable');
        return response;
    }
    async getOriginal(){
        const ghFile = 'https://raw.githubusercontent.com' + this.ghUrlPathname;
        const ghResponse = await fetch(ghFile);
        if (ghResponse.status === 200) {
            const ghBody = await ghResponse.text();
            await ensureFile(this.localFile);
            await Deno.writeTextFile(this.localFile, ghBody);
            return true;
        } else {
            return new Response('fail status: '+ghResponse.status+' ('+ghFile+')', { status: ghResponse.status });
        }
    }
}


async function serveRepos(cdn, user) {
    const {gitUser,gitToken} = cdn.options;
    const url = 'https://api.github.com/orgs/'+user+'/repos?per_page=100';
    const headers = new Headers();
    headers.append('Authorization', 'Basic ' + btoa(gitUser + ":" + gitToken));
    let html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>'+user+' github repos</title><body>';

    const repos = await fetch(url, {method:'GET', headers}).then(res => res.json());

    html += '<h1> Organisation: '+user+'</h1>';
    html += '<ul>';
    for (const repo of repos) {
        html += '<li><a href="./'+user+'/'+repo.name+'">'+repo.name+'</a></li>';
    }
    html += '</ul>';



    return new Response(html, { status:200, headers: { 'Content-Type': 'text/html' } });
}


//const {dump} = await import('https://cdn.jsdelivr.net/gh/nuxodin/dump.js@1.2.1/mod.min.js');
//html += dump(Deno, {depth:3, order:0, inherited:true});
