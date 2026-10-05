/* School closings, late starts and early dismissals.
 *
 * South Dakota schools report these to KELOLAND, whose site has a plain
 * JSON list behind its closings page. We watch it every few minutes, keep
 * the Brandon Valley entries, and when one appears or changes, push it to
 * every phone that has notifications on and show it as a bar in the app.
 * Nothing is sent when a closing is cleared; the bar simply goes away.
 */

const { getStore } = require("@netlify/blobs");

const SOURCE = "https://www.keloland.com/wp-json/nxd_app/v1/closings_alerts";
// The district, not the bank, the church or the bowling alley.
const OURS = /brandon\s*valley(?:\s+(?:school|schools|public schools|school district|sd|dist\.?|csd))?\s*$|brandon\s*valley\s+(?:school|schools|public|district|elementary|intermediate|middle|high)/i;
const KEY = "closings";

const store = () => getStore({ name: "watch", consistency: "strong" });

// Every string inside an entry, however it is shaped.
function strings(v, out = []) {
  if (typeof v === "string") out.push(v.trim());
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out.filter(Boolean);
}

const pick = (item, keys) => {
  for (const k of keys) if (typeof item[k] === "string" && item[k].trim()) return item[k].trim();
  return "";
};
const clean = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// The Brandon Valley entries, read as "name: status (details)". The field
// names are whatever KELO uses; the readers below try the usual ones and
// fall back to every string in the entry, so a renamed field can't hide
// a snow day.
function findOurs(items) {
  const list = Array.isArray(items) ? items : items && typeof items === "object" ? Object.values(items).flat() : [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const all = strings(item);
    if (!all.some((s) => OURS.test(clean(s)))) continue;
    const named = clean(pick(item, ["name", "title", "organization", "org", "org_name", "school", "label"]));
    const name = named || clean(all.find((s) => OURS.test(clean(s))) || "Brandon Valley");
    // Category words ("School", "Business") are not a status.
    const GENERIC = /^(school|schools|business|church|daycare|government|other|organization)$/i;
    const status = clean(pick(item, ["status", "closing_status", "closingStatus", "state", "message", "details", "description", "note", "notes", "text", "type"]).replace(GENERIC, ""));
    const rest = all.map(clean).filter((s) => s && s !== name && s !== status && !GENERIC.test(s) && !/^https?:\/\//.test(s) && !/^\d{4}-\d\d-\d\d/.test(s) && s.length < 140);
    const text = status && status !== name ? `${name}: ${status}` : named ? `${name}: ${rest.join(" · ") || "see KELOLAND closings"}` : name;
    out.push({ name, status, text, detail: status ? rest.slice(0, 3).join(" · ") : "" });
  }
  return out;
}

async function fetchOurs() {
  const r = await fetch(SOURCE, { headers: { "User-Agent": "brandonvalleylunch.com closings watch", Accept: "application/json" } });
  if (!r.ok) throw new Error(`kelo ${r.status}`);
  const raw = await r.json();
  const ours = findOurs(raw);
  // Log the raw shape the first time something is there, so the readers
  // above can be tightened once a real entry has been seen.
  if (ours.length) console.log("closings raw:", JSON.stringify(Array.isArray(raw) ? raw.filter((i) => strings(i).some((s) => OURS.test(s))) : raw).slice(0, 1500));
  return ours;
}

const hashOf = (ours) => ours.map((o) => o.text + "|" + o.detail).sort().join("\n");

// What the app shows: the current entries, or none.
async function current() {
  return (await store().get(KEY, { type: "json" })) || { active: [], hash: "", since: null, checked: null };
}

// One check: fetch, compare with last time, remember. Returns the entries
// that are new or changed (to be announced) and the full current list.
async function check() {
  const ours = await fetchOurs();
  const prev = await current();
  const hash = hashOf(ours);
  const changed = hash !== prev.hash;
  const seen = new Set((prev.active || []).map((o) => o.text + "|" + o.detail));
  const fresh = ours.filter((o) => !seen.has(o.text + "|" + o.detail));
  await store().setJSON(KEY, {
    active: ours, hash, checked: Date.now(),
    since: ours.length ? (changed || !prev.since ? Date.now() : prev.since) : null,
  });
  return { fresh, active: ours, changed };
}

// Tell every phone with notifications on. One push per device per change.
async function announce(entries, sendFn) {
  if (!entries.length) return 0;
  const push = getStore({ name: "push", consistency: "strong" });
  const { blobs } = await push.list();
  const body = entries.map((e) => e.text + (e.detail ? ` (${e.detail})` : "")).join("\n");
  let sent = 0;
  for (const { key } of blobs) {
    const record = await push.get(key, { type: "json" });
    if (!record || !record.sub) continue;
    try {
      await sendFn(record, { title: "Brandon Valley Schools", body, url: "/", tag: "closing" });
      sent++;
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) await push.delete(key);
      else console.error("closing push:", err && err.message);
    }
  }
  return sent;
}

module.exports = { findOurs, fetchOurs, check, current, announce, SOURCE };
