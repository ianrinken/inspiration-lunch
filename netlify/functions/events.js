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
  "2e94e37a-8f8d-ec11-8df7-eb7b319a32d1": /Middle School|\bBVMS\b|\bMS |\((?:7th|8th)[^)]*\)/,
  "ffc1d3ff-8e8d-ec11-8df7-c6813137b210": /High School|\bBVHS\b|\bHS |\((?:Junior Varsity|Varsity|Sophomore|Freshman|9[AB])[^)]*\)|\b(?:Var|9th) /,
};
// Titles carrying a secondary grade level, wherever the event is played.
const SECONDARY_EVENT = /\((?:7th|8th|9th|Junior Varsity|Varsity|Sophomore|Freshman|Middle School|9[AB])[^)]*\)|\bMS\b|\bHS\b|Middle School|High School/;

// Elementary buildings shouldn't inherit secondary-school athletics.
const SECONDARY = new Set([
  "82b0714f-8f8d-ec11-8df7-d30e05c96286",
  "2e94e37a-8f8d-ec11-8df7-eb7b319a32d1",
  "ffc1d3ff-8e8d-ec11-8df7-c6813137b210",
]);

const TZ = "America/Chicago";
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

const unescapeIcs = (s) =>
  s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

// UTC instant -> { date: "YYYY-MM-DD", time: "3:30 PM" } in Central time
function toCentral(utc) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(utc).reduce((o, p) => ((o[p.type] = p.value), o), {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute} ${parts.dayPeriod}`,
  };
}

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function parseIcs(ics, rangeStart, rangeEnd, keep) {
  const events = [];
  // Unfold wrapped lines (RFC 5545: continuation lines start with a space/tab)
  const text = ics.replace(/\r?\n[ \t]/g, "");
  for (const block of text.split("BEGIN:VEVENT").slice(1)) {
    const body = block.split("END:VEVENT")[0];
    if (/^STATUS:CANCELLED$/m.test(body)) continue;
    const summary = body.match(/^SUMMARY:(.*)$/m);
    if (!summary) continue;
    const title = unescapeIcs(summary[1]);
    if (!title) continue;
    const locM = body.match(/^LOCATION:(.*)$/m);
    const where = locM ? unescapeIcs(locM[1]) : "";
    if (keep && !keep(title, where)) continue;

    let s, e, time = null;
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
        s = c.date; time = c.time;
      } else {
        s = iso.slice(0, 10);
        const h = parseInt(t6.slice(0, 2), 10);
        time = `${((h + 11) % 12) + 1}:${t6.slice(2, 4)} ${h < 12 ? "AM" : "PM"}`;
      }
      e = addDays(s, 1);
    }

    if (e <= rangeStart || s >= rangeEnd) continue;
    // Placeholder clock times: overnight stamps, and 7:00 AM — the activities
    // feed's default school-day start ("Labor Day - No School · 7:00 AM").
    if (time && (/^(?:12|[1-6]):\d\d AM$/.test(time) || time === "7:00 AM")) time = null;
    events.push({ s, e, t: title, ...(time ? { time } : {}) });
  }
  events.sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
  return events;
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const cal = CALENDARS[q.school];
  const { start, end } = q;
  if (!cal || !DATE_RX.test(start || "") || !DATE_RX.test(end || "")) {
    return { statusCode: 400, body: JSON.stringify({ error: "bad params" }) };
  }
  const ua = { "User-Agent": "brandonvalleylunch.com school app" };
  const grab = async (url) => {
    const r = await fetch(url, { headers: ua });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    return r.text();
  };

  try {
    const mine = SCHOOL_MATCHERS[q.school];
    const others = Object.entries(SCHOOL_MATCHERS)
      .filter(([id]) => id !== q.school && SECONDARY.has(id) !== SECONDARY.has(q.school))
      .map(([, rx]) => rx);
    // A Bound event belongs to this school if it names it, or (for secondary
    // schools) if it's a district activity that no other level claims.
    const keepBound = (title, where) => {
      const t = `${title} ${where}`;
      // Grade level beats venue: a 7th-grade game played on an elementary
      // field is still a middle-school event.
      if (!SECONDARY.has(q.school) && SECONDARY_EVENT.test(title)) return false;
      if (mine && mine.test(t)) return true;
      if (!SECONDARY.has(q.school)) return false;
      return !others.some((rx) => rx.test(t)) &&
        !Object.entries(SCHOOL_MATCHERS).some(([id, rx]) => id !== q.school && rx.test(t));
    };

    const [googleIcs, boundIcs] = await Promise.all([
      grab(`https://calendar.google.com/calendar/ical/${encodeURIComponent(cal)}/public/basic.ics`),
      grab(BOUND_ICS).catch(() => null), // activities are a bonus, never fatal
    ]);

    const events = parseIcs(googleIcs, start, end);
    if (boundIcs) {
      const seen = new Set(events.map((e) => `${e.s}|${e.t.toLowerCase()}`));
      for (const ev of parseIcs(boundIcs, start, end, keepBound)) {
        const k = `${ev.s}|${ev.t.toLowerCase()}`;
        if (seen.has(k)) continue;
        seen.add(k);
        events.push(ev);
      }
      events.sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
    }
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=900",
        "Netlify-CDN-Cache-Control": "public, s-maxage=10800, stale-while-revalidate=86400",
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
