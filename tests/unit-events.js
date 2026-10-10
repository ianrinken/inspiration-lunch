/* Unit tests for the Brandon Valley events relay (netlify/functions/events.js),
 * run against trimmed copies of the real feeds in tests/fixtures. No network.
 *   node tests/unit-events.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FIX = path.join(__dirname, "fixtures");
process.env.SFP_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sfp-events-test-"));

// Offline: every fetch is answered from fixtures or refused. `mode` lets a
// test turn the sources off (bot challenge, 503) after copies were saved.
let mode = "fixtures";
const ok = (body) => ({ ok: true, status: 200, headers: new Map(), text: async () => body });
global.fetch = async (url) => {
  const u = String(url);
  if (mode === "challenge") return { ok: true, status: 202, headers: new Map([["x-amzn-waf-action", "challenge"]]), text: async () => "" };
  if (mode === "down") return { ok: false, status: 503, headers: new Map(), text: async () => "Service Unavailable" };
  if (/gobound\.com\/sd\/schools\/brandonvalley\/calendar\/ical/.test(u)) return ok(fs.readFileSync(path.join(FIX, "bound-brandonvalley.ics"), "utf8"));
  if (/calendar\.google\.com\/calendar\/ical\/c_8q83pnh5nj5nhtfuue53nvlmm0/.test(u)) return ok(fs.readFileSync(path.join(FIX, "gcal-bvhs.ics"), "utf8"));
  return { ok: false, status: 503, headers: new Map(), text: async () => "", json: async () => ({}) };
};

const DATA = require(path.join(ROOT, "data.js"));
const GRADES = require(path.join(ROOT, "grades.js"));
const events = require(path.join(ROOT, "netlify/functions/events.js"));
const { openStore } = require(path.join(ROOT, "netlify/functions/lib/store.js"));
const E = events._internals;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// Raw Bound fixture entries, for attribution tests on real data.
const BOUND = E.parseIcs(fs.readFileSync(path.join(FIX, "bound-brandonvalley.ics"), "utf8"));
const tagsOf = (f) => (f["X-BND-TAGS"] || "").split(",").map((t) => t.trim()).filter(Boolean);
const shape = (f, school) => E.shapeEvent(f, E.SCHOOLS[school], E.makeKeep(school));
const bound = (over) => ({ DTSTART: "DTSTART;TZID=America/Chicago:20261014T160000", DTEND: "DTEND;TZID=America/Chicago:20261014T164500", UID: "u", "X-BND-TAGS": "", ...over });
const ELEM = Object.values(DATA.SCHOOLS).filter((s) => s.level === "es").map((s) => s.id);

/* ---------- exports and shapes ---------- */

test("exports: handler, loadSchool, activitiesFor and the internals other functions read", () => {
  for (const k of ["handler", "loadSchool", "activitiesFor", "allowsFor", "SCHOOLS", "SCHOOL_NAMES", "LINQ_TO_ID"]) assert.ok(events[k], k);
  for (const k of ["loadSchool", "shapeEvent", "parseIcs", "gradesFor", "SCHOOLS", "toIcs", "makeKeep", "activitiesFor"]) assert.ok(E[k], `_internals.${k}`);
  assert.strictEqual(Object.keys(E.SCHOOLS).length, Object.keys(DATA.SCHOOLS).length);
  for (const s of Object.values(DATA.SCHOOLS)) assert.strictEqual(E.LINQ_TO_ID[s.linq], s.id);
  assert.strictEqual(events.SCHOOL_NAMES.bvhs, "BV High School");
  assert.deepStrictEqual(E.TAG_SCHOOLS["Elementary Events"].sort(), ELEM.slice().sort());
});

test("JSON contract: { school, start, end, events } with the app's field names only", async () => {
  const r = await events.handler({ queryStringParameters: { school: "bvhs", start: "2026-10-01", end: "2026-10-31" }, headers: {} });
  assert.strictEqual(r.statusCode, 200);
  const body = JSON.parse(r.body);
  assert.deepStrictEqual(Object.keys(body), ["school", "start", "end", "events"]);
  assert.strictEqual(body.school, "bvhs");
  assert.ok(body.events.length > 100, `only ${body.events.length} events`);
  const allowed = new Set(["id", "d", "t", "title", "cat", "e", "venue", "geo", "act", "level", "home", "x", "g", "url", "lt", "lz", "to"]);
  const cats = new Set(["noschool", "practice", "activity", "college", "academic", "school"]);
  for (const ev of body.events) {
    for (const k of Object.keys(ev)) assert.ok(allowed.has(k), `unexpected field ${k} on ${ev.title}`);
    assert.match(ev.d, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(ev.t === null || /^\d{2}:\d{2}$/.test(ev.t), `time ${ev.t}`);
    assert.ok(cats.has(ev.cat), ev.cat);
    assert.ok(ev.d >= "2026-10-01" && ev.d <= "2026-10-31");
    assert.ok(!/\p{Extended_Pictographic}/u.test(ev.title));
    assert.notStrictEqual(ev.t, "07:00", `placeholder time kept on ${ev.title}`);
  }
  assert.ok(body.events.some((e) => e.cat === "activity" && e.act && e.level && e.url && e.geo));
  assert.ok(body.events.some((e) => e.cat === "noschool" && e.t === null));
});

test("bad requests: unknown school, bad dates, end before start", async () => {
  for (const q of [{ school: "lincoln", start: "2026-10-01", end: "2026-10-31" }, { school: "bvhs", start: "10/01/2026", end: "2026-10-31" }, { school: "bvhs", start: "2026-10-31", end: "2026-10-01" }]) {
    assert.strictEqual((await events.handler({ queryStringParameters: q })).statusCode, 400, JSON.stringify(q));
  }
});

/* ---------- attribution ---------- */

test("a Brandon Elementary-tagged entry lands only on bes", () => {
  const named = BOUND.filter((f) => { const t = tagsOf(f); return t.includes("Brandon Elementary") && !t.some((x) => /Elementary$/.test(x) && x !== "Brandon Elementary"); });
  assert.ok(named.length > 0, "fixture has none");
  for (const f of named) {
    assert.ok(shape(f, "bes"), `bes dropped ${f.SUMMARY}`);
    for (const s of ["bve", "fae", "ies", "rbe", "bvis", "bvms", "bvhs"]) assert.strictEqual(shape(f, s), null, `${s} kept ${f.SUMMARY}`);
  }
});

test("'Elementary Events' alone reaches all five elementaries and no secondary school", () => {
  const blanket = BOUND.filter((f) => { const t = tagsOf(f); return t.includes("Elementary Events") && !t.some((x) => /Elementary$/.test(x)) && !/\b(BE|FAE|IES|RBE)\b|Brandon Elementary|Fred Assam|Inspiration|Robert Bennis|Burkman/.test(f.SUMMARY); });
  assert.ok(blanket.length > 0, "fixture has none");
  for (const f of blanket) {
    for (const s of ELEM) assert.ok(shape(f, s), `${s} dropped ${f.SUMMARY}`);
    for (const s of ["bvis", "bvms", "bvhs"]) assert.strictEqual(shape(f, s), null, `${s} kept ${f.SUMMARY}`);
  }
  // A named elementary tag beside the blanket tag narrows it to that school.
  const f = bound({ SUMMARY: "Fall Carnival", "X-BND-TAGS": "Elementary Events,Inspiration Elementary,PTO/PTA" });
  assert.ok(shape(f, "ies"));
  assert.strictEqual(shape(f, "bes"), null);
  // Only the blanket tag, but the school is named in the title.
  const g = bound({ SUMMARY: "BE 3rd Grade Concert", "X-BND-TAGS": "Elementary Events" });
  assert.ok(shape(g, "bes"));
  assert.strictEqual(shape(g, "rbe"), null);
});

test("high-school athletics never reach an elementary; untagged district activities fall to the secondary schools", () => {
  const varsity = BOUND.filter((f) => /^(Varsity|Junior Varsity)$/.test(f["X-BND-ACTIVITYLEVEL"] || ""));
  assert.ok(varsity.length > 20);
  for (const f of varsity) for (const s of ELEM) assert.strictEqual(shape(f, s), null, `${s} kept ${f.SUMMARY}`);
  const hs = varsity.filter((f) => shape(f, "bvhs"));
  assert.ok(hs.length === varsity.length, `${varsity.length - hs.length} varsity entries missing from bvhs`);
  // Grade wording in the title beats a same-named venue: tennis plays on
  // "Brandon Valley Middle School Tennis Courts" but is a high-school program.
  const tennis = bound({ SUMMARY: "Girls Tennis: Brandon Valley vs Harrisburg (Junior Varsity)", LOCATION: "Brandon Valley Middle School Tennis Courts", "X-BND-ACTIVITYKEY": "tennis", "X-BND-ACTIVITYNAME": "Girls Tennis", "X-BND-ACTIVITYLEVEL": "Junior Varsity" });
  assert.ok(shape(tennis, "bvhs"));
  assert.strictEqual(shape(tennis, "bvms"), null);
  // A 7th-grade game is the middle school's wherever it is played.
  const seventh = bound({ SUMMARY: "Volleyball: Brandon Valley vs Watertown (7th Grade C)", LOCATION: "Fred Assam Elementary Gym", "X-BND-ACTIVITYKEY": "volleyball", "X-BND-ACTIVITYNAME": "Volleyball", "X-BND-ACTIVITYLEVEL": "7th Grade C" });
  assert.ok(shape(seventh, "bvms"));
  assert.strictEqual(shape(seventh, "fae"), null);
  assert.strictEqual(shape(seventh, "bvhs"), null);
  // Staff-only entries reach no one.
  assert.strictEqual(shape(bound({ SUMMARY: "New Staff In-Service", "X-BND-TAGS": "School Calendar,Staff Only Events" }), "bvhs"), null);
});

test("Google Calendar entries are the school's own: no attribution test, UTC read as Central", () => {
  const ev = E.shapeEvent({ DTSTART: "DTSTART:20210921T000000Z", DTEND: "DTEND:20210921T020000Z", SUMMARY: "Coronation", UID: "g" }, E.SCHOOLS.bvhs, null);
  assert.strictEqual(ev.d, "2021-09-20");
  assert.strictEqual(ev.t, "19:00");
  assert.strictEqual(ev.e, "21:00");
  assert.strictEqual(ev.cat, "school");
  assert.ok(!ev.lt, "no 'local time' note for UTC stamps");
  // Exclusive DTEND on a one-day all-day entry is not a second day.
  const day = E.shapeEvent({ DTSTART: "DTSTART;VALUE=DATE:20220103", DTEND: "DTEND;VALUE=DATE:20220104", SUMMARY: "School Resumes", UID: "g2" }, E.SCHOOLS.bvhs, null);
  assert.strictEqual(day.to, undefined);
  const span = E.shapeEvent({ DTSTART: "DTSTART;VALUE=DATE:20261125", DTEND: "DTEND;VALUE=DATE:20261128", SUMMARY: "Thanksgiving Break - No School", UID: "g3" }, E.SCHOOLS.bvhs, null);
  assert.strictEqual(span.to, "2026-11-27");
  assert.strictEqual(span.cat, "noschool");
});

/* ---------- grades, home/away, cancellation, categories ---------- */

test("grades from team levels: '(Girls Varsity)' is 9-12, '7th Grade C' is 7, 'Junior Varsity' is 9-11", () => {
  assert.deepStrictEqual(E.gradesFor("Girls Wrestling: Okoboji Invitational (Girls Varsity)", "Girls Varsity", []), [9, 10, 11, 12]);
  assert.deepStrictEqual(E.gradesFor("Volleyball: Watertown vs Brandon Valley (7th Grade C)", "7th Grade C", []), [7]);
  assert.deepStrictEqual(E.gradesFor("Girls Tennis: Brandon Valley vs Harrisburg (Junior Varsity)", "Junior Varsity", []), [9, 10, 11]);
  assert.deepStrictEqual(E.gradesFor("Spring Sports Concussion Testing (Grades 9 & 11 & New BV Students)", "", []), [9, 11]);
  assert.deepStrictEqual(E.gradesFor("Cap and Gown Pictures", "", ["Senior Class"]), [12]);
  assert.strictEqual(E.gradesFor("Homecoming Parade", "", []), null);
  assert.strictEqual(E.gradesFor, GRADES.gradesFor, "the relay and the app share one gradesFor");
  const gv = shape(bound({ SUMMARY: "Girls Wrestling: Okoboji Girls Wrestling Invitational (Girls Varsity)", LOCATION: "Okoboji High School Gym", "X-BND-ACTIVITYKEY": "wrestling", "X-BND-ACTIVITYNAME": "Girls Wrestling", "X-BND-ACTIVITYLEVEL": "Girls Varsity" }), "bvhs");
  assert.deepStrictEqual(gv.g, [9, 10, 11, 12]);
  assert.strictEqual(gv.level, "Girls Varsity");
  assert.strictEqual(gv.title, "Girls Wrestling: Okoboji Girls Wrestling Invitational", "level moves out of the title into its own field");
  const sev = shape(bound({ SUMMARY: "Volleyball: Watertown vs Brandon Valley (7th Grade C)", LOCATION: "Brandon Valley Middle School West Gym", "X-BND-ACTIVITYKEY": "volleyball", "X-BND-ACTIVITYNAME": "Volleyball", "X-BND-ACTIVITYLEVEL": "7th Grade C" }), "bvms");
  assert.deepStrictEqual(sev.g, [7]);
});

test("home/away comes from the venue, never from 'A vs B' order", () => {
  const game = (loc) => shape(bound({ SUMMARY: "Volleyball: Watertown vs Brandon Valley (7th Grade C)", LOCATION: loc, "X-BND-ACTIVITYKEY": "volleyball", "X-BND-ACTIVITYNAME": "Volleyball", "X-BND-ACTIVITYLEVEL": "7th Grade C" }), "bvms");
  const home = game("Brandon Valley Middle School West Gym");
  assert.strictEqual(home.home, true);
  assert.strictEqual(home.title, "Volleyball: Brandon Valley vs Watertown");
  const away = game("Watertown Middle School Gym");
  assert.strictEqual(away.home, false);
  assert.strictEqual(away.title, "Volleyball: Brandon Valley at Watertown");
  // Brandon's own parks host too.
  const park = shape(bound({ SUMMARY: "Softball: Brandon Valley vs Harrisburg (Varsity)", LOCATION: "Aspen Park Field 1", "X-BND-ACTIVITYKEY": "softball", "X-BND-ACTIVITYNAME": "Softball", "X-BND-ACTIVITYLEVEL": "Varsity" }), "bvhs");
  assert.strictEqual(park.home, true);
  // Meetings and picture days get no badge, and no venue means no badge.
  assert.strictEqual(shape(bound({ SUMMARY: "VB Team Meals", LOCATION: "Brandon Valley High School Commons", "X-BND-TAGS": "Team Meals" }), "bvhs").home, undefined);
  assert.strictEqual(game("").home, undefined);
});

test("cancellations: STATUS or a 'CANCELLED - ' / 'POSTPONED - ' prefix set x and clean the title", () => {
  const a = shape(bound({ SUMMARY: "CANCELLED - Girls Basketball: Memorial MS vs Brandon Valley (7th Grade D)", STATUS: "CANCELLED", LOCATION: "Brandon Valley Middle School East Gym", "X-BND-ACTIVITYKEY": "basketball", "X-BND-ACTIVITYNAME": "Girls Basketball", "X-BND-ACTIVITYLEVEL": "7th Grade D" }), "bvms");
  assert.strictEqual(a.x, 1);
  assert.strictEqual(a.title, "Girls Basketball: Brandon Valley vs Memorial MS");
  const b = shape(bound({ SUMMARY: "POSTPONED - Football: Brandon Valley vs Harrisburg (Varsity)", LOCATION: "Brandon Valley High School Stadium", "X-BND-ACTIVITYKEY": "football", "X-BND-ACTIVITYNAME": "Football", "X-BND-ACTIVITYLEVEL": "Varsity" }), "bvhs");
  assert.strictEqual(b.x, 1);
  assert.ok(!/POSTPONED/.test(b.title));
  const c = shape(bound({ SUMMARY: "Football: Brandon Valley vs Harrisburg (Varsity)", STATUS: "CONFIRMED", LOCATION: "Brandon Valley High School Stadium", "X-BND-ACTIVITYKEY": "football", "X-BND-ACTIVITYNAME": "Football", "X-BND-ACTIVITYLEVEL": "Varsity" }), "bvhs");
  assert.strictEqual(c.x, undefined);
  // The feed marks a cancelled game the same way.
  assert.match(E.toIcs([a], "BV Middle School", "x"), /SUMMARY:CANCELLED: Girls Basketball/);
});

test("categories and placeholder times: no school, practice, college, academic, school", () => {
  const at = (summary, over = {}) => shape(bound({ SUMMARY: summary, "X-BND-TAGS": "High School Events", ...over }), "bvhs");
  const labor = at("Labor Day - No School", { DTSTART: "DTSTART;TZID=America/Chicago:20260907T070000", DTEND: "DTEND;TZID=America/Chicago:20260907T153000", "X-BND-TAGS": "Elementary Events,High School Events,Middle School Events,Intermediate School Events" });
  assert.strictEqual(labor.cat, "noschool");
  assert.strictEqual(labor.t, null, "7:00 AM is Bound's placeholder");
  assert.strictEqual(labor.e, undefined);
  assert.strictEqual(at("BV Boys/Girls Dance Practice").cat, "practice");
  assert.strictEqual(at("Jostens Meeting with Sophomores During TEAM Times").cat, "college");
  assert.deepStrictEqual(at("Jostens Meeting with Sophomores During TEAM Times").g, [10]);
  assert.strictEqual(at("HS Semester Tests").cat, "academic");
  assert.strictEqual(at("PSAT - Community Room").cat, "academic");
  assert.deepStrictEqual(at("PSAT - Community Room").g, [10, 11]);
  assert.strictEqual(at("HS Conferences").cat, "academic");
  assert.strictEqual(at("Homecoming Parade").cat, "school");
  const game = at("Football: Brandon Valley vs Harrisburg (Varsity)", { LOCATION: "Brandon Valley High School Stadium", "X-BND-ACTIVITYKEY": "football", "X-BND-ACTIVITYNAME": "Football", "X-BND-ACTIVITYLEVEL": "Varsity", URL: "https://gobound.com/direct/comps/abc/show", GEO: "43.592320;-96.573310" });
  assert.strictEqual(game.cat, "activity");
  assert.strictEqual(game.url, "https://gobound.com/direct/comps/abc/show");
  assert.strictEqual(game.geo, "43.59232,-96.57331");
  assert.strictEqual(game.t, "16:00");
  assert.strictEqual(game.e, "16:45");
  // Team business written with the program's abbreviation follows the team.
  const meal = at("Var FB Meal", { "X-BND-TAGS": "Team Meals" });
  assert.strictEqual(meal.act, "Football");
  assert.strictEqual(meal.cat, "activity");
  // Program names fold: "Boys Golf (Fall)" is Boys Golf; "Volleyball, Girls" is Volleyball.
  assert.strictEqual(E.normalizeActivity("Boys Golf (Fall)"), "Boys Golf");
  assert.strictEqual(E.normalizeActivity("Volleyball, Girls"), "Volleyball");
  const golf = at("Boys Golf (Fall): BV JV Invite", { LOCATION: "Hidden Valley Golf Course", "X-BND-ACTIVITYKEY": "golf", "X-BND-ACTIVITYNAME": "Boys Golf (Fall)", "X-BND-ACTIVITYLEVEL": "Junior Varsity" });
  assert.strictEqual(golf.act, "Boys Golf");
  assert.strictEqual(golf.title, "Boys Golf: BV JV Invite");
  // Windows zone names are Central too.
  assert.strictEqual(at("Girls Cross Country: Metro Meet (7th Grade)", { DTSTART: "DTSTART;TZID=Central Standard Time:20251016T160000", "X-BND-TAGS": "", "X-BND-ACTIVITYNAME": "Girls Cross Country", "X-BND-ACTIVITYLEVEL": "7th Grade" }), null, "a 7th-grade meet is not the high school's");
  assert.strictEqual(shape(bound({ SUMMARY: "Girls Cross Country: Metro Meet (7th Grade)", DTSTART: "DTSTART;TZID=Central Standard Time:20251016T160000", "X-BND-ACTIVITYKEY": "crosscountry", "X-BND-ACTIVITYNAME": "Girls Cross Country", "X-BND-ACTIVITYLEVEL": "7th Grade" }), "bvms").t, "16:00");
});

test("ids are the first app's ids (date|title as shown, base36), so saved corrections and calendar UIDs carry over", async () => {
  assert.strictEqual(E.legacyId("2026-10-02|Football: Brandon Valley vs Harrisburg (Varsity)"), "rg6kzk");
  const all = await events.loadSchool("bvhs");
  const game = all.find((e) => e.d === "2026-10-02" && e.title === "Football: Brandon Valley vs Harrisburg" && e.level === "Varsity");
  assert.ok(game, "fixture game missing");
  assert.strictEqual(game.id, "rg6kzk");
  // Every id is short base36 and unique within a school.
  assert.ok(all.every((e) => /^[0-9a-z]{1,7}$/.test(e.id)));
  assert.strictEqual(new Set(all.map((e) => e.id)).size, all.length, "duplicate ids");
});

/* ---------- loadSchool: merge, dedupe, overrides ---------- */

test("loadSchool merges the school's Google Calendar with its Bound entries, a day off listed once", async () => {
  const all = await events.loadSchool("bvhs");
  assert.ok(all.some((e) => e.d < "2023" && e.cat === "school"), "Google entries missing");
  assert.ok(all.some((e) => e.d >= "2026-10-01" && e.act), "Bound entries missing");
  const offDays = all.filter((e) => e.cat === "noschool").map((e) => e.d);
  assert.strictEqual(new Set(offDays).size, offDays.length, "a day off listed twice");
  for (let i = 1; i < all.length; i++) assert.ok((all[i - 1].d + (all[i - 1].t || "")) <= (all[i].d + (all[i].t || "")), "not sorted");
  // A school whose Google Calendar is unreachable still gets its Bound entries.
  const ies = await events.loadSchool("ies");
  assert.ok(ies.length > 5, `ies has ${ies.length}`);
  assert.ok(ies.every((e) => !e.act || !/Varsity|Junior Varsity/.test(e.level || "")), "HS athletics on an elementary");
  assert.ok(ies.some((e) => e.cat === "noschool"));
});

test("owner corrections from the Blobs list hide an event by id (and retitle, re-grade, re-target)", async () => {
  const before = await events.loadSchool("bvhs");
  const game = before.find((e) => e.id === "rg6kzk");
  const other = before.find((e) => e.cat === "school" && !e.g);
  assert.ok(game && other);
  const store = openStore("overrides");
  await store.set("events", [
    { id: "rg6kzk", hide: true },
    { id: other.id, title: "Renamed by the owner", grades: [11, 12], act: "Football" },
    { id: "nope", hide: true },
  ]);
  E.resetOverrides();
  try {
    const after = await events.loadSchool("bvhs");
    assert.ok(!after.some((e) => e.id === "rg6kzk"), "hidden event still served");
    const fixed = after.find((e) => e.id === other.id);
    assert.strictEqual(fixed.title, "Renamed by the owner");
    assert.deepStrictEqual(fixed.g, [11, 12]);
    assert.strictEqual(fixed.act, "Football");
    assert.strictEqual(fixed.cat, "activity");
    assert.strictEqual(after.length, before.length - 1);
    // The feeds and the JSON both go through loadSchool, so the hide holds there too.
    const r = await events.handler({ queryStringParameters: { school: "bvhs", start: "2026-10-01", end: "2026-10-31" }, headers: {} });
    assert.ok(!JSON.parse(r.body).events.some((e) => e.id === "rg6kzk"));
    const ics = await events.handler({ rawUrl: "https://brandonvalleylunch.com/feed/bvhs/all/all/calendar.ics", queryStringParameters: {} });
    assert.ok(!/rg6kzk/.test(ics.body));
  } finally {
    await store.set("events", []);
    E.resetOverrides();
  }
  assert.ok((await events.loadSchool("bvhs")).some((e) => e.id === "rg6kzk"), "override did not clear");
});

/* ---------- list=activities, feeds, ics ---------- */

test("list=activities: { school, activities:[{ act, n, levels }] } for the range", async () => {
  const r = await events.handler({ queryStringParameters: { school: "bvhs", start: "2026-10-01", end: "2026-10-31", list: "activities" }, headers: {} });
  assert.strictEqual(r.statusCode, 200);
  const body = JSON.parse(r.body);
  assert.deepStrictEqual(Object.keys(body), ["school", "activities"]);
  assert.ok(body.activities.length > 5);
  for (const a of body.activities) {
    assert.deepStrictEqual(Object.keys(a), ["act", "n", "levels"]);
    assert.ok(a.n > 0 && Array.isArray(a.levels));
  }
  const fb = body.activities.find((a) => a.act === "Football");
  assert.ok(fb && fb.levels.includes("Varsity"), JSON.stringify(fb));
  assert.ok(!body.activities.some((a) => /\(Fall\)|, Girls$/.test(a.act)), "unfolded program names");
  // The mirror's list: every program from the whole feed, one-offs dropped.
  const acts = await events.activitiesFor("bvhs");
  assert.ok(acts.includes("Football") && acts.includes("Volleyball"));
  assert.deepStrictEqual(acts, acts.slice().sort());
  assert.deepStrictEqual(await events.activitiesFor("bes"), []);
});

test("legacy feed path: /feed/<linq|slug>/<grade|all>/<acts|all|none>/calendar.ics with none and only=1", async () => {
  const linq = DATA.SCHOOLS.bvhs.linq;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const SH = require(path.join(ROOT, "shared.js"));
  const start = SH.addDays(today, -14), end = SH.addDays(today, 400);
  const window = (await events.loadSchool("bvhs")).filter((e) => E.inRange(e, start, end));
  const count = (body) => (body.match(/BEGIN:VEVENT/g) || []).length;
  // all/all: the whole school.
  const all = await events.handler({ rawUrl: `https://brandonvalleylunch.com/feed/${linq}/all/all/calendar.ics`, queryStringParameters: {} });
  assert.strictEqual(all.statusCode, 200);
  assert.strictEqual(all.headers["Content-Type"], "text/calendar; charset=utf-8");
  assert.strictEqual(count(all.body), window.length);
  assert.match(all.body, /X-WR-CALNAME:BV High School\r\n/);
  // none: no activity events at all (the per-grade mirrored calendars).
  const none = await events.handler({ rawUrl: `https://brandonvalleylunch.com/feed/${linq}/10/none/calendar.ics`, queryStringParameters: {} });
  assert.strictEqual(count(none.body), window.filter((e) => !e.act && (!e.g || e.g.includes(10))).length);
  assert.match(none.body, /X-WR-CALNAME:10th grade · BV High School/);
  assert.ok(!/SUMMARY:Football:/.test(none.body));
  // only=1: nothing but the named activity (the per-activity mirrored calendars).
  const only = await events.handler({ rawUrl: `https://brandonvalleylunch.com/feed/${linq}/all/Football/calendar.ics?only=1`, queryStringParameters: { only: "1" } });
  assert.strictEqual(count(only.body), window.filter((e) => e.act === "Football").length);
  assert.match(only.body, /X-WR-CALNAME:Football · BV High School/);
  assert.ok(count(only.body) > 3);
  // only=1 read off the address when the query string is not passed on.
  const only2 = await events.handler({ rawUrl: `https://brandonvalleylunch.com/feed/${linq}/all/Football/calendar.ics?only=1`, queryStringParameters: {} });
  assert.strictEqual(count(only2.body), count(only.body));
  // Named activities without only=1: the child's rule (their grade, their teams, everything else).
  const kid = await events.handler({ rawUrl: `https://brandonvalleylunch.com/feed/${linq}/9/${encodeURIComponent("Football,Boys Cross Country")}/calendar.ics`, queryStringParameters: {} });
  assert.strictEqual(count(kid.body), window.filter((e) => events.allowsFor(e, 9, ["Football", "Boys Cross Country"])).length);
  assert.ok(!/SUMMARY:Volleyball:/.test(kid.body));
  assert.match(kid.body, /X-WR-CALNAME:9th grade · BV High School/);
  // The slug works in place of the LINQ id; an unknown school is 404.
  const slug = await events.handler({ rawUrl: "https://brandonvalleylunch.com/feed/bvms/7/all/calendar.ics", queryStringParameters: {} });
  assert.strictEqual(slug.statusCode, 200);
  assert.match(slug.body, /X-WR-CALNAME:7th grade · BV Middle School/);
  assert.strictEqual((await events.handler({ rawUrl: "https://brandonvalleylunch.com/feed/lincoln/all/all/calendar.ics", queryStringParameters: {} })).statusCode, 404);
  // Legacy UIDs, so the owner's Google mirror updates events in place.
  const uids = all.body.match(/^UID:.*$/gm);
  assert.ok(uids.length === window.length && uids.every((u) => /^UID:\d{8}-[0-9a-z]{1,7}@brandonvalleylunch\.com$/.test(u)), uids[0]);
  assert.ok(all.body.includes("UID:20261002-rg6kzk@brandonvalleylunch.com"));
});

test("template feed path: base64url(school=&classOf=&follows=) uses the app's own rules", async () => {
  const q = Buffer.from("school=bvhs&classOf=2030&follows=Football").toString("base64url");
  const r = await events.handler({ rawUrl: `https://brandonvalleylunch.com/feed/${q}/calendar.ics`, queryStringParameters: {} });
  assert.strictEqual(r.statusCode, 200);
  assert.match(r.body, /X-WR-CALNAME:BV High School\\, class of 2030/);
  assert.ok(/SUMMARY:Football: Brandon Valley/.test(r.body), "followed team missing");
  assert.ok(!/SUMMARY:Volleyball:/.test(r.body), "unfollowed team present");
  assert.ok(/SUMMARY:No school: /.test(r.body), "district days off missing");
  // Grade filter: a freshman's feed has no senior-only entries.
  assert.ok(!/SUMMARY:Senior /.test(r.body));
  // ICS style shared by both feed paths.
  for (const body of [r.body]) {
    assert.ok(body.startsWith("BEGIN:VCALENDAR\r\n"));
    assert.ok(body.includes("BEGIN:VTIMEZONE\r\nTZID:America/Chicago"));
    assert.ok(/DTSTART;TZID=America\/Chicago:\d{8}T\d{6}/.test(body));
    assert.ok(body.split("\r\n").every((l) => Buffer.byteLength(l) <= 75), "unfolded line");
  }
  // A grade outside the school is refused.
  const bad = Buffer.from("school=bes&classOf=2027&follows=").toString("base64url");
  assert.strictEqual((await events.handler({ rawUrl: `https://brandonvalleylunch.com/feed/${bad}/calendar.ics`, queryStringParameters: {} })).statusCode, 400);
});

test("format=ics: picked ids, and the custom one-off date", async () => {
  const r = await events.handler({ queryStringParameters: { school: "bvhs", start: "2026-10-01", end: "2026-10-31", format: "ics", ids: "rg6kzk" } });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual((r.body.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.match(r.body, /SUMMARY:Football: Brandon Valley vs Harrisburg\r\n/);
  assert.match(r.body, /DESCRIPTION:BV High School\\, Varsity/);
  assert.match(r.headers["Content-Disposition"], /bvhs-events\.ics/);
  const c = await events.handler({ queryStringParameters: { format: "ics", custom: "1", start: "2026-12-23", end: "2027-01-01", title: "Winter break" } });
  assert.match(c.body, /DTSTART;VALUE=DATE:20261223\r\nDTEND;VALUE=DATE:20270102/);
  assert.match(c.body, /DESCRIPTION:Brandon Valley School District/);
});

/* ---------- resilience ---------- */

test("a bot challenge or a 503 from the sources serves the saved copy", async () => {
  await events.loadSchool("bvhs"); // saves both copies
  const n = (await events.loadSchool("bvhs")).length;
  mode = "challenge";
  try {
    const a = await events.loadSchool("bvhs", { force: true });
    assert.strictEqual(a.length, n, "challenge changed the calendar");
    mode = "down";
    const b = await events.loadSchool("bvhs", { force: true });
    assert.strictEqual(b.length, n, "503 changed the calendar");
    const r = await events.handler({ queryStringParameters: { school: "bvhs", start: "2026-10-01", end: "2026-10-31" }, headers: {} });
    assert.strictEqual(r.statusCode, 200);
    // A school never loaded before still gets the district's saved Bound copy.
    const fresh = await events.handler({ queryStringParameters: { school: "bve", start: "2026-10-01", end: "2026-10-31" }, headers: {} });
    assert.strictEqual(fresh.statusCode, 200);
    assert.ok(JSON.parse(fresh.body).events.length > 0);
    // With nothing saved at all, the failure is a clean 502, not an empty calendar.
    for (const f of fs.readdirSync(process.env.SFP_CACHE_DIR)) if (/^(bound|gcal)-/.test(f)) fs.rmSync(path.join(process.env.SFP_CACHE_DIR, f));
    const none = await events.handler({ queryStringParameters: { school: "bvhs", start: "2026-10-01", end: "2026-10-31" }, headers: {} });
    assert.strictEqual(none.statusCode, 502);
    assert.strictEqual(none.headers["Cache-Control"], "no-store");
  } finally { mode = "fixtures"; }
  assert.ok((await events.loadSchool("bvhs")).length === n, "did not recover once the sources were back");
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (err) { failed++; console.log(`  FAIL ${name}\n       ${String(err.message).split("\n").slice(0, 6).join("\n       ")}`); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} events tests passed`);
  process.exit(failed ? 1 : 0);
})();
