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
const SPONSOR_TABS = ["today", "lunch", "calendar", "guide", "school"];
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
    const [pin, answers, drift, overrides, sponsor, donate] = await Promise.all([settings.get("pin"), settings.get("answers"), require("./lib/sources.js").load("drift"), openStore("overrides").get("events").catch(() => null), settings.get("sponsors").catch(() => null), settings.get("donate").catch(() => null)]);
    const leadStore = openStore("leads");
    const leadKeys = (await leadStore.list().catch(() => [])).sort().reverse().slice(0, 100);
    const leads = (await Promise.all(leadKeys.map(async (k) => { const l = await leadStore.get(k); return l ? { key: k, ...l } : null; }))).filter(Boolean);
    return json(200, { reports, usage, misses: topMisses, pin, answers: answers || [], drift: drift ? JSON.parse(drift.body) : null, overrides: Array.isArray(overrides) ? overrides : [], sponsors: sponsor || {}, donate: donate || null, leads });
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
      // A first look at a school with no student yet is a look, not a set-up phone.
      if (body.preview === true) { u.previews = (u.previews || 0) + 1; await store.set(day, u); return json(200, { ok: true }); }
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
    // A local business asking about sponsoring: kept for the owner, emailed
    // when owner email is set up. No parent data is involved.
    if (body.action === "sponsor-lead") {
      if (await overLimit(event, "lead", 5, 60)) return tooMany();
      if (body.website) return json(200, { ok: true }); // a field people never see; only scripts fill it
      const lead = { business: clip(body.business, 80), name: clip(body.name, 60), contact: clip(body.contact, 120), note: clip(body.note, 500), screen: SPONSOR_TABS.includes(body.screen) ? body.screen : "", at: Date.now() };
      if (!lead.business || !(/@/.test(lead.contact) || (lead.contact.match(/\d/g) || []).length >= 7)) return json(400, { error: "A business name and an email or phone number are needed." });
      const store = openStore("leads");
      if ((await store.list().catch(() => [])).length >= 200) return json(200, { ok: true });
      await store.set(`${String(lead.at).padStart(14, "0")}-${crypto.randomBytes(3).toString("hex")}`, lead);
      await require("./lib/mail.js").sendOwnerEmail(`Sponsor inquiry: ${lead.business}`, `${lead.business}\n${lead.name}\n${lead.contact}\nScreen: ${lead.screen || "any"}\n\n${lead.note}`).catch(() => {});
      return json(200, { ok: true });
    }
    // A tap on the sponsor's link: a number per day, nothing about who.
    if (body.action === "sponsor-click") {
      if (await overLimit(event, "sponsor-click", 30, 60)) return json(200, { ok: true });
      const store = openStore("usage");
      const day = centralDay();
      const u = (await store.get(day)) || { phones: 0, installed: 0, bySchool: {} };
      const tab = SPONSOR_TABS.includes(body.tab) ? body.tab : "today";
      if (typeof u.sponsorClicks !== "object" || !u.sponsorClicks) u.sponsorClicks = {};
      u.sponsorClicks[tab] = (u.sponsorClicks[tab] || 0) + 1;
      await store.set(day, u);
      return json(200, { ok: true });
    }
    if (body.action === "lead-done") {
      if (!isAdmin(event)) return json(401, { error: "unauthorized" });
      if (/^\d{14}-[a-f0-9]{6}$/.test(body.key || "")) await openStore("leads").delete(body.key);
      return json(200, { ok: true });
    }
    // One sponsor per screen (Today, Lunch, Calendar, Guide, School), in the
    // app and on the school pages.
    if (body.action === "sponsor") {
      if (!isAdmin(event)) return json(401, { error: "unauthorized" });
      if (!SPONSOR_TABS.includes(body.tab)) return json(400, { error: "Pick a screen." });
      const settings = openStore("settings");
      const all = (await settings.get("sponsors").catch(() => null)) || {};
      const name = clip(body.name, 60);
      if (!name) { delete all[body.tab]; await settings.set("sponsors", all); return json(200, { ok: true, sponsors: all }); }
      const url = clip(body.url, 300), logo = clip(body.logo, 300);
      if (!/^https:\/\/[^\s]+$/.test(url)) return json(400, { error: "The link must start with https://" });
      if (logo && !/^https:\/\/[^\s]+$/.test(logo)) return json(400, { error: "The logo address must start with https://" });
      const sponsor = { id: crypto.randomBytes(4).toString("hex"), name, line: clip(body.line, 90), url, logo, until: /^\d{4}-\d{2}-\d{2}$/.test(body.until || "") ? body.until : "", at: Date.now() };
      all[body.tab] = sponsor;
      await settings.set("sponsors", all);
      return json(200, { ok: true, sponsors: all });
    }
    // Where "Chip in" sends people: a payment link the owner made.
    if (body.action === "donate") {
      if (!isAdmin(event)) return json(401, { error: "unauthorized" });
      const settings = openStore("settings");
      // QuickBooks payment links charge a fixed amount, so there is one
      // link per amount: up to three, each with the label on its button.
      // Monthly and one-time giving: up to three amounts each, every amount
      // with its own payment link.
      const clean = (list) => (Array.isArray(list) ? list : []).slice(0, 3)
        .map((l) => ({ amount: Math.round(Number(l && l.amount) * 100) / 100, url: clip(l && l.url, 300) }))
        .filter((l) => l.url && Number.isFinite(l.amount) && l.amount >= 1 && l.amount <= 1000);
      const monthly = clean(body.monthly), once = clean(body.once);
      if ([...monthly, ...once].some((l) => !/^https:\/\/[^\s]+$/.test(l.url))) return json(400, { error: "Each link must start with https://" });
      // What the page promises about the money: the card fee, the share kept
      // to run the app, who gets the rest, and how much has been passed on.
      const num = (v, lo, hi) => { const n = Number(v); return String(v ?? "").trim() !== "" && Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
      const fee = num(body.fee, 0, 30), procPct = num(body.procPct, 0, 10), procFixed = num(body.procFixed, 0, 2);
      const sent = Number(body.sent), goal = Number(body.goal), raised = Number(body.raised);
      const give = {
        monthly, once,
        fee: fee === null ? null : Math.round(fee * 10) / 10,
        procPct: procPct === null ? 2.99 : procPct,
        procFixed: procFixed === null ? 0 : procFixed,
        recipient: clip(body.recipient, 160),
        sent: Number.isFinite(sent) && sent >= 0 ? Math.round(sent * 100) / 100 : 0,
        sentAsOf: /^\d{4}-\d{2}-\d{2}$/.test(body.sentAsOf || "") ? body.sentAsOf : "",
        goal: Number.isFinite(goal) && goal > 0 ? Math.round(goal) : 0,
        // Raised is what parents have given; sent is what has already been
        // handed to the district. They are different facts on the page.
        raised: Number.isFinite(raised) && raised >= 0 ? Math.round(raised * 100) / 100 : 0,
        checkDate: /^\d{4}-\d{2}-\d{2}$/.test(body.checkDate || "") ? body.checkDate : "",
        at: Date.now(),
      };
      const any = monthly.length + once.length;
      if (!any && !give.recipient && give.fee === null) { await settings.delete("donate"); return json(200, { ok: true, donate: null }); }
      await settings.set("donate", give);
      return json(200, { ok: true, donate: give, showing: !!(any && give.recipient && give.fee !== null) });
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
