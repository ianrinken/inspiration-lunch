/* Grade semantics shared by the events function (which school an activity
 * belongs to) and the app (a child's view). One copy, so a title always
 * means the same grades on both sides.
 *
 * Grades are numbers: -1 junior kindergarten, 0 kindergarten, 1-12.
 */
(function (root) {
  "use strict";

  // Each building's grade span (Brandon Valley: elementary JrK-4,
  // Intermediate 5-6, Middle 7-8, High 9-12).
  const SPAN = {
    "041717d0-8f8d-ec11-8df7-eb7b319a32d1": [-1, 4],
    "d8f8bcbf-1b2a-f111-bb4f-02558335d9c7": [-1, 4],
    "af61ff49-908d-ec11-8df7-9c80cb6a95ae": [-1, 4],
    "0c65b2bc-908d-ec11-8df7-9566c4096294": [-1, 4],
    "ec90bc02-908d-ec11-8df7-eb7b319a32d1": [-1, 4],
    "82b0714f-8f8d-ec11-8df7-d30e05c96286": [5, 6],
    "2e94e37a-8f8d-ec11-8df7-eb7b319a32d1": [7, 8],
    "ffc1d3ff-8e8d-ec11-8df7-c6813137b210": [9, 12],
  };

  const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const HS = range(9, 12);

  // Team levels as the activities feed writes them, in parentheses. A level
  // is a set of grades that could be on that team: freshmen do make varsity
  // in the smaller sports, so Varsity is every high-school grade, not 11-12.
  const LEVELS = [
    [/\b(?:7th|seventh)\b/i, [7]],
    [/\b(?:8th|eighth)\b/i, [8]],
    [/\bmiddle school\b/i, [7, 8]],
    [/\bFR\/SO\b/i, [9, 10]],
    [/\b(?:freshm[ae]n|9th|9[AB])\b/i, [9]],
    [/\bsophomores?\b/i, [10]],
    [/\bjunior varsity\b|\bJV\b/i, [9, 10, 11]],
    [/\bvarsity\b/i, HS],
    [/\bhigh school\b|\bHS\b/i, HS],
    [/\bseniors?\b/i, [12]],
  ];

  // Programs the district only fields at the high school; the feed leaves
  // the level blank on some of their games ("Baseball: ... ()").
  const HS_ONLY = /^(?:CANCELLED - |POSTPONED - )?(?:Baseball|Softball|Boys Golf|Girls Golf|Boys Soccer|Girls Soccer|Boys Bowling|Girls Bowling|Competitive Cheer|Competitive Dance)\b/;

  const num = (s) => (/^k$/i.test(s) ? 0 : parseInt(s, 10));

  // The grades a title is about, or null when it says nothing about grade
  // (so the caller treats it as for everyone). Explicit grade wording
  // ("Grades 9-12", "7th Grade", "K-8") wins over a team level, and a
  // parenthetical level is read before loose words elsewhere in the title.
  const CLASS_TAGS = { "Freshman Class": 9, "Sophomore Class": 10, "Junior Class": 11, "Senior Class": 12 };

  function gradesFor(title, level, tags) {
    const t = String(title || "");
    const found = new Set();

    // "Grades 9-12", "Grades 5 & 6", "Grades 9 & 11 & New Students", "K-8"
    let m = t.match(/\bgrades?\s+(K|\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\b/i) || t.match(/\b(K)\s*-\s*(\d{1,2})\b/);
    if (m) range(num(m[1]), num(m[2])).forEach((g) => found.add(g));
    m = t.match(/\bgrades?\s+((?:K|\d{1,2})(?:\s*(?:&|and|,)\s*(?:K|\d{1,2}))+)\b/i);
    if (m) m[1].split(/\s*(?:&|and|,)\s*/).forEach((s) => found.add(num(s)));
    // "7th Grade", "1st & 3rd Grade", "5th-8th Grade", "Grade 3"
    for (const x of t.matchAll(/\b((?:\d{1,2}(?:st|nd|rd|th)\s*(?:&|and|,|\/|-|–)\s*)*\d{1,2}(?:st|nd|rd|th))\s+grade\b/gi)) {
      const nums = x[1].match(/\d{1,2}/g).map((n) => parseInt(n, 10));
      if (/[-–]/.test(x[1])) range(Math.min(...nums), Math.max(...nums)).forEach((g) => found.add(g));
      else nums.forEach((g) => found.add(g));
    }
    for (const x of t.matchAll(/\bgrade\s+(\d{1,2})\b/gi)) found.add(parseInt(x[1], 10));
    if (/\bkindergarten\b/i.test(t)) found.add(0);

    const valid = [...found].filter((g) => g >= -1 && g <= 12).sort((a, b) => a - b);
    if (valid.length) return valid;

    // The feed's class tags ("Senior Class"), possibly several.
    const classes = (tags || []).map((x) => CLASS_TAGS[x]).filter(Boolean).sort((a, b) => a - b);
    if (classes.length) return classes;

    // Team level: the feed's own field, or the parentheses in the title,
    // e.g. "(Junior Varsity)", "(Girls Varsity)".
    const levels = [level || ""].concat([...t.matchAll(/\(([^)]*)\)/g)].map((x) => x[1]));
    for (const lv of levels) {
      for (const [rx, grades] of LEVELS) if (lv && rx.test(lv)) return grades.slice();
    }
    if (HS_ONLY.test(t)) return HS.slice();
    // Academic milestones that come with a grade attached.
    if (/\bSenior Night\b/i.test(t)) return null; // team tradition, everyone goes
    if (/\bPSAT\b/.test(t)) return [10, 11];
    if (/\bACT\b/.test(t)) return [11, 12];
    if (/\bFAFSA\b|Financial Aid|Cap and Gown|Graduation Practice/i.test(t)) return [12];
    if (/\bProm\b|College (?:Visit|Fair)/i.test(t)) return [11, 12];
    // Loose class words, lowest priority: "Senior Retreat", "Freshman
    // Unity Day" -- but not "O'Gorman Junior High" or "Junior Varsity".
    const cls = t.match(/\b(freshm[ae]n|sophomores?|juniors?|seniors?)\b(?!\s+(?:varsity|high|kindergarten|citizens?|center))/i);
    if (cls) return [/^f/i.test(cls[1]) ? 9 : /^so/i.test(cls[1]) ? 10 : /^j/i.test(cls[1]) ? 11 : 12];
    if (/\bVar\b/.test(t)) return HS.slice(); // "Var FB Meal"
    return null;
  }

  // Could a student in this school's grade span be on the list?
  function fitsSchool(grades, schoolId) {
    const span = SPAN[schoolId];
    if (!grades || !span) return true;
    return grades.some((g) => g >= span[0] && g <= span[1]);
  }

  // Activities: titles shaped like a team event, "Volleyball: Brandon
  // Valley vs Marshall (Varsity)" or "Boys Golf (Fall): Metro Preview".
  // A meeting or a notice has no such shape.
  const TEAM_LEVEL = /\((?:7th|8th|9th|Junior Varsity|JV|Varsity|Girls Varsity|Sophomore|Freshman|FR\/SO|9[AB]|Middle School)[^)]*\)/i;
  const COMPETITION = /\svs\s|\sat\s|invite|invitational|tournament|jamboree|meet\b|classic|championship|scrimmage|quadrangular|triangular|dual\b/i;

  const PREFIX = /^([^:(]{3,40}?)\s*(?:\([^)]*\))?\s*:\s/;
  const strip = (title) => String(title || "").replace(/^(?:CANCELLED|POSTPONED)\s*-\s*/i, "");
  // Team business written with the program's abbreviation: "VB Team Meals",
  // "HS FB Awards Evening", "MS GBB Sports Meeting".
  const ABBREV = { FB: "Football", VB: "Volleyball", BBB: "Boys Basketball", GBB: "Girls Basketball" };
  const TEAM_BUSINESS = /\b(?:meals?|awards?|meeting|potluck|fundraiser|pictures?|camp|banquet|practice|concussion)\b/i;

  function activityName(title) {
    const t = strip(title);
    const m = t.match(PREFIX);
    if (m) return m[1].trim();
    // Only when exactly one program is named; a multi-sport meeting is
    // for everyone.
    const abbr = [...new Set(t.match(/\b(?:FB|VB|BBB|GBB)\b/g) || [])];
    return abbr.length === 1 && TEAM_BUSINESS.test(t) ? ABBREV[abbr[0]] : null;
  }

  function isActivity(title) {
    const t = strip(title);
    if (PREFIX.test(t)) return TEAM_LEVEL.test(t) || COMPETITION.test(t);
    return !!activityName(t);
  }

  // Short display form of a team level, or null if the text isn't one:
  // "Junior Varsity" -> "JV", "7th Grade A" -> "7th A", "Sophomore" -> "Soph".
  function levelShort(text) {
    const t = String(text || "").trim();
    if (!t) return null;
    let m;
    if ((m = t.match(/^(\d{1,2})(?:st|nd|rd|th) Grade(?: ([A-D]))?$/i))) return `${m[1]}th${m[2] ? ` ${m[2].toUpperCase()}` : ""}`;
    if (/^junior varsity$/i.test(t) || /^JV$/i.test(t)) return "JV";
    if (/^(?:girls |boys )?varsity$/i.test(t)) return "Varsity";
    if (/^sophomore$/i.test(t)) return "Soph";
    if (/^freshm[ae]n$/i.test(t)) return "9th";
    if (/^9[AB]$/i.test(t)) return t.toUpperCase();
    if (/^FR\/SO\b/i.test(t)) return t;
    if (/^middle school$/i.test(t)) return "MS";
    if (/^high school$/i.test(t)) return "HS";
    return null;
  }

  const api = { SPAN, gradesFor, fitsSchool, range, activityName, isActivity, levelShort };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BVGrades = api;
})(typeof self !== "undefined" ? self : this);
