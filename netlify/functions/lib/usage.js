/* Visit counts. Each visit adds one tiny record of its own and nothing is
 * ever rewritten, so two visits that arrive together can't overwrite each
 * other. (The old way read a day's total, added one and saved it back; on a
 * busy day, and with storage that takes up to a minute to agree with itself,
 * visits were lost.) The nightly job rolls each past day into one total.
 *
 * Still nothing that identifies a phone: the record's name holds the day, the
 * kind of visit and the schools on that phone, plus random letters. */
const crypto = require("crypto");
const { openStore } = require("./store.js");

const rand = () => crypto.randomBytes(6).toString("hex");
const centralDay = (ms = Date.now()) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

/** kind: "v" a set-up phone, "i" a set-up phone with the app installed, "p" a first look. */
async function addVisit(day, { preview = false, installed = false, schools = [] } = {}) {
  const kind = preview ? "p" : installed ? "i" : "v";
  await openStore("visits").set(`${day}/${kind}/${schools.join(".") || "-"}/${rand()}`, 1);
}
async function addSponsorTap(day, tab) {
  await openStore("visits").set(`${day}/c/${tab}/${rand()}`, 1);
}

function tally(keys, into) {
  for (const key of keys) {
    const [, kind, detail] = key.split("/");
    if (kind === "p") into.previews = (into.previews || 0) + 1;
    else if (kind === "c") { into.sponsorClicks = into.sponsorClicks || {}; into.sponsorClicks[detail] = (into.sponsorClicks[detail] || 0) + 1; }
    else if (kind === "v" || kind === "i") {
      into.phones++;
      if (kind === "i") into.installed++;
      for (const s of detail && detail !== "-" ? detail.split(".") : []) into.bySchool[s] = (into.bySchool[s] || 0) + 1;
    }
  }
  return into;
}

/** One day's totals: the saved total (older days, and counts from before this
 *  change) plus any visit records not yet rolled into it. null when empty. */
async function readDay(day) {
  const [saved, keys] = await Promise.all([openStore("usage").get(day), openStore("visits").list(`${day}/`)]);
  if (!saved && !keys.length) return null;
  const total = { phones: 0, installed: 0, bySchool: {}, ...(saved ? JSON.parse(JSON.stringify(saved)) : {}) };
  total.bySchool = total.bySchool || {};
  // A rolled-up day already includes its records; any left over are only waiting to be removed.
  if (!total.rolled) tally(keys, total);
  delete total.rolled;
  return total;
}

/** Nightly: fold every finished day's records into that day's total, then
 *  remove them. Safe to run twice: a day marked rolled is never added again. */
async function rollUp(now = Date.now()) {
  const visits = openStore("visits"), usage = openStore("usage");
  const today = centralDay(now);
  const byDay = {};
  for (const key of await visits.list()) { const d = key.split("/")[0]; if (d < today) (byDay[d] = byDay[d] || []).push(key); }
  let days = 0, records = 0;
  for (const [day, keys] of Object.entries(byDay)) {
    const saved = await usage.get(day);
    if (!saved || !saved.rolled) {
      const total = { phones: 0, installed: 0, bySchool: {}, ...(saved || {}) };
      total.bySchool = { ...(total.bySchool || {}) };
      tally(keys, total);
      await usage.set(day, { ...total, rolled: true });
    }
    for (let i = 0; i < keys.length; i += 40) await Promise.all(keys.slice(i, i + 40).map((k) => visits.delete(k)));
    days++; records += keys.length;
  }
  return { days, records };
}

module.exports = { addVisit, addSponsorTap, readDay, rollUp, centralDay };
