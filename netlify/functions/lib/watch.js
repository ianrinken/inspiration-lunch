/* Everything the app is built from, checked on a schedule.
 * Live feeds (the district's Bound calendar and each school's Google
 * Calendar) are refreshed; documents the app reads (the district calendar,
 * the handbooks, the supply lists) are fingerprinted so a new version is
 * noticed the day the district posts it. Brandon Valley has eight
 * buildings, so every one is refreshed every run. */
const { getSource, getMeta, load, save } = require("./sources.js");

const DATA = require("../../../data.js");
const SCHOOL_LIST = Object.values(DATA.SCHOOLS);
const ALL = SCHOOL_LIST.map((s) => s.id);
// Kept for callers that still read it: every school, every run.
const BOUND = Object.fromEntries(SCHOOL_LIST.map((s) => [s.id, DATA.DISTRICT.bound]));
function schoolsThisRun() { return ALL.slice(); }

const DOCS = [
  { key: "doc-district-calendar", label: "District calendar", school: null, url: DATA.DISTRICT.calendarPdf },
  ...Object.entries(DATA.DISTRICT.handbooks).map(([which, url]) => ({ key: `doc-handbook-${which}`, label: `${which[0].toUpperCase()}${which.slice(1)} handbook`, school: null, which, url })),
  ...SCHOOL_LIST.filter((s) => s.supplies).map((s) => ({ key: `doc-supplies-${s.id}`, label: `${s.short} supply list`, school: s.id, supplies: true, url: s.supplies })),
];
const isCalendar = (t) => t.includes("BEGIN:VCALENDAR");
const isPdf = (t) => t.startsWith("%PDF");
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

// New closings, late starts and early dismissals: push once per entry.
// Runs inside every sync and, through the day, every ten minutes on its
// own (alerts.js).
async function checkAlerts() {
  const out = { alerts: [], error: null };
  const notify = require("./notify.js");
  try {
    const school = require("../school.js")._internals;
    const seen = new Set(JSON.parse((await load("seen-alerts"))?.body || "[]"));
    const fresh = new Map();
    for (const a of await school.districtBanners()) if (!seen.has(a.id)) fresh.set(a.id, { alert: a, schools: ALL });
    for (const sc of ALL) {
      for (const a of await school.schoolBanners(sc)) {
        if (seen.has(a.id) || fresh.has(a.id)) continue;
        fresh.set(a.id, { alert: a, schools: [sc] });
      }
    }
    for (const { alert, schools } of fresh.values()) {
      out.alerts.push({ id: alert.id, push: await notify.notifyAlert(alert, schools).catch((e) => ({ error: e.message })) });
      seen.add(alert.id);
    }
    await save("seen-alerts", { at: Date.now(), hash: "", body: JSON.stringify([...seen].slice(-200)) });
  } catch (err) {
    out.error = String(err.message || err);
  }
  return out;
}

// A school posted a new supply list: tell the phones with a child there.
async function notifySupplies(doc) {
  const notify = require("./notify.js");
  const s = DATA.SCHOOLS[doc.school];
  return notify.broadcast(async (record) => {
    if (record.prefs && record.prefs.alerts === false) return null;
    const kids = await notify.kidsFor(record);
    if (!kids.some((k) => k.school === doc.school)) return null;
    const es = record.lang === "es";
    return {
      title: es ? `Nueva lista de útiles: ${s.short}` : `New supply list: ${s.short}`,
      body: es ? "La escuela publicó una lista nueva. Está en la pestaña Escuela." : "The school posted a new list. It's on the School tab.",
      url: "/#school", tag: `sfp-supplies-${doc.school}`,
    };
  });
}

async function runSync() {
  const report = { at: Date.now(), bound: {}, docs: {}, changes: {}, alerts: [] };
  const notify = require("./notify.js");
  const eventsMod = require("../events.js");
  const events = eventsMod._internals && eventsMod._internals.loadSchool ? eventsMod._internals : eventsMod;
  report.turn = ALL;
  // The district's activities calendar once; then each school's own calendar.
  let boundOk = true;
  try {
    const r = await getSource("bound-brandonvalley", DATA.DISTRICT.boundIcs, { valid: isCalendar, force: true, accept: "text/calendar,*/*" });
    report.boundDistrict = { at: r.at, stale: !!r.stale, error: r.error || null };
    boundOk = !r.stale;
  } catch (err) { report.boundDistrict = { at: null, stale: true, error: String(err.message || err) }; boundOk = false; }
  for (const s of SCHOOL_LIST) {
    try {
      const r = await getSource(`gcal-${s.id}`, `https://calendar.google.com/calendar/ical/${encodeURIComponent(s.gcal)}/public/basic.ics`, { valid: isCalendar, force: true, accept: "text/calendar,*/*" });
      report.bound[s.id] = { at: r.at, stale: !!r.stale, error: r.error || null };
      // Compare the next three weeks of games with last run's picture, and
      // tell families following a team that was cancelled or moved. Only
      // when both sources answered: a stale copy must never read as changes.
      if (!r.stale && boundOk) {
        const all = await events.loadSchool(s.id);
        report.bound[s.id].upcoming = all.filter((e) => e.d >= today()).length;
        const snap = notify.snapshot(all);
        const prev = await load(`snap2-${s.id}`);
        const changes = prev ? notify.diff(JSON.parse(prev.body), snap) : [];
        await save(`snap2-${s.id}`, { at: Date.now(), hash: "", body: JSON.stringify(snap) });
        if (changes.length) report.changes[s.id] = { count: changes.length, push: await notify.notifyChanges(s.id, changes).catch((e) => ({ error: e.message })) };
      }
    } catch (err) {
      report.bound[s.id] = { at: null, stale: true, error: String(err.message || err) };
    }
  }
  const a = await checkAlerts();
  report.alerts = a.alerts;
  if (a.error) report.alertsError = a.error;
  for (const doc of DOCS) {
    try {
      // Documents change rarely; keep only the fingerprint, not the PDF.
      const before = await getMeta(doc.key);
      const r = await getSource(doc.key, doc.url, { valid: isPdf, force: true, accept: "application/pdf" });
      const meta = await getMeta(doc.key);
      await save(doc.key, { ...(await load(doc.key)), body: "" });
      report.docs[doc.key] = { label: doc.label, school: doc.school, url: doc.url, changedAt: meta.changedAt, checkedAt: r.at, stale: !!r.stale };
      // A changed supply list reaches that school's families; the parsed
      // copy is dropped so the next open reads the new one.
      if (doc.supplies && r.changed && before && before.hash) {
        await save(`school-${doc.school}-supplies`, { at: 0, hash: "", body: "" }).catch(() => {});
        report.docs[doc.key].notified = await notifySupplies(doc).catch((e) => ({ error: e.message }));
      }
    } catch (err) {
      report.docs[doc.key] = { label: doc.label, school: doc.school, url: doc.url, error: String(err.message || err) };
    }
  }
  // Game changes held overnight (quiet hours) go out on the first morning run.
  report.flushed = await notify.flushPending().catch((e) => ({ error: e.message }));
  // Warm the school relay so parents get saved copies instantly. Each kind
  // only refetches when its own saved copy is due.
  const school = require("../school.js");
  report.warmed = 0;
  const kinds = ["forms", "clubs", "supplies", "handbook", "alerts"];
  for (const sc of ALL) {
    for (const what of kinds) {
      const r = await school.handler({ queryStringParameters: { school: sc, what } }).catch(() => null);
      if (r && r.statusCode === 200) report.warmed++;
    }
  }
  // Spanish: translate anything new in the background (it takes minutes the
  // first time; afterwards only new menu items, games and posts).
  if (process.env.URL && process.env.ANTHROPIC_API_KEY) {
    const r = await fetch(`${process.env.URL}/.netlify/functions/translate-background`, { method: "POST" }).catch((e) => ({ status: e.message }));
    report.spanish = r.status;
  }
  // Tell the owner when something has been failing for a while.
  const checks = {};
  checks["district activities calendar (Bound)"] = report.boundDistrict.stale ? { ok: false, why: report.boundDistrict.error || "stale" } : { ok: true };
  for (const [sc, b] of Object.entries(report.bound)) checks[`${DATA.SCHOOLS[sc].short} school calendar`] = b.stale ? { ok: false, why: b.error || "stale" } : { ok: true };
  for (const d of Object.values(report.docs)) checks[d.label] = d.error || d.stale ? { ok: false, why: d.error || "stale" } : { ok: true };
  checks["closings list (KELOLAND)"] = report.alertsError ? { ok: false, why: report.alertsError } : { ok: true };
  checks["school info (forms, clubs, supplies, handbook)"] = report.warmed >= ALL.length * (kinds.length - 1) ? { ok: true } : { ok: false, why: `${report.warmed} of ${ALL.length * kinds.length} loaded` };
  report.health = await require("./health.js").recordHealth(checks).catch((e) => ({ error: e.message }));
  await save("status", { at: report.at, hash: "", body: JSON.stringify(report) });
  return report;
}

async function readStatus() {
  const s = await load("status");
  return s && s.body ? JSON.parse(s.body) : null;
}

module.exports = { runSync, checkAlerts, readStatus, BOUND, DOCS, schoolsThisRun, notifySupplies };
