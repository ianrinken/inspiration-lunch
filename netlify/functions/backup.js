/* Scheduled nightly (netlify.toml). Two jobs:
 *  1. Backup: copies every family code and notification sign-up into a dated
 *     snapshot (14 kept), downloadable from the admin page.
 *  2. Retention: deletes family codes unused for 12 months, reports older
 *     than 6 months, and spent request counters, as the privacy page says. */
const { openStore, connect } = require("./lib/store.js");

const DAY = 864e5;
const dump = async (name) => {
  const store = openStore(name);
  const out = {};
  for (const key of await store.list()) out[key] = await store.get(key);
  return out;
};

async function runBackup() {
  const now = Date.now();
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const snapshot = { at: now, family: await dump("family"), push: await dump("push") };
  const backups = openStore("backups");
  await backups.set(day, snapshot);
  const keep = (await backups.list()).sort().reverse();
  for (const old of keep.slice(14)) await backups.delete(old);

  const removed = { family: 0, reports: 0, limits: 0 };
  const family = openStore("family");
  for (const [code, rec] of Object.entries(snapshot.family)) {
    const last = Math.max(rec?.lastSeen || 0, rec?.updatedAt || 0, rec?.createdAt || 0);
    if (now - last > 365 * DAY) { await family.delete(code); removed.family++; }
  }
  const reports = openStore("reports");
  for (const key of await reports.list()) {
    const at = Number(key.split("-")[0]);
    if (at && now - at > 182 * DAY) { await reports.delete(key); removed.reports++; }
  }
  // Searches that found nothing: one record per day, kept 6 months.
  const misses = openStore("misses");
  removed.misses = 0;
  for (const key of await misses.list()) {
    const at = Date.parse(`${key}T12:00:00Z`);
    if (at && now - at > 182 * DAY) { await misses.delete(key); removed.misses++; }
  }
  const limits = openStore("limits");
  for (const key of await limits.list()) {
    const rec = await limits.get(key);
    if (!rec || now - (rec.at || 0) > 2 * DAY) { await limits.delete(key); removed.limits++; }
  }
  return { day, families: Object.keys(snapshot.family).length, subscriptions: Object.keys(snapshot.push).length, removed };
}

exports.handler = async (event) => {
  connect(event);
  const result = await runBackup();
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) };
};
exports.runBackup = runBackup;
