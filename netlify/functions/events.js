/* Relay for each Brandon Valley school's calendar: the school's public
 * Google Calendar merged with the district's Bound (gobound.com) activities
 * calendar. Neither allows cross-origin browser fetches and Bound runs
 * 1.5 MB, so this trims them to compact JSON for a date range. Responses
 * are CDN-cached, so the sources are hit a few times an hour at most.
 *
 * GET /.netlify/functions/events?school=bvhs&start=YYYY-MM-DD&end=YYYY-MM-DD
 * GET /.netlify/functions/events?school=bvhs&start=..&end=..&format=ics&ids=a,b
 * GET /.netlify/functions/events?school=bvhs&start=..&end=..&list=activities
 *
 * Bound is one district-wide feed; its building tags (and, failing those,
 * the wording of the title and venue) say which school an entry is for.
 *
 * Times stay in Brandon local time as plain strings ("2026-10-03",
 * "19:00"): Bound publishes America/Chicago stamps and Google publishes
 * UTC; both are read as the Central wall time and never shifted again, so
 * no server time zone can move a game to the wrong day.
 */

const SHARED = require("../../shared.js");
const SFDATA = require("../../data.js");
// Grade semantics shared with the app (one copy, so a title always means
// the same grades on both sides): team levels, class tags, activity shapes.
const GRADES = require("../../grades.js");
const { gradesFor, activityName, isActivity } = GRADES;

const DISTRICT = SFDATA.DISTRICT;

// Every building from data.js: Google Calendar, LINQ id (the id existing
// calendar subscriptions and the Google mirror use), Bound building tags.
const SCHOOLS = Object.fromEntries(Object.values(SFDATA.SCHOOLS).map((s) => [s.id, {
  id: s.id, linq: s.linq, gcal: s.gcal, name: s.name, short: s.short, level: s.level, grades: s.grades, tags: s.boundTags || [],
}]));
const SCHOOL_NAMES = Object.fromEntries(Object.values(SCHOOLS).map((s) => [s.id, s.name]));
const LINQ_TO_ID = Object.fromEntries(Object.values(SCHOOLS).filter((s) => s.linq).map((s) => [s.linq, s.id]));
const ELEMENTARY = Object.values(SCHOOLS).filter((s) => s.level === "es").map((s) => s.id);
// Elementary buildings shouldn't inherit secondary-school athletics.
const SECONDARY = new Set(Object.values(SCHOOLS).filter((s) => s.level !== "es").map((s) => s.id));

// Bound's building tags -> the schools they mean ("Elementary Events" is
// shared by the five elementaries).
const TAG_SCHOOLS = {};
for (const s of Object.values(SCHOOLS)) for (const tag of s.tags) (TAG_SCHOOLS[tag] = TAG_SCHOOLS[tag] || []).push(s.id);

// Wording that names a building, for Bound entries without a building tag.
// Case-sensitive on purpose: the abbreviations (BE, IES, MS, HS) would
// match ordinary words otherwise. "Middle School"/"High School" alone are
// too generic for the venue half of the title+venue test (an away match at
// "Luverne High School" would land on our high school), so our own campus
// name is required; BVMS/BVHS and the grade markers are specific enough.
const SCHOOL_MATCHERS = {
  bes: /Brandon Elementary|\bBE /,
  bve: /Burkman/,
  fae: /Fred Assam|\bFAE\b/,
  ies: /Inspiration|\bIES\b|\bIE /,
  rbe: /Robert Bennis|\bRBE\b/,
  bvis: /Intermediate|\bBVIS\b/,
  bvms: /Brandon Valley Middle School|\bBVMS\b|\bMS |\((?:7th|8th)[^)]*\)/,
  bvhs: /Brandon Valley High School|\bBVHS\b|\bHS |\((?:Junior Varsity|Varsity|Sophomore|Freshman|9[AB])[^)]*\)|\b(?:Var|9th) /,
};
for (const id of Object.keys(SCHOOL_MATCHERS)) if (!SCHOOLS[id]) throw new Error(`events.js: SCHOOL_MATCHERS names ${id}, not in data.js`);
// Titles carrying a secondary grade level, wherever the event is played.
const SECONDARY_EVENT = /\((?:7th|8th|9th|Junior Varsity|Varsity|Sophomore|Freshman|Middle School|9[AB])[^)]*\)|\bMS\b|\bHS\b|Middle School|High School/;

// Home venues. The title order is NOT a home/away signal (Bound lists
// "Brandon Valley vs Yankton" for a game played at Yankton), so the venue
// is the only reliable indicator. Aspen Park and McHardy Park are Brandon's
// own fields (baseball/softball and cross country host there).
const HOME_VENUE = /brandon valley|aspen park|mchardy park/i;
// Only competitions get a home/away badge; meetings and picture day don't.
const COMPETITION = /\svs\s|invite|invitational|tournament|jamboree|meet\b|classic|championship|scrimmage|quadrangular|triangular|dual\b/i;

const NO_SCHOOL = /\bno school\b/i;
const PRACTICE = /\bpractice\b|\brehearsal\b|open gym/i;
const COLLEGE = /\bVisit\b|College|University|Financial Aid|FAFSA|Scholarship|Career|Marine Corps|\bArmy\b|\bNavy\b|Air Force|National Guard|Jostens/i;
const ACADEMIC = /\bACT\b|PSAT|\bTest(?:ing|s)?\b|Conferences?\b|Graduation|Commencement|Orientation|Registration|Picture|Tutor|Quarter|Semester/i;

// Bound names the same program more than one way ("Volleyball, Girls",
// "Boys Golf (Fall)"); fold them so following one catches every entry.
function normalizeActivity(name) {
  return name
    .replace(/^(.+),\s*(Boys|Girls)$/, "$2 $1")
    .replace(/^(Boys|Girls) Cross Country Running$/, "$1 Cross Country")
    .replace(/^Girls Volleyball$/, "Volleyball")
    .replace(/^Boys Football$/, "Football")
    .replace(/\s*\((?:Fall|Spring|Winter)\)$/, "")
    .trim();
}

// Bound writes matchups as "A vs B" in an order that does not say who
// hosts. Rewrite them the way a team's own schedule reads: Brandon Valley
// first, "vs" when hosting and "at" when travelling.
function orientMatchup(title, home) {
  if (home === undefined) return title;
  const m = title.match(/^(.*?:\s*)?(.+?)\s+vs\.?\s+(.+?)(\s*\([^)]*\))?$/i);
  if (!m) return title;
  const prefix = m[1] || "", a = m[2].trim(), b = m[3].trim(), suffix = m[4] || "";
  const aIsBV = /brandon valley/i.test(a), bIsBV = /brandon valley/i.test(b);
  const joiner = home ? " vs " : " at ";
  if (aIsBV === bIsBV) return title.replace(/\s+vs\.?\s+/i, joiner);
  const bv = aIsBV ? a : b, other = aIsBV ? b : a;
  return `${prefix}${bv}${joiner}${other}${suffix}`;
}

function unfold(text) {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}
// Staff sometimes paste a link into the title: "Pigskin Classic (https://...)".
function unescapeIcs(v) {
  return v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1")
    .replace(/\s*\(\s*https?:\/\/[^)]*\)/gi, "")
    .replace(/\s*https?:\/\/\S+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    // "Competition - https://..." leaves a dangling dash once the link goes.
    .replace(/\s*[-\u2013:]$/, "");
}

// Stable short id per event (the app asks for specific ones in .ics, the
// owner's corrections name them, and subscribed calendars key on them).
// Same hash and input as the first Brandon Valley app (date|title as
// shown), so ids, calendar UIDs and saved corrections carry over.
function legacyId(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 7);
}
function hashId(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// "20261003T200000" -> { d: "2026-10-03", t: "20:00", stamp: "200000" }
function parseStamp(line) {
  const v = line.slice(line.lastIndexOf(":") + 1).trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
  if (!m) return null;
  const d = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4] || /VALUE=DATE[:;]/.test(line)) return { d, t: null, stamp: null, date: true };
  // Bound stamps games in the venue's zone; Google publishes UTC.
  const tz = /Z$/.test(v) ? "UTC" : zoneName((line.match(/TZID="?([^:;"]+)/) || [])[1]);
  return { d, t: `${m[4]}:${m[5]}`, stamp: `${m[4]}${m[5]}${m[6]}`, tz };
}

// Bound mixes IANA names ("America/Denver") with Windows ones ("Central
// Standard Time"). Anything unrecognized is treated as Brandon time, so an
// odd label can never take a calendar down.
const WINDOWS_ZONES = { "Central Standard Time": "America/Chicago", "Mountain Standard Time": "America/Denver", "US Mountain Standard Time": "America/Phoenix", "Eastern Standard Time": "America/New_York", "Pacific Standard Time": "America/Los_Angeles" };
function zoneName(z) {
  if (!z) return "America/Chicago";
  const name = WINDOWS_ZONES[z.trim()] || z.trim();
  try { new Intl.DateTimeFormat("en-US", { timeZone: name }); return name; } catch { return "America/Chicago"; }
}

// A wall-clock time in another zone -> the same moment in Brandon.
function zoneOffset(zone, ms) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms));
  const g = (k) => Number(p.find((x) => x.type === k).value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - ms;
}
function toCentral(st) {
  const [y, mo, da] = st.d.split("-").map(Number);
  const wall = Date.UTC(y, mo - 1, da, +st.stamp.slice(0, 2), +st.stamp.slice(2, 4), +st.stamp.slice(4, 6));
  const instant = st.tz === "UTC" ? wall : wall - zoneOffset(st.tz, wall - zoneOffset(st.tz, wall));
  const c = new Date(instant + zoneOffset("America/Chicago", instant)).toISOString();
  return { d: c.slice(0, 10), t: c.slice(11, 16), stamp: c.slice(11, 19).replace(/:/g, ""), tz: "America/Chicago" };
}
const ZONE_NAMES = { "America/Denver": "MT", "America/Boise": "MT", "America/Phoenix": "MT", "America/New_York": "ET", "America/Los_Angeles": "PT" };

function parseIcs(text) {
  const out = [];
  for (const block of unfold(text).split("BEGIN:VEVENT").slice(1)) {
    const body = block.split("END:VEVENT")[0];
    const f = {};
    for (const line of body.split("\n")) {
      const m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/);
      if (!m) continue;
      if (m[1] === "DTSTART" || m[1] === "DTEND") f[m[1]] = line;
      else f[m[1]] = m[3];
    }
    if (f.DTSTART) out.push(f);
  }
  return out;
}

// Bound's own fields on each event: the program, the team level, and tags
// naming the building(s) and class(es) it is for. Far more reliable than
// the title, when present (Google Calendar events have none of this).
function boundFields(f) {
  const tags = unescapeIcs(f["X-BND-TAGS"] || "").split(",").map((t) => t.trim()).filter(Boolean);
  const url = String(f.URL || "").trim();
  return {
    act: normalizeActivity(unescapeIcs(f["X-BND-ACTIVITYNAME"] || "")),
    level: unescapeIcs(f["X-BND-ACTIVITYLEVEL"] || ""),
    tags,
    url: /^https:\/\/(?:www\.)?gobound\.com\//.test(url) ? url : "",
  };
}

// Could a student in this school's grade span be on the list?
function fitsSchool(grades, schoolId) {
  const span = SCHOOLS[schoolId] && SCHOOLS[schoolId].grades;
  if (!grades || !span) return true;
  return grades.some((g) => g >= span[0] && g <= span[1]);
}

// A Bound event belongs to this school if its tags say so, or it names the
// school, or (for secondary schools) it's a district activity that no
// other building claims.
function makeKeep(school) {
  const mine = SCHOOL_MATCHERS[school];
  const others = Object.entries(SCHOOL_MATCHERS)
    .filter(([id]) => id !== school && SECONDARY.has(id) !== SECONDARY.has(school))
    .map(([, rx]) => rx);
  return (title, where, fields) => {
    const t = `${title} ${where}`;
    const tags = (fields && fields.tags) || [];
    if (tags.includes("Staff Only Events")) return false;
    // Grade wording (title, team level, class tags) is authoritative over
    // the venue AND the "no one else claims it" fallback below: a
    // "(Middle School)" match belongs only to a building with grades 7-8.
    if (!fitsSchool(gradesFor(title, fields && fields.level, tags), school)) return false;
    // The feed's own building tags settle it when present. A named
    // elementary tag is more specific than the blanket "Elementary Events"
    // tag that usually rides along with it, so the named ones win.
    const tagged = tags.filter((tag) => TAG_SCHOOLS[tag]);
    if (tagged.length) {
      const named = tagged.filter((tag) => tag !== "Elementary Events");
      if (named.length) return named.some((tag) => TAG_SCHOOLS[tag].includes(school));
      // Only the blanket tag: a school named in the title ("BE 3rd Grade
      // Concert") still narrows it to that school.
      const inTitle = Object.entries(SCHOOL_MATCHERS).filter(([id, rx]) => ELEMENTARY.includes(id) && rx.test(title));
      if (inTitle.length) return inTitle.some(([id]) => id === school);
      return ELEMENTARY.includes(school);
    }
    // Grade level beats venue: a 7th-grade game played on an elementary
    // field is still a middle-school event.
    if (!SECONDARY.has(school) && SECONDARY_EVENT.test(title)) return false;
    if (mine && mine.test(t)) return true;
    if (!SECONDARY.has(school)) return false;
    return !others.some((rx) => rx.test(t)) &&
      !Object.entries(SCHOOL_MATCHERS).some(([id, rx]) => id !== school && rx.test(t));
  };
}

// One parsed VEVENT -> the app's event, or null to drop it. `keep` is the
// school's Bound attribution test (Google entries are the school's own).
function shapeEvent(f, school, keep) {
  let start = parseStamp(f.DTSTART);
  if (!start) return null;
  let end = f.DTEND ? parseStamp(f.DTEND) : null;
  const fields = boundFields(f);
  // Google publishes UTC; Bound's 7:00 AM "school day" placeholder is
  // checked on the published wall time, then real times move to Central.
  let local = null;
  if (start.t && start.tz !== "America/Chicago" && (start.tz === "UTC" || (start.t !== "07:00" && start.t >= "05:00"))) {
    local = { t: start.t, z: ZONE_NAMES[start.tz] || "" };
    start = toCentral(start);
    if (end && end.t) end = toCentral(end);
  }
  let title = unescapeIcs(f.SUMMARY || "");
  if (!title) return null;
  const venue = unescapeIcs(f.LOCATION || "");
  let cancelled = (f.STATUS || "").toUpperCase() === "CANCELLED";
  const cm = title.match(/^(CANCEL+ED|POSTPONED)\s*[-:]\s*/i);
  if (cm) { cancelled = true; title = title.slice(cm[0].length); }
  if (keep && !keep(title, venue, fields)) return null;

  // Competitions: "vs" when the venue is ours, "at" when it isn't.
  const isGame = COMPETITION.test(title);
  const home = isGame && venue ? HOME_VENUE.test(venue) : undefined;
  // The title as the first app showed it (level in parentheses and all):
  // the id hashes this, so saved corrections and calendar UIDs carry over.
  const shown = orientMatchup(title, home);
  const id = legacyId(`${start.d}|${shown}`);

  // A multi-sport meeting is tagged with one program by the feed; it is
  // really for everyone. Titles shaped like a team event ("Volleyball:
  // Brandon Valley vs Marshall (Varsity)") are that team's even without
  // Bound's field (the Google calendars have none).
  let act = /\bSports Meeting\b/i.test(title) ? "" : fields.act;
  if (!act && isActivity(shown)) act = activityName(shown) || "";
  const level = fields.level;
  const g = gradesFor(shown, level, fields.tags);

  // Shown title: the team level moves to its own field (one card per game
  // night, the levels inside), and an empty "()" goes.
  title = shown.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu, "").replace(/\s+/g, " ").trim();
  if (act) {
    title = title.replace(/\s*\(([^()]*)\)$/, (m, inner) => (!inner.trim() || (level && inner.includes(level.slice(0, 6))) ? "" : m));
    // "Boys Golf (Fall): BV JV Invite" -> the season label is the program's, not the event's.
    title = title.replace(/^([^:(]+?)\s*\((?:Fall|Spring|Winter)\)(\s*:)/, "$1$2");
  }
  // "Competition - https://... (Varsity)": once the link and level go, a
  // dash is left hanging.
  title = title.replace(/\s*[-\u2013:]$/, "");

  // Placeholder clock times: overnight stamps, and 7:00 AM (the
  // activities feed's default school-day start: "Labor Day - No School").
  let t = start.t;
  if (t && (t === "07:00" || t < "05:00")) t = null;
  if (NO_SCHOOL.test(title)) t = null;
  const endT = t && end && end.d === start.d && end.t && end.t > t ? end.t : null;

  let cat;
  if (NO_SCHOOL.test(title)) cat = "noschool";
  else if (PRACTICE.test(title) && !/\bGrad(?:uation)?\s+Practice\b/i.test(title)) cat = "practice";
  else if (act) cat = "activity";
  else if (COLLEGE.test(title) || fields.tags.includes("College Visits and Fairs")) cat = "college";
  else if (ACADEMIC.test(title) || fields.tags.includes("Academic Testing") || fields.tags.includes("Conferences")) cat = "academic";
  else cat = "school";

  const ev = { id, d: start.d, t, title, cat };
  if (endT) ev.e = endT;
  if (venue) ev.venue = venue;
  // Bound pins every venue (GEO:lat;lon); directions use the pin, since a
  // name like "Watertown High School Arena" doesn't say which town.
  const geo = String(f.GEO || "").match(/^\s*(-?\d+(?:\.\d+)?)\s*;\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (venue && geo && (Math.abs(+geo[1]) > 0.01 || Math.abs(+geo[2]) > 0.01)) ev.geo = `${(+geo[1]).toFixed(5)},${(+geo[2]).toFixed(5)}`;
  if (act) { ev.act = act; if (level) ev.level = level; }
  if (home !== undefined) ev.home = home;
  if (cancelled) ev.x = 1;
  if (g) ev.g = g;
  if (fields.url) ev.url = fields.url;
  if (t) ev.stamp = start.stamp;
  // Shown next to the Brandon time: "7:00 PM (6:00 PM Mountain)".
  if (t && local && local.z && local.t !== t) { ev.lt = local.t; ev.lz = local.z; }
  // Multi-day all-day entries (an exclusive DTEND date is the day after).
  if (end && end.date && !start.t) {
    const last = addDays(end.d, -1);
    if (last > start.d) ev.to = last;
  }
  // Same entry in both sources, under slightly different casing.
  ev.key = `${start.d}|${shown.toLowerCase()}`;
  return ev;
}

const { getSource } = require("./lib/sources.js");
const { openStore } = require("./lib/store.js");
const { withSpanish, cdnFor, toSpanish } = require("./lib/translate.js");
const BOUND_URL = () => DISTRICT.boundIcs;
const GCAL_URL = (calendarId) => `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
const isCalendar = (t) => t.includes("BEGIN:VCALENDAR") && t.includes("BEGIN:VEVENT");
// A school's own calendar may legitimately be empty for a stretch.
const isGcal = (t) => t.includes("BEGIN:VCALENDAR");

// Corrections from overrides.js (hide, re-target, rename), by title.
const OVERRIDES = require("../../overrides.js");
const rx = (p) => new RegExp(p, "i");
const HIDE = OVERRIDES.hide.map(rx);
const GRADE_RULES = OVERRIDES.grades.map((g) => ({ re: rx(g.match), grades: g.grades }));
const RENAME = OVERRIDES.rename.map((r) => ({ re: rx(r.match), to: r.to }));
function applyStaticOverrides(ev) {
  if (HIDE.some((re) => re.test(ev.title))) return null;
  for (const r of RENAME) if (r.re.test(ev.title)) ev.title = r.to;
  for (const g of GRADE_RULES) if (g.re.test(ev.title)) { if (g.grades && g.grades.length) ev.g = g.grades; else delete ev.g; }
  return ev;
}

// Corrections made on the admin page, by event id: Blobs store "overrides",
// key "events", a list of { id, date?, hide?, title?, grades?, act? }.
// Applied before anything reaches the app, a feed or a mirrored calendar.
let overridesMemo = { at: 0, list: [] };
async function overrides() {
  if (Date.now() - overridesMemo.at < 60 * 1000) return overridesMemo.list;
  let list;
  try { list = await openStore("overrides").get("events"); } catch { list = overridesMemo.list; }
  overridesMemo = { at: Date.now(), list: Array.isArray(list) ? list : [] };
  return overridesMemo.list;
}
const resetOverrides = () => { overridesMemo = { at: 0, list: [] }; };
function applyOverrides(events, list) {
  if (!list.length) return events;
  const out = [];
  for (const ev of events) {
    const o = list.find((r) => r.id === ev.id && (!r.date || r.date === ev.d));
    if (!o) { out.push(ev); continue; }
    if (o.hide) continue;
    const fixed = { ...ev };
    if (o.title) fixed.title = String(o.title);
    if (Array.isArray(o.grades)) { if (o.grades.length) fixed.g = o.grades; else delete fixed.g; }
    if (o.act !== undefined) {
      if (o.act) { fixed.act = String(o.act); if (fixed.cat === "school") fixed.cat = "activity"; }
      else { delete fixed.act; delete fixed.level; if (fixed.cat === "activity") fixed.cat = "school"; }
    }
    out.push(fixed);
  }
  return out;
}

// One school's merged calendar: its Google Calendar plus the Bound entries
// attributed to it, corrections applied. Everything the feeds hold (about
// two school years); callers filter by date.
async function loadSchool(schoolId, opts = {}) {
  const school = SCHOOLS[schoolId];
  if (!school) throw new Error(`unknown school ${schoolId}`);
  // getSource serves the saved copy on a bad minute (marked stale) and only
  // rejects when there is nothing saved at all. Either source alone still
  // makes a calendar; neither does not.
  const [gcal, bound] = await Promise.all([
    school.gcal ? getSource(`gcal-${school.id}`, GCAL_URL(school.gcal), { valid: isGcal, accept: "text/calendar,*/*", ...opts }).catch((e) => ({ failed: e })) : { body: "" },
    getSource("bound-brandonvalley", BOUND_URL(), { valid: isCalendar, accept: "text/calendar,*/*", ...opts }).catch((e) => ({ failed: e })),
  ]);
  if (gcal.failed && bound.failed) throw bound.failed;
  const events = [];
  const seen = new Set();
  const take = (text, keep) => {
    if (!text) return;
    for (const f of parseIcs(text)) {
      const ev = shapeEvent(f, school, keep);
      if (!ev || seen.has(ev.key)) continue;
      seen.add(ev.key);
      events.push(ev);
    }
  };
  take(gcal.body, null);
  take(bound.body, makeKeep(school.id));
  // A day off often appears in both sources with different wording ("NO
  // SCHOOL" and "Labor Day - No School"); keep the more specific one.
  const offByDay = {};
  for (const ev of events) if (ev.cat === "noschool") (offByDay[ev.d] = offByDay[ev.d] || []).push(ev);
  const drop = new Set();
  for (const list of Object.values(offByDay)) {
    if (list.length < 2) continue;
    const best = list.reduce((a, b) => (b.title.length > a.title.length ? b : a));
    for (const ev of list) if (ev !== best) drop.add(ev);
  }
  // Bound sometimes lists the same entry twice (one per team level).
  const dup = new Set();
  let out = [];
  for (const ev of events) {
    if (drop.has(ev)) continue;
    const key = `${ev.d}|${ev.t}|${ev.title}|${ev.level || ""}`;
    if (dup.has(key)) continue;
    dup.add(key);
    delete ev.key;
    if (applyStaticOverrides(ev)) out.push(ev);
  }
  out = applyOverrides(out, await overrides());
  out.sort((a, b) => (a.d + (a.t || "")).localeCompare(b.d + (b.t || "")));
  return out;
}

// Every program a student at this school could be in, from the whole
// feed (every season, not just the month on screen), for the Google
// mirror. A one-off title is more likely a typo than a program.
async function activitiesFor(schoolId) {
  const counts = {};
  for (const ev of await loadSchool(schoolId)) if (ev.act) counts[ev.act] = (counts[ev.act] || 0) + 1;
  return Object.keys(counts).filter((n) => counts[n] >= 2).sort();
}

// A child's rule for the legacy feeds: grade wording excludes other
// grades; picked activities narrow activity events; everything else stays.
function allowsFor(ev, grade, acts) {
  if (grade !== null && grade !== undefined && ev.g && !ev.g.includes(grade)) return false;
  if (acts && acts.length && ev.act) return acts.includes(ev.act);
  return true;
}

function inRange(ev, start, end) {
  const last = ev.to || ev.d;
  return last >= start && ev.d <= end;
}

function icsEscape(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
function addDays(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
function toIcs(events, schoolName, feedName, cancelled = "CANCELLED: ") {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Scratch Marketing//Brandon Valley Parent//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  if (feedName) {
    // A subscription: phones re-fetch it on their own, so changes reach
    // the family's calendar without opening the app.
    lines.push(`X-WR-CALNAME:${icsEscape(feedName)}`, "X-WR-TIMEZONE:America/Chicago", "REFRESH-INTERVAL;VALUE=DURATION:PT2H", "X-PUBLISHED-TTL:PT2H");
  }
  // Times are Brandon wall-clock times, stated as such, so a phone set to
  // another zone (a parent traveling) still shows the right moment.
  lines.push(...VTIMEZONE_CHICAGO);
  const now = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  for (const ev of events) {
    const day = ev.d.replace(/-/g, "");
    // UIDs as the first Brandon Valley app wrote them, so calendars
    // subscribed then (and the owner's Google mirror) update in place.
    lines.push("BEGIN:VEVENT", `UID:${day}-${ev.id}@brandonvalleylunch.com`, `DTSTAMP:${now}`);
    if (ev.stamp) {
      lines.push(`DTSTART;TZID=America/Chicago:${day}T${ev.stamp}`);
      if (ev.e) lines.push(`DTEND;TZID=America/Chicago:${day}T${ev.e.replace(":", "")}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${addDays(ev.to || ev.d, 1).replace(/-/g, "")}`);
    }
    const level = feedName && ev.level && !/^(High School|HS )/.test(ev.level) ? ` (${ev.level})` : "";
    lines.push(`SUMMARY:${icsEscape((ev.x ? cancelled : "") + ev.title + level)}`);
    if (ev.venue) lines.push(`LOCATION:${icsEscape(ev.venue)}`);
    if (ev.geo) lines.push(`GEO:${ev.geo.replace(",", ";")}`);
    if (ev.url) lines.push(`URL:${ev.url}`);
    lines.push(`DESCRIPTION:${icsEscape(`${schoolName}${ev.level ? `, ${ev.level}` : ""}`)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcs).join("\r\n") + "\r\n";
}
// US Central time rules (second Sunday in March, first Sunday in November).
const VTIMEZONE_CHICAGO = [
  "BEGIN:VTIMEZONE", "TZID:America/Chicago",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0600", "TZOFFSETTO:-0500", "TZNAME:CDT", "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0600", "TZNAME:CST", "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
  "END:VTIMEZONE",
];
// Calendar lines longer than 75 bytes continue on the next line after a space.
function foldIcs(line) {
  if (Buffer.byteLength(line) <= 75) return line;
  const out = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) { out.push(cur); cur = ""; }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=300",
  "Netlify-CDN-Cache-Control": "public, s-maxage=1800, stale-while-revalidate=600",
};
const ICS_FEED_HEADERS = {
  "Content-Type": "text/calendar; charset=utf-8",
  "Cache-Control": "public, max-age=1800",
  "Netlify-CDN-Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400",
};

// Calendar subscriptions live at /feed/<id>/calendar.ics (netlify.toml
// rewrites it here): calendar apps want a plain .ics address, and robots.txt
// allows /feed/ so Google Calendar may fetch it. <id> is the feed's query
// string in base64url; Netlify does not pass a rewrite's path pieces on.
function feedQuery(event) {
  const m = String(event.rawUrl || event.path || "").match(/\/feed\/([A-Za-z0-9_-]{4,600})\/calendar\.ics/);
  if (!m) return null;
  try { return { ...Object.fromEntries(new URLSearchParams(Buffer.from(m[1], "base64url").toString("utf8"))), feed: "1" }; } catch { return null; }
}

// The first Brandon Valley app's feed address, still on parents' phones
// and in the owner's Google mirror:
//   /feed/<linq id or school id>/<grade|all>/<activities|all|none>/calendar.ics[?only=1]
// acts=none: no activity events at all; only=1: nothing but the named
// activities. The mirrored Google Calendars are built from these two (one
// calendar per grade, one per activity), so nothing lands twice.
function legacyFeed(event) {
  const url = String(event.rawUrl || event.path || "");
  const m = url.match(/\/feed\/([^/?]+)\/([^/?]+)\/([^/?]+)\/calendar\.ics/);
  if (!m) return null;
  const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
  const school = LINQ_TO_ID[m[1]] || (SCHOOLS[m[1]] ? m[1] : null);
  const q = event.queryStringParameters || {};
  const only = q.only === "1" || /[?&]only=1(?:&|$)/.test(url);
  return { school, grade: dec(m[2]), acts: dec(m[3]), only };
}

const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;
const gradeName = (g) => (g === -1 ? "Junior kindergarten" : g === 0 ? "Kindergarten" : `${ordinal(g)} grade`);

async function serveLegacyFeed(f) {
  if (!f.school) return { statusCode: 404, body: "Calendar not found" };
  const school = SCHOOLS[f.school];
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const start = SHARED.addDays(today, -14), end = SHARED.addDays(today, 400);
  try {
    const all = (await loadSchool(school.id)).filter((ev) => inRange(ev, start, end));
    const grade = /^-?\d{1,2}$/.test(f.grade) ? parseInt(f.grade, 10) : null;
    const none = f.acts === "none";
    const acts = (f.acts === "all" || none ? "" : f.acts).split(",").filter(Boolean);
    const only = f.only && acts.length > 0;
    let picked = all;
    let name = school.name;
    if (grade !== null || acts.length || none) {
      // The grade applies in every form (the first app skipped it for
      // acts=none, so its per-grade calendars carried every grade's dates).
      picked = all.filter((ev) => allowsFor(ev, grade, []) && (none ? !ev.act : only ? acts.includes(ev.act) : allowsFor(ev, grade, acts)));
      if (only && acts.length === 1) name = `${acts[0]} · ${school.name}`;
      if (grade !== null) name = `${gradeName(grade)} · ${school.name}`;
    }
    return { statusCode: 200, headers: ICS_FEED_HEADERS, body: toIcs(picked, school.name, name) };
  } catch (err) {
    return { statusCode: 502, headers: { "Cache-Control": "no-store" }, body: "Calendar temporarily unavailable" };
  }
}

exports.handler = async (event) => {
  require("./lib/store.js").connect(event);
  const legacy = legacyFeed(event);
  if (legacy) return serveLegacyFeed(legacy);
  const q = feedQuery(event) || event.queryStringParameters || {};
  if (q.format === "ics" && q.custom === "1") {
    const title = String(q.title || "").slice(0, 120).trim();
    if (!YMD.test(q.start || "") || !title) return { statusCode: 400, body: "Bad request" };
    const end = YMD.test(q.end || "") && q.end >= q.start ? q.end : q.start;
    const ev = { id: hashId(`${q.start}|${title}`), d: q.start, to: end !== q.start ? end : undefined, t: null, title };
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="school-date.ics"', "Cache-Control": "public, max-age=86400" },
      body: toIcs([ev], DISTRICT.name),
    };
  }
  const schoolId = q.school;
  // feed=1: one student's rolling calendar subscription (two weeks back,
  // a year ahead), filtered by the same rules the app uses.
  if (q.feed === "1") {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    // family=&kid= reads the student from their family code, so teams added
    // later reach a calendar subscribed long ago. classOf= / grade= are the
    // self-contained forms.
    let fam = null;
    if (q.family) {
      const rec = await require("./family.js").loadFamily(String(q.family).toUpperCase()).catch(() => null);
      fam = rec && rec.kids.find((k) => k.id === q.kid);
      if (!fam) return { statusCode: 404, body: "Calendar not found" };
    }
    const sid = fam ? fam.school : schoolId;
    const classOf = fam ? fam.classOf : Number(q.classOf);
    const grade = classOf ? SHARED.gradeOf(classOf, today) : Number(q.grade);
    if (!SCHOOLS[sid] || !(grade >= SCHOOLS[sid].grades[0] && grade <= SCHOOLS[sid].grades[1])) return { statusCode: 400, body: "Bad request" };
    const start = SHARED.addDays(today, -14), end = SHARED.addDays(today, 400);
    try {
      const kid = { school: sid, grade, follows: fam ? fam.follows : SHARED.decodeFollows(q.follows) };
      const all = (await loadSchool(sid)).filter((ev) => inRange(ev, start, end));
      let mine = SHARED.sortEvents(SHARED.mergeDistrict(SFDATA.DISTRICT_CALENDAR, all, start, end, grade).concat(SHARED.stateFor(SFDATA.STATE_EVENTS, kid, start, end)).filter((ev) => SHARED.mineFilter(kid, ev)));
      let name = grade >= 9 ? `${SCHOOLS[sid].name}, class of ${SHARED.classFor(grade, today)}` : `${gradeName(grade)} · ${SCHOOLS[sid].name}`;
      // Subscribed in Spanish: titles, levels and places in Spanish (saved
      // translations; anything not ready yet stays English until next refresh).
      if (q.lang === "es") {
        const es = await toSpanish(mine.flatMap((ev) => [ev.title, ev.level, ev.venue]).filter(Boolean), { budgetMs: 4000 });
        const tr = (s) => (s && es[s.trim()]) || s;
        mine = mine.map((ev) => ({ ...ev, title: tr(ev.title), level: tr(ev.level), venue: tr(ev.venue) }));
        name = `${SCHOOLS[sid].name}, promoción ${SHARED.classFor(grade, today)}`;
      }
      return { statusCode: 200, headers: ICS_FEED_HEADERS, body: toIcs(mine, SCHOOLS[sid].name, name, q.lang === "es" ? "CANCELADO: " : undefined) };
    } catch (err) {
      return { statusCode: 502, headers: { "Cache-Control": "no-store" }, body: "Calendar temporarily unavailable" };
    }
  }
  if (!SCHOOLS[schoolId] || !YMD.test(q.start || "") || !YMD.test(q.end || "") || q.end < q.start) {
    return { statusCode: 400, body: "Bad request" };
  }
  try {
    const all = await loadSchool(schoolId);
    // Every activity and level the school runs in the range, for the
    // "follow activities" picker.
    if (q.list === "activities") {
      const acts = new Map();
      for (const ev of all) {
        if (!ev.act || !inRange(ev, q.start, q.end)) continue;
        const a = acts.get(ev.act) || { act: ev.act, n: 0, levels: new Set() };
        a.n++;
        if (ev.level) a.levels.add(ev.level);
        acts.set(ev.act, a);
      }
      const list = [...acts.values()]
        .map((a) => ({ act: a.act, n: a.n, levels: [...a.levels].sort() }))
        .sort((a, b) => a.act.localeCompare(b.act));
      const body = await withSpanish(event, JSON.stringify({ school: schoolId, activities: list }), "activities");
      return { statusCode: 200, headers: { ...JSON_HEADERS, "Netlify-CDN-Cache-Control": cdnFor(body, JSON_HEADERS["Netlify-CDN-Cache-Control"]) }, body };
    }
    let events = all.filter((ev) => inRange(ev, q.start, q.end));
    if (q.format === "ics") {
      const ids = new Set(String(q.ids || "").split(",").filter(Boolean));
      if (ids.size) {
        const picked = events.filter((ev) => ids.has(ev.id));
        if (picked.length) events = picked;
      }
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": `attachment; filename="${schoolId}-events.ics"`,
          "Cache-Control": "public, max-age=300",
        },
        body: toIcs(events, SCHOOLS[schoolId].name),
      };
    }
    events = events.map((ev) => { const copy = { ...ev }; delete copy.stamp; return copy; });
    const body = await withSpanish(event, JSON.stringify({ school: schoolId, start: q.start, end: q.end, events }), "events");
    return {
      statusCode: 200,
      headers: { ...JSON_HEADERS, "Netlify-CDN-Cache-Control": cdnFor(body, JSON_HEADERS["Netlify-CDN-Cache-Control"]) },
      body,
    };
  } catch (err) {
    return { statusCode: 502, headers: { "Cache-Control": "no-store" }, body: JSON.stringify({ error: "Could not reach the school calendars." }) };
  }
};

// Shared with the sync, the notification sender and the Google mirror.
exports.loadSchool = loadSchool;
exports.activitiesFor = activitiesFor;
exports.allowsFor = allowsFor;
exports.SCHOOLS = SCHOOLS;
exports.SCHOOL_NAMES = SCHOOL_NAMES;
exports.LINQ_TO_ID = LINQ_TO_ID;
// Exported for tests (and the callers that read loadSchool from here).
exports._internals = {
  parseIcs, shapeEvent, gradesFor, SCHOOLS, SCHOOL_NAMES, LINQ_TO_ID, TAG_SCHOOLS, toIcs, loadSchool, activitiesFor, allowsFor,
  BOUND_URL, GCAL_URL, isCalendar, isGcal, makeKeep, orientMatchup, normalizeActivity, applyOverrides, resetOverrides,
  legacyFeed, feedQuery, legacyId, hashId, inRange,
};
