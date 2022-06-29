
import { serve } from "https://deno.land/std@0.145.0/http/server.ts";
import { CDN } from "./cdn.js";

const __dirname = new URL('.', import.meta.url).pathname.replace(/^\//, '');
const cachePath = __dirname + 'cache';

const cdn = new CDN({
    cachePath,
    gitUser: Deno.args[0],
    gitToken: Deno.args[1],
});


await serve(request=>cdn.handle(request), {port:8081});
