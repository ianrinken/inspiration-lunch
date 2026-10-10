/* Small key-value stores (family codes, push subscriptions, reports, usage
 * counts). Netlify Blobs in production; a folder per store on disk for the
 * local preview, so the same code runs in both places. */
// The Claude key was saved in Netlify as SFSD_API_Key; the SDK and the
// readiness checks look for ANTHROPIC_API_KEY. Every function loads this file.
if (!process.env.ANTHROPIC_API_KEY && process.env.SFSD_API_Key) process.env.ANTHROPIC_API_KEY = process.env.SFSD_API_Key;

const fs = require("fs");
const os = require("os");
const path = require("path");

const onNetlify = () => !!process.env.NETLIFY_BLOBS_CONTEXT;

// Netlify's older-style (Lambda) functions only reach Blobs after this is
// called with the request's event; without it every function silently used
// its own temporary disk, and one function couldn't read another's data.
function connect(event) {
  if (event && event.blobs) {
    try { require("@netlify/blobs").connectLambda(event); } catch {}
  }
}

function fileStore(name) {
  const dir = path.join(process.env.SFP_CACHE_DIR || path.join(os.tmpdir(), "sfp-sources"), `store-${name}`);
  const file = (key) => path.join(dir, encodeURIComponent(key) + ".json");
  return {
    async get(key) { try { return JSON.parse(fs.readFileSync(file(key), "utf8")); } catch { return null; } },
    async set(key, value, { onlyIfNew = false } = {}) {
      fs.mkdirSync(dir, { recursive: true });
      if (onlyIfNew && fs.existsSync(file(key))) return false;
      fs.writeFileSync(file(key), JSON.stringify(value));
      return true;
    },
    async delete(key) { try { fs.unlinkSync(file(key)); } catch {} },
    async list(prefix = "") {
      try { return fs.readdirSync(dir).map((f) => decodeURIComponent(f.replace(/\.json$/, ""))).filter((k) => k.startsWith(prefix)); } catch { return []; }
    },
  };
}

function blobStore(name) {
  const { getStore } = require("@netlify/blobs");
  // Default (eventual) consistency: strong reads aren't available to
  // Lambda-style functions. Writes show up everywhere within about a minute;
  // onlyIfNew stays atomic, so two families can't get the same code.
  const s = getStore({ name });
  return {
    async get(key) { return (await s.get(key, { type: "json" })) || null; },
    async set(key, value, { onlyIfNew = false } = {}) {
      const r = await s.setJSON(key, value, onlyIfNew ? { onlyIfNew: true } : undefined);
      return !(r && r.modified === false);
    },
    async delete(key) { await s.delete(key); },
    async list(prefix = "") {
      const { blobs } = await s.list(prefix ? { prefix } : undefined);
      return blobs.map((b) => b.key);
    },
  };
}

const openStore = (name) => (onNetlify() ? blobStore(name) : fileStore(name));
module.exports = { openStore, connect };
