/* Rules shared by the app and the calendar feed, so a subscribed phone
 * calendar shows exactly what the app shows. Loaded as a plain script in
 * the browser (window.SFSHARED) and required by netlify/functions/events.js.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SFSHARED = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // School-life entries worth a student's own view (the building calendars
  // also carry every club meeting and room booking).
  const HIGHLIGHT = /Homecoming|Dance|Prom|Picture|Pep Rally|Assembly|Spirit|Blood Drive|Flu Shot|Graduation|Concert|Musical|Play\b|Variety Show|Club Fair|Open House|Orientation|Coronation|Career Day|Parent|Yearbook|Cap and Gown/i;

  const SCHOOLWIDE = /Homecoming|\bProm\b|Pep Rally|Assembly|Graduation|Variety Show|Coronation|Spirit Week|Senior Night|Club Fair/i;

  // Date strings only ("YYYY-MM-DD"), done in UTC so no time zone can shift them.
  function addDays(ymd, n) {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  function weekday(ymd) {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }
  const isWeekend = (ymd) => weekday(ymd) === 0 || weekday(ymd) === 6;

  // District calendar rows -> app events for a date range.
  function districtItems(district, start, end, grade) {
    const out = [];
    for (const e of district) {
      if (e.d > end || (e.to || e.d) < start) continue;
      // grade: one grade (a student), [lo, hi] (a whole school), or null.
      if (e.grades && grade != null && !(Array.isArray(grade) ? e.grades.some((g) => g >= grade[0] && g <= grade[1]) : e.grades.includes(grade))) continue;
      const off = e.kind === "noschool" || e.kind === "break";
      out.push({ id: `dist-${e.d}-${e.kind}`, d: e.d, to: e.to, t: null, title: e.title, cat: off ? "noschool" : "district", district: true, kind: e.kind });
    }
    return out;
  }

  // State championships for the activities a student follows (from the
  // state association's published dates), shown like district dates.
  function stateFor(stateEvents, kid, start, end) {
    const acts = (kid.follows || []).map((f) => f.act);
    return (stateEvents || []).filter((e) => e.d <= end && (e.to || e.d) >= start && acts.some((a) => e.acts.test(a)))
      .map((e) => ({ id: `state-${e.d}-${e.title.replace(/\W+/g, "").slice(0, 20)}`, d: e.d, to: e.to, t: null, title: e.title, venue: e.venue, map: e.map || `${e.venue}, SD`, cat: "state", district: true, kind: "state" }));
  }

  function follows(kid, ev) {
    if (!ev.act) return false;
    return (kid.follows || []).some((f) => f.act === ev.act && (!f.level || f.level === ev.level));
  }
  const forGrade = (ev, grade) => !ev.g || ev.g.includes(grade);

  // A student's own view: school days, their grade's events, their teams.
  function mineFilter(kid, ev) {
    if (ev.district) return true;
    // School-wide nights are sometimes filed under a club ("Student Council:
    // Homecoming Dance"); every student sees those, not just members.
    // Middle school teams are by grade: a 7th grader's team, not the 8th's.
    if (ev.act) return (follows(kid, ev) && (kid.grade > 8 || forGrade(ev, kid.grade))) || (SCHOOLWIDE.test(ev.title.replace(/^[^:]+:\s*/, "")) && !/Competitive/i.test(ev.act));
    if (!forGrade(ev, kid.grade)) return false;
    if (ev.cat === "noschool" || ev.cat === "academic" || ev.cat === "college") return true;
    if (ev.cat === "school") return HIGHLIGHT.test(ev.title);
    return false;
  }
  // The whole building, minus other teams' practices.
  function allFilter(kid, ev) {
    if (ev.district) return true;
    if (ev.cat === "practice") return follows(kid, ev);
    return true;
  }

  // The district calendar names days off; drop the feed's own "No School"
  // entries on those days so a day off is listed once.
  function mergeDistrict(district, events, start, end, grade) {
    const dist = districtItems(district, start, end, grade);
    const offDays = new Set();
    for (const e of dist) {
      if (e.cat !== "noschool") continue;
      for (let d = e.d; d <= (e.to || e.d); d = addDays(d, 1)) offDays.add(d);
    }
    // A school calendar often repeats a district date under its own
    // wording ("End of First Quarter"): the district's copy wins.
    const norm = (x) => String(x || "").toLowerCase().replace(/^no school:\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
    const said = new Set(dist.map((e) => `${e.d}|${norm(e.title)}`));
    return dist.concat(events.filter((e) => !(e.cat === "noschool" && offDays.has(e.d)) && !said.has(`${e.d}|${norm(e.title)}`)));
  }

  function sortEvents(list) {
    const rank = (e) => (e.district ? 0 : e.cat === "noschool" ? 1 : e.t ? 2 : 1);
    return list.sort((a, b) => {
      if (a.d !== b.d) return a.d < b.d ? -1 : 1;
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return (a.t || "").localeCompare(b.t || "");
    });
  }

  // One game night is several feed entries, one per team level (9A, 9B,
  // JV, varsity). Show it once, with the levels and their times inside.
  function groupEvents(list) {
    const out = [];
    const byKey = new Map();
    for (const e of list) {
      if (!e.act || e.cat === "practice") { out.push(e); continue; }
      const key = `${e.d}|${e.title}|${e.home}`;
      const g = byKey.get(key);
      const part = { id: e.id, level: e.level || "", t: e.t, e: e.e, venue: e.venue, geo: e.geo, x: e.x, url: e.url, lt: e.lt, lz: e.lz };
      if (!g) {
        const head = { ...e, parts: [part] };
        byKey.set(key, head);
        out.push(head);
        continue;
      }
      g.parts.push(part);
      if (e.t && (!g.t || e.t < g.t)) g.t = e.t;
      if (e.e && (!g.e || e.e > g.e)) g.e = e.e;
    }
    for (const g of byKey.values()) {
      if (g.parts.length === 1) { delete g.parts; continue; }
      g.parts.sort((a, b) => (a.t || "").localeCompare(b.t || ""));
      g.ids = g.parts.map((p) => p.id);
      g.level = g.parts.map((p) => p.level).filter(Boolean).join(", ");
      g.x = g.parts.every((p) => p.x) ? 1 : undefined;
      const venues = [...new Set(g.parts.map((p) => p.venue).filter(Boolean))];
      // No location on any level is real (Bound leaves some blank): no venue.
      g.venue = venues.length === 0 ? undefined : venues.length === 1 ? venues[0] : joinVenues(venues);
    }
    return out;
  }

  // "X High School Gym Main" + "X High School Gym Auxiliary" ->
  // "X High School Gym Main and Gym Auxiliary".
  function joinVenues(venues) {
    if (venues.length < 2) return venues[0];
    const words = venues.map((v) => v.split(" "));
    const shortest = Math.min(...words.map((w) => w.length));
    let n = 0;
    while (n < shortest && words.every((w) => w[n] === words[0][n])) n++;
    const keep = Math.max(0, n - 1); // keep the last shared word ("Gym") on each part
    if (keep < 2) return venues.join(" and ");
    return `${words[0].slice(0, keep).join(" ")} ${words.map((w) => w.slice(keep).join(" ")).join(" and ")}`;
  }

  // One grade's short name: JK, K, 1st ... 12th.
  function gradeShort(n) {
    if (n === -1) return "JK";
    if (n === 0) return "K";
    const suf = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
    return `${n}${suf}`;
  }

  function gradeLabel(g) {
    if (!g || !g.length) return "";
    if (g.length === 1) return { "-1": "Junior kindergarten", 0: "Kindergarten", 9: "Freshmen", 10: "Sophomores", 11: "Juniors", 12: "Seniors" }[g[0]] || `${gradeShort(g[0])} grade`;
    if (g.join() === "11,12") return "Juniors, seniors";
    if (g.join() === "10,11") return "10th, 11th";
    return g.map(gradeShort).join(", ");
  }

  // Grades come from the graduating class, so students move up on their
  // own. The school year turns over July 1: a June graduate is still a
  // senior in June, and families see next year's grade over the summer.
  function yearEnd(ymd) {
    const [y, m] = ymd.split("-").map(Number);
    return m >= 7 ? y + 1 : y;
  }
  const gradeOf = (classOf, ymd) => 12 - (classOf - yearEnd(ymd));
  const classFor = (grade, ymd) => yearEnd(ymd) + (12 - grade);
  // The published school year a date belongs to (or the next one coming).
  function schoolYearFor(years, ymd) {
    return years.find((y) => ymd <= y.last && ymd >= addDays(y.first, -120)) || years.find((y) => ymd <= y.last) || years[years.length - 1];
  }

  // Compact, URL-safe description of a student for the calendar feed:
  // school, grade and teams only. Names never leave the phone.
  function encodeFeed(kid) {
    const f = (kid.follows || []).map((x) => (x.level ? `${x.act}~${x.level}` : x.act)).join("|");
    return { school: kid.school, classOf: String(kid.classOf), follows: f };
  }
  function decodeFollows(s) {
    return String(s || "").split("|").filter(Boolean).slice(0, 40).map((x) => {
      const [act, level] = x.split("~");
      return { act: act.slice(0, 60), level: (level || "").slice(0, 40) };
    });
  }

  // What a district alert means for a school day, however it's worded:
  // "2-hour late start", "starting classes 2 hours late", "opening two hours
  // late", "2-hour delay", "buildings are closed", "no classes", "dismiss
  // early", "e-learning day". Returns late2 | late1 | late | early | remote |
  // closed, or null when the text isn't about the school day at all.
  const N2 = "(?:two|2)", N1 = "(?:one|1)";
  const HRS = "[\\s-]*(?:hours?|hrs?)";
  const lateBy = (n) => new RegExp(`${n}${HRS}[\\s-]*(?:late|delay)|(?:late start|delay(?:ed)?(?: start)?)\\D{0,20}${n}${HRS}|(?:start|open|begin|class)\\w*(?:\\s+\\w+){0,2}\\s+${n}${HRS}\\s+late`);
  function alertKind(text) {
    const low = String(text || "").toLowerCase().replace(/\s+/g, " ");
    if (/remote learning|e-?learning|virtual learning|online learning|learn(ing)? (from|at) home|work from home/.test(low)) return "remote";
    if (/early (release|dismissal|out)|dismiss(ed|ing|al)?\b(\s+\w+){0,3}\s+early|release(d)? early|let out early/.test(low)) return "early";
    if (lateBy(N2).test(low)) return "late2";
    if (lateBy(N1).test(low)) return "late1";
    if (/late start|delayed start|start(ing|s)? late|open(ing|s)? late|delay(ed)?\b/.test(low)) return "late";
    // School still in session (only evening activities called off, say):
    // never a closing. "Cancelled" means closed only when it's school itself.
    if (/(school|classes)\b[^.]{0,30}\b(in session|as (normal|usual|scheduled)|will be held|on schedule)/.test(low)) return null;
    if (/\b(closed|closing|close)\b|no school|no classes|not in session|will not (be )?(hold|have) (school|classes)|(school|classes)\b[^.]{0,20}\bcancel+ed|cancel+ed\b[^.]{0,10}\b(school|classes)/.test(low)) return "closed";
    return null;
  }

  // Deadlines a parent of this grade shouldn't miss, between two dates:
  // the yearly ones in data.js plus ACT/SAT registration for 11th and 12th.
  // Each is { d, key, vars, url } so the app and push messages word it.
  function deadlinesFor(data, grade, start, end) {
    const out = [];
    for (const x of data.DEADLINES || []) if (x.g.includes(grade) && x.d >= start && x.d <= end) out.push({ d: x.d, key: x.key, vars: {}, url: x.url });
    if (grade >= 11) {
      for (const x of data.TEST_DATES || []) {
        const url = (data.TEST_LINKS || {})[x.test];
        if (x.reg >= start && x.reg <= end) out.push({ d: x.reg, key: "{test} registration closes for the {date} test", vars: { test: x.test, date: x.d }, url });
        if (x.late && x.late >= start && x.late <= end) out.push({ d: x.late, key: "Last day for late {test} registration ({date} test)", vars: { test: x.test, date: x.d }, url });
      }
    }
    return out.sort((a, b) => a.d.localeCompare(b.d));
  }

  return { alertKind, deadlinesFor, stateFor, yearEnd, gradeOf, classFor, schoolYearFor, HIGHLIGHT, addDays, weekday, isWeekend, districtItems, follows, forGrade, mineFilter, allFilter, mergeDistrict, sortEvents, groupEvents, gradeLabel, gradeShort, encodeFeed, decodeFollows };
});
