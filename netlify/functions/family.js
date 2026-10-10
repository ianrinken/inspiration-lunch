/* Family codes: keeps every phone in a family (two households, a
 * grandparent) and every calendar subscription on the same students and
 * teams. No account.
 *
 * Stored per student: school, graduating class, followed teams. Never a
 * name, lunch line or allergy; those stay on each phone.
 *
 * POST { action: "create", kids }        -> { code }
 * POST { action: "load", code }          -> { kids, updatedAt }
 * POST { action: "save", code, kids }    -> { ok, updatedAt }
 */
const { openStore } = require("./lib/store.js");
const { overLimit, tooMany } = require("./lib/limit.js");

const DATA = require("../../data.js");
const SCHOOLS = new Set(Object.keys(DATA.SCHOOLS));
const BY_LINQ = Object.fromEntries(Object.values(DATA.SCHOOLS).map((s) => [s.linq, s.id]));
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
// New codes are 8 characters from ALPHABET. Codes families picked in the
// app before October 2026 (6 to 12 letters and digits) keep working.
const CODE = /^[A-Z0-9]{6,12}$/;

// A record saved by the earlier app: students by LINQ building id, grade
// and activity names. Read it as the template's shape, once.
function normalizeRecord(rec) {
  if (!rec || !Array.isArray(rec.kids)) return rec;
  const legacy = rec.kids.some((k) => k && Number.isInteger(k.grade) && !Number.isInteger(k.classOf));
  if (!legacy) return rec;
  const savedAt = rec.savedAt || rec.updatedAt || Date.now();
  const ymd = new Date(savedAt).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const [y, m] = ymd.split("-").map(Number);
  const yearEnd = m >= 7 ? y + 1 : y;
  const kids = rec.kids.map((k, i) => {
    const school = BY_LINQ[k.school] || (SCHOOLS.has(k.school) ? k.school : null);
    if (!school || !Number.isInteger(k.grade)) return null;
    return { id: String(k.id || `m${i}${Math.random().toString(36).slice(2, 7)}`).replace(/[^a-z0-9]/gi, "").slice(0, 16), school,
      // The old app saved the school year the grade belonged to (its start
      // year); the save date is the fallback.
      classOf: (Number.isInteger(k.year) ? k.year + 1 : yearEnd) + (12 - k.grade), follows: (k.acts || []).map((a) => ({ act: String(a).slice(0, 60), level: "" })) };
  }).filter(Boolean);
  return { ...rec, kids, updatedAt: rec.updatedAt || savedAt, createdAt: rec.createdAt || savedAt, migrated: true };
}

const json = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });

function cleanKids(list) {
  return (Array.isArray(list) ? list : []).slice(0, 8).map((k) => {
    if (!k || !SCHOOLS.has(k.school) || !Number.isInteger(k.classOf) || k.classOf < 2020 || k.classOf > 2045) return null;
    const id = String(k.id || "").replace(/[^a-z0-9]/gi, "").slice(0, 16);
    if (!id) return null;
    const follows = (Array.isArray(k.follows) ? k.follows : []).slice(0, 40)
      .map((f) => ({ act: String((f && f.act) || "").slice(0, 60), level: String((f && f.level) || "").slice(0, 40) }))
      .filter((f) => f.act);
    return { id, school: k.school, classOf: k.classOf, follows };
  }).filter(Boolean);
}

function newCode() {
  const bytes = require("crypto").randomBytes(8);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

async function loadFamily(code) {
  if (!CODE.test(code)) return null;
  return normalizeRecord(await openStore("family").get(code));
}

exports.handler = async (event) => {
  require("./lib/store.js").connect(event);
  if (event.httpMethod && event.httpMethod !== "POST") return json(405, { error: "POST only" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "bad json" }); }
  const store = openStore("family");
  try {
    if (body.action === "create") {
      if (await overLimit(event, "family-create", 200, 60)) return tooMany();
      const kids = cleanKids(body.kids);
      if (!kids.length) return json(400, { error: "no students" });
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const rec = { kids, updatedAt: Date.now(), createdAt: Date.now() };
        if (await store.set(code, rec, { onlyIfNew: true })) return json(200, { code, updatedAt: rec.updatedAt });
      }
      return json(503, { error: "try again" });
    }
    const code = String(body.code || "").toUpperCase();
    if (!CODE.test(code)) return json(400, { error: "bad code" });
    const rec = normalizeRecord(await store.get(code));
    if (!rec) return json(404, { error: "not found" });
    if (body.action === "load") {
      if (await overLimit(event, "family-load", 2000, 60)) return tooMany();
      // Note when a code was last used (at most daily) so long-unused codes
      // can be deleted; a record read from the earlier app is written back
      // in today's shape.
      if (rec.migrated || !rec.lastSeen || Date.now() - rec.lastSeen > 864e5) await store.set(code, { ...rec, migrated: undefined, lastSeen: Date.now() }).catch(() => {});
      return json(200, { kids: rec.kids, updatedAt: rec.updatedAt });
    }
    if (body.action === "save") {
      if (await overLimit(event, "family-save", 1000, 60)) return tooMany();
      const kids = cleanKids(body.kids);
      const next = { ...rec, kids, updatedAt: Date.now(), lastSeen: Date.now() };
      await store.set(code, next);
      return json(200, { ok: true, updatedAt: next.updatedAt });
    }
    return json(400, { error: "unknown action" });
  } catch (err) {
    console.error("family:", err && (err.stack || err.message));
    return json(502, { error: "unavailable" });
  }
};

exports.loadFamily = loadFamily;
exports._internals = { cleanKids, newCode, CODE, normalizeRecord };
