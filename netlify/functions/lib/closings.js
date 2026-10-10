/* School closings, late starts and early dismissals.
 *
 * South Dakota schools report these to KELOLAND, whose site has a plain
 * JSON list behind its closings page. The district has no alert-banner API,
 * so this list is Brandon Valley's "alert banners": each entry about the
 * district becomes { id, html, at } in the same shape the Sioux Falls relay
 * returns, and the app's shared.js alertKind() reads the wording
 * ("closed", "two hours late", "early dismissal") exactly as it does there.
 *
 * The list is empty on an ordinary day. Entries for the bank, the church
 * and the bowling alley that share the name are left out.
 */
const crypto = require("crypto");
const { UA } = require("./sources.js");

const DISTRICT = require("../../../data.js").DISTRICT;
const SOURCE = DISTRICT.closingsJson || "https://www.keloland.com/wp-json/nxd_app/v1/closings_alerts";
const LABEL = DISTRICT.name || "Brandon Valley School District";
// The district, not the bank, the church or the bowling alley.
const OURS = /brandon\s*valley(?:\s+(?:school|schools|public schools|school district|sd|dist\.?|csd))?\s*$|brandon\s*valley\s+(?:school|schools|public|district|elementary|intermediate|middle|high)/i;

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
const clean = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A timestamp inside the entry, if KELO gives one; ISO 8601 when readable.
function whenOf(item) {
  const cand = pick(item, ["updated", "updated_at", "modified", "date", "time", "timestamp", "created", "created_at", "post_date", "post_modified"]);
  const d = cand ? new Date(/^\d{10}$/.test(cand) ? +cand * 1000 : cand) : null;
  return d && !isNaN(d) ? d.toISOString() : null;
}

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
    const name = named || clean(all.find((s) => OURS.test(clean(s))) || LABEL);
    // Category words ("School", "Business") are not a status.
    const GENERIC = /^(school|schools|business|church|daycare|government|other|organization)$/i;
    const status = clean(pick(item, ["status", "closing_status", "closingStatus", "state", "message", "details", "description", "note", "notes", "text", "type"]).replace(GENERIC, ""));
    const rest = all.map(clean).filter((s) => s && s !== name && s !== status && !GENERIC.test(s) && !/^https?:\/\//.test(s) && !/^\d{4}-\d\d-\d\d/.test(s) && !/^\d{10}$/.test(s) && s.length < 140);
    // No status field: whatever else the entry says is the status.
    const text = status && status !== name ? `${name}: ${status}` : rest.length ? `${name}: ${rest.join(" · ")}` : `${name}: see KELOLAND closings`;
    out.push({ name, status, text, detail: status ? rest.slice(0, 3).join(" · ") : "", at: whenOf(item) });
  }
  return out;
}

// One entry as the app's alert banner. The id is a fingerprint of the words,
// so a change (late start becomes closed) is a new alert and a repeat is not.
function toBanner(entry, now = new Date()) {
  const what = entry.status || entry.text.replace(/^[^:]*:\s*/, "");
  const html = `<b>${esc(LABEL)}:</b> ${esc(what)}${entry.detail ? ` (${esc(entry.detail)})` : ""}`;
  const id = "kelo-" + crypto.createHash("sha256").update(`${LABEL}|${what}|${entry.detail}`).digest("hex").slice(0, 16);
  return { id, html, at: entry.at || now.toISOString() };
}

async function fetchOurs() {
  const r = await fetch(SOURCE, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`kelo ${r.status}`);
  const raw = await r.json();
  const ours = findOurs(raw);
  // Log the raw shape the first time something is there, so the readers
  // above can be tightened once a real entry has been seen.
  if (ours.length) console.log("closings raw:", JSON.stringify(Array.isArray(raw) ? raw.filter((i) => strings(i).some((s) => OURS.test(s))) : raw).slice(0, 1500));
  return ours;
}

// What the relay and the scheduled check both call: the live banners.
async function banners() {
  return (await fetchOurs()).map((e) => toBanner(e));
}

module.exports = { findOurs, fetchOurs, banners, toBanner, SOURCE, OURS };
