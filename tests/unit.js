/* Unit tests: the real shipped code (shared rules and Netlify functions),
 * run against trimmed copies of real feeds in tests/fixtures. No network.
 *   node tests/unit.js
 * Every bug that has bitten this app gets a test here.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FIX = path.join(__dirname, "fixtures");
process.env.SFP_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sfp-test-"));

// Offline: every fetch is answered from fixtures or refused.
global.fetch = async (url) => {
  const u = String(url);
  const bound = u.match(/gobound\.com\/sd\/schools\/siouxfalls(\w+)\/calendar\/ical/);
  if (bound && fs.existsSync(path.join(FIX, `bound-${bound[1]}.ics`))) {
    const body = fs.readFileSync(path.join(FIX, `bound-${bound[1]}.ics`), "utf8");
    return { ok: true, status: 200, headers: new Map(), text: async () => body };
  }
  if (/api\.mealviewer\.com/.test(u)) {
    const body = fs.readFileSync(path.join(FIX, "mealviewer-lincoln.json"), "utf8");
    return { ok: true, status: 200, headers: new Map(), json: async () => JSON.parse(body), text: async () => body };
  }
  return { ok: false, status: 503, headers: new Map(), text: async () => "", json: async () => ({}) };
};

const SH = require(path.join(ROOT, "shared.js"));
const DATA = require(path.join(ROOT, "data.js"));
const events = require(path.join(ROOT, "netlify/functions/events.js"));
const notify = require(path.join(ROOT, "netlify/functions/lib/notify.js"));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* ---------- shared rules ---------- */

test("grades come from the graduating class and move up July 1", () => {
  assert.strictEqual(SH.gradeOf(2028, "2026-09-30"), 11);
  assert.strictEqual(SH.gradeOf(2028, "2027-06-30"), 11);
  assert.strictEqual(SH.gradeOf(2028, "2027-07-01"), 12);
  assert.strictEqual(SH.classFor(9, "2026-10-01"), 2030);
});

test("grouping never hangs when no level has a venue (froze the page once)", () => {
  const start = Date.now();
  const g = SH.groupEvents([
    { id: "a", act: "Boys Basketball", d: "2027-01-07", title: "Boys Basketball: Washington at Tea Area", home: false, t: "16:00", level: "9A" },
    { id: "b", act: "Boys Basketball", d: "2027-01-07", title: "Boys Basketball: Washington at Tea Area", home: false, t: "17:30", level: "9B" },
  ]);
  assert.ok(Date.now() - start < 100);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].venue, undefined);
  assert.deepStrictEqual(g[0].ids, ["a", "b"]);
});

test("two gyms collapse to one readable venue", () => {
  const g = SH.groupEvents([
    { id: "a", act: "Volleyball", d: "2026-10-01", title: "V", home: true, t: "16:30", level: "9A", venue: "Sioux Falls Lincoln High School Gym Auxiliary" },
    { id: "b", act: "Volleyball", d: "2026-10-01", title: "V", home: true, t: "16:30", level: "JV", venue: "Sioux Falls Lincoln High School Gym Main" },
  ]);
  assert.strictEqual(g[0].venue, "Sioux Falls Lincoln High School Gym Auxiliary and Gym Main");
});

test("school-wide nights show for every student, club events don't", () => {
  const kid = { grade: 11, follows: [] };
  assert.ok(SH.mineFilter(kid, { act: "Student Council", title: "Student Council: Homecoming Dance" }));
  assert.ok(!SH.mineFilter(kid, { act: "Competitive Dance", title: "Competitive Dance: Sioux Falls Invitational" }));
  assert.ok(!SH.mineFilter(kid, { act: "Volleyball", title: "Volleyball: Lincoln vs Tea Area" }));
  assert.ok(SH.mineFilter({ grade: 11, follows: [{ act: "Volleyball", level: "" }] }, { act: "Volleyball", title: "Volleyball: Lincoln vs Tea Area" }));
});

test("grade-targeted events reach only their grades", () => {
  assert.ok(SH.mineFilter({ grade: 12, follows: [] }, { cat: "academic", title: "Senior meeting", g: [12] }));
  assert.ok(!SH.mineFilter({ grade: 9, follows: [] }, { cat: "academic", title: "Senior meeting", g: [12] }));
});

test("state championships follow the student's teams", () => {
  const items = SH.stateFor(DATA.STATE_EVENTS, { follows: [{ act: "Volleyball" }] }, "2026-11-01", "2026-11-30");
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].title, "State volleyball");
  assert.strictEqual(SH.stateFor(DATA.STATE_EVENTS, { follows: [] }, "2026-11-01", "2026-11-30").length, 0);
});

test("district days off are listed once (feed duplicates dropped)", () => {
  const merged = SH.mergeDistrict(DATA.DISTRICT_CALENDAR, [{ id: "x", d: "2026-10-12", cat: "noschool", title: "No School - Native American Day" }], "2026-10-12", "2026-10-12", 11);
  assert.strictEqual(merged.filter((e) => e.cat === "noschool").length, 1);
});

test("every school year has dates in order and graduation for each school", () => {
  for (const y of DATA.SCHOOL_YEARS) {
    assert.ok(y.first < y.last, y.id);
    // Every high school has a graduation entry; its time may be unpublished (null).
    for (const s of Object.values(DATA.SCHOOLS).filter((x) => x.level === "hs").map((x) => x.id)) assert.ok(s in y.graduation.times, `${y.id} ${s}`);
    assert.ok(y.graduation.d >= y.first && y.graduation.d <= SH.addDays(y.last, 14), `${y.id} graduation date`);
  }
  for (const e of DATA.DISTRICT_CALENDAR) if (e.kind === "noschool") assert.ok(!SH.isWeekend(e.d), `weekend day off ${e.d}`);
});

/* ---------- events relay ---------- */

test("a firewall challenge is a failure, never an empty calendar", async () => {
  const realFetch = global.fetch;
  const { getSource } = require(path.join(ROOT, "netlify/functions/lib/sources.js"));
  global.fetch = async () => ({ status: 202, headers: { get: (h) => (h === "x-amzn-waf-action" ? "challenge" : null) }, text: async () => "" });
  await assert.rejects(getSource("never-saved", "https://gobound.com/x", { valid: (t) => t.includes("BEGIN:VCALENDAR") }));
  global.fetch = realFetch;
});

test("change detection: cancellations and time changes, not new games", () => {
  const before = { k: { t: "16:30", x: false, act: "Volleyball", level: "JV", d: "2026-10-08", title: "V" } };
  assert.deepStrictEqual(notify.diff(before, { k: { ...before.k, t: "17:00" } }).map((c) => c.kind), ["time"]);
  assert.deepStrictEqual(notify.diff(before, { k: { ...before.k, x: true } }).map((c) => c.kind), ["cancelled"]);
  assert.strictEqual(notify.diff({}, before).length, 0);
});

/* ---------- protection and housekeeping ---------- */

test("request limits block floods, per address", async () => {
  const { overLimit } = require(path.join(ROOT, "netlify/functions/lib/limit.js"));
  const a = { headers: { "x-nf-client-connection-ip": "203.0.113.5" } };
  const b = { headers: { "x-nf-client-connection-ip": "203.0.113.6" } };
  const results = [];
  for (let i = 0; i < 4; i++) results.push(await overLimit(a, "t-bucket", 3, 60));
  assert.deepStrictEqual(results, [false, false, false, true]);
  assert.strictEqual(await overLimit(b, "t-bucket", 3, 60), false);
  const stored = JSON.stringify(await require(path.join(ROOT, "netlify/functions/lib/store.js")).openStore("limits").list());
  assert.ok(!stored.includes("203.0.113"), "no raw IP addresses stored");
});

test("health: email only after three failures in a row, then on recovery", async () => {
  const sent = [];
  const mail = require(path.join(ROOT, "netlify/functions/lib/mail.js"));
  const real = mail.sendOwnerEmail;
  mail.sendOwnerEmail = async (subject) => { sent.push(subject); return {}; };
  delete require.cache[require.resolve(path.join(ROOT, "netlify/functions/lib/health.js"))];
  const { recordHealth } = require(path.join(ROOT, "netlify/functions/lib/health.js"));
  for (let i = 0; i < 4; i++) await recordHealth({ feed: { ok: false, why: "down" } });
  assert.strictEqual(sent.length, 1, "one email for an outage, not one per run");
  await recordHealth({ feed: { ok: true } });
  assert.deepStrictEqual(sent, ["1 source failing", "Recovered"]);
  mail.sendOwnerEmail = real;
});

test("quiet hours hold game changes overnight and send them in the morning", async () => {
  const RealDate = Date;
  const at = (iso) => { const fixed = new RealDate(iso).getTime(); global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } }; };
  try {
    at("2026-10-08T23:30:00-05:00"); // 11:30 PM Central
    const held = await notify.notifyChanges("lincoln", [{ act: "Volleyball", level: "JV", d: "2026-10-09", title: "V", kind: "time", t: "17:00", was: "16:30" }]);
    assert.deepStrictEqual(held, { held: 1 });
    const pending = require(path.join(ROOT, "netlify/functions/lib/store.js")).openStore("pending");
    assert.strictEqual(((await pending.get("lincoln")) || []).length, 1);
    at("2026-10-09T07:00:00-05:00"); // 7 AM Central
    await notify.flushPending();
    assert.strictEqual(await pending.get("lincoln"), null);
  } finally { global.Date = RealDate; }
});

test("nightly job backs up and deletes year-old family codes", async () => {
  const st = require(path.join(ROOT, "netlify/functions/lib/store.js"));
  const fam = st.openStore("family");
  await fam.set("OLDCODE2", { kids: [], updatedAt: Date.now() - 400 * 864e5, lastSeen: Date.now() - 400 * 864e5 });
  await fam.set("NEWCODE2", { kids: [], updatedAt: Date.now() });
  const r = await require(path.join(ROOT, "netlify/functions/backup.js")).runBackup();
  assert.ok(r.removed.family >= 1);
  assert.strictEqual(await fam.get("OLDCODE2"), null);
  assert.ok(await fam.get("NEWCODE2"));
  assert.ok((await st.openStore("backups").list()).length === 1);
});

/* ---------- translations ---------- */

test("every t() string in app.js has Spanish", () => {
  const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const sandbox = { self: {} };
  new Function("self", fs.readFileSync(path.join(ROOT, "i18n.js"), "utf8"))(sandbox.self);
  const es = sandbox.self.SFI18N.es;
  const keys = new Set();
  for (const m of app.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse(`"${m[1]}"`));
  const missing = [...keys].filter((k) => !(k in es));
  assert.deepStrictEqual(missing, [], `missing Spanish: ${missing.join(" | ")}`);
});

test("Spanish: relays add a dictionary, keep the English data, and save each translation once", async () => {
  const tr = require("../netlify/functions/lib/translate.js");
  let calls = 0;
  tr._internals.useCaller(async (list) => { calls++; return list.map((s) => `ES ${s}`); });
  const body = JSON.stringify({ days: [{ d: "2026-10-05", lines: { Lunch: [{ n: "Chicken Nuggets", t: "ENTREES" }, { n: "1%", t: "MILK" }] } }] });
  const out = JSON.parse(await tr.withSpanish({ queryStringParameters: { lang: "es" } }, body, "menu"));
  assert.strictEqual(out.days[0].lines.Lunch[0].n, "Chicken Nuggets");
  assert.strictEqual(out.es["Chicken Nuggets"], "ES Chicken Nuggets");
  assert.strictEqual(out.es.Lunch, "ES Lunch");
  assert.ok(!("1%" in out.es), "numbers aren't sent for translation");
  assert.ok(!out.esMissing);
  tr._internals.useCaller(async () => { throw new Error("should come from the saved copy"); });
  const again = JSON.parse(await tr.withSpanish({ queryStringParameters: { lang: "es" } }, body, "menu"));
  assert.strictEqual(again.es["Chicken Nuggets"], "ES Chicken Nuggets");
  assert.strictEqual(calls, 1);
  assert.strictEqual(await tr.withSpanish({ queryStringParameters: {} }, body, "menu"), body, "English answers are untouched");
  // A failed translation leaves English and says so, so the CDN won't keep it.
  const news = JSON.stringify({ items: [{ title: "Homecoming week", html: "<p>Spirit days</p>" }] });
  const partial = JSON.parse(await tr.withSpanish({ queryStringParameters: { lang: "es" } }, news, "news"));
  assert.strictEqual(partial.esMissing, 2);
  assert.strictEqual(tr.cdnFor(JSON.stringify(partial), "long"), "public, s-maxage=30");
  tr._internals.useCaller(null);
});

test("Spanish: long batches split, a wrong-length answer is never used", async () => {
  const { chunks } = require("../netlify/functions/lib/translate.js")._internals;
  const parts = chunks(Array.from({ length: 130 }, (_, i) => `Item number ${i}`));
  assert.ok(parts.length >= 3 && parts.every((p) => p.length <= 60));
  assert.strictEqual(parts.flat().length, 130);
  const tr = require("../netlify/functions/lib/translate.js");
  tr._internals.useCaller(async (list) => list.slice(1));
  const d = await tr.toSpanish(["Varsity football practice", "Band concert"]);
  assert.deepStrictEqual(d, {});
  tr._internals.useCaller(null);
});

test("every handbook string has Spanish (people's names stay as written)", () => {
  global.self = global;
  delete require.cache[require.resolve(path.join(ROOT, "i18n.js"))];
  require(path.join(ROOT, "i18n.js"));
  require(path.join(ROOT, "handbooks-es.js"));
  const es = global.SFI18N.es;
  const H = require(path.join(ROOT, "handbooks.js"));
  const missing = [];
  const walk = (x, k) => {
    if (typeof x === "string") { if (/[A-Za-z]{2}/.test(x) && !["year", "source", "start", "end", "email", "phone", "name"].includes(k) && !es[x]) missing.push(x.slice(0, 60)); }
    else if (Array.isArray(x)) x.forEach((v) => walk(v, k));
    else if (x && typeof x === "object") for (const [kk, v] of Object.entries(x)) walk(v, kk);
  };
  // Schedule names are labels; contact names are people.
  for (const sc of Object.values(H)) {
    for (const x of sc.schedules || []) { walk(x.name); walk(x.note); for (const r of x.rows || []) walk(r.label); }
    walk(sc.lunch); walk(sc.attendance, "attendance");
    for (const c of sc.contacts || []) walk(c.role);
    walk(sc.policies);
  }
  assert.deepStrictEqual(missing, [], `missing Spanish: ${missing.join(" | ")}`);
});

test("deadlines: right grades, ACT/SAT only for 11th and 12th, every wording in Spanish", () => {
  global.self = global;
  require(path.join(ROOT, "i18n.js"));
  const es = global.SFI18N.es;
  const all = (g) => SH.deadlinesFor(DATA, g, "2026-07-01", "2027-06-30");
  assert.ok(all(12).some((x) => /FAFSA/.test(x.key)));
  assert.ok(!all(9).some((x) => /FAFSA|\{test\}/.test(x.key)), "9th graders get no FAFSA or ACT deadlines");
  assert.ok(all(11).some((x) => x.vars.test === "ACT") && all(11).some((x) => x.vars.test === "SAT"));
  const keys = new Set([9, 10, 11, 12].flatMap((g) => all(g).map((x) => x.key)));
  for (const k of keys) assert.ok(es[k], `no Spanish for deadline "${k}"`);
  const sorted = all(11).map((x) => x.d);
  assert.deepStrictEqual(sorted, [...sorted].sort());
});

test("deadline push lines read right in English and Spanish", () => {
  const x = SH.deadlinesFor(DATA, 11, "2026-11-06", "2026-11-06")[0];
  assert.strictEqual(notify.deadlineText({ lang: "en" }, x), "ACT registration closes for the Dec 12 test");
  assert.match(notify.deadlineText({ lang: "es" }, x), /^Cierra la inscripción del ACT para el examen del 12 dic/);
});

test("away venues keep Bound's map pin, and no place is assumed to be in Sioux Falls", () => {
  const E = events._internals;
  const ev = (f) => E.shapeEvent({ DTSTART: "DTSTART;TZID=America/Chicago:20261017T100000", SUMMARY: "Girls Soccer: Lincoln at Watertown", "X-BND-ACTIVITYKEY": "soccer", "X-BND-ACTIVITYNAME": "Girls Soccer", UID: "w", LOCATION: "Watertown High School Arena", ...f }, E.SCHOOLS.lincoln);
  assert.strictEqual(ev({ GEO: "44.902271;-97.097931" }).geo, "44.90227,-97.09793");
  // Bound writes 0;0 when it has no pin: no pin, not the Gulf of Guinea.
  assert.strictEqual(ev({ GEO: "0.0;0.0" }).geo, undefined);
  assert.strictEqual(ev({}).geo, undefined);
  assert.match(E.toIcs([ev({ GEO: "44.902271;-97.097931" })], "x"), /GEO:44\.90227;-97\.09793/);
  // State championships carry a full map address; none is left to guess.
  const { STATE_EVENTS } = require("../data.js");
  const SH = require("../shared.js");
  const st = SH.stateFor(STATE_EVENTS, { follows: [{ act: "Girls Soccer" }] }, "2026-10-01", "2026-10-31")[0];
  assert.strictEqual(st.map, "Watertown, SD");
  for (const e of STATE_EVENTS) assert.ok(!/Sioux Falls.*Sioux Falls/.test(e.map || `${e.venue}, SD`), e.title);
});

test("every district calendar and state championship title has Spanish", () => {
  global.self = global;
  require(path.join(ROOT, "i18n.js"));
  const es = global.SFI18N.es;
  const miss = [];
  for (const e of DATA.STATE_EVENTS) if (!es[e.title]) miss.push(e.title);
  for (const e of DATA.DISTRICT_CALENDAR) { const m = /^No school: (.+)$/.exec(e.title); if (!es[m ? m[1] : e.title]) miss.push(e.title); }
  assert.deepStrictEqual([...new Set(miss)], []);
});

test("district alerts are read however they're worded (a missed one left cards showing a normal day)", () => {
  const cases = [
    ["2-hour late start Friday for all SFSD schools.", "late2"], ["SFSD starting classes 2 hours late on Tuesday", "late2"],
    ["Sioux Falls public schools starting two hours late", "late2"], ["Sioux Falls schools opening 2 hours late on Wednesday", "late2"],
    ["Sioux Falls schools will be on a 2-hour delay Thursday.", "late2"], ["Schools will start one hour late tomorrow.", "late1"],
    ["Late start for Sioux Falls schools Thursday", "late"], ["Sioux Falls School District buildings are closed today.", "closed"],
    ["Evening activities are cancelled tonight due to weather. School will be in session tomorrow as normal.", null],
    ["All activities are cancelled tonight.", null], ["School is cancelled Wednesday due to weather.", "closed"],
    ["Classes are canceled Thursday.", "closed"], ["There will be no school on Tuesday, February 3, due to the blizzard.", "closed"],
    ["Tuesday will be an eLearning day for all SFSD students.", "remote"], ["Sioux Falls schools will dismiss two hours early today.", "early"],
    ["There will be no classes tomorrow, Tuesday.", "closed"], ["Classes are canceled for Wednesday.", "closed"],
    ["Schools will dismiss 2 hours early today.", "early"], ["Tomorrow is an e-learning day; students work from home in Canvas.", "remote"],
    ["Picture retakes are Thursday.", null], ["Homecoming parade tonight at 6 PM.", null],
  ];
  for (const [text, want] of cases) assert.strictEqual(SH.alertKind(text), want, text);
});

test("no emoji in the app's own files", () => {
  for (const f of ["app.js", "index.html", "i18n.js", "data.js", "handbooks.js", "style.css"]) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\\u\{[0-9A-F]+\}|\\p\{Extended_Pictographic\}/gi, "");
    assert.ok(!/\p{Extended_Pictographic}/u.test(src), `emoji in ${f}`);
  }
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (err) { failed++; console.log(`  FAIL ${name}\n       ${String(err.message).split("\n")[0]}`); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} unit tests passed`);
  process.exit(failed ? 1 : 0);
})();
