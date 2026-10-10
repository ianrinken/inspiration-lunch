/* Nightly drift check: does what parents see still match the sources?
 *
 * For each school it asks the app's own relays the questions a parent
 * would: is this week's menu posted, does the calendar have anything in
 * the next seven days during the school year, do the school's menus
 * (forms), handbook and supply list still read. Problems are saved (the
 * admin page shows them) and the owner is emailed only when the list
 * changes, so a lasting problem doesn't send an email every night.
 */
const { load, save } = require("./sources.js");
const { sendOwnerEmail } = require("./mail.js");
const DATA = require("../../../data.js");

const ymd = (d) => d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const call = async (fn, q) => { const r = await fn.handler({ queryStringParameters: q }); return r.statusCode === 200 ? JSON.parse(r.body) : null; };

async function checkSchool(school, today, week) {
  const problems = [];
  const menu = require("../menu.js"), events = require("../events.js"), relay = require("../school.js");
  const s = DATA.SCHOOLS[school];
  const year = require("../../../shared.js").schoolYearFor(DATA.SCHOOL_YEARS, today);
  const inSession = today >= year.first && today <= year.last;
  // Menu: the week is posted (the cafeteria posts about a month ahead).
  try {
    const app = await call(menu, { school, start: today, end: week });
    if (!app) problems.push("menu: the app's menu relay failed");
    else if (inSession && !(app.days || []).some((d) => d.lines && d.lines.Lunch && d.lines.Lunch.length)) problems.push("menu: no lunch posted for the coming week");
  } catch (e) { problems.push(`menu: couldn't check (${e.message})`); }
  // Calendar: events still come through (Bound can block us).
  try {
    const mod = events._internals && events._internals.loadSchool ? events._internals : events;
    const all = await mod.loadSchool(school);
    const soon = all.filter((e) => e.d >= today && e.d <= week).length;
    if (inSession && !soon) problems.push("calendar: no events at all in the next 7 days");
  } catch (e) { problems.push(`calendar: failed to load (${e.message})`); }
  // The school's website menus, the handbook and the supply list.
  try {
    const forms = await call(relay, { school, what: "forms" });
    if (!forms || !(forms.groups || []).some((g) => g.files.length)) problems.push("school site: no parent or student links read");
  } catch (e) { problems.push(`school site: ${e.message}`); }
  try {
    const hb = await call(relay, { school, what: "handbook" });
    if (!hb || (hb.sections || []).length < 10) problems.push(`handbook: only ${hb ? (hb.sections || []).length : 0} sections read`);
  } catch (e) { problems.push(`handbook: ${e.message}`); }
  if (s.supplies) {
    try {
      const sup = await call(relay, { school, what: "supplies" });
      if (!sup || !(sup.items || []).length) problems.push("supply list: nothing read from the PDF");
    } catch (e) { problems.push(`supply list: ${e.message}`); }
  }
  return problems;
}

async function runDrift() {
  const today = ymd(new Date());
  const week = ymd(new Date(Date.now() + 6 * 864e5));
  const report = { at: Date.now(), schools: {} };
  for (const school of Object.keys(DATA.SCHOOLS)) report.schools[school] = await checkSchool(school, today, week);
  const list = Object.entries(report.schools).flatMap(([s, p]) => p.map((x) => `${DATA.SCHOOLS[s].short} ${x}`));
  const prev = JSON.parse((await load("drift"))?.body || "{}");
  const was = new Set(prev.list || []);
  const now = new Set(list);
  const fresh = list.filter((x) => !was.has(x));
  const cleared = [...was].filter((x) => !now.has(x));
  report.list = list;
  if (fresh.length || cleared.length) {
    report.mail = await sendOwnerEmail(
      fresh.length ? `${fresh.length} thing${fresh.length > 1 ? "s" : ""} no longer match the source` : "Everything matches the sources again",
      [fresh.length ? `New:\n${fresh.join("\n")}` : "", cleared.length ? `Fixed:\n${cleared.join("\n")}` : "", list.length ? `\nStill open:\n${list.join("\n")}` : ""].filter(Boolean).join("\n\n"),
    ).catch((e) => ({ error: e.message }));
  }
  await save("drift", { at: Date.now(), hash: "", body: JSON.stringify(report) });
  return report;
}

module.exports = { runDrift, checkSchool };
