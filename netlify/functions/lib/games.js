/* Changes to followed games: cancelled, postponed, moved to another time
 * or place, or back on. Checked every hour against a snapshot of the next
 * three weeks; each phone hears only about the activities its kids are
 * signed up for, in one push.
 */

const { getStore } = require("@netlify/blobs");
const events = require("../events.js");

const { eventsFor, allowsFor, SCHOOL_NAMES, toCentral, addDays } = events;
const DAYS_AHEAD = 21;
const KEY = "games";

const SHORT = {
  "041717d0-8f8d-ec11-8df7-eb7b319a32d1": "Brandon El.", "d8f8bcbf-1b2a-f111-bb4f-02558335d9c7": "Burkman Valley",
  "af61ff49-908d-ec11-8df7-9c80cb6a95ae": "Fred Assam", "0c65b2bc-908d-ec11-8df7-9566c4096294": "Inspiration",
  "ec90bc02-908d-ec11-8df7-eb7b319a32d1": "Robert Bennis", "82b0714f-8f8d-ec11-8df7-d30e05c96286": "Intermediate",
  "2e94e37a-8f8d-ec11-8df7-eb7b319a32d1": "Middle", "ffc1d3ff-8e8d-ec11-8df7-c6813137b210": "High",
};

const store = () => getStore({ name: "watch", consistency: "strong" });
const slim = (ev) => ({ t: ev.t, stamp: ev.stamp || null, x: ev.x || null, where: ev.where || "", act: ev.act, g: ev.g || null, time: ev.time || null, s: ev.s });

// What's on the calendar now, per school, activities only.
async function current() {
  const today = toCentral(new Date()).date;
  const items = {};
  for (const school of Object.keys(SCHOOL_NAMES)) {
    let list = [];
    try { list = await eventsFor(school, today, addDays(today, DAYS_AHEAD)); } catch (err) { console.warn("games:", school, err && err.message); continue; }
    for (const ev of list) if (ev.act) items[`${school}|${ev.s}|${ev.id}`] = slim(ev);
  }
  return items;
}

// One check: what changed since last time. The first run only remembers.
async function checkGames() {
  const now = await current();
  if (!Object.keys(now).length) return []; // every source failed: say nothing
  const prev = (await store().get(KEY, { type: "json" })) || null;
  await store().setJSON(KEY, { at: Date.now(), items: now });
  if (!prev || !prev.items) return [];
  const changes = [];
  for (const [k, ev] of Object.entries(now)) {
    const was = prev.items[k];
    if (!was) continue;
    const school = k.split("|")[0];
    let kind = null;
    if (ev.x !== was.x) kind = ev.x ? ev.x : "back on";
    else if (ev.stamp && was.stamp && ev.stamp !== was.stamp) kind = "time";
    else if (ev.where && was.where && ev.where !== was.where) kind = "venue";
    if (kind) changes.push({ school, key: k, kind, ev, was });
  }
  return changes;
}

const dayLabel = (iso) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "America/Chicago" })
  .format(new Date(`${iso}T12:00:00Z`));

function line(c) {
  const ev = c.ev;
  const when = `${dayLabel(ev.s)}${ev.time ? ` ${ev.time}` : ""}`;
  switch (c.kind) {
    case "cancelled": return `Cancelled: ${ev.t} (${when})`;
    case "postponed": return `Postponed: ${ev.t} (${when})`;
    case "back on": return `Back on: ${ev.t} (${when})`;
    case "time": return `New time: ${ev.t}, now ${when}${c.was.time ? ` (was ${c.was.time})` : ""}`;
    case "venue": return `New place: ${ev.t}, ${ev.where} (${when})`;
    default: return `${ev.t} (${when})`;
  }
}

// Tell each phone about the changes to the activities its kids follow.
async function notifyChanges(changes, sendFn) {
  if (!changes.length) return { sent: 0, devices: 0 };
  const push = getStore({ name: "push", consistency: "strong" });
  const { blobs } = await push.list();
  let sent = 0, devices = 0;
  for (const { key } of blobs) {
    const record = await push.get(key, { type: "json" });
    if (!record || !record.sub || !record.kids || !record.kids.length) continue;
    devices++;
    const mine = [];
    const seen = new Set();
    for (const kid of record.kids) {
      for (const c of changes) {
        if (c.school !== kid.school || seen.has(c.key)) continue;
        if (!kid.acts || !kid.acts.includes(c.ev.act)) continue;
        if (!allowsFor({ ...c.ev, t: c.ev.t }, kid.grade, kid.acts)) continue;
        seen.add(c.key);
        mine.push(c);
      }
    }
    if (!mine.length) continue;
    const lines = mine.slice(0, 4).map(line);
    if (mine.length > 4) lines.push(`+${mine.length - 4} more`);
    const title = mine.length === 1
      ? ({ cancelled: "Game cancelled", postponed: "Game postponed", "back on": "Game back on", time: "Game time changed", venue: "Game moved" })[mine[0].kind] || "Game change"
      : `${mine.length} game changes`;
    try {
      await sendFn(record, { title, body: lines.join("\n"), url: "/?tab=events", tag: "bvl-games" });
      sent++;
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) await push.delete(key);
      else console.error("games push:", err && err.message);
    }
  }
  return { sent, devices };
}

module.exports = { checkGames, notifyChanges, line, SHORT };
