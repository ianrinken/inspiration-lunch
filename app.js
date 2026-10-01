/* Brandon Valley Lunch — daily school lunch menus for Brandon Valley School District.
 * Pulls live menu data from the LINQ Connect public API, month by month,
 * with a localStorage cache so the app keeps working offline.
 */
(() => {
  "use strict";

  const API_BASE = "https://api.linqconnect.com/api/FamilyMenu";
  const DISTRICT_ID = "b1d7358a-818b-ec11-90c7-d2d97b40e955"; // Brandon Valley School District

  // From api/FamilyMenuIdentifier?identifier=L36JZQ (district code AZB89G)
  const SCHOOLS = [
    { id: "041717d0-8f8d-ec11-8df7-eb7b319a32d1", name: "Brandon Elementary" },
    { id: "d8f8bcbf-1b2a-f111-bb4f-02558335d9c7", name: "Burkman Valley Elementary" },
    { id: "af61ff49-908d-ec11-8df7-9c80cb6a95ae", name: "Fred Assam Elementary" },
    { id: "0c65b2bc-908d-ec11-8df7-9566c4096294", name: "Inspiration Elementary" },
    { id: "ec90bc02-908d-ec11-8df7-eb7b319a32d1", name: "Robert Bennis Elementary" },
    { id: "82b0714f-8f8d-ec11-8df7-d30e05c96286", name: "BV Intermediate School" },
    { id: "2e94e37a-8f8d-ec11-8df7-eb7b319a32d1", name: "BV Middle School" },
    { id: "ffc1d3ff-8e8d-ec11-8df7-c6813137b210", name: "BV High School" },
  ];
  const DEFAULT_SCHOOL = "0c65b2bc-908d-ec11-8df7-9566c4096294"; // Inspiration Elementary

  const CACHE_PREFIX = "bvl-menu-v5:"; // v5: catch-all for unrecognized categories
  const EVENTS_PREFIX = "bvl-events-v7:"; // v7: Bound fields (program, grades, end, url, cancellations)
  const EVENTS_API = "/.netlify/functions/events";
  const SCHOOL_KEY = "bvl-school";
  const MENU_FRESH_MS = 30 * 60 * 1000;       // refetch menus older than 30min
  const EVENTS_FRESH_MS = 30 * 60 * 1000;     // refetch events older than 30min
  const EMPTY_FRESH_MS = 2 * 60 * 60 * 1000;  // recheck unposted months every 2h
  const SHEET_MAX_OPEN_MS = 5 * 60 * 1000;    // auto-close a day sheet left open this long
  const FAMILY_API = "/.netlify/functions/family";
  const FAMILY_KEY = "bvl-family"; // this device's family code, once one exists
  const PUSH_API = "/.netlify/functions/push";
  const PUSH_KEY = "bvl-push"; // "1" once this device asked for the evening heads-up
  const PUSH_PUBLIC = "BPwNi91GO_Q3BvtYJodMYYajTDU3b_opYxbzXLS7r4TDpdPaMqX4NWx-TSVW-trBTi8GZV-ob8TqKKuQELU1SI8";

  // Google's own four-color "G" mark, so the button is recognizable as
  // going to Google Calendar at a glance, not just by reading the label.
  const GOOGLE_G_ICON = `<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18z"/>
    <path fill="#FBBC05" d="M3.95 10.7A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.27-1.7V4.97H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.03z"/>
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z"/>
  </svg>`;

  // Standing alternate entrées offered alongside the day's hot meal.
  const ALTERNATE_RX = /bagel bag|uncrustable|jammer/i;

  const $ = (id) => document.getElementById(id);
  const calendarEl = $("calendar");
  const monthLabelEl = $("monthLabel");
  const statusEl = $("statusArea");
  const updatedEl = $("updatedNote");
  const weekdayRow = document.querySelector(".weekday-row");

  let schoolId = null;
  try { schoolId = localStorage.getItem(SCHOOL_KEY); } catch {}

  // Domain migration: accept a school preference handed over via ?school=…
  // (used when moving installs from bvlunch.netlify.app to the custom domain).
  const urlSchool = new URLSearchParams(location.search).get("school");
  if (urlSchool && SCHOOLS.some((s) => s.id === urlSchool)) {
    schoolId = urlSchool;
    try { localStorage.setItem(SCHOOL_KEY, urlSchool); } catch {}
    history.replaceState(null, "", location.pathname);
  }

  if (!SCHOOLS.some((s) => s.id === schoolId)) schoolId = DEFAULT_SCHOOL;

  /* ---------------- my kids (this device only, no names) ---------------- */

  // A child is a school, a grade and the activities they're in. Parents
  // switch between one child, all of them, or everything at a school. It
  // lives only in this browser's storage -- no account, no name, nothing
  // sent anywhere.
  const KIDS_KEY = "bvl-kids";
  // Whose phone this is. A student sets up one profile (their own grade
  // and activities) and the app talks to them, not about "your kids".
  // Student mode is high school only: everyone there is 13 or older, which
  // keeps the notification (a persistent identifier) out of COPPA's reach.
  const ROLE_KEY = "bvl-role";
  let role = "";
  try { role = localStorage.getItem(ROLE_KEY) || ""; } catch {}
  const isStudent = () => role === "student";
  const setRole = (r) => { role = r; try { localStorage.setItem(ROLE_KEY, r); } catch {} };
  const MODE_KEY = "bvl-mode"; // "all" | "kids" | a child's id
  const ACTIVITIES_PREFIX = "bvl-activities-v2:";
  const ACTIVITIES_FRESH_MS = 24 * 60 * 60 * 1000;
  const SHORT = {
    "041717d0-8f8d-ec11-8df7-eb7b319a32d1": "Brandon Elem",
    "d8f8bcbf-1b2a-f111-bb4f-02558335d9c7": "Burkman",
    "af61ff49-908d-ec11-8df7-9c80cb6a95ae": "Fred Assam",
    "0c65b2bc-908d-ec11-8df7-9566c4096294": "Inspiration",
    "ec90bc02-908d-ec11-8df7-eb7b319a32d1": "Bennis",
    "82b0714f-8f8d-ec11-8df7-d30e05c96286": "Intermediate",
    "2e94e37a-8f8d-ec11-8df7-eb7b319a32d1": "Middle",
    "ffc1d3ff-8e8d-ec11-8df7-c6813137b210": "High",
  };
  let kids = [];
  try { kids = JSON.parse(localStorage.getItem(KIDS_KEY) || "[]"); } catch {}
  kids = (Array.isArray(kids) ? kids : []).filter((k) =>
    k && typeof k.id === "string" && SCHOOLS.some((x) => x.id === k.school) && Number.isInteger(k.grade) && Array.isArray(k.acts));
  let mode = "all";
  try { mode = localStorage.getItem(MODE_KEY) || "all"; } catch {}

  // ?setup=… carries a family's kids (school, grade, activities; never a
  // name) from one device to another: texted to the other parent, or
  // opened in the installed app after setting up in Safari.
  const packSetup = (list) => btoa(JSON.stringify(list.map((k) =>
    [SCHOOLS.findIndex((x) => x.id === k.school), k.grade, k.acts]))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  let imported = 0;
  const setupParam = new URLSearchParams(location.search).get("setup");
  if (setupParam) {
    try {
      const list = JSON.parse(atob(setupParam.replace(/-/g, "+").replace(/_/g, "/")));
      for (const row of Array.isArray(list) ? list : []) {
        const [si, grade, acts] = row;
        const sch = SCHOOLS[si];
        if (!sch || !Number.isInteger(grade) || !Array.isArray(acts)) continue;
        const clean = { id: `${Date.now().toString(36)}${imported}`, school: sch.id, grade, acts: acts.filter((a) => typeof a === "string").sort(), year: schoolYear() };
        const dup = kids.some((k) => k.school === clean.school && k.grade === clean.grade && k.acts.join("|") === clean.acts.join("|"));
        if (!dup) { kids.push(clean); imported++; }
      }
      if (imported) {
        mode = kids.length > 1 ? "kids" : kids[0].id;
        try { localStorage.setItem(KIDS_KEY, JSON.stringify(kids)); localStorage.setItem(MODE_KEY, mode); } catch {}
      }
    } catch {}
    history.replaceState(null, "", location.pathname);
  }
  if (mode === "kids" ? kids.length < 2 : mode !== "all" && !kids.some((k) => k.id === mode)) mode = kids.length === 1 ? kids[0].id : "all";
  // School years turn over on July 1: feeds switch then, and August
  // events (band camp, freshman day) are tagged for the incoming grade.
  const schoolYear = (d = new Date()) => (d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1);
  const INTERMEDIATE_ID = "82b0714f-8f8d-ec11-8df7-d30e05c96286";
  const MIDDLE_ID = "2e94e37a-8f8d-ec11-8df7-eb7b319a32d1";
  const HIGH_ID = "ffc1d3ff-8e8d-ec11-8df7-c6813137b210";
  // The district has one path: any elementary -> Intermediate (5-6) ->
  // Middle (7-8) -> High (9-12). So each July every child moves up a grade
  // and, when the grade crosses a building line, to the next building.
  const schoolForGrade = (grade, current) =>
    grade >= 9 ? HIGH_ID : grade >= 7 ? MIDDLE_ID : grade >= 5 ? INTERMEDIATE_ID : current;
  let promoted = [], graduated = [];
  (() => {
    const now = schoolYear();
    let changed = false;
    kids = kids.filter((k) => {
      if (!Number.isInteger(k.year)) { k.year = now; changed = true; return true; }
      if (k.year >= now) return true;
      const steps = now - k.year;
      const grade = k.grade + steps;
      changed = true;
      if (grade > 12) { graduated.push(k); return false; }
      const before = kidLabelOf(k);
      k.grade = grade;
      k.school = schoolForGrade(grade, k.school);
      k.year = now;
      promoted.push(`${before} is now ${kidLabelOf(k)}`);
      return true;
    });
    if (changed) { try { localStorage.setItem(KIDS_KEY, JSON.stringify(kids)); } catch {} }
    // Keep the "moved up" notice until it's been read: a reload (the app
    // updating itself on the same open) must not swallow it.
    if (promoted.length || graduated.length) {
      const lines = [...promoted, ...graduated.map(() => "Your 12th grader graduated. Congratulations!")];
      try { localStorage.setItem("bvl-notice", JSON.stringify(lines)); } catch {}
    }
  })();

  const activeKids = () => (mode === "kids" ? kids : kids.filter((k) => k.id === mode));
  // The schools in play: a child's, every child's, or just the one picked.
  const activeSchools = () => {
    const ks = activeKids();
    return ks.length ? [...new Set(ks.map((k) => k.school))] : [schoolId];
  };
  if (activeKids().length) schoolId = activeKids()[0].school;

  function saveKids() {
    try {
      localStorage.setItem(KIDS_KEY, JSON.stringify(kids));
      localStorage.setItem(MODE_KEY, mode);
    } catch {}
    syncPush(); // the evening heads-up follows whatever the kids are now
    syncFamily(); // and so does the family code
  }

  // Ask the browser not to evict this site's saved data under storage
  // pressure. A deliberate "clear website data" still clears it; the
  // family code covers that.
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch {}

  function kidLabelOf(k) {
    const g = k.grade;
    const ord = `${g}${["th", "st", "nd", "rd"][(g % 100 > 10 && g % 100 < 14) || g % 10 > 3 ? 0 : g % 10]}`;
    return `${g === -1 ? "Jr. K" : g === 0 ? "K" : ord} · ${SHORT[k.school] || ""}`;
  }
  const schoolName = (id) => (SCHOOLS.find((s) => s.id === id) || {}).name || "";
  const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;
  const gradeShort = (g) => (g === -1 ? "Jr. K" : g === 0 ? "K" : ordinal(g));
  const gradeName = (g) => (g === -1 ? "Junior kindergarten" : g === 0 ? "Kindergarten" : `${ordinal(g)} grade`);
  const kidLabel = (k) => `${gradeShort(k.grade)} · ${SHORT[k.school]}`;

  // The relay already worked out grades (g) and the program (act) from the
  // feed's own fields; the title rules are the fallback for events that
  // come from a school's Google Calendar instead.
  const eventGrades = (ev) => ev.g || BVGrades.gradesFor(ev.t);
  const eventActivity = (ev) => ev.act || (BVGrades.isActivity(ev.t) ? BVGrades.activityName(ev.t) : null);

  // Is this event one of this child's? Anything that says nothing about
  // grade or activity is for everyone and stays -- hiding too much is
  // worse than showing a little extra.
  function kidAllows(ev, k) {
    const grades = eventGrades(ev);
    if (grades && !grades.includes(k.grade)) return false;
    if (k.acts.length) {
      const act = eventActivity(ev);
      if (act) return k.acts.includes(act);
    }
    return true;
  }
  // "Everything" shows a school whole; otherwise an event stays if any of
  // the selected children at that school would see it.
  function allowedFor(ev, school) {
    const ks = activeKids().filter((k) => k.school === school);
    return !ks.length || ks.some((k) => kidAllows(ev, k));
  }

  // Once brandonvalleylunch.com is live and serving this app, quietly move
  // old netlify.app installs there, carrying the saved school along. The
  // manifest check guarantees we never bounce anyone to a parking page.
  const NEW_HOME = "https://brandonvalleylunch.com";
  if (location.hostname === "bvlunch.netlify.app") {
    fetch(`${NEW_HOME}/manifest.webmanifest`, { mode: "cors" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((m) => {
        if (m && m.name === "Brandon Valley Lunch") {
          location.replace(`${NEW_HOME}/?school=${schoolId}`);
        }
      })
      .catch(() => { /* new domain not live yet — stay put */ });
  }

  // Captured before any of our own writes: a visitor with saved data has
  // used the app before, so "new feature" notices are meaningful to them.
  let isReturning = false;
  try { isReturning = Object.keys(localStorage).some((k) => k.startsWith("bvl-")); } catch {}

  /* ---------------- install banner ---------------- */

  const INSTALL_KEY = "bvl-install";
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  // iPadOS 13+ reports itself as a Mac, but a touch-capable "Mac" is an iPad.
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let deferredInstallPrompt = null;

  function dismissInstallBanner() {
    $("installBanner").hidden = true;
    try { localStorage.setItem(INSTALL_KEY, "done"); } catch {}
  }
  $("installClose").addEventListener("click", dismissInstallBanner);
  $("installBtn").addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    const p = deferredInstallPrompt;
    deferredInstallPrompt = null;
    p.prompt();
    await p.userChoice.catch(() => {});
    dismissInstallBanner();
  });
  window.addEventListener("appinstalled", dismissInstallBanner);

  let installDismissed = false;
  try { installDismissed = localStorage.getItem(INSTALL_KEY) === "done"; } catch {}
  if (!isStandalone && !installDismissed) {
    if (isIOS) {
      // iOS has no programmatic install prompt — only the share sheet.
      $("installText").textContent = "Add this app to your home screen: tap the Share icon, then “Add to Home Screen.”";
      $("installBanner").hidden = false;
    } else {
      window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        $("installText").textContent = "Add this app to your home screen for one-tap access to menus and events.";
        $("installBtn").hidden = false;
        $("installBanner").hidden = false;
      });
    }
  }

  const today = new Date();
  let view = { year: today.getFullYear(), month: today.getMonth() }; // month is 0-based
  let currentMonthData = null;   // parsed menu data for the viewed month
  let currentMonthEvents = {};   // per-day school events for the viewed month

  const TAB_KEY = "bvl-tab";
  let tab = "lunch";
  try { const t = localStorage.getItem(TAB_KEY); if (t === "events" || t === "school") tab = t; } catch {}

  /* ---------------- data ---------------- */

  const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;
  const cacheKey = (y, m, school) => `${CACHE_PREFIX}${school}:${monthKey(y, m)}`;

  function apiUrl(y, m, school) {
    const last = new Date(y, m + 1, 0).getDate();
    return `${API_BASE}?buildingId=${school}&districtId=${DISTRICT_ID}` +
      `&startDate=${m + 1}-1-${y}&endDate=${m + 1}-${last}-${y}`;
  }

  function cleanName(name) {
    return name
      .replace(/\s*\((elem|ms|hs)\.?\)\s*/gi, " ")
      .replace(/,\s*frozen\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  // Reduce the (large) API payload to just what the app renders.
  function parseMenu(json) {
    const out = { days: {}, holidays: {}, empty: true };
    for (const cal of (json && json.AcademicCalendars) || []) {
      for (const day of cal.Days || []) {
        if (!day.Date || !day.Note) continue;
        const [mm, dd, yy] = day.Date.split("/").map(Number);
        out.holidays[`${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`] = day.Note;
      }
    }
    const sessions = json && json.FamilyMenuSessions;
    if (!Array.isArray(sessions)) return out;
    const lunch = sessions.find((s) => s.ServingSession === "Lunch");
    if (!lunch || !Array.isArray(lunch.MenuPlans)) return out;

    for (const plan of lunch.MenuPlans) {
      for (const day of plan.Days || []) {
        const meals = day.MenuMeals || [];
        if (!meals.length) continue;
        const d = {
          entree: null,   // the day's hot meal
          sides: [],      // grain/veg served with the hot meal
          alternates: [], // standing alternates (Bagel Bag, Uncrustable, …)
          vegetable: [],
          fruit: [],
          milk: [],
          condiments: [],
        };
        for (const meal of meals) {
          const mealName = (meal.MenuMealName || "").toLowerCase();
          const isFirstMeal = meal === meals[0];
          for (const cat of meal.RecipeCategories || []) {
            const catName = (cat.CategoryName || "").toLowerCase();
            for (const r of cat.Recipes || []) {
              const recipe = cleanName(r.RecipeName || "");
              if (!recipe) continue;
              if (catName.includes("entr")) {
                // First non-standing entrée on the hot line is the day's meal;
                // everything else marked entrée (second hot choice, standing
                // alternates, MS/HS "Cold Grab n' Go Line") is an alternate.
                if (isFirstMeal && !d.entree && !ALTERNATE_RX.test(recipe)) {
                  d.entree = recipe;
                } else if (!d.alternates.includes(recipe)) {
                  d.alternates.push(recipe);
                }
              } else if (isFirstMeal) {
                d.sides.push(recipe); // grain / soup that comes with the hot meal
              } else if (mealName.includes("garden") || catName.includes("veg") || catName.includes("fruit")) {
                if (catName.includes("fruit")) d.fruit.push(recipe);
                else d.vegetable.push(recipe);
              } else if (catName.includes("milk")) {
                d.milk.push(recipe);
              } else if (catName.includes("condiment")) {
                d.condiments.push(recipe);
              } else {
                // A category we don't otherwise recognize (none exist in
                // current data, but LINQ's naming has drifted before) —
                // surface it rather than silently dropping the item.
                d.condiments.push(recipe);
              }
            }
          }
        }
        if (d.entree || d.alternates.length) {
          const [mm, dd, yy] = day.Date.split("/").map(Number);
          const key = `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
          out.days[key] = d;
          out.empty = false;
        }
      }
    }
    return out;
  }

  function readCache(y, m, school) {
    try {
      const raw = localStorage.getItem(cacheKey(y, m, school));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function writeCache(y, m, parsed, school) {
    try {
      localStorage.setItem(cacheKey(y, m, school), JSON.stringify({ fetchedAt: Date.now(), ...parsed }));
    } catch { /* storage full/unavailable — app still works from network */ }
  }

  async function fetchMonth(y, m, school = schoolId) {
    const res = await fetch(apiUrl(y, m, school), { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const parsed = parseMenu(await res.json());
    writeCache(y, m, parsed, school);
    return { fetchedAt: Date.now(), ...parsed };
  }

  // Cache-first month data for the hero (doesn't touch the calendar view).
  async function getMonthData(y, m, school = schoolId) {
    const cached = readCache(y, m, school);
    if (cached && Date.now() - cached.fetchedAt < (cached.empty ? EMPTY_FRESH_MS : MENU_FRESH_MS)) return cached;
    try { return await fetchMonth(y, m, school); }
    catch { return cached; }
  }

  /* ---------------- school events (public Google Calendars via relay) ---------------- */

  // {'YYYY-MM-DD': [{t, time?, multi}]} for every day an event covers
  function eventsByDay(events) {
    const map = {};
    for (const ev of events || []) {
      const multi = addDaysIso(ev.s, 1) < ev.e;
      for (let d = ev.s; d < ev.e; d = addDaysIso(d, 1)) {
        (map[d] = map[d] || []).push({
          t: ev.t, time: ev.time, stamp: ev.stamp, end: ev.end, id: ev.id, where: ev.where, home: ev.home,
          act: ev.act, g: ev.g, url: ev.url, x: ev.x, sch: ev.sch, multi,
        });
      }
    }
    return map;
  }

  // Display form of a title: "Volleyball: Brandon Valley vs Marshall
  // (Varsity)" -> { title: "Volleyball vs Marshall", level: "Varsity" }.
  // Brandon Valley is implied everywhere in this app, and the level is
  // better shown beside the title than buried inside it.
  function compact(t) {
    let title = t, level = "";
    const m = t.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    if (m && BVGrades.levelShort(m[2])) { title = m[1]; level = BVGrades.levelShort(m[2]); }
    title = title
      .replace(/\s*\((?:Fall|Spring|Winter)\)/, "") // "Boys Golf (Fall)" is just Boys Golf here
      .replace(/^([^:]+):\s*Brandon Valley\s+(vs|at)\s+/, "$1 $2 ");
    return { title, level };
  }

  // Youngest to oldest, so a row reads "7th A, 8th A" or "9th, Soph, JV, Varsity".
  const LEVEL_ORDER = ["7th", "8th", "MS", "9th", "9A", "9B", "FR/SO", "Soph", "JV", "Varsity", "HS"];
  const levelRank = (l) => { const i = LEVEL_ORDER.findIndex((p) => l.startsWith(p)); return i < 0 ? 99 : i; };

  // One line per program-and-opponent: the day's three Marshall volleyball
  // matches (JV, Soph, Varsity) read as a single row with all three levels.
  function summarize(evs) {
    const groups = [];
    for (const ev of evs) {
      const { title, level } = compact(ev.t);
      let g = groups.find((x) => x.title === title && !!x.x === !!ev.x);
      if (!g) { g = { title, levels: [], time: ev.time, stamp: ev.stamp, where: ev.where, home: ev.home, x: ev.x, sch: ev.sch, n: 0 }; groups.push(g); }
      if (level && !g.levels.includes(level)) { g.levels.push(level); g.levels.sort((a, b) => levelRank(a) - levelRank(b) || a.localeCompare(b)); }
      if (ev.stamp && (!g.stamp || ev.stamp < g.stamp)) { g.stamp = ev.stamp; g.time = ev.time; }
      g.n++;
    }
    return groups;
  }
  const groupLine = (g) => [g.title, g.levels.join(", "), g.time].filter(Boolean).join(" · ");

  function addDaysIso(iso, n) {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + n);
    return dkey(d);
  }

  async function getEventsData(y, m, school) {
    const key = `${EVENTS_PREFIX}${school}:${monthKey(y, m)}`;
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
    if (cached && Date.now() - cached.fetchedAt < EVENTS_FRESH_MS) return cached;
    try {
      const last = new Date(y, m + 1, 0).getDate();
      const start = `${y}-${String(m + 1).padStart(2, "0")}-01`;
      const end = addDaysIso(`${y}-${String(m + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`, 1);
      const res = await fetch(`${EVENTS_API}?school=${school}&start=${start}&end=${end}`);
      if (!res.ok) throw new Error(`events ${res.status}`);
      const fresh = { fetchedAt: Date.now(), events: (await res.json()).events || [] };
      try { localStorage.setItem(key, JSON.stringify(fresh)); } catch {}
      return fresh;
    } catch { return cached; } // menus never depend on events working
  }

  // The month's events for whoever is selected: one school, or every
  // school the chosen children attend, each filtered to those children
  // and (when more than one school) tagged with the school.
  async function monthEvents(y, m) {
    const schools = activeSchools();
    const parts = await Promise.all(schools.map((sch) => getEventsData(y, m, sch)));
    const all = [];
    parts.forEach((d, i) => {
      const sch = schools[i];
      for (const ev of (d && d.events) || []) {
        if (!allowedFor(ev, sch)) continue;
        all.push(schools.length > 1 ? { ...ev, sch } : ev);
      }
    });
    if (schools.length > 1) {
      all.sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : (a.stamp || "") < (b.stamp || "") ? -1 : (a.stamp || "") > (b.stamp || "") ? 1 : 0));
    }
    return eventsByDay(all);
  }

  /* ---------------- today hero ---------------- */

  const fmtHero = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
  const fmtShort = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });
  const dkey = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

  // Parents mostly check the night before: after lunchtime the hero looks
  // ahead to the next school day instead of today.
  function heroStart() {
    const now = new Date();
    const probe = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (now.getHours() >= 13) probe.setDate(probe.getDate() + 1);
    return probe;
  }

  function heroLabel(target) {
    const now = new Date();
    const t1 = new Date(now); t1.setDate(t1.getDate() + 1);
    return dkey(target) === dkey(now) ? "Today"
      : dkey(target) === dkey(t1) ? "Tomorrow"
      : "Next school day";
  }

  // Each render supersedes the last: a school, child or tab switch while
  // a fetch is in flight must never paint into the hero.
  let heroToken = 0;
  function renderHero() {
    const token = ++heroToken;
    const stale = () => token !== heroToken;
    if (tab === "school") { $("hero").hidden = true; $("heroLinks").hidden = true; return Promise.resolve(); }
    return tab === "events" ? renderEventsHero(stale) : renderLunchHero(stale);
  }

  function heroCard() {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hero-card";
    b.innerHTML = `<p class="hero-kicker"></p><p class="hero-entree"></p><p class="hero-sides"></p><p class="hero-alt"></p>`;
    return b;
  }
  function showCards(cards) {
    const wrap = $("heroCards");
    wrap.innerHTML = "";
    cards.forEach((c) => wrap.appendChild(c));
    $("hero").hidden = !cards.length;
  }

  // The next weekday on or after d — weekends never carry school events.
  function nextWeekday(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate() + 1);
    return x;
  }

  const rowLine = (g) =>
    `<span class="hero-row"><b>${esc(g.title)}</b>${g.levels.length ? ` · ${esc(g.levels.join(", "))}` : ""}` +
    `${g.time ? ` · ${esc(g.time)}` : ""}${g.sch ? ` · ${esc(SHORT[g.sch])}` : ""}` +
    `${g.x ? ` · <i>${g.x === "postponed" ? "Postponed" : "Cancelled"}</i>` : ""}</span>`;

  async function renderEventsHero(stale) {
    let byDay = {};
    const loaded = new Set();
    const ensureMonth = async (dt) => {
      const k = `${dt.getFullYear()}-${dt.getMonth()}`;
      if (loaded.has(k)) return;
      loaded.add(k);
      byDay = { ...byDay, ...(await monthEvents(dt.getFullYear(), dt.getMonth())) };
    };

    // Always the next school day itself — never skip ahead to find one that
    // happens to have events; an empty day honestly reads "No events".
    const target = nextWeekday(heroStart());
    await ensureMonth(target);
    if (stale()) return;
    const key = dkey(target);
    const evs = byDay[key] || [];

    const card = heroCard();
    const groups = summarize(evs);
    const lead = groups[0] || null;
    // A competition leads the day: say so where "Tomorrow" usually goes.
    const gameDay = lead && lead.home !== undefined && !lead.x;
    card.querySelector(".hero-kicker").innerHTML = `<span>${esc(gameDay ? `Game day · ${heroLabel(target).toLowerCase()}` : heroLabel(target))}</span> · <span>${esc(fmtHero.format(target))}</span>`;
    $("heroLinks").hidden = true;
    card.querySelector(".hero-entree").textContent = !lead ? "No events"
      : `${lead.x ? (lead.x === "postponed" ? "Postponed: " : "Cancelled: ") : ""}${lead.title}`;
    card.querySelector(".hero-sides").textContent = !lead ? "" : [
      lead.sch ? SHORT[lead.sch] : null,
      lead.levels.join(", "),
      lead.time,
      lead.home === true ? "Home" : lead.home === false ? "Away" : null,
      lead.where,
    ].filter(Boolean).join(" · ");
    const rest = groups.slice(1);
    card.querySelector(".hero-alt").innerHTML = rest.slice(0, 3).map(rowLine).join("") +
      (rest.length > 3 ? `<span class="hero-row">+${rest.length - 3} more</span>` : "");
    card.classList.toggle("no-tap", !evs.length);
    card.onclick = evs.length ? () => { showMonthOf(target); openSheet(key, null, "events", evs); } : null;
    showCards([card]);

    // Coming up: the next few things after the hero day, across the next
    // two weeks, so the tab answers "what's this week" at a glance.
    $("heroTomorrow").hidden = true;
    const up = $("heroUpcoming");
    const rows = [];
    const d = new Date(target);
    for (let i = 0; i < 14 && rows.length < 5; i++) {
      d.setDate(d.getDate() + 1);
      await ensureMonth(d);
      if (stale()) return;
      const k = dkey(d);
      for (const g of summarize(byDay[k] || [])) {
        if (rows.length >= 5) break;
        rows.push({ k, day: new Date(d), g });
      }
    }
    // One collapsed line by default so the hero stays next to the tabs.
    // Opening it lasts for the visit, not forever: every fresh open of the
    // app starts collapsed, on every device.
    let openUp = false;
    try { openUp = sessionStorage.getItem("bvl-upcoming") === "open"; } catch {}
    const peek = rows[0] ? `${fmtShort.format(rows[0].day).split(",")[0]}: ${rows[0].g.title}${rows.length > 1 ? ` +${rows.length - 1} more` : ""}` : "";
    const chevron = `<svg class="up-chev" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    up.classList.toggle("open", openUp);
    up.innerHTML = rows.length ? `<button type="button" class="up-toggle" aria-expanded="${openUp}"><span class="up-title">Coming up</span>` +
      `<span class="up-peek">${esc(peek)}</span>${chevron}</button><div class="up-list">` + rows.map((r) =>
      `<button type="button" class="up-row" data-key="${r.k}"><span class="up-day">${esc(fmtShort.format(r.day))}</span>` +
      `<span class="up-what"><b>${esc(r.g.title)}</b>${r.g.levels.length ? ` · ${esc(r.g.levels.join(", "))}` : ""}` +
      `${r.g.time ? ` · ${esc(r.g.time)}` : ""}${r.g.sch ? ` · ${esc(SHORT[r.g.sch])}` : ""}` +
      `${r.g.x ? ` · <i>${r.g.x === "postponed" ? "Postponed" : "Cancelled"}</i>` : ""}</span></button>`
    ).join("") + `</div>` : "";
    const toggle = up.querySelector(".up-toggle");
    if (toggle) toggle.addEventListener("click", () => {
      const now = !up.classList.contains("open");
      up.classList.toggle("open", now);
      toggle.setAttribute("aria-expanded", String(now));
      try { sessionStorage.setItem("bvl-upcoming", now ? "open" : "closed"); } catch {}
    });
    up.querySelectorAll(".up-row").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.key;
      const [y, m, dd] = k.split("-").map(Number);
      showMonthOf(new Date(y, m - 1, dd));
      openSheet(k, null, "events", byDay[k] || []);
    }));
    up.hidden = !rows.length;
  }

  // Students get the bell schedule one tap from the lunch card.
  async function renderStudentLinks() {
    const el = $("heroLinks");
    if (!isStudent()) { el.hidden = true; return; }
    const info = await getSchoolInfo(HIGH_ID);
    const bell = info && (info.links || []).find((l) => /bell schedule|class time/i.test(l.label));
    if (!bell || tab !== "lunch") { el.hidden = true; return; }
    el.innerHTML = "";
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.textContent = "Bell schedule";
    b.addEventListener("click", () => {
      const kind = viewable(bell);
      if (kind) openViewerSheet("Bell schedule", bell.view || bell.href, kind); else window.open(bell.href, "_blank", "noopener");
    });
    el.appendChild(b);
    el.hidden = false;
  }

  // The next published lunch at one school, plus the one after it.
  async function nextLunch(school, stale) {
    const probe = heroStart();
    let days = {};
    const loaded = new Set();
    const ensureMonth = async (dt) => {
      const k = `${dt.getFullYear()}-${dt.getMonth()}`;
      if (loaded.has(k)) return;
      loaded.add(k);
      const md = await getMonthData(dt.getFullYear(), dt.getMonth(), school);
      days = { ...days, ...((md && md.days) || {}) };
    };
    let target = null;
    for (let i = 0; i < 45; i++) {
      await ensureMonth(probe);
      if (stale()) return null;
      if (days[dkey(probe)]) { target = new Date(probe); break; }
      probe.setDate(probe.getDate() + 1);
    }
    if (!target) return null;
    const info = days[dkey(target)];
    let after = null;
    const p2 = new Date(target);
    for (let i = 0; i < 7; i++) {
      p2.setDate(p2.getDate() + 1);
      await ensureMonth(p2);
      if (stale()) return null;
      if (days[dkey(p2)]) { after = { date: new Date(p2), info: days[dkey(p2)] }; break; }
    }
    return { target, info, after };
  }

  async function renderLunchHero(stale) {
    // "All my kids" across two buildings: one card per school, so the
    // night-before glance still answers for every child.
    const schools = activeSchools();
    const found = await Promise.all(schools.map((sch) => nextLunch(sch, stale)));
    if (stale()) return;
    const now = new Date();
    const t1 = new Date(now); t1.setDate(t1.getDate() + 1);
    const cards = [];
    found.forEach((r, i) => {
      if (!r) return;
      const sch = schools[i];
      const card = heroCard();
      card.querySelector(".hero-kicker").innerHTML = schools.length > 1
        ? `<span>${esc(SHORT[sch])}</span> · <span>${esc(heroLabel(r.target))}</span>`
        : `<span>${esc(heroLabel(r.target))}</span> · <span>${esc(fmtHero.format(r.target))}</span>`;
      card.querySelector(".hero-entree").textContent = r.info.entree || r.info.alternates[0] || "";
      card.querySelector(".hero-sides").textContent = r.info.sides.length ? `with ${r.info.sides.join(" · ")}` : "";
      card.querySelector(".hero-alt").innerHTML = r.info.alternates.length
        ? `or: <b>${r.info.alternates.map(esc).join("</b> · <b>")}</b>` : "";
      if (isStudent()) {
        // A student's day is lunch AND what's after school, in one card.
        const evHost = document.createElement("p");
        evHost.className = "hero-events";
        evHost.hidden = true;
        card.appendChild(evHost);
        monthEvents(r.target.getFullYear(), r.target.getMonth()).then((byDay) => {
          if (stale()) return;
          const groups = summarize(byDay[dkey(r.target)] || []);
          if (!groups.length) return;
          evHost.innerHTML = groups.slice(0, 3).map((g) =>
            `${esc(g.title)}${g.levels.length ? ` · ${esc(g.levels.join(", "))}` : ""}${g.time ? ` · ${esc(g.time)}` : ""}` +
            `${g.home === true ? " · Home" : g.home === false ? " · Away" : ""}`).join("<br>") +
            (groups.length > 3 ? `<br>+${groups.length - 3} more` : "");
          evHost.hidden = false;
        });
      }
      card.onclick = () => {
        if (schoolId !== sch) { mode = kids.find((k) => k.school === sch) ? mode : "all"; schoolId = sch; syncPicker(); }
        showMonthOf(r.target);
        openSheet(dkey(r.target), r.info);
      };
      cards.push(card);
    });
    showCards(cards);

    // One-line teaser for the school day after the hero day (single school).
    $("heroUpcoming").hidden = true;
    renderStudentLinks();
    const teaser = $("heroTomorrow");
    teaser.hidden = true;
    const one = schools.length === 1 && found[0] && found[0].after;
    if (one) {
      const word = dkey(one.date) === dkey(t1) ? "Tomorrow" : fmtHero.format(one.date).split(",")[0];
      teaser.innerHTML = `${word}: <b>${esc(one.info.entree || one.info.alternates[0] || "")}</b>`;
      teaser.hidden = false;
    }
  }

  /* ---------------- calendar ---------------- */

  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const fmtDay = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });

  function isToday(y, m, d) {
    const now = new Date();
    return y === now.getFullYear() && m === now.getMonth() && d === now.getDate();
  }

  function render() {
    document.getElementById("main").classList.toggle("school-tab", tab === "school");
    $("schoolView").hidden = tab !== "school";
    if (tab === "school") { renderSchoolView(); return; }
    const { year, month } = view;
    monthLabelEl.textContent = `${MONTHS[month]} ${year}`;
    calendarEl.innerHTML = "";
    statusEl.hidden = true;
    statusEl.innerHTML = "";
    if (tab === "events") renderEventsView();
    else renderLunchView();
  }

  function showStatus(html, retry) {
    calendarEl.hidden = true;
    weekdayRow.style.display = "none";
    statusEl.hidden = false;
    statusEl.innerHTML = html;
    const btn = $("retryBtn");
    if (btn) btn.addEventListener("click", retry);
  }

  // Walk the month a day at a time. Lunch is a Mon–Fri affair; school events
  // (games, ACT testing, tournaments) happen on weekends too.
  function eachDay(year, month, makeCell, weekends) {
    const lastDate = new Date(year, month + 1, 0).getDate();
    let started = false;
    for (let d = 1; d <= lastDate; d++) {
      const dow = new Date(year, month, d).getDay(); // 0=Sun
      if (!weekends && (dow === 0 || dow === 6)) continue;
      if (!started) {
        const col = weekends ? (dow + 6) % 7 : dow - 1; // weeks start Monday
        for (let i = 0; i < col; i++) calendarEl.appendChild(emptyCell());
        started = true;
      }
      const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      calendarEl.appendChild(makeCell(d, key, dow));
    }
  }

  function renderLunchView() {
    const { year, month } = view;
    const data = currentMonthData;
    const days = (data && data.days) || {};

    if (!Object.keys(days).length) {
      if (data && data.error) {
        showStatus(`
          <h2>Couldn&rsquo;t load the menu</h2>
          <p>Check your connection and try again. If you&rsquo;ve opened this month before, it would show from memory.</p>
          <button id="retryBtn">Try again</button>`, () => loadMonth(true));
      } else {
        showStatus(`
          <h2>Menu not posted yet</h2>
          <p>The district hasn&rsquo;t published the ${MONTHS[month]} menu on LINQ Connect. Check back closer to the month.</p>
          <button id="retryBtn">Check again</button>`, () => loadMonth(true));
      }
      renderUpdated();
      return;
    }

    calendarEl.hidden = false;
    weekdayRow.style.display = "";

    // The phone list hides no-school days outside the in-session range
    // (mid-session holidays like Labor Day still show).
    const schoolDays = Object.keys(days).sort();
    const firstSchool = schoolDays[0], lastSchool = schoolDays[schoolDays.length - 1];

    calendarEl.classList.remove("week7");
    weekdayRow.classList.remove("week7");
    eachDay(year, month, (d, key) => {
      // Outside the published range we know nothing — never claim "no school".
      const unpublished = !days[key] && (key < firstSchool || key > lastSchool);
      const cell = dayCell(d, key, days[key], unpublished);
      if (unpublished) cell.classList.add("out-of-session");
      return cell;
    }, false);
    renderUpdated();
  }

  function renderEventsView() {
    const { year, month } = view;
    const hasAny = Object.keys(currentMonthEvents).length > 0;

    if (!hasAny) {
      showStatus(`
        <h2>No events posted</h2>
        <p>Nothing on the ${MONTHS[month]} school calendar yet. Events come straight from the school&rsquo;s official calendar.</p>
        <button id="retryBtn">Check again</button>`, () => loadMonth(true));
      return;
    }

    calendarEl.hidden = false;
    weekdayRow.style.display = "";
    calendarEl.classList.add("week7");
    weekdayRow.classList.add("week7");
    eachDay(year, month, (d, key) => eventCell(d, key), true);
    renderUpdated();
  }

  function emptyCell() {
    const el = document.createElement("div");
    el.className = "day-cell empty";
    return el;
  }

  const DOW_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function isPast(y, m, d) {
    const now = new Date();
    return new Date(y, m, d) < new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function cellState(dayNum) {
    const { year, month } = view;
    return isToday(year, month, dayNum) ? " today" : (isPast(year, month, dayNum) ? " past" : "");
  }

  function cellTop(dayNum, dow) {
    return `<span class="day-top"><span class="day-num">${dayNum}</span><span class="day-dow">${DOW_ABBR[dow]}</span></span>`;
  }

  function eventCell(dayNum, key) {
    const { year, month } = view;
    const dow = new Date(year, month, dayNum).getDay();
    const evs = currentMonthEvents[key] || [];
    if (!evs.length) {
      const el = document.createElement("div");
      el.className = "day-cell ev-empty" + cellState(dayNum);
      el.dataset.dow = dow;
      el.innerHTML = cellTop(dayNum, dow);
      return el;
    }
    const groups = summarize([...evs.filter((ev) => !ev.multi), ...evs.filter((ev) => ev.multi)]);
    const first = groups[0];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "day-cell" + cellState(dayNum);
    btn.dataset.dow = dow;
    btn.setAttribute("aria-label", `${fmtDay.format(new Date(year, month, dayNum))}: ${groupLine(first)}`);
    btn.innerHTML = `${cellTop(dayNum, dow)}<span class="day-entree"></span>${groups.length > 1 ? `<span class="day-more">+${groups.length - 1} more</span>` : ""}`;
    btn.querySelector(".day-entree").textContent = groupLine(first);
    btn.addEventListener("click", () => openSheet(key, null, "events"));
    return btn;
  }

  function dayCell(dayNum, key, info, unpublished) {
    const { year, month } = view;
    const dow = new Date(year, month, dayNum).getDay();
    const state = cellState(dayNum);
    const top = cellTop(dayNum, dow);
    const holidays = (currentMonthData && currentMonthData.holidays) || {};

    if (!info) {
      const el = document.createElement("div");
      el.className = "day-cell no-school" + state;
      el.dataset.dow = dow;
      el.innerHTML = `${top}<span class="day-note"></span>`;
      el.querySelector(".day-note").textContent = unpublished
        ? "Menu not posted"
        : (holidays[key] || "No school");
      return el;
    }
    const name = info.entree || info.alternates[0] || "";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "day-cell" + state;
    btn.dataset.dow = dow;
    btn.setAttribute("aria-label", `${fmtDay.format(new Date(year, month, dayNum))}: ${name}`);
    btn.innerHTML = `${top}<span class="day-entree"></span>`;
    btn.querySelector(".day-entree").textContent = name;
    btn.addEventListener("click", () => openSheet(key, info));
    return btn;
  }

  function renderUpdated() {
    if (tab === "events") { updatedEl.textContent = ""; return; }
    const data = currentMonthData;
    if (!data || !data.fetchedAt) { updatedEl.textContent = ""; return; }
    const mins = Math.round((Date.now() - data.fetchedAt) / 60000);
    let when;
    if (mins < 2) when = "just now";
    else if (mins < 60) when = `${mins} min ago`;
    else if (mins < 36 * 60) when = `${Math.round(mins / 60)}h ago`;
    else when = new Date(data.fetchedAt).toLocaleDateString();
    const which = activeSchools().length > 1 ? `${schoolName(schoolId)} menu · ` : "";
    updatedEl.textContent = which + (data.fromCache ? `Showing saved menu · updated ${when}` : `Updated ${when}`);
    updatedEl.classList.toggle("stale", !!data.fromCache && mins > 36 * 60);
  }

  /* ---------------- detail sheet ---------------- */

  const sheet = $("daySheet");
  const backdrop = $("sheetBackdrop");
  let sheetOpener = null;
  let sheetOpenedAt = null;
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

  // Google Calendar's public "quick add" URL -- no login/API key needed,
  // opens a pre-filled new event for the person to review and save
  // themselves. Only takes one event at a time (Google's own limitation),
  // unlike the multi-select .ics export below.
  // "HHMMSS" -> "6:30 PM"
  function fmtStamp(stamp) {
    const h = parseInt(stamp.slice(0, 2), 10);
    return `${((h + 11) % 12) + 1}:${stamp.slice(2, 4)} ${h < 12 ? "AM" : "PM"}`;
  }

  function googleCalUrl(dayKey, ev) {
    const datePart = dayKey.replace(/-/g, "");
    let dates;
    if (ev.stamp) {
      const h = parseInt(ev.stamp.slice(0, 2), 10);
      const endStamp = ev.end || String((h + 1) % 24).padStart(2, "0") + ev.stamp.slice(2);
      dates = `${datePart}T${ev.stamp}/${datePart}T${endStamp}`;
    } else {
      dates = `${datePart}/${addDaysIso(dayKey, 1).replace(/-/g, "")}`;
    }
    const params = new URLSearchParams({ action: "TEMPLATE", text: ev.t, dates });
    if (ev.stamp) params.set("ctz", "America/Chicago");
    if (ev.where) params.set("location", ev.where);
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  // The hero can point at a day in the month after the one on screen (the
  // night of the 30th), so it hands over that day's events itself rather
  // than relying on the viewed month's data.
  function openSheet(key, info, mode = "lunch", events = null) {
    const [y, m, d] = key.split("-").map(Number);
    $("sheetDate").textContent = fmtDay.format(new Date(y, m - 1, d));
    const dayEvents = events || currentMonthEvents[key] || [];
    const sections = [];
    if (mode === "events") {
      const rows = dayEvents.map((ev, i) => {
        const when = ev.time ? ` · ${ev.time}${ev.end ? ` to ${fmtStamp(ev.end)}` : ""}` : "";
        const { title, level } = compact(ev.t);
        const label = `<span class="ev-title${ev.x === "cancelled" ? " ev-off" : ""}">${esc(title)}</span>${level ? ` · ${esc(level)}` : ""}${esc(when)}`;
        const id = ev.id || String(i);
        const bits = [];
        if (ev.sch) bits.push(`<b class="ev-sch">${esc(SHORT[ev.sch])}</b>`);
        if (ev.x) bits.push(`<b class="ev-x">${ev.x === "postponed" ? "Postponed" : "Cancelled"}</b>`);
        if (ev.where) {
          const badge = ev.home === true ? `<b class="at-home">Home</b> · `
            : ev.home === false ? `<b class="at-away">Away</b> · ` : "";
          bits.push(`${badge}${esc(ev.where)}`);
        }
        // Bound's page for the event: tickets, directions, changes.
        if (ev.url) bits.push(`<a class="ev-link" href="${esc(ev.url)}" target="_blank" rel="noopener">Details</a>`);
        const sub = bits.length ? `<span class="ev-where">${bits.join(" · ")}</span>` : "";
        return `<li><label class="ev-pick">` +
          `<input type="checkbox" class="ev-check" value="${esc(id)}">` +
          `<span>${label}${sub}</span></label></li>`;
      }).join("");
      sections.push(`<div class="menu-section"><h3>At school</h3><ul>${rows}</ul></div>`);
    }
    info = info || { entree: null, sides: [], alternates: [], vegetable: [], fruit: [], milk: [], condiments: [] };
    if (info.entree) {
      const items = [{ name: info.entree, hero: true }, ...info.sides.map((s) => ({ name: s }))];
      sections.push(section("Main Entrée", items));
    }
    if (info.alternates.length) sections.push(section("Or choose instead", info.alternates.map((n) => ({ name: n }))));
    if (info.vegetable.length) sections.push(section("Garden Bar · Vegetables", info.vegetable.map((n) => ({ name: n }))));
    if (info.fruit.length) sections.push(section("Garden Bar · Fruit", info.fruit.map((n) => ({ name: n }))));
    if (info.milk.length) sections.push(section("Milk", info.milk.map((n) => ({ name: n }))));
    if (info.condiments.length) sections.push(section("Condiments", info.condiments.map((n) => ({ name: n }))));
    $("sheetBody").innerHTML = sections.join("");
    if (mode === "events" && dayEvents.length) {
      // A real link (not script) so iOS hands the file to the Calendar app.
      const a = document.createElement("a");
      a.className = "sheet-action";
      a.addEventListener("click", (e) => {
        if (a.classList.contains("disabled")) e.preventDefault();
      });

      // Same footprint and behavior as the button above, but goes straight
      // to Google Calendar specifically -- labeled plainly so it's never
      // ambiguous which calendar it's headed to. Google's own quick-add
      // link only takes one event at a time, so unlike the button above
      // this one is only active when exactly one box is checked.
      const g = document.createElement("a");
      g.className = "sheet-action sheet-action-google";
      g.target = "_blank";
      g.rel = "noopener";
      g.innerHTML = `${GOOGLE_G_ICON}<span>Add to Google Calendar</span>`;
      g.addEventListener("click", (e) => {
        if (g.classList.contains("disabled")) e.preventDefault();
      });

      const boxes = [...$("sheetBody").querySelectorAll(".ev-check")];
      const sync = () => {
        const picked = boxes.filter((b) => b.checked).map((b) => b.value);
        a.classList.toggle("disabled", !picked.length);
        a.textContent = picked.length > 1
          ? `Add ${picked.length} to my calendar`
          : "Add to my calendar";
        // Picked events may come from more than one school ("all my kids").
        const schools = [...new Set(picked.map((id) => (dayEvents.find((ev) => ev.id === id) || {}).sch || schoolId))];
        a.href = picked.length
          ? `${EVENTS_API}?school=${schools.join(",")}&start=${key}&end=${addDaysIso(key, 1)}` +
            `&format=ics&ids=${picked.join(",")}`
          : "#";

        const onlyPicked = picked.length === 1 ? dayEvents.find((ev) => ev.id === picked[0]) : null;
        g.classList.toggle("disabled", !onlyPicked);
        g.href = onlyPicked ? googleCalUrl(key, onlyPicked) : "#";
      };
      boxes.forEach((b) => b.addEventListener("change", sync));
      // One event on the day: nothing to choose between, so pre-select it.
      if (boxes.length === 1) boxes[0].checked = true;
      sync();
      $("sheetBody").appendChild(a);
      const hint = document.createElement("p");
      hint.className = "sheet-hint";
      hint.textContent = "Google Calendar only adds one event at a time.";
      $("sheetBody").appendChild(hint);
      $("sheetBody").appendChild(g);
    }
    showSheet(Date.now());
  }

  function section(title, items) {
    return `<div class="menu-section"><h3>${esc(title)}</h3><ul>` +
      items.map((i) => `<li${i.hero ? ' class="hero-item"' : ""}>${esc(i.name)}</li>`).join("") +
      `</ul></div>`;
  }

  function closeSheet() {
    sheet.classList.remove("show"); backdrop.classList.remove("show");
    setTimeout(() => {
      sheet.hidden = true; backdrop.hidden = true;
      // Hand focus back to whatever opened the sheet.
      try { if (sheetOpener && sheetOpener.isConnected) sheetOpener.focus({ preventScroll: true }); } catch {}
      sheetOpener = null;
      sheetOpenedAt = null;
    }, 280);
  }

  // Swipe down to close: the sheet follows the finger when the drag starts
  // on the handle or header, or on content that's scrolled to the top, and
  // lets go past a third of its height (or a quick flick).
  (() => {
    const sheetBody = $("sheetBody");
    let startY = null, startT = 0, dy = 0, dragging = false;
    const reset = () => {
      sheet.style.transition = ""; sheet.style.transform = "";
      backdrop.style.transition = ""; backdrop.style.opacity = "";
    };
    sheet.addEventListener("touchstart", (e) => {
      if (sheet.hidden || e.touches.length !== 1) return;
      const inBody = sheetBody.contains(e.target);
      if (inBody && sheetBody.scrollTop > 0) return; // let the content scroll
      startY = e.touches[0].clientY; startT = Date.now(); dy = 0; dragging = false;
    }, { passive: true });
    sheet.addEventListener("touchmove", (e) => {
      if (startY === null) return;
      dy = e.touches[0].clientY - startY;
      if (!dragging) {
        if (dy < 8) { if (dy < -8) startY = null; return; } // upward: not a dismiss
        dragging = true;
        sheet.style.transition = "none"; backdrop.style.transition = "none";
      }
      if (e.cancelable) e.preventDefault(); // we own this gesture now
      sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
      backdrop.style.opacity = String(Math.max(0, 1 - dy / sheet.offsetHeight));
    }, { passive: false });
    const end = () => {
      if (startY === null) return;
      const quick = Date.now() - startT < 300 && dy > 40;
      const far = dy > Math.min(140, sheet.offsetHeight / 3);
      startY = null;
      if (dragging && (quick || far)) {
        reset();
        closeSheet();
      } else {
        reset(); // snaps back through the normal transition
      }
      dragging = false;
    };
    sheet.addEventListener("touchend", end);
    sheet.addEventListener("touchcancel", end);
  })();

  // Keep Tab inside the dialog while it is open.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || sheet.hidden) return;
    const focusable = sheet.querySelectorAll("button, a[href], input, [tabindex]:not([tabindex='-1'])");
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!sheet.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  });
  $("sheetClose").addEventListener("click", closeSheet);
  backdrop.addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) closeSheet(); });

  // openedAt feeds the stale-sheet auto-close; null means never auto-close
  // (a parent mid-way through setting up a view shouldn't lose it).
  function showSheet(openedAt) {
    sheetOpener = document.activeElement;
    sheetOpenedAt = openedAt;
    sheet.hidden = false; backdrop.hidden = false;
    sheet.scrollTop = 0; $("sheetBody").scrollTop = 0;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      sheet.classList.add("show"); backdrop.classList.add("show");
    }));
    // Move the caret into the dialog so keyboard and screen-reader users
    // land inside it rather than back on the page behind.
    setTimeout(() => { try { $("sheetClose").focus({ preventScroll: true }); } catch {} }, 60);
  }

  /* ---------------- view editor ---------------- */

  async function getActivities(school) {
    const key = `${ACTIVITIES_PREFIX}${school}`;
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
    if (cached && Date.now() - cached.fetchedAt < ACTIVITIES_FRESH_MS) return cached.activities;
    try {
      const res = await fetch(`${EVENTS_API}?school=${school}&list=activities`);
      if (!res.ok) throw new Error(`activities ${res.status}`);
      const activities = (await res.json()).activities || [];
      try { localStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), activities })); } catch {}
      return activities;
    } catch { return cached ? cached.activities : null; }
  }

  const chip = (label, on, onClick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (on ? " on" : "");
    b.setAttribute("aria-pressed", String(on));
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  };
  const fill = (el, nodes) => { el.innerHTML = ""; nodes.forEach((n) => el.appendChild(n)); };
  const toggleIn = (list, x) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

  // Who is this phone for? Asked once, before the first profile.
  function openRoleSheet() {
    $("sheetDate").textContent = "Who's this phone for?";
    const body = $("sheetBody");
    body.innerHTML = `<p class="sheet-intro">Pick one. You can change it later under Edit.</p>`;
    const parent = document.createElement("button");
    parent.type = "button"; parent.className = "sheet-action"; parent.textContent = "A parent";
    parent.addEventListener("click", () => { setRole("parent"); openKidForm(null); });
    const student = document.createElement("button");
    student.type = "button"; student.className = "sheet-action sheet-action-quiet"; student.textContent = "A high school student";
    student.addEventListener("click", () => { setRole("student"); openKidForm(null); });
    body.appendChild(parent); body.appendChild(student);
    const hint = document.createElement("p");
    hint.className = "sheet-hint"; hint.textContent = "Student mode is for Brandon Valley High School. No name, no account, either way.";
    body.appendChild(hint);
    showSheet(null);
  }

  // The list of children, or straight to the form when there are none yet.
  function openKidsSheet() {
    if (!kids.length && !role) return openRoleSheet();
    if (isStudent()) return openKidForm(kids[0] || null);
    if (!kids.length) return openKidForm(null);
    $("sheetDate").textContent = "My kids";
    const body = $("sheetBody");
    body.innerHTML = `<div class="menu-section"><ul id="kidList"></ul></div>`;
    const list = $("kidList");
    for (const k of kids) {
      const li = document.createElement("li");
      li.className = "kid-row";
      li.innerHTML = `<span><span class="info-label">${esc(gradeName(k.grade))} · ${esc(schoolName(k.school))}</span>` +
        `<span class="info-sub">${esc(k.acts.length ? k.acts.join(", ") : "All activities")}</span></span>`;
      const actions = document.createElement("span");
      actions.className = "kid-actions";
      const sub = document.createElement("button");
      sub.type = "button"; sub.className = "link-btn"; sub.textContent = "Subscribe";
      sub.addEventListener("click", () => openSubscribeSheet(k));
      const edit = document.createElement("button");
      edit.type = "button"; edit.className = "link-btn"; edit.textContent = "Edit";
      edit.addEventListener("click", () => openKidForm(k));
      actions.appendChild(sub); actions.appendChild(edit);
      li.appendChild(actions);
      list.appendChild(li);
    }
    const add = document.createElement("button");
    add.type = "button"; add.className = "sheet-action"; add.textContent = "Add another child";
    add.addEventListener("click", () => openKidForm(null));
    body.appendChild(add);
    const share = document.createElement("button");
    share.type = "button"; share.className = "sheet-action sheet-action-quiet"; share.textContent = "Share my setup";
    share.addEventListener("click", shareSetup);
    body.appendChild(share);
    const hint = document.createElement("p");
    hint.className = "sheet-hint";
    hint.textContent = "Share sends a link that sets up the same kids on another phone, or in the installed app. No names, no account.";
    body.appendChild(hint);
    body.appendChild(familyBlock(null));
    body.appendChild(notificationsSection());
    if (kids.length === 1 && kids[0].school === HIGH_ID) {
      const who = document.createElement("button");
      who.type = "button"; who.className = "sheet-remove"; who.textContent = "This is a student's phone";
      who.addEventListener("click", () => { setRole("student"); openKidsSheet(); });
      body.appendChild(who);
    }
    showSheet(null);
  }

  // A calendar subscription: the phone's calendar app fetches this feed
  // itself, so games, changes and cancellations keep flowing with nothing
  // to tap. One child, or a whole school.
  function feedUrl(kid, school) {
    const p = new URLSearchParams({ school: kid ? kid.school : school, feed: "1" });
    if (kid) { p.set("grade", String(kid.grade)); if (kid.acts.length) p.set("acts", kid.acts.join(",")); }
    return `${location.origin}${EVENTS_API}?${p.toString()}`;
  }

  function openSubscribeSheet(kid, school) {
    const what = kid ? `${gradeName(kid.grade)} · ${schoolName(kid.school)}` : schoolName(school);
    const url = feedUrl(kid, school);
    $("sheetDate").textContent = "Subscribe";
    const body = $("sheetBody");
    body.innerHTML =
      `<p class="sheet-intro"><b>${esc(what)}</b><br>Your calendar app checks this feed on its own, so new games, ` +
      `time changes and cancellations show up without opening this app again.</p>`;
    // webcals:// = a subscription fetched over https. Plain webcal:// is
    // fetched over http, and this site redirects http away, which Apple's
    // fetcher doesn't reliably follow.
    const webcal = url.replace(/^https:\/\//, "webcals://").replace(/^http:\/\//, "webcal://");
    const apple = document.createElement("a");
    apple.className = "sheet-action";
    apple.href = webcal;
    apple.textContent = "Add to iPhone or Mac calendar";
    body.appendChild(apple);
    const appleHint = document.createElement("p");
    appleHint.className = "sheet-hint";
    appleHint.textContent = "Tap Subscribe when your phone asks. It then lives under Calendars as a subscribed calendar; make sure it's checked.";
    body.appendChild(appleHint);
    // Google Calendar opens its own "add this calendar" screen when handed
    // the feed address this way; no copying and pasting.
    const google = document.createElement("a");
    google.className = "sheet-action sheet-action-google";
    google.href = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
    google.target = "_blank"; google.rel = "noopener";
    google.innerHTML = `${GOOGLE_G_ICON}<span>Add to Google Calendar</span>`;
    body.appendChild(google);
    const copy = document.createElement("button");
    copy.type = "button"; copy.className = "link-btn copy-link";
    copy.textContent = "Copy the feed link instead";
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(url); toast("Link copied"); }
      catch { prompt("Copy this link:", url); }
    });
    body.appendChild(copy);
    const hint = document.createElement("p");
    hint.className = "sheet-hint";
    hint.textContent = "Google asks you to confirm, then the calendar syncs to the Google Calendar app on your phone. If it doesn't open, paste the copied link under Other calendars, From URL, on a computer.";
    body.appendChild(hint);
    showSheet(null);
  }

  /* ---------------- family code ---------------- */

  const familyCode = () => { try { return localStorage.getItem(FAMILY_KEY) || ""; } catch { return ""; } };
  const CODE_RX = /^[A-Z0-9]{6,12}$/;
  const cleanCode = (raw) => String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const kidsPayload = () => kids.map((k) => ({ school: k.school, grade: k.grade, acts: k.acts }));

  async function postFamily(payload) {
    const res = await fetch(FAMILY_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `family ${res.status}`), { status: res.status });
    return data;
  }

  // Claim the family's own code; refused if another family has it.
  async function createFamilyCode(raw) {
    const code = cleanCode(raw);
    if (!CODE_RX.test(code)) throw Object.assign(new Error("format"), { status: 0 });
    await postFamily({ action: "save", code, kids: kidsPayload(), create: true });
    try { localStorage.setItem(FAMILY_KEY, code); } catch {}
    return code;
  }

  let familyTimer = null;
  function syncFamily() {
    const code = familyCode();
    if (!code || !kids.length) return;
    clearTimeout(familyTimer);
    familyTimer = setTimeout(() => { postFamily({ action: "save", code, kids: kidsPayload() }).catch(() => {}); }, 800);
  }

  async function restoreFromCode(raw) {
    const code = cleanCode(raw);
    if (!CODE_RX.test(code)) throw Object.assign(new Error("format"), { status: 0 });
    const data = await postFamily({ action: "load", code });
    const list = (data.kids || []).filter((k) => SCHOOLS.some((x) => x.id === k.school) && Number.isInteger(k.grade) && Array.isArray(k.acts));
    if (!list.length) throw new Error("empty");
    kids = list.map((k, i) => ({ id: `${Date.now().toString(36)}${i}`, school: k.school, grade: k.grade, acts: [...k.acts].sort(), year: schoolYear() }));
    try { localStorage.setItem(FAMILY_KEY, code); } catch {}
    closeSheet();
    setMode(kids.length > 1 ? "kids" : kids[0].id);
    toast(kids.length === 1 ? "1 child restored" : `${kids.length} kids restored`);
  }

  const CODE_NOTE = "Remember this code, or write it down. Phones sometimes clear a website's saved settings for security " +
    "(Safari does it after a week without a visit). Your code brings this setup back on any phone. No names, no account.";

  // The code block shown in the child form and in My kids: pick a code, or
  // see the one already saved.
  function familyBlock(beforeCreate) {
    const wrap = document.createElement("div");
    wrap.className = "menu-section family";
    wrap.innerHTML = `<h3>${isStudent() ? "Backup code" : "Family code"}</h3>`;
    const paint = () => {
      const code = familyCode();
      [...wrap.querySelectorAll(":scope > :not(h3)")].forEach((n) => n.remove());
      if (code) {
        const p = document.createElement("p"); p.className = "family-code"; p.textContent = code;
        const note = document.createElement("p"); note.className = "sheet-note"; note.textContent = CODE_NOTE;
        wrap.appendChild(p); wrap.appendChild(note);
        return;
      }
      const note = document.createElement("p"); note.className = "sheet-note";
      note.textContent = (isStudent() ? "Optional. Pick a code only you would know, 6 to 12 letters and numbers. " : "Optional. Pick a code only your family would know, 6 to 12 letters and numbers. ") + CODE_NOTE;
      const row = document.createElement("div"); row.className = "code-row";
      const input = document.createElement("input");
      input.type = "text"; input.className = "code-input"; input.maxLength = 12; input.placeholder = "LYNXFAMILY26";
      input.autocomplete = "off"; input.spellcheck = false; input.setAttribute("autocapitalize", "characters"); input.setAttribute("aria-label", "Family code");
      const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = "Save code";
      b.addEventListener("click", async () => {
        const code = cleanCode(input.value);
        if (!CODE_RX.test(code)) { toast("6 to 12 letters and numbers"); return; }
        b.disabled = true;
        try {
          if (beforeCreate) beforeCreate();
          await createFamilyCode(code);
          toast("Family code saved");
          paint();
        } catch (err) {
          toast(err.status === 409 ? "That code is taken. Try another." : err.message === "pick a grade first" ? "Pick the grade first" : "Couldn't save the code right now");
          b.disabled = false;
        }
      });
      row.appendChild(input); row.appendChild(b);
      wrap.appendChild(note); wrap.appendChild(row);
    };
    paint();
    return wrap;
  }

  function openRestoreSheet() {
    $("sheetDate").textContent = "Restore my kids";
    const body = $("sheetBody");
    body.innerHTML = `<p class="sheet-intro">Enter the family code from your other phone, or from before your settings were cleared.</p>` +
      `<input id="restoreCode" class="code-input" type="text" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="12" placeholder="Your family code" aria-label="Family code">`;
    const go = document.createElement("button");
    go.type = "button"; go.className = "sheet-action"; go.textContent = "Restore";
    go.addEventListener("click", async () => {
      go.disabled = true;
      try { await restoreFromCode($("restoreCode").value); }
      catch (err) { toast(err.status === 404 ? "No kids under that code" : err.message === "format" ? "6 to 12 letters and numbers" : "Couldn't restore right now"); go.disabled = false; }
    });
    body.appendChild(go);
    showSheet(null);
    setTimeout(() => { try { $("restoreCode").focus(); } catch {} }, 350);
  }

  /* ---------------- evening heads-up (push) ---------------- */

  const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  function urlB64(b64) {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }
  const pushWanted = () => { try { return localStorage.getItem(PUSH_KEY) === "1"; } catch { return false; } };

  async function pushSubscription() {
    if (!pushSupported) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  async function postPush(payload) {
    const res = await fetch(PUSH_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`push ${res.status}`);
    return res.json();
  }

  // What the server should know: the kids (no names), or the picked school.
  const pushConfig = () => ({ kids: kids.map((k) => ({ school: k.school, grade: k.grade, acts: k.acts })), school: schoolId, role: role || "parent" });

  let syncTimer = null;
  function syncPush() {
    if (!pushWanted()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      try {
        const sub = await pushSubscription();
        if (sub) await postPush({ action: "subscribe", sub: sub.toJSON(), ...pushConfig() });
      } catch { /* next change will try again */ }
    }, 800);
  }

  async function enablePush() {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("denied");
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(PUSH_PUBLIC) }));
    await postPush({ action: "subscribe", sub: sub.toJSON(), ...pushConfig() });
    try { localStorage.setItem(PUSH_KEY, "1"); } catch {}
  }

  async function disablePush() {
    const sub = await pushSubscription();
    if (sub) {
      try { await postPush({ action: "unsubscribe", endpoint: sub.endpoint }); } catch {}
      try { await sub.unsubscribe(); } catch {}
    }
    try { localStorage.setItem(PUSH_KEY, "0"); } catch {}
  }

  function notificationsSection() {
    const wrap = document.createElement("div");
    wrap.className = "menu-section notify";
    wrap.innerHTML = `<h3>${isStudent() ? "Heads-ups" : "Evening heads-up"}</h3>`;
    const row = document.createElement("label");
    row.className = "notify-row";
    row.innerHTML = `<span><span class="info-label">${isStudent() ? "Tomorrow's lunch and your events at 7 pm, and a game-day ping at 7 am" : "Tomorrow's lunch and events, 7 pm"}</span>` +
      `<span class="info-sub" id="notifySub"></span></span><input type="checkbox" id="notifyToggle">`;
    wrap.appendChild(row);
    const box = row.querySelector("#notifyToggle");
    const sub = row.querySelector("#notifySub");
    const test = document.createElement("button");
    test.type = "button"; test.className = "link-btn notify-test"; test.textContent = "Send me one now";
    test.hidden = true;
    wrap.appendChild(test);

    const state = async () => {
      if (!pushSupported || (isIOS && !isStandalone)) {
        box.disabled = true;
        sub.textContent = isIOS && !isStandalone
          ? "On iPhone, add the app to your home screen first (Share, then Add to Home Screen), then turn this on from there."
          : "Not available in this browser.";
        return;
      }
      if (Notification.permission === "denied") {
        box.disabled = true;
        sub.textContent = "Notifications are blocked for this site in your phone's settings.";
        return;
      }
      const s = await pushSubscription();
      box.checked = !!s && pushWanted();
      test.hidden = !box.checked;
      sub.textContent = box.checked
        ? (isStudent() ? "One a night, plus one on game mornings." : kids.length ? "One notification a night, for each child." : `One notification a night, for ${schoolName(schoolId)}.`)
        : (isStudent() ? "One the evening before each school day, one on mornings you have a game. Nothing else, ever." : "A single notification the evening before each school day. Nothing else, ever.");
    };
    box.addEventListener("change", async () => {
      box.disabled = true;
      try {
        if (box.checked) { await enablePush(); toast("You'll hear from us at 7 pm"); }
        else { await disablePush(); toast("Evening heads-up turned off"); }
      } catch (err) {
        box.checked = !box.checked;
        toast(err && err.message === "denied" ? "Notifications weren't allowed" : "Couldn't set that up right now");
      }
      box.disabled = false;
      state();
    });
    test.addEventListener("click", async () => {
      test.disabled = true;
      try {
        const s = await pushSubscription();
        await postPush({ action: "test", endpoint: s.endpoint });
        toast("Sent. It should show up in a moment.");
      } catch { toast("Couldn't send a test right now"); }
      test.disabled = false;
    });
    state();
    return wrap;
  }

  async function shareSetup() {
    const url = `${location.origin}${location.pathname}?setup=${packSetup(kids)}`;
    const text = "Our kids' schools, grades and activities for Brandon Valley Lunch";
    if (navigator.share) {
      try { await navigator.share({ title: "Brandon Valley Lunch", text, url }); return; } catch { /* cancelled: fall through to copy */ }
    }
    try { await navigator.clipboard.writeText(url); toast("Link copied"); }
    catch { prompt("Copy this link:", url); }
  }

  function openKidForm(existing) {
    const student = isStudent();
    const draft = existing
      ? { ...existing, acts: [...existing.acts] }
      : { id: null, school: student ? HIGH_ID : schoolId, grade: null, acts: [] };
    $("sheetDate").textContent = student
      ? (existing ? "My schedule" : "Set up my schedule")
      : (existing ? "Edit child" : (kids.length ? "Add a child" : "Set up my kids"));
    const body = $("sheetBody");
    body.innerHTML = (student
      ? `<p class="sheet-intro">Pick your grade and what you're in. Events then shows what's yours; ` +
        `school-wide events always stay. This stays on your phone &mdash; no name, no account.</p>`
      : `<p class="sheet-intro">Pick the school, grade and activities. Events then shows what's theirs; ` +
        `school-wide events always stay. This stays on your phone &mdash; no name, no account.</p>` +
        `<div class="menu-section"><h3>School</h3><div class="chips grid" id="kSchool"></div></div>`) +
      `<div class="menu-section"><h3>Grade</h3><div class="chips" id="kGrade"></div></div>` +
      `<div class="menu-section" id="kActsWrap" hidden><h3>Activities</h3>` +
      `<p class="sheet-note" id="kActsNote"></p><div class="chips" id="kActs"></div></div>`;
    // While they're setting up the first child, offer the family code too,
    // so the "my settings vanished" case is covered from day one. The
    // code is created when they tap it, with the child included.
    if (!existing && !kids.length) {
      body.appendChild(familyBlock(() => {
        if (draft.grade === null) throw new Error("pick a grade first");
        commit();
      }));
      const restore = document.createElement("p");
      restore.className = "sheet-hint";
      restore.innerHTML = `Already have a ${student ? "backup" : "family"} code? <button type="button" class="wn-link" id="restoreLink">${student ? "Restore my schedule" : "Restore my kids"}</button>`;
      body.appendChild(restore);
      restore.querySelector("#restoreLink").addEventListener("click", openRestoreSheet);
    }
    const save = document.createElement("button");
    save.type = "button"; save.className = "sheet-action";
    save.textContent = existing || student ? "Save" : "Add";
    body.appendChild(save);
    let remove = null;
    // Put the draft into the kids list (used by Add, and by the code button
    // when it fires first).
    const commit = () => {
      if (!draft.grade && draft.grade !== 0) return;
      draft.acts = [...draft.acts].sort();
      if (draft.id) {
        kids = kids.map((k) => (k.id === draft.id ? draft : k));
      } else {
        draft.id = Date.now().toString(36);
        kids.push(draft);
      }
      draft.year = schoolYear();
      saveKids();
      renderKidBar();
    };
    if (existing) {
      remove = document.createElement("button");
      remove.type = "button"; remove.className = "sheet-remove"; remove.textContent = student ? "Clear my schedule" : "Remove this child";
      body.appendChild(remove);
    }

    function paint() {
      if ($("kSchool")) fill($("kSchool"), SCHOOLS.map((sch) => chip(sch.name, draft.school === sch.id, () => {
        if (draft.school === sch.id) return;
        draft.school = sch.id; draft.grade = null; draft.acts = [];
        paint(); loadActs();
      })));
      const [lo, hi] = BVGrades.SPAN[draft.school];
      fill($("kGrade"), BVGrades.range(lo, hi).map((g) => chip(gradeShort(g), draft.grade === g, () => {
        draft.grade = g; paint();
      })));
      save.classList.toggle("disabled", draft.grade === null);
    }
    let actsList = [];
    function paintActs() {
      const names = [...new Set([...actsList, ...draft.acts])].sort();
      fill($("kActs"), names.map((n) => chip(n, draft.acts.includes(n), () => {
        draft.acts = toggleIn(draft.acts, n); paintActs();
      })));
    }
    async function loadActs() {
      const forSchool = draft.school;
      const wrap = $("kActsWrap"), note = $("kActsNote");
      wrap.hidden = false; note.textContent = "Loading activities…"; fill($("kActs"), []);
      const list = await getActivities(forSchool);
      if (draft.school !== forSchool || !document.body.contains(wrap)) return;
      actsList = list || [];
      if (list === null) {
        note.textContent = "Activities couldn't load right now. Save anyway and add them later.";
      } else if (!list.length && !draft.acts.length) {
        wrap.hidden = true; // elementary: nothing to pick from
        return;
      } else {
        note.textContent = "Optional. Leave all off to keep every activity.";
      }
      paintActs();
    }

    save.addEventListener("click", () => {
      if (save.classList.contains("disabled")) return;
      const firstChild = !existing && kids.length === 0;
      commit();
      dismissWhatsNew();
      closeSheet();
      setMode(draft.id);
      if (firstChild) setTimeout(() => openSchoolTip(draft.school), 380);
    });
    if (remove) {
      remove.addEventListener("click", () => {
        const was = existing, at = kids.findIndex((k) => k.id === existing.id);
        kids = kids.filter((k) => k.id !== existing.id);
        closeSheet();
        setMode(mode === existing.id ? "all" : mode);
        toast("Child removed", () => {
          kids.splice(Math.min(at, kids.length), 0, was);
          setMode(was.id);
        });
      });
    }

    if (student && existing) {
      body.appendChild(familyBlock(null));
      const share = document.createElement("button");
      share.type = "button"; share.className = "sheet-action sheet-action-quiet"; share.textContent = "Share my schedule";
      share.addEventListener("click", shareSetup);
      body.appendChild(share);
      const hint = document.createElement("p");
      hint.className = "sheet-hint"; hint.textContent = "Share sends a link that sets up the same grade and activities on a friend's phone.";
      body.appendChild(hint);
      body.appendChild(notificationsSection());
      const who = document.createElement("button");
      who.type = "button"; who.className = "sheet-remove"; who.textContent = "This is a parent's phone";
      who.addEventListener("click", () => { setRole("parent"); openKidsSheet(); });
      body.appendChild(who);
    }
    paint();
    loadActs();
    showSheet(null);
  }

  /* ---------------- school info sheet ---------------- */

  const SCHOOL_API = "/.netlify/functions/school";
  const SCHOOL_INFO_PREFIX = "bvl-school-v3:"; // v3: no district calendar PDF (the app is the calendar)
  const SCHOOL_INFO_FRESH_MS = 24 * 60 * 60 * 1000;

  async function getSchoolInfo(school) {
    const key = `${SCHOOL_INFO_PREFIX}${school}`;
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
    if (cached && Date.now() - cached.fetchedAt < SCHOOL_INFO_FRESH_MS) return cached.info;
    try {
      const res = await fetch(`${SCHOOL_API}?school=${school}&v=3`);
      if (!res.ok) throw new Error(`school ${res.status}`);
      const info = await res.json();
      try { localStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), info })); } catch {}
      return info;
    } catch { return cached ? cached.info : null; }
  }

  /* ---------------- School tab ---------------- */

  // The building's page inside the app: today's status, the few things
  // parents reach for most, then everything the school's own site links
  // for families, read live so nothing here can go stale on our side.
  let schoolPick = null; // which school the tab shows when "All my kids" spans two
  let schoolToken = 0;

  const QUICK = [
    { label: "Call the office", test: (l) => false, phone: true },
    { label: "Report an absence", test: (l) => /attendance/i.test(l.label) && /^mailto:/.test(l.href) },
    { label: "Bell schedule", test: (l) => /bell schedule|class time/i.test(l.label) },
    { label: "Supply list", test: (l) => /supply/i.test(l.label) },
    { label: "Handbook", test: (l, span) => /handbook/i.test(l.group || "") && new RegExp(span, "i").test(l.label) },
    { label: "Counselors", test: (l) => /counsel/i.test(l.label) },
    { label: "Bus pass", test: (l) => /bus pass/i.test(l.label) },
    { label: "Lunch account", test: (l) => /lunch (?:account|money|pay)|myschoolbucks|revtrak/i.test(l.label) },
  ];
  const levelWord = (school) => {
    const [lo] = BVGrades.SPAN[school];
    return lo >= 9 ? "High School" : lo >= 7 ? "Middle School" : lo >= 5 ? "Intermediate" : "Elementary";
  };

  // Group a school's links by what they're for, rather than by which menu
  // the website keeps them in.
  const TOPICS = [
    ["contact", "Contact"],
    ["schedules", "Schedules and calendars"],
    ["school", "For school"],
    ["health", "Health"],
    ["activities", "Activities and clubs"],
    ["counseling", "Counseling and academics"],
    ["accounts", "Logins and accounts"],
    ["students", "Student resources"],
    ["district", "District notices"],
  ];
  function topicOf(l) {
    const t = `${l.label} ${l.group || ""}`;
    if (/attendance/i.test(t)) return "contact";
    if (/bell schedule|class time|calendar/i.test(t)) return "schedules";
    if (/nurse|health|allergy|concussion|medication|exclusion|seizure|immuniz|wellness/i.test(t)) return "health";
    if (/skyward|clever|cns menu|linq|lunch account|myschoolbucks/i.test(t)) return "accounts";
    if (/counsel|college|scholarship|transcript|library|academic/i.test(t)) return "counseling";
    if (/club|activity pass|booster|coaches|physical|athletic|student council|fine arts|band|choir|orchestra|theat/i.test(t)) return "activities";
    if (/ferpa|complaint|notice|policy|board/i.test(t)) return "district";
    if (/supply|handbook|bus pass|parking|forms?\b|drivers|registration|enroll|permit|picture/i.test(t)) return "school";
    if (l.section === "Students") return "students";
    if (l.section === "Activities") return "activities";
    if (l.section === "District") return "district";
    return "school";
  }

  // Show a document from the school's own site in place: a picture, or a
  // PDF in a frame. The original is always a tap away.
  function openViewerSheet(label, url, kind) {
    $("sheetDate").textContent = label;
    const body = $("sheetBody");
    body.innerHTML = kind === "image"
      ? `<img class="doc-img" src="${esc(url)}" alt="${esc(label)}">`
      : `<div class="doc-pages" id="docPages"><p class="sheet-note doc-loading">Loading…</p></div>`;
    const open = document.createElement("a");
    open.className = "sheet-action"; open.href = url; open.target = "_blank"; open.rel = "noopener";
    open.textContent = kind === "image" ? "Open the original" : "Open the full document";
    body.appendChild(open);
    const hint = document.createElement("p");
    hint.className = "sheet-hint"; hint.textContent = "From the school's website.";
    body.appendChild(hint);
    showSheet(null);
    if (kind === "pdf") renderPdf(url, $("docPages"));
  }

  // Draw a PDF's pages fitted to the sheet's width, so a phone scrolls
  // down through it instead of sideways. pdf.js loads on first use.
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
  const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  let pdfjsReady = null;
  async function renderPdf(url, host) {
    try {
      pdfjsReady = pdfjsReady || import(PDFJS).then((m) => { m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return m; });
      const pdfjs = await pdfjsReady;
      const doc = await pdfjs.getDocument({ url: `${SCHOOL_API}?doc=${encodeURIComponent(url)}` }).promise;
      if (!host.isConnected) return;
      host.innerHTML = "";
      const width = host.clientWidth || 320;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const total = Math.min(doc.numPages, 60);
      const slots = [];
      for (let n = 1; n <= total; n++) {
        const slot = document.createElement("div");
        slot.className = "doc-page";
        host.appendChild(slot);
        slots.push(slot);
      }
      const drawn = new Set();
      const draw = async (n) => {
        if (drawn.has(n)) return;
        drawn.add(n);
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const scale = width / base.width;
        const vp = page.getViewport({ scale: scale * dpr });
        const canvas = document.createElement("canvas");
        canvas.width = vp.width; canvas.height = vp.height;
        canvas.style.width = "100%";
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
        if (!host.isConnected) return;
        slots[n - 1].style.minHeight = "";
        slots[n - 1].appendChild(canvas);
      };
      // Size every slot from page 1's shape so the scrollbar is honest,
      // then draw pages as they come into view.
      const first = await doc.getPage(1);
      const ratio = first.getViewport({ scale: 1 }).height / first.getViewport({ scale: 1 }).width;
      slots.forEach((s) => { s.style.minHeight = `${Math.round(width * ratio)}px`; });
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) draw(slots.indexOf(e.target) + 1); });
      }, { root: $("sheetBody"), rootMargin: "600px 0px" });
      slots.forEach((s) => io.observe(s));
      await draw(1);
      if (doc.numPages > total) {
        const more = document.createElement("p");
        more.className = "sheet-note"; more.textContent = `Showing the first ${total} of ${doc.numPages} pages.`;
        host.appendChild(more);
      }
    } catch (err) {
      if (!host.isConnected) return;
      host.innerHTML = `<p class="sheet-note">Couldn't show the pages here. Use the button below to open it.</p>`;
    }
  }
  const viewable = (l) => (l.view ? "image" : l.doc ? "pdf" : null);

  // The supply list, read into sections: a child sees their grade (or, at
  // the middle school, the core list plus their classes), with the full
  // sheet one tap away.
  const SUPPLIES_PREFIX = "bvl-supplies-v1:";
  async function getSupplies(school) {
    const key = `${SUPPLIES_PREFIX}${school}`;
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
    if (cached && Date.now() - cached.fetchedAt < SCHOOL_INFO_FRESH_MS) return cached.data;
    try {
      const res = await fetch(`${SCHOOL_API}?school=${school}&supplies=1`);
      if (!res.ok) throw new Error(`supplies ${res.status}`);
      const data = await res.json();
      try { localStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), data })); } catch {}
      return data;
    } catch { return cached ? cached.data : null; }
  }

  async function openSuppliesSheet(school, link) {
    $("sheetDate").textContent = "Supply list";
    const body = $("sheetBody");
    body.innerHTML = `<p class="sheet-note doc-loading">Loading…</p>`;
    showSheet(null);
    const data = await getSupplies(school);
    if ($("sheetDate").textContent !== "Supply list" || sheet.hidden) return;
    const secs = [...((data && data.sections) || [])].sort((a, b) => (a.grade === null || b.grade === null) ? 0 : a.grade - b.grade);
    if (!secs.length) {
      // Can't read it: fall back to the sheet itself.
      body.innerHTML = "";
      const kind = viewable(link);
      if (kind) { openViewerSheet("Supply list", link.view || link.href, kind); return; }
      body.innerHTML = `<p class="sheet-intro">Couldn't read the list right now.</p>`;
      return;
    }
    const mine = activeKids().filter((k) => k.school === school);
    const graded = secs.some((sec) => sec.grade !== null);
    let pick = null;
    if (graded) {
      const grades = [...new Set(mine.map((k) => k.grade))];
      pick = grades.length === 1 ? secs.find((sec) => sec.grade === grades[0]) || secs[0] : secs[0];
    }
    const render = () => {
      body.innerHTML = "";
      if (graded) {
        const chips = document.createElement("div"); chips.className = "chips supply-pick";
        for (const sec of secs) chips.appendChild(chip(gradeShort(sec.grade), sec === pick, () => { pick = sec; render(); }));
        body.appendChild(chips);
        const h = document.createElement("h3"); h.className = "supply-h"; h.textContent = `${gradeName(pick.grade)} · ${schoolName(school)}`;
        body.appendChild(h);
        body.appendChild(list(pick.lines));
      } else {
        // Middle school: the core list, then the child's classes first.
        const acts = new Set(mine.flatMap((k) => k.acts.map((a) => a.toLowerCase())));
        const order = [...secs].sort((a, b) => rank(a) - rank(b));
        function rank(sec) { const t = sec.title.toLowerCase(); return /core/.test(t) ? 0 : [...acts].some((a) => t.includes(a.split(" ").pop())) ? 1 : 2; }
        for (const sec of order) {
          const h = document.createElement("h3"); h.className = "supply-h"; h.textContent = titleCase(sec.title);
          body.appendChild(h); body.appendChild(list(sec.lines));
        }
      }
      for (const n of (data.notes || [])) { const p = document.createElement("p"); p.className = "sheet-note"; p.textContent = n; body.appendChild(p); }
      const full = document.createElement("button");
      full.type = "button"; full.className = "sheet-action sheet-action-quiet"; full.textContent = "See the full list";
      full.addEventListener("click", () => { const kind = viewable(link); if (kind) openViewerSheet("Supply list", link.view || link.href, kind); else window.open(link.href, "_blank", "noopener"); });
      body.appendChild(full);
      const hint = document.createElement("p"); hint.className = "sheet-hint"; hint.textContent = "Read from the school's supply list. Check the full list if anything looks off.";
      body.appendChild(hint);
    };
    const list = (lines) => { const ul = document.createElement("ul"); ul.className = "supply-list"; for (const l of lines) { const li = document.createElement("li"); li.textContent = l; ul.appendChild(li); } return ul; };
    const titleCase = (t) => t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bPe\b/g, "PE").replace(/\bArt\b/g, "Art");
    render();
  }

  async function renderSchoolView() {
    const token = ++schoolToken;
    const stale = () => token !== schoolToken;
    const schools = activeSchools();
    if (!schools.includes(schoolPick)) schoolPick = schoolId;
    const school = schoolPick;
    const el = $("schoolView");

    // Today at this school: a school day (and what's for lunch), a day
    // off and why, or an early dismissal.
    const now = new Date();
    const key = dkey(now);
    const [md, ed, info] = await Promise.all([
      getMonthData(now.getFullYear(), now.getMonth(), school),
      getEventsData(now.getFullYear(), now.getMonth(), school),
      getSchoolInfo(school),
    ]);
    if (stale()) return;
    const todays = ((ed && ed.events) || []).filter((ev) => ev.s <= key && key < ev.e && allowedFor(ev, school));
    const off = (md && md.holidays && md.holidays[key]) || (todays.find((ev) => /\bno school\b/i.test(ev.t)) || {}).t;
    const early = todays.find((ev) => /early (?:dismissal|out|release)/i.test(ev.t));
    const weekend = now.getDay() === 0 || now.getDay() === 6;
    const lunch = md && md.days && md.days[key];
    let status;
    if (weekend) status = "No school today";
    else if (off) status = `No school: ${off.replace(/\s*-\s*no school/i, "")}`;
    else if (early) status = early.t;
    else if (lunch) status = `School day · Lunch: ${lunch.entree || lunch.alternates[0] || ""}`;
    else status = "School day";

    const pick = schools.length > 1
      ? `<div class="chips school-pick">${schools.map((sch) => `<button type="button" class="chip${sch === school ? " on" : ""}" data-school="${sch}">${esc(SHORT[sch])}</button>`).join("")}</div>`
      : "";
    const card = `<div class="hero-card school-card"><p class="hero-kicker"><span>Today</span> · <span>${esc(fmtHero.format(now))}</span></p>` +
      `<p class="hero-entree">${esc(schoolName(school))}</p><p class="hero-sides">${esc(status)}</p></div>`;

    let quick = "", sections = "";
    const viewers = []; // [id, label, url, kind] wired after paint
    const rowAttrs = (l, id) => {
      if (/supply/i.test(l.label) && /\.pdf$/i.test(l.href)) { viewers.push([id, "supplies", l, "supplies"]); return `href="#" data-view="${id}"`; }
      const kind = viewable(l);
      if (kind) { viewers.push([id, l.label, l.view || l.href, kind]); return `href="#" data-view="${id}"`; }
      return `href="${esc(l.href)}"${l.href.startsWith("mailto:") || l.href.startsWith("tel:") ? "" : ' target="_blank" rel="noopener"'}`;
    };
    if (info) {
      const links = info.links || [];
      const span = levelWord(school);
      const actions = [];
      if (info.phone) actions.push({ label: "Call the office", href: `tel:${info.phone.replace(/\D/g, "")}`, sub: info.phone });
      for (const q of QUICK) {
        if (q.phone) continue;
        const l = links.find((x) => q.test(x, span)) || (q.label === "Handbook" ? links.find((x) => /handbook/i.test(x.group || "")) : null);
        if (l) {
          const grades = [...new Set(activeKids().filter((k) => k.school === school).map((k) => k.grade))];
          const sub = q.label === "Supply list" && grades.length === 1 ? gradeName(grades[0]) : (l.label !== q.label ? l.label : "");
          actions.push({ ...l, label: q.label, sub });
        }
      }
      quick = actions.length ? `<div class="quick">${actions.slice(0, 6).map((a, n) =>
        `<a class="quick-btn" ${rowAttrs(a, `q${n}`)}><span class="quick-label">${esc(a.label)}</span>${a.sub ? `<span class="quick-sub">${esc(a.sub)}</span>` : ""}</a>`).join("")}</div>` : "";

      const row = (l, id, sub) =>
        `<li><a class="info-row" ${rowAttrs(l, id)}>` +
        `<span><span class="info-label">${esc(l.label)}</span>${sub ? `<span class="info-sub">${esc(sub)}</span>` : ""}</span></a></li>`;
      const groups = {};
      links.forEach((l, n) => { (groups[topicOf(l)] = groups[topicOf(l)] || []).push([l, `l${n}`]); });
      const parts = [];
      for (const [key, title] of TOPICS) {
        const items = [];
        if (key === "contact") {
          if (info.email) items.push(row({ label: "Email the office", href: `mailto:${info.email}` }, "c1", info.email));
          if (info.address) items.push(row({ label: "Address", href: `https://maps.apple.com/?q=${encodeURIComponent(info.address)}` }, "c2", info.address));
        }
        if (key === "schedules") {
          items.push(`<li><button type="button" class="info-row info-btn" id="schoolSubscribe"><span><span class="info-label">Subscribe to all school events</span>` +
            `<span class="info-sub">Keeps your phone's calendar up to date on its own</span></span></button></li>`);
        }
        for (const [l, id] of groups[key] || []) {
          const sub = l.group && !new RegExp(l.group.split("|")[0].trim().slice(0, 6), "i").test(l.label) ? l.group.replace(/\s*\|\s*/g, " · ") : "";
          items.push(row(l, id, sub));
        }
        if (key === "activities" && info.clubs && info.clubs.length) {
          items.push(info.clubs.map((c) => `<li class="club-row"><span class="info-label">${esc(c.name)}</span>` +
            `${c.advisor ? `<span class="info-sub">Advisor: ${esc(c.advisor)}</span>` : ""}</li>`).join(""));
        }
        if (items.length) parts.push(`<div class="menu-section"><h3>${esc(title)}</h3><ul>${items.join("")}</ul></div>`);
      }
      parts.push(`<p class="sheet-hint">From the school's website, checked daily. <a href="${esc(info.site)}" target="_blank" rel="noopener">Open the full site</a></p>`);
      sections = parts.join("");
    } else {
      sections = `<p class="sheet-intro">The school website isn't reachable right now. Try again in a bit.</p>`;
    }

    el.innerHTML = pick + card + quick + sections;
    el.querySelectorAll(".school-pick .chip").forEach((b) => b.addEventListener("click", () => { schoolPick = b.dataset.school; renderSchoolView(); }));
    const sub = $("schoolSubscribe");
    if (sub) sub.addEventListener("click", () => openSubscribeSheet(null, school));
    for (const [id, label, url, kind] of viewers) {
      el.querySelectorAll(`[data-view="${id}"]`).forEach((a) => a.addEventListener("click", (e) => {
        e.preventDefault();
        if (kind === "supplies") openSuppliesSheet(school, url); else openViewerSheet(label, url, kind);
      }));
    }
  }

  function renderSchoolLink() {}

  // Chips under the header, on every tab: one child, all of them, or the
  // whole school. Before anything is set up, just the invitation.
  function renderKidBar() {
    const bar = $("kidBar");
    if (!kids.length) {
      bar.innerHTML = "";
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip kid-add";
      b.textContent = isStudent() ? "Set up my schedule" : role === "parent" ? "Set up my kids" : "Get started";
      b.addEventListener("click", openKidsSheet);
      bar.appendChild(b);
      return;
    }
    const nodes = [chip("Everything", mode === "all", () => setMode("all"))];
    for (const k of kids) nodes.push(chip(isStudent() ? "My schedule" : kidLabel(k), mode === k.id, () => setMode(k.id)));
    if (kids.length > 1) nodes.push(chip("All my kids", mode === "kids", () => setMode("kids")));
    const edit = document.createElement("button");
    edit.type = "button"; edit.className = "link-btn kid-edit"; edit.textContent = "Edit";
    edit.addEventListener("click", openKidsSheet);
    nodes.push(edit);
    fill(bar, nodes);
  }

  // One line at the bottom, with Undo when the action is reversible.
  let toastTimer = null;
  function toast(text, undo) {
    const el = $("toast"), btn = $("toastUndo");
    $("toastText").textContent = text;
    btn.hidden = !undo;
    btn.onclick = undo ? () => { hideToast(); undo(); } : null;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 6000);
  }
  function hideToast() { clearTimeout(toastTimer); $("toast").hidden = true; }

  function syncPicker() {
    select.value = schoolId;
    $("schoolLabel").textContent = mode === "kids" && activeSchools().length > 1 ? "All my kids" : schoolName(schoolId);
    renderSchoolLink();
  }

  function setMode(m) {
    mode = m;
    if (mode === "kids" && kids.length < 2) mode = kids.length ? kids[0].id : "all";
    if (mode !== "all" && mode !== "kids" && !kids.some((k) => k.id === mode)) mode = "all";
    const ks = activeKids();
    if (ks.length) schoolId = ks[0].school;
    try { localStorage.setItem(SCHOOL_KEY, schoolId); } catch {}
    saveKids();
    syncPicker();
    renderKidBar();
    currentMonthData = null;
    loadMonth();
    renderHero();
  }

  /* ---------------- loading ---------------- */

  const stateKey = () => `${mode}|${schoolId}`;
  async function refreshEvents(year, month) {
    const forState = stateKey();
    const byDay = await monthEvents(year, month);
    if (view.year !== year || view.month !== month || stateKey() !== forState) return;
    currentMonthEvents = byDay;
    render();
  }

  async function loadMonth(force = false) {
    const { year, month } = view;
    const forSchool = schoolId; // a school switch mid-fetch must not land as this view's data
    const isCurrent = () => schoolId === forSchool && view.year === year && view.month === month;

    currentMonthEvents = {};
    const cached = readCache(year, month, forSchool);
    if (cached && !force) {
      currentMonthData = { ...cached, fromCache: true };
      render();
      refreshEvents(year, month);
      const maxAge = cached.empty ? EMPTY_FRESH_MS : MENU_FRESH_MS;
      if (Date.now() - cached.fetchedAt < maxAge) return;
      try {
        const fresh = await fetchMonth(year, month, forSchool);
        if (isCurrent()) { currentMonthData = fresh; render(); }
      } catch { /* keep showing cache */ }
      return;
    }

    updatedEl.textContent = "Loading…";
    let fresh;
    try {
      fresh = await fetchMonth(year, month, forSchool);
    } catch {
      fresh = cached ? { ...cached, fromCache: true } : { days: {}, empty: true, error: true };
    }
    if (isCurrent()) {
      currentMonthData = fresh;
      render();
      refreshEvents(year, month);
    }
  }

  // Tapping the hero on the last day of a month: the calendar behind the
  // sheet moves to the month the hero is talking about.
  function showMonthOf(dt) {
    if (view.year === dt.getFullYear() && view.month === dt.getMonth()) return;
    view = { year: dt.getFullYear(), month: dt.getMonth() };
    loadMonth();
  }

  function shiftMonth(delta) {
    const m = view.month + delta;
    view = { year: view.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    loadMonth();
  }

  /* ---------------- what's new ---------------- */

  const WHATS_NEW_KEY = "bvl-whatsnew-views";
  let whatsNewEligible = false;
  let whatsNewCounted = false;

  try {
    const seen = localStorage.getItem(WHATS_NEW_KEY);
    // Nothing is "new" to a first-time visitor, and it retires after 3 views.
    whatsNewEligible = isReturning && !kids.length && seen !== "done" && (parseInt(seen, 10) || 0) < 3;
  } catch {}

  function dismissWhatsNew() {
    whatsNewEligible = false;
    $("whatsNew").hidden = true;
    try { localStorage.setItem(WHATS_NEW_KEY, "done"); } catch {}
  }

  // Only meaningful on the Events tab, where the feature lives.
  function updateWhatsNew() {
    if (!whatsNewEligible || tab !== "events") { $("whatsNew").hidden = true; return; }
    if (!whatsNewCounted) {
      whatsNewCounted = true;
      let shown = 0;
      try { shown = (parseInt(localStorage.getItem(WHATS_NEW_KEY), 10) || 0) + 1; } catch {}
      try { localStorage.setItem(WHATS_NEW_KEY, String(shown)); } catch {}
    }
    $("whatsNew").hidden = false;
  }

  $("whatsNewClose").addEventListener("click", dismissWhatsNew);
  $("whatsNewGo").addEventListener("click", openKidsSheet);

  /* ---------------- after the first child: point at the School tab ---------------- */

  const SCHOOL_TIP_KEY = "bvl-tip-school";
  function openSchoolTip(school) {
    let seen = false;
    try { seen = localStorage.getItem(SCHOOL_TIP_KEY) === "done"; } catch {}
    if (seen) return;
    try { localStorage.setItem(SCHOOL_TIP_KEY, "done"); } catch {}
    $("sheetDate").textContent = "One more thing";
    const body = $("sheetBody");
    body.innerHTML =
      `<div class="tour"><h3 class="tour-h">${esc(schoolName(school))} has its own tab</h3>` +
      `<p class="tour-p">The School tab has the office phone, how to report an absence, the bell schedule, ` +
      `supply list, handbooks and more, all right here in the app.</p></div>`;
    const go = document.createElement("button");
    go.type = "button"; go.className = "sheet-action"; go.textContent = "Show me";
    go.addEventListener("click", () => { closeSheet(); setTab("school"); window.scrollTo({ top: 0, behavior: "smooth" }); });
    body.appendChild(go);
    const later = document.createElement("button");
    later.type = "button"; later.className = "sheet-remove"; later.textContent = "Later";
    later.addEventListener("click", closeSheet);
    body.appendChild(later);
    showSheet(null);
  }

  let pendingNotice = [];
  try { pendingNotice = JSON.parse(localStorage.getItem("bvl-notice") || "[]"); } catch {}
  if (!Array.isArray(pendingNotice)) pendingNotice = [];

  function openNotice(title, lines) {
    $("sheetDate").textContent = title;
    const body = $("sheetBody");
    body.innerHTML = `<div class="tour">${lines.map((l) => `<p class="tour-p">${esc(l)}</p>`).join("")}` +
      `<p class="sheet-note">Grades move up every July. Anything off? Fix it under Edit.</p></div>`;
    const ok = document.createElement("button");
    ok.type = "button"; ok.className = "sheet-action"; ok.textContent = "Got it";
    ok.addEventListener("click", () => { try { localStorage.removeItem("bvl-notice"); } catch {} closeSheet(); });
    body.appendChild(ok);
    showSheet(null);
  }

  /* ---------------- what's-new walkthrough ---------------- */

  // Shown once to people who used the app before this round. New visitors
  // see the "Set up my kids" button and need no tour.
  const TOUR_KEY = "bvl-tour-v1";
  const TOUR = [
    { h: "Your kids, your calendar",
      p: "Tap Set up my kids under the header. Add each child's school, grade and activities, no names needed. Then switch between one child, all of them, or everything at a school." },
    { h: "Events, cleaned up",
      p: "Cancelled and postponed games are marked instead of missing. Details on any event opens tickets and directions. Coming up shows the next two weeks at a glance." },
    { h: "Your phone's calendar, kept in sync",
      p: "In Edit, tap Subscribe next to a child. Their games, time changes and cancellations flow into your calendar on their own." },
    { h: "A heads-up every evening",
      p: "Turn on the 7 pm notification in Edit for tomorrow's lunch and events, one line per child. Share my setup sends the same kids to the other parent's phone." },
  ];

  function openTour() {
    try { localStorage.setItem(TOUR_KEY, "done"); } catch {}
    dismissWhatsNew();
    let step = 0;
    $("sheetDate").textContent = "What's new";
    const body = $("sheetBody");
    const paint = () => {
      const t = TOUR[step];
      const last = step === TOUR.length - 1;
      body.innerHTML =
        `<div class="tour"><p class="tour-step">${step + 1} of ${TOUR.length}</p>` +
        `<h3 class="tour-h">${esc(t.h)}</h3><p class="tour-p">${esc(t.p)}</p>` +
        `<p class="tour-dots">${TOUR.map((_, i) => `<span class="${i === step ? "on" : ""}"></span>`).join("")}</p></div>`;
      const next = document.createElement("button");
      next.type = "button"; next.className = "sheet-action";
      next.textContent = last ? (kids.length ? "Done" : "Set up my kids") : "Next";
      next.addEventListener("click", () => {
        if (!last) { step++; paint(); return; }
        closeSheet();
        if (!kids.length) setTimeout(() => openKidsSheet(), 320);
      });
      body.appendChild(next);
      if (!last) {
        const skip = document.createElement("button");
        skip.type = "button"; skip.className = "sheet-remove"; skip.textContent = "Skip";
        skip.addEventListener("click", closeSheet);
        body.appendChild(skip);
      }
    };
    paint();
    showSheet(null);
  }

  let tourDue = false;
  try { tourDue = isReturning && localStorage.getItem(TOUR_KEY) !== "done"; } catch {}

  /* ---------------- tabs ---------------- */

  function setTab(t) {
    tab = t;
    try { localStorage.setItem(TAB_KEY, t); } catch {}
    for (const [id, name] of [["tabLunch", "lunch"], ["tabEvents", "events"], ["tabSchool", "school"]]) {
      const active = name === t;
      $(id).classList.toggle("active", active);
      $(id).setAttribute("aria-selected", String(active));
    }
    render();
    renderHero();
    updateWhatsNew();
  }
  $("tabLunch").addEventListener("click", () => setTab("lunch"));
  $("tabEvents").addEventListener("click", () => setTab("events"));
  $("tabSchool").addEventListener("click", () => setTab("school"));
  if (tab !== "lunch") setTab(tab); // restore persisted tab styling

  $("prevMonth").addEventListener("click", () => shiftMonth(-1));
  $("nextMonth").addEventListener("click", () => shiftMonth(1));
  monthLabelEl.addEventListener("click", () => {
    const now = new Date();
    view = { year: now.getFullYear(), month: now.getMonth() };
    loadMonth();
  });

  // Swipe between months on touch devices.
  let touchX = null, touchY = null;
  calendarEl.addEventListener("touchstart", (e) => {
    touchX = e.touches[0].clientX; touchY = e.touches[0].clientY;
  }, { passive: true });
  calendarEl.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    touchX = touchY = null;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) shiftMonth(dx < 0 ? 1 : -1);
  }, { passive: true });

  /* ---------------- school picker ---------------- */

  const select = $("schoolSelect");

  for (const sch of SCHOOLS) select.appendChild(new Option(sch.name, sch.id));
  select.addEventListener("change", () => {
    // Picking a school by hand means "everything at that school".
    schoolId = select.value;
    setMode("all");
  });
  syncPicker();
  renderKidBar();

  // Refresh when the PWA comes back to the foreground, and periodically
  // while it's left open — otherwise a screen that's never switched away
  // from (a countertop tablet, a pinned tab) would never notice new data.
  // loadMonth()/getEventsData() already skip the network call when the
  // cache isn't actually stale, so this tick is cheap when it has nothing
  // to do.
  function refreshIfVisible() {
    if (document.hidden) return;
    // A day sheet left open long enough to have gone stale gets closed
    // rather than silently shown with outdated content — reopening it
    // picks up whatever's current.
    if (!sheet.hidden && sheetOpenedAt && Date.now() - sheetOpenedAt >= SHEET_MAX_OPEN_MS) {
      closeSheet();
    }
    loadMonth();
    renderHero();
    // A screen that's simply left open (never fully closed and reopened)
    // has no other reason to ever notice a new app version is available —
    // the browser mainly checks for one on navigation. Ask explicitly on
    // the same heartbeat that already refreshes data, so bug fixes reach a
    // countertop tablet within minutes rather than staying stuck on
    // whatever code was running when it was first opened.
    if (swRegistration) swRegistration.update().catch(() => {});
  }
  document.addEventListener("visibilitychange", refreshIfVisible);
  setInterval(refreshIfVisible, 5 * 60 * 1000);

  let swRegistration = null;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").then((reg) => { swRegistration = reg; }).catch(() => {});
    // Once a new worker actually takes control, the OLD one is still what's
    // running in memory for this page — a new registration alone changes
    // nothing until the page reloads. Do that once, automatically: there's
    // no unsaved user input in this app worth protecting against a reload.
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });
  }

  loadMonth();
  renderHero();
  updateWhatsNew();
  if (imported) toast(imported === 1 ? "1 child added from the link" : `${imported} kids added from the link`);
  else if (pendingNotice.length) {
    // The new school year moved everyone up; say so once it's been read.
    if (promoted.length || graduated.length) saveKids();
    setTimeout(() => openNotice("New school year", pendingNotice), 900);
  }
  // Let the page paint first; a sheet sliding up over a blank screen reads as broken.
  else if (tourDue) setTimeout(openTour, 900);
})();
