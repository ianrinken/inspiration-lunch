/* "Report a mistake" and privacy-safe usage counts.
 *
 * POST { action: "report", message, context }  a parent flags something wrong
 * POST { action: "ping", schools, installed }  once per phone per day; adds
 *      to that day's totals. No id, no name, nothing that identifies a phone.
 * POST { action: "miss", q }  a search that found nothing (no phone id;
 *      numbers and emails removed), so the district sees what parents
 *      look for and can't find.
 * POST { action: "pin", text, es, until }  with x-admin-key: a district
 *      announcement shown at the top of every screen (empty text removes it).
 * POST { action: "answer", q, a, link, qEs, aEs }  with x-admin-key: an
 *      answer search shows for a question parents ask (from the list of
 *      searches that found nothing). { action: "answer", id, remove: true } deletes.
 * GET  ?days=30  with header x-admin-key: ADMIN_KEY   reports and totals
 */
const crypto = require("crypto");
const { openStore } = require("./lib/store.js");
const { overLimit, tooMany } = require("./lib/limit.js");

const SCHOOLS = new Set(Object.keys(require("../../data.js").SCHOOLS));
const json = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });
const centralDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const clip = (v, n) => String(v || "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, n);

function isAdmin(event) {
  const key = process.env.ADMIN_KEY;
  const given = (event.headers || {})["x-admin-key"] || "";
  return !!key && given.length === key.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
}
// What a parent typed, minus anything personal: phone numbers, ids, emails.
const cleanQuery = (q) => clip(q, 80).toLowerCase().replace(/\S+@\S+/g, "").replace(/\d{4,}/g, "").replace(/[^\p{L}\p{N}\s'&-]/gu, " ").replace(/\s+/g, " ").trim();

exports.handler = async (event) => {
  require("./lib/store.js").connect(event);
  if (event.httpMethod === "GET") {
    if (!isAdmin(event)) return json(401, { error: "unauthorized" });
    // ?backup=1: the latest nightly backup (family codes and notification sign-ups).
    if ((event.queryStringParameters || {}).backup === "1") {
      const b = openStore("backups");
      const latest = (await b.list()).sort().pop();
      if (!latest) return json(404, { error: "no backup yet" });
      return { statusCode: 200, headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="sfp-backup-${latest}.json"`, "Cache-Control": "no-store" }, body: JSON.stringify(await b.get(latest)) };
    }
    const days = Math.min(120, Number((event.queryStringParameters || {}).days) || 30);
    const reportsStore = openStore("reports"), usageStore = openStore("usage");
    const keys = (await reportsStore.list()).sort().reverse().slice(0, 200);
    const reports = (await Promise.all(keys.map((k) => reportsStore.get(k)))).filter(Boolean);
    const usage = [];
    const misses = {};
    const missStore = openStore("misses");
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - i * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
      const [u, m] = await Promise.all([usageStore.get(d), missStore.get(d)]);
      if (u) usage.push({ day: d, ...u });
      for (const [q, n] of Object.entries(m || {})) misses[q] = (misses[q] || 0) + n;
    }
    const topMisses = Object.entries(misses).sort((a, b) => b[1] - a[1]).slice(0, 50).map(([q, n]) => ({ q, n }));
    const settings = openStore("settings");
    const [pin, answers, drift, overrides] = await Promise.all([settings.get("pin"), settings.get("answers"), require("./lib/sources.js").load("drift"), openStore("overrides").get("events").catch(() => null)]);
    return json(200, { reports, usage, misses: topMisses, pin, answers: answers || [], drift: drift ? JSON.parse(drift.body) : null, overrides: Array.isArray(overrides) ? overrides : [] });
  }
  if (event.httpMethod && event.httpMethod !== "POST") return json(405, { error: "method" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "bad json" }); }
  try {
    if (body.action === "report") {
      if (await overLimit(event, "report", 30, 60)) return tooMany();
      const message = clip(body.message, 1000);
      if (message.length < 3) return json(400, { error: "empty" });
      const c = body.context || {};
      const rec = {
        at: Date.now(), message,
        context: { type: clip(c.type, 20), title: clip(c.title, 200), school: SCHOOLS.has(c.school) ? c.school : "", date: clip(c.date, 10), id: clip(c.id, 40) },
      };
      await openStore("reports").set(`${Date.now()}-${crypto.randomBytes(3).toString("hex")}`, rec);
      return json(200, { ok: true });
    }
    if (body.action === "ping") {
      if (await overLimit(event, "ping", 300, 24 * 60)) return json(200, { ok: true });
      const store = openStore("usage");
      const day = centralDay();
      const u = (await store.get(day)) || { phones: 0, installed: 0, bySchool: {} };
      u.phones++;
      if (body.installed) u.installed++;
      for (const s of (Array.isArray(body.schools) ? body.schools : []).slice(0, 8)) if (SCHOOLS.has(s)) u.bySchool[s] = (u.bySchool[s] || 0) + 1;
      await store.set(day, u);
      return json(200, { ok: true });
    }
    if (body.action === "miss") {
      if (await overLimit(event, "miss", 200, 60)) return json(200, { ok: true });
      const q = cleanQuery(body.q);
      if (q.length < 3) return json(200, { ok: true });
      const store = openStore("misses");
      const day = centralDay();
      const m = (await store.get(day)) || {};
      if (!(q in m) && Object.keys(m).length >= 500) return json(200, { ok: true });
      m[q] = (m[q] || 0) + 1;
      await store.set(day, m);
      return json(200, { ok: true });
    }
    if (body.action === "answer") {
      if (!isAdmin(event)) return json(401, { error: "unauthorized" });
      const settings = openStore("settings");
      let list = (await settings.get("answers")) || [];
      if (body.remove) list = list.filter((x) => x.id !== body.id);
      else {
        const q = clip(body.q, 120), a = clip(body.a, 800);
        if (q.length < 3 || a.length < 3) return json(400, { error: "question and answer are both needed" });
        const link = /^https:\/\/[^\s"<>]+$/.test(body.link || "") ? clip(body.link, 300) : "";
        const rec = { id: body.id || crypto.randomBytes(4).toString("hex"), q, a, link, qEs: clip(body.qEs, 120), aEs: clip(body.aEs, 800), at: Date.now() };
        list = list.filter((x) => x.id !== rec.id).concat(rec).slice(-200);
      }
      await settings.set("answers", list);
      return json(200, { ok: true, answers: list });
    }
    // Owner corrections to events: hide, retitle, re-target by grade, by
    // event id. events.js applies them before anything is served (feeds and
    // mirrored calendars included).
    if (body.action === "overrides") {
      if (!isAdmin(event)) return json(401, { error: "unauthorized" });
      const list = (Array.isArray(body.list) ? body.list : []).map((o) => o && typeof o.id === "string" && /^[a-z0-9]{1,12}$/.test(o.id)
        ? { id: o.id, ...(o.date && /^\d{4}-\d\d-\d\d$/.test(o.date) ? { date: o.date } : {}), ...(o.hide ? { hide: true } : {}),
            ...(o.title ? { title: clip(o.title, 120) } : {}), ...(Array.isArray(o.grades) ? { grades: o.grades.map(Number).filter((g) => Number.isInteger(g) && g >= -1 && g <= 12) } : {}),
            ...(o.why ? { why: clip(o.why, 160) } : {}) }
        : null).filter(Boolean).slice(0, 500);
      await openStore("overrides").set("events", list);
      return json(200, { ok: true, overrides: list });
    }
    if (body.action === "pin") {
      if (!isAdmin(event)) return json(401, { error: "unauthorized" });
      const text = clip(body.text, 400);
      const settings = openStore("settings");
      if (!text) { await settings.delete("pin"); return json(200, { ok: true, pin: null }); }
      const until = /^\d{4}-\d{2}-\d{2}$/.test(body.until || "") ? body.until : "";
      const pin = { id: crypto.randomBytes(4).toString("hex"), text, es: clip(body.es, 400), until, at: Date.now() };
      await settings.set("pin", pin);
      return json(200, { ok: true, pin });
    }
    return json(400, { error: "unknown action" });
  } catch (err) {
    console.error("report:", err && err.message);
    return json(502, { error: "unavailable" });
  }
};
