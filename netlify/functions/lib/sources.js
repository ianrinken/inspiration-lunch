/* Last-good copies of every upstream source.
 *
 * Bound sits behind a firewall that sometimes answers with a bot challenge
 * (HTTP 202, empty body) instead of the calendar. A challenge must never
 * reach a parent as "no events", so every source is validated, and the
 * last copy that passed validation is kept. Readers get the saved copy
 * while it is fresh, a live fetch when it isn't, and the saved copy again
 * (marked stale) if the live fetch fails.
 *
 * Storage: Netlify Blobs in production; a folder on disk anywhere else
 * (local preview, tests), so the same code runs in both.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

function blobStore() {
  if (!process.env.NETLIFY_BLOBS_CONTEXT) return null;
  try {
    const { getStore } = require("@netlify/blobs");
    return getStore({ name: "sources" });
  } catch {
    return null;
  }
}

const dir = process.env.SFP_CACHE_DIR || path.join(os.tmpdir(), "sfp-sources");
const fileKey = (key) => path.join(dir, key.replace(/[^a-z0-9._-]/gi, "_") + ".json");

async function load(key) {
  const blobs = blobStore();
  if (blobs) return (await blobs.get(key, { type: "json" })) || null;
  try { return JSON.parse(fs.readFileSync(fileKey(key), "utf8")); } catch { return null; }
}
async function save(key, record) {
  const blobs = blobStore();
  if (blobs) return blobs.setJSON(key, record);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fileKey(key), JSON.stringify(record));
}

async function fetchLive(url, accept) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: accept || "*/*" } });
  if (res.headers.get("x-amzn-waf-action")) throw new Error("firewall challenge");
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/**
 * key: storage key; url: source; valid(text) -> bool; maxAgeMs: how long a
 * saved copy counts as fresh; force: skip the saved copy (the scheduled sync).
 * Returns { body, at, stale, changed }.
 */
async function getSource(key, url, { valid, maxAgeMs = 30 * 60 * 1000, force = false, accept } = {}) {
  const saved = await load(key);
  if (!force && saved && Date.now() - saved.at < maxAgeMs) return { body: saved.body, at: saved.at, stale: false };
  try {
    const body = await fetchLive(url, accept);
    if (valid && !valid(body)) throw new Error("failed validation");
    const hash = crypto.createHash("sha256").update(body).digest("hex");
    // First sighting is not a change; only a different fingerprint is.
    const changed = !!(saved && saved.hash && saved.hash !== hash);
    await save(key, { at: Date.now(), hash, body, changedAt: changed ? Date.now() : (saved && saved.changedAt) || null });
    return { body, at: Date.now(), stale: false, changed };
  } catch (err) {
    if (saved) return { body: saved.body, at: saved.at, stale: true, error: String(err.message || err) };
    throw err;
  }
}

async function getMeta(key) {
  const saved = await load(key);
  return saved ? { at: saved.at, changedAt: saved.changedAt || null, hash: saved.hash } : null;
}

module.exports = { getSource, getMeta, load, save, UA };
