/* Scheduled Monday mornings (netlify.toml): one email to the owner with the
 * week in numbers, what parents searched for and couldn't find (each one
 * is something to add as an answer on the admin page), new reports, and
 * anything the nightly source check still has open. */
const { connect, openStore } = require("./lib/store.js");
const { load } = require("./lib/sources.js");
const { sendOwnerEmail } = require("./lib/mail.js");

const day = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

async function buildWeekly(now = Date.now()) {
  const days = [...Array(7)].map((_, i) => day(now - (i + 1) * 864e5));
  const usage = openStore("usage"), misses = openStore("misses"), reports = openStore("reports");
  let phoneDays = 0, peak = 0, installed = 0;
  const bySchool = {}, missed = {};
  for (const d of days) {
    const [u, m] = await Promise.all([usage.get(d), misses.get(d)]);
    if (u) {
      phoneDays += u.phones; peak = Math.max(peak, u.phones); installed = Math.max(installed, u.installed || 0);
      for (const [s, n] of Object.entries(u.bySchool || {})) bySchool[s] = (bySchool[s] || 0) + n;
    }
    for (const [q, n] of Object.entries(m || {})) missed[q] = (missed[q] || 0) + n;
  }
  const since = now - 7 * 864e5;
  const newReports = [];
  for (const k of await reports.list()) if (Number(k.split("-")[0]) >= since) newReports.push(await reports.get(k));
  const drift = JSON.parse((await load("drift"))?.body || "{}");
  const top = Object.entries(missed).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const lines = [
    `Week of ${days[6]} to ${days[0]}`,
    "",
    `Phones using the app: about ${Math.round(phoneDays / 7)} a day (busiest day ${peak}); ${installed} on a home screen.`,
    `By school (phone-days): ${Object.entries(bySchool).map(([s, n]) => `${s} ${n}`).join(", ") || "none yet"}`,
    "",
    top.length ? "Searched for and not found (add answers on the admin page):" : "Every search found something this week.",
    ...top.map(([q, n]) => `  ${n}x  ${q}`),
    "",
    newReports.length ? `Reported mistakes (${newReports.length}):` : "No mistakes reported.",
    ...newReports.map((r) => `  ${r.context.title || r.context.type || "General"}: ${r.message.slice(0, 200)}`),
    "",
    (drift.list || []).length ? `Still not matching the sources:\n${drift.list.map((x) => `  ${x}`).join("\n")}` : "Everything matched the sources at the last nightly check.",
    "",
    "Admin page: https://brandonvalleylunch.com/admin.html",
  ];
  return { subject: `Weekly: ${Math.round(phoneDays / 7)} phones a day, ${top.length} unanswered searches`, text: lines.join("\n") };
}

exports.handler = async (event) => {
  connect(event);
  const { subject, text } = await buildWeekly();
  const mail = await sendOwnerEmail(subject, text).catch((e) => ({ error: e.message }));
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, mail }) };
};
exports._internals = { buildWeekly };
