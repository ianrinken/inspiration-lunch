/* Last-good copies of every upstream source.
 *
 * Bound, the schools' Google Calendars and the district site all have bad
 * minutes: a timeout, a 5xx, or Bound's firewall answering a bot challenge
 * instead of the feed. Without this, a bad minute reaches a parent as an
 * empty calendar. With it, the last copy that looked right is served
 * instead, and the failure is only a line in the log.
 *
 * Works in both kinds of Netlify function: v2 (ESM) functions get Blobs
 * automatically; v1 (exports.handler) functions must call connectLambda
 * first, which events.js and school.js do. With no Blobs at all (local
 * runs) it degrades to a plain fetch with an in-memory memo.
 */

const { getStore } = require("@netlify/blobs");

const TIMEOUT_MS = 9000;
const MEMO_MS = 60 * 1000;       // one copy per source per minute per instance
const memo = new Map();          // url -> { body, at }

const key = (url) => url.replace(/[^a-z0-9]+/gi, "_").slice(0, 180);

function store() {
  try { return getStore({ name: "sources" }); } catch { return null; }
}

// Does this look like the real thing? An ICS must carry a calendar; HTML
// and JSON must not be a firewall interstitial; nothing may be empty.
function looksRight(url, body, res) {
  if (!body || body.length < 40) return false;
  if (res && res.headers.get("x-amzn-waf-action")) return false;
  if (/\.ics\b|\/ical\b/i.test(url) || /text\/calendar/i.test(res ? res.headers.get("content-type") || "" : "")) {
    return /BEGIN:VCALENDAR/.test(body);
  }
  if (/<title>\s*(just a moment|attention required|access denied)/i.test(body)) return false;
  return true;
}

async function live(url, headers) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    const body = await res.text();
    if (!res.ok || !looksRight(url, body, res)) throw new Error(`upstream ${res.status}${res.headers.get("x-amzn-waf-action") ? " (bot challenge)" : ""}`);
    return body;
  } finally { clearTimeout(t); }
}

// The source's text: live when it's good, the saved copy when it isn't.
async function fetchText(url, headers = {}) {
  const m = memo.get(url);
  if (m && Date.now() - m.at < MEMO_MS) return m.body;
  const s = store();
  try {
    const body = await live(url, headers);
    memo.set(url, { body, at: Date.now() });
    if (s) s.set(key(url), body, { metadata: { at: Date.now(), url } }).catch(() => {});
    return body;
  } catch (err) {
    let saved = null;
    if (s) { try { saved = await s.getWithMetadata(key(url)); } catch { saved = null; } }
    if (saved && saved.data) {
      const age = Math.round((Date.now() - ((saved.metadata && saved.metadata.at) || 0)) / 60000);
      console.warn(`sources: ${url} failed (${err.message}); serving copy from ${age} min ago`);
      memo.set(url, { body: saved.data, at: Date.now() });
      return saved.data;
    }
    throw err;
  }
}

module.exports = { fetchText, looksRight };
