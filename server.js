import { Hono } from "hono";
import { createCDN } from "./src/app.js";

const app = new Hono();
const cdn = createCDN({ cachePath: "./cache" });

app.route("/full", cdn.full);
app.route("/min", cdn.min);

const port = parseInt(Deno.env.get("PORT")) || 8080;

/* Loopback by default: behind a reverse proxy — the usual way to run this — binding to
   every interface puts the CDN on the public internet unproxied, and then only a firewall
   stands between it and the outside. Set HOST=0.0.0.0 where that is wanted (a container,
   for instance, which reaches its port no other way). */
const hostname = Deno.env.get("HOST") || "127.0.0.1";

console.log(`Server running on http://${hostname}:${port}`);
console.log(`- Full source: http://${hostname}:${port}/full/user/repo@tag/file.js`);
console.log(`- Min source:  http://${hostname}:${port}/min/user/repo@tag/file.js`);

Deno.serve({ port, hostname }, app.fetch);
