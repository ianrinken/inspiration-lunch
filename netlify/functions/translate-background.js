/* Background (up to 15 minutes): translate what parents are about to read,
 * so Spanish is ready before anyone opens it. The scheduled sync starts this
 * after it refreshes the sources; only new strings cost anything, since every
 * translation is saved. A lock keeps overlapping runs from doubling up.
 */
const { connect, openStore } = require("./lib/store.js");
const { overLimit } = require("./lib/limit.js");
const SHARED = require("../../shared.js");
const SFDATA = require("../../data.js");

// Spanish is warmed ahead for every school; only new strings cost anything.
const SCHOOLS = Object.keys(SFDATA.SCHOOLS);
const LOCK_MS = 20 * 60e3;

const ymd = (d) => d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
function months(today) {
  const [y, m] = today.split("-").map(Number);
  return [0, 1].map((k) => {
    const first = new Date(Date.UTC(y, m - 1 + k, 1));
    const last = new Date(Date.UTC(y, m + k, 0));
    return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)];
  });
}

async function warm() {
  const run = (fn, q) => fn.handler({ queryStringParameters: { ...q, lang: "es" }, _budgetMs: 10 * 60e3 }).then((r) => r.statusCode).catch((e) => e.message);
  const events = require("./events.js"), menu = require("./menu.js"), school = require("./school.js"), weather = require("./weather.js");
  const today = ymd(new Date());
  const report = {};
  report.weather = await run(weather, {});
  for (const sc of SCHOOLS) {
    const r = (report[sc] = {});
    for (const [start, end] of months(today)) {
      r[`events ${start}`] = await run(events, { school: sc, start, end });
      r[`menu ${start}`] = await run(menu, { school: sc, start, end });
    }
    r.activities = await run(events, { school: sc, start: today, end: SHARED.schoolYearFor(SFDATA.SCHOOL_YEARS, today).last, list: "activities" });
    for (const what of ["alerts", "news", "feed", "staff", "clubs", "scholarships", "supplies", "forms"]) r[what] = await run(school, { school: sc, what });
    for (const slug of Object.keys(school._internals.PAGES)) r[`page ${slug}`] = await run(school, { school: sc, what: "page", slug });
  }
  return report;
}

exports.handler = async (event) => {
  connect(event);
  if (!process.env.ANTHROPIC_API_KEY) return { statusCode: 200, body: "no key" };
  // The sync starts this at most twice an hour; anyone else hitting the URL
  // gets the same allowance, and the lock below stops overlapping runs.
  if (await overLimit(event, "translate", 4, 60)) return { statusCode: 429, body: "too many" };
  const store = openStore("tr-es");
  const lock = await store.get("warm-lock").catch(() => null);
  if (lock && Date.now() - lock.at < LOCK_MS) return { statusCode: 200, body: "already running" };
  await store.set("warm-lock", { at: Date.now() });
  const report = await warm();
  await store.set("warm-last", { at: Date.now(), report }).catch(() => {});
  await store.delete("warm-lock").catch(() => {});
  return { statusCode: 200, body: JSON.stringify(report) };
};

exports._internals = { months, warm };
