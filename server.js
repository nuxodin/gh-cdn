import { Hono } from "hono";
import { createCDN } from "./src/app.js";

const app = new Hono();
const cdn = createCDN({ cachePath: "./cache" });

app.route("/full", cdn.full); // Mount "full" CDN under /full/
app.route("/min", cdn.min); // Mount "min" CDN under /min/

const port = parseInt(Deno.env.get("PORT") || Deno.args[2]) || 8080;

console.log(`Server running on http://localhost:${port}`);
console.log(`- Full source: http://localhost:${port}/full/user/repo@tag/file.js`);
console.log(`- Min source:  http://localhost:${port}/min/user/repo@tag/file.js`);

Deno.serve({ port }, app.fetch);
