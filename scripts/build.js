/* Copies only the files the public site needs into dist/. Everything else
 * in the project (the .env with private keys, tests, dev server, notes) is
 * never published. Netlify runs this before each deploy. */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "dist");
const FILES = [
  "index.html", "admin.html", "admin.js", "privacy.html", "style.css", "app.js", "data.js", "shared.js", "handbooks.js", "i18n.js", "handbooks-es.js",
  "sw.js", "manifest.webmanifest", "favicon.ico", "apple-touch-icon.png", "apple-touch-icon-precomposed.png",
  "robots.txt", "_headers",
];
const DIRS = ["icons"];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const f of FILES) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
for (const d of DIRS) fs.cpSync(path.join(ROOT, d), path.join(OUT, d), { recursive: true });
// Safety net: refuse to publish anything that looks like a secret.
for (const f of fs.readdirSync(OUT, { recursive: true })) {
  if (/(^|\/)\.env|\.pem$|\.key$/.test(String(f))) throw new Error(`refusing to publish ${f}`);
}
console.log(`dist/: ${FILES.length} files + ${DIRS.join(", ")}`);
