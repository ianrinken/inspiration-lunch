/* Push notifications: the evening heads-up, game changes and school alerts.
 *
 * The server never knows a student's name. Messages carry student ids
 * ("lines: [{ kid, text }]") and the phone's service worker swaps in the
 * names it keeps locally. */
const webpush = require("web-push");
const SHARED = require("../../../shared.js");
const SFDATA = require("../../../data.js");
const { openStore } = require("./store.js");

const VAPID_PUBLIC = "BPwNi91GO_Q3BvtYJodMYYajTDU3b_opYxbzXLS7r4TDpdPaMqX4NWx-TSVW-trBTi8GZV-ob8TqKKuQELU1SI8";
const SHORT = Object.fromEntries(Object.values(require("../../../data.js").SCHOOLS).map((s) => [s.id, s.short]));

function configure() {
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!priv) throw new Error("VAPID_PRIVATE_KEY is not set");
  webpush.setVapidDetails("https://brandonvalleylunch.com", VAPID_PUBLIC, priv);
}

// Message wording in the language the phone uses (sent when subscribing).
const WORDS = {
  en: { noSchool: (r) => `no school (${r})`, home: " (home)", away: " (away)", cancelled: "CANCELLED: ", tomorrow: (d) => `Tomorrow, ${d}`, change: (s) => `${s} schedule change`, isCancelled: (t, l, d) => `${t} (${l}) on ${d} is cancelled`, moved: (t, l, d, n, w) => `${t} (${l}) on ${d} moved to ${n} (was ${w})`, alert: "School alert", weekAhead: "The week ahead", inAWeek: (s) => `In a week: ${s}`, locale: "en-US" },
  es: { noSchool: (r) => `sin clases (${r})`, home: " (en casa)", away: " (de visitante)", cancelled: "CANCELADO: ", tomorrow: (d) => `Mañana, ${d}`, change: (s) => `Cambio de horario en ${s}`, isCancelled: (t, l, d) => `${t} (${l}) del ${d} se canceló`, moved: (t, l, d, n, w) => `${t} (${l}) del ${d} cambió a las ${n} (antes ${w})`, alert: "Aviso escolar", weekAhead: "La semana que viene", inAWeek: (s) => `En una semana: ${s}`, locale: "es-US" },
};
const words = (record) => WORDS[record.lang === "es" ? "es" : "en"];
// Deadline wording in the phone's language, from the app's own i18n.js.
function deadlineText(record, x) {
  const w = words(record);
  let key = x.key;
  if (record.lang === "es") {
    if (!global.SFI18N) { if (!global.self) global.self = global; require("../../../i18n.js"); }
    key = global.SFI18N.es[x.key] || x.key;
  }
  const date = x.vars.date ? new Date(`${x.vars.date}T12:00:00Z`).toLocaleDateString(w.locale, { month: "short", day: "numeric", timeZone: "UTC" }) : "";
  return key.replace(/\{(\w+)\}/g, (m, k) => (k === "date" ? date : x.vars[k] || m));
}

// Game titles, holidays and alert text in the phone's language (saved
// translations; English if one isn't ready in time).
async function loc(record, s) {
  if (record.lang !== "es" || !s) return s;
  const d = await require("./translate.js").toSpanish([s], { budgetMs: 5000 }).catch(() => ({}));
  return d[s.trim()] || s;
}
const centralToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const fmtTime = (t) => { let [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${String(m).padStart(2, "0")} ${ap}`; };

function offReason(ymd) {
  if (SHARED.isWeekend(ymd)) return "Weekend";
  const y = SHARED.schoolYearFor(SFDATA.SCHOOL_YEARS, ymd);
  if (ymd < y.first || ymd > y.last) return "Summer break";
  const hit = SFDATA.DISTRICT_CALENDAR.find((e) => (e.kind === "noschool" || e.kind === "break") && e.d <= ymd && (e.to || e.d) >= ymd);
  return hit ? hit.title.replace(/^No school:?\s*/, "") || "No school" : null;
}

// The students a subscription follows: from its family code when it has
// one (always current), otherwise the snapshot sent when it subscribed.
async function kidsFor(record) {
  // Devices subscribed by the earlier app kept students by LINQ id, grade
  // and activities; read them in today's shape.
  const { normalizeRecord } = require("../family.js")._internals;
  let kids = (normalizeRecord({ kids: record.kids || [], savedAt: record.savedAt }) || {}).kids || [];
  if (record.family) {
    const fam = normalizeRecord(await openStore("family").get(record.family));
    if (fam) kids = fam.kids;
  }
  // Students this phone asked not to hear about.
  const mute = new Set((record.prefs && record.prefs.mute) || []);
  return kids.filter((k) => !mute.has(k.id));
}

async function eventsFor(school, cache) {
  if (!cache[school]) cache[school] = require("../events.js")._internals.loadSchool(school);
  return cache[school];
}

// "Tomorrow" for each student: day off, their games, their grade's events.
async function buildDigest(record, cache = {}) {
  const day = SHARED.addDays(centralToday(), 1);
  const kids = await kidsFor(record);
  const lines = [];
  for (const k of kids) {
    const grade = SHARED.gradeOf(k.classOf, day);
    if (grade > 12) continue;
    const kid = { ...k, grade };
    const off = offReason(day);
    const all = (await eventsFor(k.school, cache)).filter((e) => e.d <= day && (e.to || e.d) >= day);
    const mine = SHARED.groupEvents(SHARED.sortEvents(SHARED.mergeDistrict(SFDATA.DISTRICT_CALENDAR, all, day, day, grade).filter((e) => SHARED.mineFilter(kid, e))));
    const bits = [];
    if (off && off !== "Weekend") bits.push(words(record).noSchool(await loc(record, off)));
    // Grade deadlines: the day before, and a week ahead.
    for (const when of [day, SHARED.addDays(day, 6)]) {
      for (const x of SHARED.deadlinesFor(SFDATA, grade, when, when)) bits.push(when === day ? deadlineText(record, x) : words(record).inAWeek(deadlineText(record, x)));
    }
    for (const e of mine) {
      if (e.district || e.cat === "noschool") continue;
      const when = e.t ? ` ${fmtTime(e.t)}` : "";
      const where = e.home === true ? words(record).home : e.home === false ? words(record).away : "";
      bits.push(`${e.x ? words(record).cancelled : ""}${await loc(record, e.title.replace(/^[^:]+:\s*/, (m) => (e.act ? m : "")))}${when}${where}`);
    }
    if (bits.length) lines.push({ kid: k.id, text: bits.slice(0, 3).join("; ") });
  }
  if (!lines.length) return null;
  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString(words(record).locale, { weekday: "long", timeZone: "UTC" });
  return { title: words(record).tomorrow(label), lines, url: "/#today", tag: "sfp-evening" };
}

// Sunday evening: the whole school week for each student in one message.
async function buildWeekAhead(record, cache = {}) {
  const w = words(record);
  const start = SHARED.addDays(centralToday(), 1);
  const end = SHARED.addDays(start, 6);
  const kids = await kidsFor(record);
  const lines = [];
  const dayName = (d) => { const n = new Date(`${d}T12:00:00Z`).toLocaleDateString(w.locale, { weekday: "short", timeZone: "UTC" }); return n.charAt(0).toUpperCase() + n.slice(1); };
  for (const k of kids) {
    const grade = SHARED.gradeOf(k.classOf, start);
    if (grade > 12) continue;
    const kid = { ...k, grade };
    const all = (await eventsFor(k.school, cache)).filter((e) => (e.to || e.d) >= start && e.d <= end);
    const mine = SHARED.groupEvents(SHARED.sortEvents(SHARED.mergeDistrict(SFDATA.DISTRICT_CALENDAR, all, start, end, grade).filter((e) => SHARED.mineFilter(kid, e))));
    const bits = [];
    for (const e of mine) {
      if (e.cat === "college") continue;
      if (e.district && e.cat !== "noschool" && e.kind !== "conferences") continue;
      const when = e.t ? ` ${fmtTime(e.t)}` : "";
      const where = e.home === true ? w.home : e.home === false ? w.away : "";
      const title = e.cat === "noschool" ? w.noSchool(await loc(record, e.title.replace(/^No school:?\s*/, "") || "")) : await loc(record, e.title.replace(/^[^:]+:\s*/, (m) => (e.act ? m : "")));
      bits.push(`${dayName(e.d)} ${e.x ? w.cancelled : ""}${title}${when}${where}`);
    }
    if (bits.length) lines.push({ kid: k.id, text: bits.slice(0, 4).join("; ") + (bits.length > 4 ? ` (+${bits.length - 4})` : "") });
  }
  if (!lines.length) return null;
  return { title: w.weekAhead, lines, url: "/#today", tag: "sfp-week" };
}

async function send(record, payload) {
  configure();
  return webpush.sendNotification(record.sub, JSON.stringify(payload), { TTL: 6 * 3600 });
}

// Send to every subscription; returns counts. `build(record)` returns a
// payload or null. Dead subscriptions (404/410) are removed.
async function broadcast(build) {
  const store = openStore("push");
  let sent = 0, skipped = 0, dropped = 0;
  for (const key of await store.list()) {
    const record = await store.get(key);
    if (!record || !record.sub) { await store.delete(key); dropped++; continue; }
    try {
      const payload = await build(record, key, store);
      if (!payload) { skipped++; continue; }
      await send(record, payload);
      sent++;
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) { await store.delete(key); dropped++; }
      else { skipped++; console.error("push:", err && err.message); }
    }
  }
  return { sent, skipped, dropped };
}

/* ---------- change detection (called by the 30-minute sync) ---------- */

// A compact picture of each school's next three weeks of games.
function snapshot(events) {
  const today = centralToday();
  const until = SHARED.addDays(today, 21);
  const snap = {};
  for (const e of events) {
    if (!e.act || e.cat === "practice" || e.d < today || e.d > until) continue;
    snap[`${e.d}|${e.title}|${e.level || ""}`] = { t: e.t || null, x: !!e.x, act: e.act, level: e.level || "", d: e.d, title: e.title };
  }
  return snap;
}
function diff(before, after) {
  const changes = [];
  for (const [key, now] of Object.entries(after)) {
    const was = before[key];
    if (!was) continue; // new games aren't news; changes to known ones are
    if (now.x && !was.x) changes.push({ ...now, kind: "cancelled" });
    else if (!now.x && now.t && was.t && now.t !== was.t) changes.push({ ...now, kind: "time", was: was.t });
  }
  return changes;
}

// Quiet hours for game changes: 9 PM to 6 AM Central. Changes found then
// are held and sent on the first morning sync. School alerts are never held.
const centralHour = () => parseInt(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }).format(new Date()), 10) % 24;
const isQuiet = () => { const h = centralHour(); return h >= 21 || h < 6; };
const DAILY_CHANGE_CAP = 3;

async function flushPending() {
  if (isQuiet()) return { held: true };
  const store = openStore("pending");
  const sent = {};
  for (const key of await store.list()) {
    const list = (await store.get(key)) || [];
    await store.delete(key);
    if (list.length) sent[key] = await notifyChanges(key, list, true);
  }
  return sent;
}

async function notifyChanges(school, changes, flushing = false) {
  if (!changes.length) return { sent: 0 };
  if (!flushing && isQuiet()) {
    const store = openStore("pending");
    const held = ((await store.get(school)) || []).concat(changes).slice(-50);
    await store.set(school, held);
    return { held: changes.length };
  }
  return broadcast(async (record, key, store) => {
    if (record.prefs && record.prefs.changes === false) return null;
    // At most three game-change messages per phone per day.
    const today = centralToday();
    const sentToday = record.sent && record.sent.day === today ? record.sent.n : 0;
    if (sentToday >= DAILY_CHANGE_CAP) return null;
    const kids = (await kidsFor(record)).filter((k) => k.school === school);
    const lines = [];
    for (const k of kids) {
      for (const c of changes) {
        if (!SHARED.follows(k, c)) continue;
        const w = words(record);
        const day = new Date(`${c.d}T12:00:00Z`).toLocaleDateString(w.locale, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
        const title = await loc(record, c.title), level = await loc(record, c.level);
        lines.push({ kid: k.id, text: c.kind === "cancelled" ? w.isCancelled(title, level, day) : w.moved(title, level, day, fmtTime(c.t), fmtTime(c.was)) });
      }
    }
    if (lines.length) await store.set(key, { ...record, sent: { day: today, n: sentToday + 1 } });
    return lines.length ? { title: words(record).change(SHORT[school]), lines: lines.slice(0, 4), url: "/#calendar", tag: `sfp-change-${school}` } : null;
  });
}

async function notifyAlert(alert, schools) {
  const text = String(alert.html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, 180);
  if (!text) return { sent: 0 };
  return broadcast(async (record) => {
    if (record.prefs && record.prefs.alerts === false) return null;
    const kids = await kidsFor(record);
    if (!kids.some((k) => schools.includes(k.school))) return null;
    return { title: words(record).alert, body: await loc(record, text), url: "/#today", tag: `sfp-alert-${alert.id}` };
  });
}

module.exports = { deadlineText, flushPending, isQuiet, VAPID_PUBLIC, buildDigest, buildWeekAhead, send, broadcast, snapshot, diff, notifyChanges, notifyAlert, kidsFor, centralToday, configure };
