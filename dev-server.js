/* Local preview: serves the static app and runs the Netlify functions in
 * process, so the preview uses the real relays against live data.
 *   node dev-server.js [siteDir] [port]
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(process.argv[2] || __dirname);
// Local secrets (VAPID key) from .env, which never goes to git.
try {
  for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}
// Saved source copies live next to the site (Netlify Blobs in production).
process.env.SFP_CACHE_DIR = process.env.SFP_CACHE_DIR || path.join(root, ".cache");
const port = Number(process.argv[3] || process.env.PORT || 8431);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  // netlify.toml rewrites /feed/* to the events function.
  const fn = /^\/feed\//.test(url.pathname) ? [null, "events"] : url.pathname.match(/^\/\.netlify\/functions\/([a-z-]+)$/);
  if (fn && fs.existsSync(path.join(root, "netlify/functions", `${fn[1]}.mjs`))) {
    // Scheduled functions: run on demand locally.
    for (const k of Object.keys(require.cache)) if (k.startsWith(root)) delete require.cache[k];
    try {
      const mod = await import(path.join(root, "netlify/functions", `${fn[1]}.mjs`) + `?t=${Date.now()}`);
      const out = await mod.default(new Request(`http://localhost:${port}${req.url}`));
      res.writeHead(out.status, Object.fromEntries(out.headers));
      return res.end(await out.text());
    } catch (err) { res.writeHead(500); return res.end(String(err)); }
  }
  if (fn) {
    try {
      const file = path.join(root, "netlify/functions", `${fn[1]}.js`);
      // Fresh code on every request (functions and their shared helpers).
      for (const k of Object.keys(require.cache)) if (k.startsWith(root)) delete require.cache[k];
      const body = await new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => ok(b)); });
      const handler = require(file).handler;
      // SFP_FAKE_ES=1: a stand-in translator (no API key needed), so a
      // Spanish walk-through shows any screen that still prints English.
      if (process.env.SFP_FAKE_ES) require(path.join(root, "netlify/functions/lib/translate.js"))._internals.useCaller(async (list) => list.map((s, i) => (/</.test(s) ? s.replace(/>([^<]*[A-Za-z]{2}[^<]*)</g, ">traducido<") : `traducido ${i}`)));
      const out = await handler({ httpMethod: req.method, body, headers: req.headers, path: url.pathname, rawUrl: url.href, queryStringParameters: Object.fromEntries(url.searchParams) });
      res.writeHead(out.statusCode, out.headers || {});
      return res.end(out.body);
    } catch (err) {
      res.writeHead(500); return res.end(String(err));
    }
  }
  let p = path.join(root, decodeURIComponent(url.pathname));
  if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (p.endsWith("/")) p += "index.html";
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
}).listen(port, () => console.log(`Serving ${root} on http://localhost:${port}`));
