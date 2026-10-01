/* Relay for the schools' public Google Calendars (their ICS feeds don't
 * allow cross-origin browser fetches). Returns compact JSON events for a
 * date range; responses are CDN-cached so Google is hit a few times a day.
 *
 * GET /.netlify/functions/events?school=<buildingId>&start=YYYY-MM-DD&end=YYYY-MM-DD
 */

// buildingId (same ids the app already uses) -> public Google Calendar id
const CALENDARS = {
  "041717d0-8f8d-ec11-8df7-eb7b319a32d1": "c_lk4f0sf7m263481bksgqii8qdk@group.calendar.google.com", // Brandon Elementary
  "d8f8bcbf-1b2a-f111-bb4f-02558335d9c7": "c_e8d7901cad2431e55294d2743334511490bce6c7d904928f0ab43f5d8651403a@group.calendar.google.com", // Burkman Valley Elementary
  "af61ff49-908d-ec11-8df7-9c80cb6a95ae": "c_eka0c7b34dvek74sbkcnsi2298@group.calendar.google.com", // Fred Assam Elementary
  "0c65b2bc-908d-ec11-8df7-9566c4096294": "c_oev712r91d4s20cdllnkf02hao@group.calendar.google.com", // Inspiration Elementary
  "ec90bc02-908d-ec11-8df7-eb7b319a32d1": "c_i2k36488vcv4h1n33utlv7ar3g@group.calendar.google.com", // Robert Bennis Elementary
  "82b0714f-8f8d-ec11-8df7-d30e05c96286": "c_q2r3bv8jrh8kdttfgj2s5gntss@group.calendar.google.com", // BV Intermediate
  "2e94e37a-8f8d-ec11-8df7-eb7b319a32d1": "k12.sd.us_1v08ahk36loit8h6c6d2c3ga08@group.calendar.google.com", // BV Middle
  "ffc1d3ff-8e8d-ec11-8df7-c6813137b210": "c_8q83pnh5nj5nhtfuue53nvlmm0@group.calendar.google.com", // BV High
};

// District-wide activities calendar (Bound / gobound.com) — the live source
// for athletics, clubs and activities. Several schools let their own Google
// Calendar go stale, so events here are attributed per school and merged in.
const BOUND_ICS = "https://www.gobound.com/sd/schools/brandonvalley/calendar/ical";

// Case-sensitive on purpose: the abbreviations (BE, IES, MS, HS) would match
// ordinary words otherwise.
const SCHOOL_MATCHERS = {
  "041717d0-8f8d-ec11-8df7-eb7b319a32d1": /Brandon Elementary|\bBE /,
  "d8f8bcbf-1b2a-f111-bb4f-02558335d9c7": /Burkman/,
  "af61ff49-908d-ec11-8df7-9c80cb6a95ae": /Fred Assam|\bFAE\b/,
  "0c65b2bc-908d-ec11-8df7-9566c4096294": /Inspiration|\bIES\b|\bIE /,
  "ec90bc02-908d-ec11-8df7-eb7b319a32d1": /Robert Bennis|\bRBE\b/,
  "82b0714f-8f8d-ec11-8df7-d30e05c96286": /Intermediate|\bBVIS\b/,
  // "Middle School"/"High School" alone are too generic for the venue half
  // of the combined title+venue test below -- almost every opposing team's
  // building is also named "___ Middle School" or "___ High School" (e.g.
  // an away tennis match at "Luverne High School" would otherwise falsely
  // match Brandon Valley High School). Require "Brandon Valley" so only
  // our own campuses qualify; BVMS/BVHS and the title-only grade markers
  // are already specific enough to leave alone.
  "2e94e37a-8f8d-ec11-8df7-eb7b319a32d1": /Brandon Valley Middle School|\bBVMS\b|\bMS |\((?:7th|8th)[^)]*\)/,
  "ffc1d3ff-8e8d-ec11-8df7-c6813137b210": /Brandon Valley High School|\bBVHS\b|\bHS |\((?:Junior Varsity|Varsity|Sophomore|Freshman|9[AB])[^)]*\)|\b(?:Var|9th) /,
};
// Titles carrying a secondary grade level, wherever the event is played.
const SECONDARY_EVENT = /\((?:7th|8th|9th|Junior Varsity|Varsity|Sophomore|Freshman|Middle School|9[AB])[^)]*\)|\bMS\b|\bHS\b|Middle School|High School/;
// Grade wording IN THE TITLE ITSELF is authoritative, overriding a
// same-named venue coincidence -- e.g. Girls Tennis is a high-school
// program, but its courts are literally named "Brandon Valley Middle School
// Tennis Courts", which otherwise matches Middle School's own venue-based
// rule below and leaks JV/Varsity matches onto the middle-school calendar.
// gradesFor reads every form the feed uses ("(Girls Varsity)", "(FR/SO
// Red)", "(Grades 9-12)", "(Seniors)", unlabeled baseball), shared with the
// app so a child's view agrees with the calendar.
const { gradesFor, fitsSchool, activityName, isActivity } = require("../../grades.js");

// Bound's building tags -> the schools they mean.
const ELEMENTARY = [
  "041717d0-8f8d-ec11-8df7-eb7b319a32d1", "d8f8bcbf-1b2a-f111-bb4f-02558335d9c7",
  "af61ff49-908d-ec11-8df7-9c80cb6a95ae", "0c65b2bc-908d-ec11-8df7-9566c4096294",
  "ec90bc02-908d-ec11-8df7-eb7b319a32d1",
];
const TAG_SCHOOLS = {
  "Brandon Elementary": ["041717d0-8f8d-ec11-8df7-eb7b319a32d1"],
  "Burkman Valley Elementary": ["d8f8bcbf-1b2a-f111-bb4f-02558335d9c7"],
  "Fred Assam Elementary": ["af61ff49-908d-ec11-8df7-9c80cb6a95ae"],
  "Inspiration Elementary": ["0c65b2bc-908d-ec11-8df7-9566c4096294"],
  "Robert Bennis Elementary": ["ec90bc02-908d-ec11-8df7-eb7b319a32d1"],
  "Elementary Events": ELEMENTARY,
  "Intermediate School Events": ["82b0714f-8f8d-ec11-8df7-d30e05c96286"],
  "Middle School Events": ["2e94e37a-8f8d-ec11-8df7-eb7b319a32d1"],
  "High School Events": ["ffc1d3ff-8e8d-ec11-8df7-c6813137b210"],
};

// Elementary buildings shouldn't inherit secondary-school athletics.
const SECONDARY = new Set([
  "82b0714f-8f8d-ec11-8df7-d30e05c96286",
  "2e94e37a-8f8d-ec11-8df7-eb7b319a32d1",
  "ffc1d3ff-8e8d-ec11-8df7-c6813137b210",
]);

const SCHOOL_NAMES = {
  "041717d0-8f8d-ec11-8df7-eb7b319a32d1": "Brandon Elementary",
  "d8f8bcbf-1b2a-f111-bb4f-02558335d9c7": "Burkman Valley Elementary",
  "af61ff49-908d-ec11-8df7-9c80cb6a95ae": "Fred Assam Elementary",
  "0c65b2bc-908d-ec11-8df7-9566c4096294": "Inspiration Elementary",
  "ec90bc02-908d-ec11-8df7-eb7b319a32d1": "Robert Bennis Elementary",
  "82b0714f-8f8d-ec11-8df7-d30e05c96286": "BV Intermediate School",
  "2e94e37a-8f8d-ec11-8df7-eb7b319a32d1": "BV Middle School",
  "ffc1d3ff-8e8d-ec11-8df7-c6813137b210": "BV High School",
};

// Home venues. The title order is NOT a home/away signal — Bound lists
// "Brandon Valley vs Yankton" for a game played at Yankton — so the venue
// is the only reliable indicator. Aspen Park and McHardy Park are Brandon's
// own fields (baseball/softball and cross country host there).
const HOME_VENUE = /brandon valley|aspen park|mchardy park/i;
// Only competitions get a home/away badge; meetings and picture day don't.
const COMPETITION = /\svs\s|invite|invitational|tournament|jamboree|meet\b|classic|championship|scrimmage|quadrangular|triangular|dual\b/i;

const TZ = "America/Chicago";
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

const unescapeIcs = (s) =>
  s.replace(/\\n/gi, " ").replace(/\\([,;\\\\])/g, "$1")
    // Staff sometimes paste a link into the title: "Pigskin Classic (https://…)"
    .replace(/\s*\(\s*https?:\/\/[^)]*\)/gi, "")
    .replace(/\s*https?:\/\/\S+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

// UTC instant -> { date: "YYYY-MM-DD", time: "3:30 PM" } in Central time
function toCentral(utc) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(utc).reduce((o, p) => ((o[p.type] = p.value), o), {});
  const h24 = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(utc).reduce((o, p) => ((o[p.type] = p.value), o), {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute} ${parts.dayPeriod}`,
    stamp: `${h24.hour === "24" ? "00" : h24.hour}${h24.minute}${h24.second}`,
  };
}

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}


// Bound writes matchups as "A vs B" in an order that does not indicate the
// host — "Brandon Valley vs Yankton" is played at Yankton. Rewrite them the
// way a team's own schedule reads: Brandon Valley first, "vs" when hosting
// and "at" when travelling.
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

// Bound's own fields on each event: the program it belongs to, the team
// level, and tags naming the building(s) and class(es) it is for. Far more
// reliable than reading the title, when present (Google Calendar events
// have none of this).
function boundFields(body) {
  const f = (k) => { const m = body.match(new RegExp(`^${k}:(.*)$`, "m")); return m ? unescapeIcs(m[1]).trim() : ""; };
  const tags = f("X-BND-TAGS").split(",").map((t) => t.trim()).filter(Boolean);
  // Raw, not unescaped: the title cleaner strips links on purpose.
  const url = ((body.match(/^URL:(.*)$/m) || [])[1] || "").trim();
  return {
    act: normalizeActivity(f("X-BND-ACTIVITYNAME")),
    level: f("X-BND-ACTIVITYLEVEL"),
    tags,
    url: /^https:\/\/(?:www\.)?gobound\.com\//.test(url) ? url : "",
  };
}

// Bound names the same program more than one way ("Volleyball, Girls",
// "Boys Golf (Fall)"); fold them so a pick catches every entry.
function normalizeActivity(name) {
  return name
    .replace(/^(.+),\s*(Boys|Girls)$/, "$2 $1")
    .replace(/^Girls Volleyball$/, "Volleyball")
    .replace(/^Boys Football$/, "Football")
    .replace(/\s*\((?:Fall|Spring|Winter)\)$/, "")
    .trim();
}

// "CANCELLED - Girls Basketball: ..." -> state + clean title.
function cancellation(title, body) {
  const m = title.match(/^(CANCEL+ED|POSTPONED)\s*[-:]\s*/i);
  if (m) return { x: m[1].toLowerCase().startsWith("post") ? "postponed" : "cancelled", title: title.slice(m[0].length) };
  if (/^STATUS:CANCELLED$/m.test(body)) return { x: "cancelled", title };
  return { x: null, title };
}

function parseIcs(ics, rangeStart, rangeEnd, keep) {
  const events = [];
  // Unfold wrapped lines (RFC 5545: continuation lines start with a space/tab)
  const text = ics.replace(/\r?\n[ \t]/g, "");
  for (const block of text.split("BEGIN:VEVENT").slice(1)) {
    const body = block.split("END:VEVENT")[0];
    const summary = body.match(/^SUMMARY:(.*)$/m);
    if (!summary) continue;
    const raw = unescapeIcs(summary[1]);
    if (!raw) continue;
    const fields = boundFields(body);
    const { x, title } = cancellation(raw, body);
    const locM = body.match(/^LOCATION:(.*)$/m);
    const where = locM ? unescapeIcs(locM[1]) : "";
    if (keep && !keep(title, where, fields)) continue;

    let s, e, time = null, stamp = null;
    const allDay = body.match(/^DTSTART;VALUE=DATE:(\d{8})$/m);
    if (allDay) {
      const raw = allDay[1];
      s = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
      const endM = body.match(/^DTEND;VALUE=DATE:(\d{8})$/m);
      e = endM
        ? `${endM[1].slice(0, 4)}-${endM[1].slice(4, 6)}-${endM[1].slice(6, 8)}`
        : addDays(s, 1); // DTEND is exclusive
    } else {
      const timed = body.match(/^DTSTART(?:;TZID=[^:]+)?:(\d{8})T(\d{6})(Z?)$/m);
      if (!timed) continue;
      const [, d8, t6, z] = timed;
      const iso = `${d8.slice(0, 4)}-${d8.slice(4, 6)}-${d8.slice(6, 8)}T${t6.slice(0, 2)}:${t6.slice(2, 4)}:${t6.slice(4, 6)}${z ? "Z" : ""}`;
      if (z) {
        const c = toCentral(new Date(iso));
        s = c.date; time = c.time; stamp = c.stamp;
      } else {
        s = iso.slice(0, 10);
        const h = parseInt(t6.slice(0, 2), 10);
        time = `${((h + 11) % 12) + 1}:${t6.slice(2, 4)} ${h < 12 ? "AM" : "PM"}`;
        stamp = t6;
      }
      e = addDays(s, 1);
    }
    // A real same-day end time (Bound gives one on most events).
    let end = null;
    const endM = body.match(/^DTEND(?:;TZID=[^:]+)?:(\d{8})T(\d{6})(Z?)$/m);
    if (stamp && endM) {
      const endIso = `${endM[1].slice(0, 4)}-${endM[1].slice(4, 6)}-${endM[1].slice(6, 8)}`;
      const endStamp = endM[3] ? toCentral(new Date(`${endIso}T${endM[2].slice(0, 2)}:${endM[2].slice(2, 4)}:${endM[2].slice(4, 6)}Z`)) : { date: endIso, stamp: endM[2] };
      if (endStamp.date === s && endStamp.stamp > stamp) end = endStamp.stamp;
    }

    if (e <= rangeStart || s >= rangeEnd) continue;
    // Placeholder clock times: overnight stamps, and 7:00 AM — the activities
    // feed's default school-day start ("Labor Day - No School · 7:00 AM").
    if (time && (/^(?:12|[1-6]):\d\d AM$/.test(time) || time === "7:00 AM")) time = stamp = end = null;
    const isGame = COMPETITION.test(title);
    const home = isGame && where ? HOME_VENUE.test(where) : undefined;
    const shown = orientMatchup(title, home);
    const id = Math.abs(hash(`${s}|${shown}`)).toString(36).slice(0, 7);
    // A multi-sport meeting is tagged with one program by the feed; it is
    // really for everyone.
    const act = /\bSports Meeting\b/i.test(title) ? "" : fields.act;
    const grades = gradesFor(shown, fields.level, fields.tags);
    events.push({
      s, e, t: shown, id,
      ...(time ? { time, stamp } : {}),
      ...(end ? { end } : {}),
      ...(where ? { where } : {}),
      ...(home === undefined ? {} : { home }),
      ...(act ? { act } : {}),
      ...(grades ? { g: grades } : {}),
      ...(fields.url ? { url: fields.url } : {}),
      ...(x ? { x } : {}),
    });
  }
  events.sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
  return events;
}


/* ---- .ics export: hand a day's events to the phone's calendar app ---- */

const escIcs = (t) => t.replace(/([\\;,])/g, "\\$1").replace(/\r?\n/g, "\\n");

// RFC 5545 wants lines folded at 75 octets.
function fold(line) {
  if (line.length <= 74) return line;
  const out = [line.slice(0, 74)];
  let rest = line.slice(74);
  while (rest.length > 73) { out.push(" " + rest.slice(0, 73)); rest = rest.slice(73); }
  if (rest) out.push(" " + rest);
  return out.join("\r\n");
}

const compact = (iso) => iso.replace(/-/g, "");

function buildIcs(events, label, feed = false) {
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "PRODID:-//Brandon Valley Lunch//brandonvalleylunch.com//EN",
    `X-WR-CALNAME:${escIcs(label)}`,
    ...(feed ? ["REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"] : []),
  ];
  events.forEach((ev) => {
    // Stable per event, so a subscription updates in place rather than
    // piling up duplicates as the window rolls.
    const uid = `${compact(ev.s)}-${ev.id}@brandonvalleylunch.com`;
    lines.push("BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${now}`);
    if (ev.stamp) {
      // Floating local time: shows at the right clock time on a phone here.
      lines.push(`DTSTART:${compact(ev.s)}T${ev.stamp}`);
      const endH = String((parseInt(ev.stamp.slice(0, 2), 10) + 1) % 24).padStart(2, "0");
      lines.push(`DTEND:${compact(ev.s)}T${ev.end || endH + ev.stamp.slice(2)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compact(ev.s)}`, `DTEND;VALUE=DATE:${compact(ev.e)}`);
    }
    lines.push(fold(`SUMMARY:${escIcs((ev.x ? `${ev.x === "postponed" ? "Postponed" : "Cancelled"}: ` : "") + ev.t)}`));
    if (ev.url) lines.push(fold(`URL:${ev.url}`));
    if (ev.where) lines.push(fold(`LOCATION:${escIcs(ev.where)}`));
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}

const UA = { "User-Agent": "brandonvalleylunch.com school app" };
const grab = async (url) => {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return r.text();
};

// A Bound event belongs to this school if it names it, or (for secondary
// schools) if it's a district activity that no other level claims.
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
    // the venue AND the "no one else claims it" inheritance fallback
    // below -- a "(Middle School)" match belongs only to a building with
    // grades 7-8, excluding every other one.
    if (!fitsSchool(gradesFor(title, fields && fields.level, tags), school)) return false;
    // The feed's own building tags settle it when present. A named
    // elementary tag is more specific than the blanket "Elementary
    // Events" tag that usually rides along with it, so the named ones
    // win when any are present.
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

// A child's rule, same as the app's: grade wording excludes other grades;
// picked activities narrow activity events; everything else stays.
function allowsFor(ev, grade, acts) {
  const g = ev.g || gradesFor(ev.t);
  if (grade !== null && grade !== undefined && g && !g.includes(grade)) return false;
  if (acts && acts.length) {
    const act = ev.act || (isActivity(ev.t) ? activityName(ev.t) : null);
    if (act) return acts.includes(act);
  }
  return true;
}

// One school's merged calendar for a date range.
async function eventsFor(school, start, end) {
  const [googleIcs, boundIcs] = await Promise.all([
    grab(`https://calendar.google.com/calendar/ical/${encodeURIComponent(CALENDARS[school])}/public/basic.ics`),
    grab(BOUND_ICS).catch(() => null), // activities are a bonus, never fatal
  ]);
  let events = parseIcs(googleIcs, start, end);
  if (boundIcs) {
    const seen = new Set(events.map((e) => `${e.s}|${e.t.toLowerCase()}`));
    for (const ev of parseIcs(boundIcs, start, end, makeKeep(school))) {
      const k = `${ev.s}|${ev.t.toLowerCase()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      events.push(ev);
    }
    events.sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
  }
  // A day off often appears in both sources with different wording
  // ("NO SCHOOL" and "Labor Day - No School"); keep the more specific one.
  const offByDay = {};
  for (const ev of events) if (/\bno school\b/i.test(ev.t)) (offByDay[ev.s] = offByDay[ev.s] || []).push(ev);
  const dropOff = new Set();
  for (const list of Object.values(offByDay)) {
    if (list.length < 2) continue;
    const keep = list.reduce((a, b) => (b.t.length > a.t.length ? b : a));
    for (const ev of list) if (ev !== keep) dropOff.add(ev);
  }
  if (dropOff.size) events = events.filter((ev) => !dropOff.has(ev));
  return events;
}

exports.handler = async (event) => {
  const q = { ...(event.queryStringParameters || {}) };
  // The clean feed address (/feed/<school>/<grade>/<acts>/calendar.ics)
  // is rewritten here by netlify.toml, but only the request's own query
  // string travels with it, so read the pieces off the original path.
  const m = String(event.rawUrl || event.path || "").match(/\/feed\/([^/?]+)\/([^/?]+)\/([^/?]+)\/calendar\.ics/);
  if (m) { q.school = m[1]; q.feed = "1"; q.grade = m[2]; q.acts = m[3]; }
  // One school for the calendar; the .ics export may span several
  // (a family's "all my kids" day), as school=a,b.
  const schools = String(q.school || "").split(",").filter(Boolean);
  const listing = q.list === "activities";
  // feed=1: a calendar subscription. Rolling window, so the phone's
  // calendar app keeps itself current without the parent doing anything.
  const feed = q.feed === "1";
  if (feed) q.format = "ics";
  const today = toCentral(new Date()).date;
  const start = feed ? addDays(today, -14) : q.start;
  const end = feed ? addDays(today, 400) : q.end;
  const multi = q.format === "ics" && schools.length > 1;
  if (!schools.length || (!multi && schools.length !== 1) || !schools.every((s) => CALENDARS[s]) ||
      (!listing && (!DATE_RX.test(start || "") || !DATE_RX.test(end || "")))) {
    return { statusCode: 400, body: JSON.stringify({ error: "bad params" }) };
  }

  try {
    // list=activities: everything a student at this school could be signed
    // up for, drawn from the whole activities feed (every season, not just
    // the month on screen), so a parent setting up a child picks from what
    // actually exists. Attribution is the same keep as the calendar.
    if (listing) {
      const counts = {};
      for (const ev of parseIcs(await grab(BOUND_ICS), "0000-01-01", "9999-12-31", makeKeep(schools[0]))) {
        const name = ev.act || (isActivity(ev.t) ? activityName(ev.t) : null);
        if (name) counts[name] = (counts[name] || 0) + 1;
      }
      // A one-off title is more likely a typo than a program.
      const activities = Object.keys(counts).filter((n) => counts[n] >= 2).sort();
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
          "Netlify-CDN-Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
        },
        body: JSON.stringify({ activities }),
      };
    }

    const events = (await Promise.all(schools.map((s) => eventsFor(s, start, end)))).flat();
    // format=ics hands the range straight to the phone's calendar app.
    // ids= limits it to the events the parent actually picked.
    if (q.format === "ics") {
      let name = schools.length > 1 ? "School events" : (SCHOOL_NAMES[schools[0]] || "School events");
      const want = (q.ids || "").split(",").filter(Boolean);
      let picked = want.length ? events.filter((ev) => want.includes(ev.id)) : events;
      // A child's feed: their grade and activities, same rule as the app.
      // "all" is how the clean /feed/… address says "no filter".
      const grade = /^-?\d{1,2}$/.test(q.grade || "") ? parseInt(q.grade, 10) : null;
      const acts = (q.acts === "all" ? "" : decodeURIComponent(q.acts || "")).split(",").filter(Boolean);
      if (grade !== null || acts.length) {
        picked = picked.filter((ev) => allowsFor(ev, grade, acts));
        if (grade !== null && schools.length === 1) {
          const label = grade === -1 ? "Junior kindergarten" : grade === 0 ? "Kindergarten" : `${grade}${["th", "st", "nd", "rd"][(grade % 100 > 10 && grade % 100 < 14) || grade % 10 > 3 ? 0 : grade % 10]} grade`;
          name = `${label} · ${SCHOOL_NAMES[schools[0]]}`;
        }
      }
      // Ids can go stale if a title changed since the page was loaded — hand
      // back the whole day rather than a dead-end 404.
      const chosen = picked.length || feed ? picked : events;
      if (!chosen.length && !feed) {
        return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*" }, body: "" };
      }
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          // A download for the one-day export; a subscription is fetched
          // by the calendar app itself and must not be an attachment.
          ...(feed ? {} : { "Content-Disposition": `attachment; filename="school-events.ics"` }),
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": feed ? "public, max-age=1800" : "public, max-age=900",
          ...(feed ? { "Netlify-CDN-Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400" } : {}),
        },
        body: buildIcs(chosen, name, feed),
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
        "Netlify-CDN-Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400",
      },
      body: JSON.stringify({ events }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "calendar unavailable" }),
    };
  }
};

// Shared with the notification sender.
exports.eventsFor = eventsFor;
exports.allowsFor = allowsFor;
exports.SCHOOL_NAMES = SCHOOL_NAMES;
exports.toCentral = toCentral;
exports.addDays = addDays;
