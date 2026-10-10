/* Brandon Valley Lunch: one place for a family's school day, built on the
 * Sioux Falls Parent template (the district template). Students live only in this browser's
 * localStorage. The only things sent anywhere are a school and a date
 * range (to the menu and events relays) so nothing about a child ever
 * leaves the phone.
 */
(() => {
  "use strict";

  const { DISTRICT, LEVEL_INFO, DEADLINES, SCHOOLS, DISTRICT_LINKS, DISTRICT_CALENDAR, SCHOOL_YEARS, GUIDE, TEST_DATES, TEST_LINKS, STATE_EVENTS, COSTS, PHYSICALS } = window.SFDATA;
  const APP_NAME = "Brandon Valley Lunch";
  const APP_COLOR = "#A8181A";
  // Schools by the id the old app used (the LINQ building id): data migration
  // and the Google calendar mirror still speak it.
  const BY_LINQ = Object.fromEntries(Object.values(SCHOOLS).map((x) => [x.linq, x.id]));
  const SH = window.SFSHARED;
  const HANDBOOKS = window.SFHANDBOOKS || {};

  const KIDS_KEY = "sfp-kids";
  const KID_KEY = "sfp-kid";
  const FAMILY_KEY = "sfp-family"; // this phone's family code, once one exists
  const TAB_KEY = "sfp-tab";
  const CAL_MODE_KEY = "sfp-calmode";
  const CHECKS_KEY = "sfp-checks";
  const INSTALL_KEY = "sfp-install";
  const EVENTS_PREFIX = "sfp-ev-v3:"; // v3: never trust a month cached during a Bound outage
  const MENU_PREFIX = "sfp-menu-v2:"; // v2: allergens
  const ACTS_PREFIX = "sfp-acts-v1:";
  const NEWS_PREFIX = "sfp-news-v2:"; // v2: article bodies for the in-app reader
  const FRESH_MS = 30 * 60 * 1000;
  const ACTS_FRESH_MS = 6 * 60 * 60 * 1000;
  const EVENTS_API = "/.netlify/functions/events";
  const MENU_API = "/.netlify/functions/menu";
  const SCHOOL_API = "/.netlify/functions/school";
  const STATUS_API = "/.netlify/functions/status";

  // The major allergens, as the menu relay names them (LINQ lists eight).
  const ALLERGENS = ["Milk", "Egg", "Wheat", "Soy", "Peanuts", "Tree nuts", "Fish", "Shellfish"];
  const flagged = (kid, item) => (item.a || []).filter((a) => (kid.allergies || []).includes(a));
  // Brandon Valley's cafeterias publish one lunch line per school; a
  // district with special-diet lines lists them here (MealViewer style).
  const DIETS = [
    { id: "", label: "Regular" },
  ];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  /* ---------------- language (English source strings, Spanish in i18n.js) ---------------- */

  let lang = store.get("sfp-lang", (navigator.language || "").toLowerCase().startsWith("es") ? "es" : "en");
  if (lang !== "es") lang = "en";
  // English is the key; placeholders in braces are filled in one pass, so a
  // student's name can never be mistaken for another placeholder.
  const t = (s, vars) => {
    let out = (lang === "es" && window.SFI18N && SFI18N.es[s]) || s;
    if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
    return out;
  };
  document.documentElement.lang = lang;
  // Spanish dates are lower case ("jueves, 1 de octubre"); headings start upper case.
  const cap = (s) => (lang === "es" && s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  // District calendar titles ("No school: Labor Day") translate piece by piece.
  const distTitle = (s) => {
    if (lang !== "es") return s;
    const m = /^No school:\s*(.+)$/.exec(s);
    return m ? `${t("No school")}: ${t(m[1])}` : t(s);
  };
  // Live content (menus, games, staff titles, news) arrives in English with a
  // Spanish dictionary from the relays. tx() swaps the text only where it's
  // shown, so the app's own rules keep reading the English.
  const ES_KEY = "sfp-es-dict";
  let esDict = store.get(ES_KEY, {}) || {};
  const tx = (s) => (lang === "es" && s && esDict[String(s).trim()]) || s;
  // Menu names arrive from the cafeteria system in mixed styles ("FRENCH
  // FRIES" next to "Fruit Salad"); all-caps ones read as normal words.
  const fixCaps = (n) => (/[a-z]/.test(n) || !/[A-Z]{4}/.test(n) ? n
    : n.toLowerCase().replace(/(^|[\s/(&-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(Wg|Bbq|Pb)\b/g, (m) => m.toUpperCase()));
  const dish = (n) => { const es = tx(n); return es !== n ? es : fixCaps(n); };
  // App wording first (i18n.js), then the live dictionary.
  const tt = (s) => { const o = t(s); return o !== s ? o : tx(s); };
  const hasEs = (s) => !s || !/[A-Za-z]{2}/.test(String(s)) || !!esDict[String(s).trim()];
  let esSave = null;
  function learnEs(map) {
    let grew = false;
    for (const [en, es] of Object.entries(map || {})) {
      if (esDict[en] === es) continue;
      delete esDict[en]; // re-insert, so the newest stay when trimming
      esDict[en] = es;
      grew = true;
    }
    if (!grew) return false;
    clearTimeout(esSave);
    esSave = setTimeout(() => {
      // Keep this phone's copy small: drop the oldest entries past ~1 MB.
      let keys = Object.keys(esDict);
      while (keys.length > 50 && JSON.stringify(esDict).length > 1e6) {
        for (const k of keys.slice(0, Math.ceil(keys.length / 4))) delete esDict[k];
        keys = Object.keys(esDict);
      }
      store.set(ES_KEY, esDict);
    }, 500);
    return true;
  }
  // Said only when something on the screen is still in English (a new
  // article not translated yet, or no translation service).
  const enNote = (what = "Content from the school, in English.", ...src) => (lang === "es" && !(src.length && src.flat().every(hasEs)) ? `<p class="fine">${esc(t(what))}</p>` : "");

  /* ---------------- dates (all local, Central time wall clock) ---------------- */

  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const addDays = (s, n) => { const dt = parse(s); dt.setDate(dt.getDate() + n); return ymd(dt); };
  const dow = (s) => parse(s).getDay();
  const isWeekend = (s) => dow(s) === 0 || dow(s) === 6;
  const todayYmd = () => ymd(new Date());
  const monthKey = (s) => s.slice(0, 7);
  const monthStart = (key) => `${key}-01`;
  const monthEnd = (key) => { const [y, m] = key.split("-").map(Number); return ymd(new Date(y, m, 0, 12)); };
  const addMonths = (key, n) => { const [y, m] = key.split("-").map(Number); const dt = new Date(y, m - 1 + n, 1, 12); return ymd(dt).slice(0, 7); };
  const mondayOf = (s) => addDays(s, -((dow(s) + 6) % 7));
  const fmt = (s, opts) => parse(s).toLocaleDateString(lang === "es" ? "es-US" : "en-US", opts);
  const fmtLong = (s) => fmt(s, { weekday: "long", month: "long", day: "numeric" });
  const fmtShort = (s) => fmt(s, { weekday: "short", month: "short", day: "numeric" });
  const fmtMonthDay = (s) => fmt(s, { month: "short", day: "numeric" });
  const fmtMonth = (key) => fmt(monthStart(key), { month: "long", year: "numeric" });
  function fmtTime(t) {
    if (!t) return "";
    let [h, m] = t.split(":").map(Number);
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${pad(m)}\u00a0${ap}`; // never split "5:15" from "PM"
  }
  // Bell times are written "8:20" / "3:15"; anything before 7 is afternoon.
  function bellTo24(t) {
    let [h, m] = t.split(":").map(Number);
    if (h < 7) h += 12;
    return `${pad(h)}:${pad(m)}`;
  }
  function relLabel(s) {
    const td = todayYmd();
    if (s === td) return t("Today");
    if (s === addDays(td, 1)) return t("Tomorrow");
    const diff = (parse(s) - parse(td)) / 864e5;
    if (diff > 0 && diff < 7) return fmt(s, { weekday: "long" });
    return "";
  }
  const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  // District links by label (data.js), never by position.
  const LINK = (label) => (DISTRICT_LINKS.find((l) => l.label === label) || {}).url || DISTRICT.site;

  /* ---------------- district calendar ---------------- */

  const DISTRICT_BY_DAY = new Map();
  for (const e of DISTRICT_CALENDAR) {
    let d = e.d;
    const last = e.to || e.d;
    while (d <= last) {
      if (!isWeekend(d)) {
        const list = DISTRICT_BY_DAY.get(d) || [];
        list.push(e);
        DISTRICT_BY_DAY.set(d, list);
      }
      d = addDays(d, 1);
    }
  }
  function offReason(s) {
    if (isWeekend(s)) return "Weekend";
    const year = SH.schoolYearFor(SCHOOL_YEARS, s);
    if (s < year.first || s > year.last) return "Summer break";
    const hit = (DISTRICT_BY_DAY.get(s) || []).find((e) => e.kind === "noschool" || e.kind === "break");
    return hit ? hit.title : null;
  }

  /* ---------------- students ---------------- */

  // "See an example family": two sample students kept in memory only. Nothing
  // is saved, no family code is made, nothing reaches the server.
  const DEMO_KEY = "sfp-demo";
  let demo = store.get(DEMO_KEY, false) === true;
  // ?demo opens straight into the example family (the QR code on handouts).
  // Nothing is saved; "Leave" returns a parent to their own students.
  if (/[?&]demo\b/.test(location.search)) {
    demo = true;
    store.set(DEMO_KEY, true);
    history.replaceState(history.state, "", location.pathname + location.hash);
  }
  const demoKids = () => [
    { id: "demo-1", name: "Maya", school: "bvhs", classOf: SH.classFor(10, ymd(new Date())), diet: "", allergies: ["Milk"], follows: [{ act: "Volleyball", level: "" }] },
    { id: "demo-2", name: "Jordan", school: "bvms", classOf: SH.classFor(7, ymd(new Date())), diet: "", allergies: [], follows: [{ act: "Football", level: "" }] },
    { id: "demo-3", name: "Leo", school: "ies", classOf: SH.classFor(2, ymd(new Date())), diet: "", allergies: ["Peanuts"], follows: [] },
  ];
  // The app that ran here before October 2026 kept its students under
  // other keys (bvl-*), by LINQ building id, grade and activity names.
  // Bring them across once, so nobody sets their kids up twice.
  const MIGRATED_KEY = "sfp-migrated";
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  function migrateOldApp() {
    if (store.get(MIGRATED_KEY, null) || localStorage.getItem(KIDS_KEY)) return false;
    let old = [];
    try { old = JSON.parse(localStorage.getItem("bvl-kids") || "[]"); } catch { old = []; }
    const today = ymd(new Date());
    const ALLERGY = { Eggs: "Egg", "Tree Nuts": "Tree nuts" };
    const moved = (Array.isArray(old) ? old : []).map((k) => {
      const school = BY_LINQ[k.school] || (SCHOOLS[k.school] ? k.school : null);
      if (!school || !Number.isInteger(k.grade)) return null;
      // Grade was saved with the school year it belonged to; class year follows.
      const classOf = Number.isInteger(k.year) ? k.year + 1 + (12 - k.grade) : SH.classFor(k.grade, today);
      return { id: String(k.id || `k${Math.random().toString(36).slice(2, 9)}`).slice(0, 16), name: "", school, classOf, diet: "",
        allergies: (k.allergies || []).map((a) => ALLERGY[a] || a).filter((a) => ALLERGENS.includes(a)),
        follows: (k.acts || []).map((a) => ({ act: String(a), level: "" })) };
    }).filter(Boolean);
    const oldFamily = (localStorage.getItem("bvl-family") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const oldMode = localStorage.getItem("bvl-mode");
    if (!moved.length && !oldFamily) { store.set(MIGRATED_KEY, { at: today, none: true }); return false; }
    if (moved.length) store.set(KIDS_KEY, moved);
    if (oldFamily) store.set(FAMILY_KEY, { code: oldFamily, updatedAt: 0 });
    if (oldMode && moved.some((k) => k.id === oldMode)) store.set(KID_KEY, oldMode);
    store.set(MIGRATED_KEY, { at: today, kids: moved.length, family: !!oldFamily, student: localStorage.getItem("bvl-role") === "student" });
    // The old keys stay for a while in case anything needs checking.
    return true;
  }
  const migrated = !demo && migrateOldApp();
  // A phone that is new to the app has nothing to catch up on.
  if (!migrated && !localStorage.getItem("sfp-whatsnew") && !localStorage.getItem(KIDS_KEY)) { try { localStorage.setItem("sfp-whatsnew", JSON.stringify(todayStr())); } catch {} }
  let kids = demo ? demoKids() : store.get(KIDS_KEY, []);
  if (!Array.isArray(kids)) kids = [];
  // Students are stored by graduating class; the grade is worked out for
  // today, so everyone moves up on July 1 without the parent doing a thing.
  function hydrateKids() {
    const t = todayYmd();
    kids = kids.filter((k) => k && SCHOOLS[k.school] && (Number.isInteger(k.classOf) || GUIDE[k.grade]));
    let migrated = false;
    for (const k of kids) {
      // Older saves stored a grade; convert it once and save the class, or
      // the grade would never move up.
      if (!Number.isInteger(k.classOf)) { k.classOf = SH.classFor(k.grade, t); migrated = true; }
      k.grade = SH.gradeOf(k.classOf, t);
      // A senior is done after their last day of school, not on July 1.
      const senior = SCHOOL_YEARS.find((y) => y.last.startsWith(String(k.classOf)));
      k.graduated = k.grade > 12 || (senior ? t > senior.last : false);
      if (!k.allergies) k.allergies = [];
    }
    if (migrated && !demo) store.set(KIDS_KEY, kids.map(({ grade, graduated, ...k }) => k));
  }
  hydrateKids();
  let activeKidId = store.get(KID_KEY, null);
  const saveKids = () => {
    if (demo) return; // the example family is never saved
    store.set(KIDS_KEY, kids.map(({ grade, graduated, ...k }) => k));
    queueFamilySave();
    writeLocalNames();
    keepData();
  };
  // iPhones clear a website's saved data after about a week unused (unless
  // it's on the home screen). Ask the browser to keep ours, and make sure a
  // family code exists so the setup can be restored if it's cleared anyway.
  function keepData() {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if (kids.length && !family) ensureFamily().catch(() => {});
  }
  // Notifications arrive with student ids only; the service worker reads
  // the names from this phone-only cache.
  function writeLocalNames() {
    if (!("caches" in window)) return;
    const names = Object.fromEntries(kids.map((k) => [k.id, kidName(k)]));
    caches.open("sfp-local").then((c) => c.put("/__names", new Response(JSON.stringify(names), { headers: { "Content-Type": "application/json" } }))).catch(() => {});
  }
  const activeKid = () => kids.find((k) => k.id === activeKidId) || kids[0] || null;
  const kidName = (k) => k.name || t("Student {n}", { n: kids.indexOf(k) + 1 });
  const ordinal = (g) => (g === -1 ? "JK" : g === 0 ? "K" : `${g}${g === 1 ? "st" : g === 2 ? "nd" : g === 3 ? "rd" : "th"}`);
  // "11th grade" / "grado 11"; the short form is for chips and buttons.
  // Grade 0 is kindergarten, -1 junior kindergarten.
  const gradeName = (g) => (g === -1 ? t("Junior kindergarten") : g === 0 ? t("Kindergarten") : lang === "es" ? `grado ${g}` : `${ordinal(g)} grade`);
  const gradeShort = (g) => (g === -1 ? "JK" : g === 0 ? "K" : lang === "es" ? `${g}.º` : ordinal(g));
  // "BV High", or "Inspiration Lynx" for a district that uses mascots.
  const schoolLabel = (s) => (s.mascot ? `${s.short} ${s.mascot}` : s.short);
  const levelOf = (k) => SCHOOLS[k.school].level;
  const isHigh = (k) => levelOf(k) === "hs";
  // The school's usual day for a date: All-City lets out at 1:00 on
  // Wednesdays. `about` marks hours the school hasn't published.
  function bellFor(s, day) {
    const b = s.bell;
    const end = b.wed && day && dow(day) === 3 ? b.wed : b.end;
    return { start: b.start, end, about: !!b.about };
  }
  // A student who has outgrown their school's grades (5th to 6th, 8th to
  // 9th) is moving up; the app asks for the new school.
  const movingUp = (k) => !k.graduated && SCHOOLS[k.school] && k.grade > SCHOOLS[k.school].grades[1];
  const gradeText = (k) => (k.graduated ? t("Class of {year}, graduated", { year: k.classOf }) : gradeName(k.grade));

  /* ---------------- data loading ---------------- */

  function readCache(key) { return store.get(key, null); }
  function writeCache(key, data) { store.set(key, { at: Date.now(), ...data }); }

  // The relays add a Spanish dictionary when asked (lang=es). When some of it
  // is still being translated, ask again a little later and redraw.
  const LIVE_API = /\/\.netlify\/functions\/(events|menu|school|weather)\b/;
  let esRedraw = null;
  async function getJson(url, retry = 0) {
    const es = lang === "es" && LIVE_API.test(url);
    const res = await fetch(es ? `${url}${url.includes("?") ? "&" : "?"}lang=es` : url, retry ? { cache: "no-cache" } : undefined);
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    if (j && j.es) {
      if (learnEs(j.es) && retry) {
        clearTimeout(esRedraw);
        esRedraw = setTimeout(() => { if ($("sheet").hidden) render(); }, 300);
      }
      if (j.esMissing && retry < 3) setTimeout(() => getJson(url, retry + 1).catch(() => {}), 40e3 * (retry + 1));
    }
    return j;
  }
  // Saved copies are kept per language: a Spanish view needs the dictionary
  // that came with its answer.
  const langKey = () => (lang === "es" ? "es:" : "");

  // Events for one school and one month. `school` is passed in, never read
  // from shared state, so a school switch mid-fetch can't cross the caches.
  const inflight = new Map();
  async function getMonthEvents(school, key) {
    const cacheKey = `${EVENTS_PREFIX}${langKey()}${school}:${key}`;
    const cached = readCache(cacheKey);
    if (cached && Date.now() - cached.at < FRESH_MS) return cached.events;
    if (inflight.has(cacheKey)) return inflight.get(cacheKey);
    const p = getJson(`${EVENTS_API}?school=${school}&start=${monthStart(key)}&end=${monthEnd(key)}`)
      .then((j) => { writeCache(cacheKey, { events: j.events }); return j.events; })
      .catch((err) => { if (cached) return cached.events; throw err; })
      .finally(() => inflight.delete(cacheKey));
    inflight.set(cacheKey, p);
    return p;
  }
  async function getEvents(school, start, end) {
    const keys = [];
    for (let k = monthKey(start); k <= monthKey(end); k = addMonths(k, 1)) keys.push(k);
    const months = await Promise.all(keys.map((k) => getMonthEvents(school, k)));
    const seen = new Set();
    return months.flat().filter((e) => {
      if (seen.has(e.id) || (e.to || e.d) < start || e.d > end) return false;
      seen.add(e.id);
      return true;
    });
  }

  async function getMonthMenu(school, key) {
    const cacheKey = `${MENU_PREFIX}${langKey()}${school}:${key}`;
    const cached = readCache(cacheKey);
    if (cached && Date.now() - cached.at < FRESH_MS) return cached;
    if (inflight.has(cacheKey)) return inflight.get(cacheKey);
    const p = getJson(`${MENU_API}?school=${school}&start=${monthStart(key)}&end=${monthEnd(key)}`)
      .then((j) => { const data = { days: j.days, prices: j.prices, off: j.off || {} }; writeCache(cacheKey, data); return data; })
      .catch((err) => { if (cached) return cached; throw err; })
      .finally(() => inflight.delete(cacheKey));
    inflight.set(cacheKey, p);
    return p;
  }
  async function getMenu(school, start, end) {
    const keys = [];
    for (let k = monthKey(start); k <= monthKey(end); k = addMonths(k, 1)) keys.push(k);
    const months = await Promise.all(keys.map((k) => getMonthMenu(school, k)));
    const byDay = new Map();
    const off = {};
    for (const m of months) { for (const day of m.days || []) byDay.set(day.d, day.lines); Object.assign(off, m.off || {}); }
    return { byDay, prices: months[0]?.prices || {}, posted: months.some((m) => (m.days || []).length), off };
  }

  async function getActivities(school) {
    const cacheKey = `${ACTS_PREFIX}${langKey()}${school}`;
    const cached = readCache(cacheKey);
    if (cached && Date.now() - cached.at < ACTS_FRESH_MS) return cached.activities;
    const t = todayYmd();
    try {
      const j = await getJson(`${EVENTS_API}?school=${school}&start=${t}&end=${SH.schoolYearFor(SCHOOL_YEARS, t).last}&list=activities`);
      writeCache(cacheKey, { activities: j.activities });
      return j.activities;
    } catch (err) {
      if (cached) return cached.activities;
      throw err;
    }
  }

  // School info (staff, pages, clubs, news, alerts): small JSON from the
  // school relay, cached here too so the app opens instantly offline.
  const SCHOOL_FRESH = { staff: 6 * 3600e3, page: 3 * 3600e3, clubs: 6 * 3600e3, news: 10 * 60e3, alerts: 2 * 60e3, scholarships: 6 * 3600e3, forms: 6 * 3600e3, feed: 10 * 60e3, supplies: 24 * 3600e3, handbook: 24 * 3600e3 };
  async function getSchool(school, what, slug) {
    const scope = what === "page" ? `${school}:${slug}` : school;
    const cacheKey = `${NEWS_PREFIX}${langKey()}${what}:${scope}`;
    const cached = readCache(cacheKey);
    if (cached && Date.now() - cached.at < SCHOOL_FRESH[what]) return cached.data;
    if (inflight.has(cacheKey)) return inflight.get(cacheKey);
    const p = getJson(`${SCHOOL_API}?school=${school}&what=${what}${slug ? `&slug=${encodeURIComponent(slug)}` : ""}`)
      .then((data) => { writeCache(cacheKey, { data }); return data; })
      .catch((err) => { if (cached) return cached.data; throw err; })
      .finally(() => inflight.delete(cacheKey));
    inflight.set(cacheKey, p);
    return p;
  }
  let statusCache = null;
  async function getStatus() {
    if (statusCache && Date.now() - statusCache.at < 5 * 60e3) return statusCache.data;
    const data = await getJson(STATUS_API);
    statusCache = { at: Date.now(), data };
    return data;
  }

  /* ---------------- tailoring (rules live in shared.js) ---------------- */

  const { mineFilter, allFilter, sortEvents, groupEvents, gradeLabel } = SH;
  // District dates, plus state championships for the student's teams when a student is given.
  const mergeDistrict = (events, start, end, grade, kid) => SH.mergeDistrict(DISTRICT_CALENDAR, events, start, end, grade).concat(kid ? SH.stateFor(STATE_EVENTS, kid, start, end) : []);

  // Which day the Today card is about: today until the final bell, then the
  // next weekday (parents check the night before).
  function focusDay(kid) {
    const t = todayYmd();
    const end = bellTo24(bellFor(SCHOOLS[kid.school], todayYmd()).end);
    if (!isWeekend(t) && nowHM() < end) return t;
    let d = addDays(t, 1);
    while (isWeekend(d)) d = addDays(d, 1);
    return d;
  }

  function lunchLine(lines, diet) {
    if (!lines) return null;
    const key = diet && lines[`Lunch - ${diet}`] ? `Lunch - ${diet}` : "Lunch";
    return lines[key] ? { key, items: lines[key] } : null;
  }
  // "Contains peanuts" for the items in a student's line that hit their allergies.
  // "Contains milk: Lactose Free Milk" names the item, so a flag on a
  // dairy free line reads as the milk carton, not the main dish.
  function allergyWarning(kid, items) {
    const hit = items.filter((i) => flagged(kid, i).length);
    if (!hit.length) return "";
    const list = [...new Set(hit.flatMap((i) => flagged(kid, i)))].map((a) => t(a)).join(", ").toLowerCase();
    return t("Contains {list}: {items}", { list, items: hit.map((i) => dish(i.n)).join(", ") });
  }
  function describeMeal(items) {
    const mains = items.filter((i) => i.t === "ENTREES" || i.t === "BREAKFAST").map((i) => dish(i.n));
    const sides = items.filter((i) => !["ENTREES", "BREAKFAST", "MILK", "OTHER"].includes(i.t) && !/Relish|Seasonal Fresh Fruit|Juice Assortment/i.test(i.n)).map((i) => dish(i.n)).slice(0, 4);
    // Two choices read as "A or B"; a long list (a cafeteria that lists every
    // standing item as an entrée) reads as "A or B and 5 more".
    const main = !mains.length ? dish(items[0]?.n || "") : mains.length <= 2 ? mains.join(` ${t("or")} `) : `${mains.slice(0, 2).join(` ${t("or")} `)} ${t("and {n} more", { n: mains.length - 2 })}`;
    return { main, sides };
  }

  /* ---------------- rendering helpers ---------------- */

  // Line icons for Today's summaries and task buttons (stroke = currentColor).
  const ICON = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const ICONS = {
    clock: ICON("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2"),
    lunch: ICON("M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 1-3 3-3 6v4h3v8M17 3v18"),
    game: ICON("M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"),
    event: ICON("M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"),
    off: ICON("M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M9 13l6 5M15 13l-6 5"),
    alert: ICON("M12 3 2 20h20L12 3zM12 10v4M12 17v.5"),
    absent: ICON("M9 21h6M10 3h4v9.5a4 4 0 1 1-4 0zM12 13v3"),
    phone: ICON("M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"),
    search: ICON("M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM21 21l-5-5"),
    chat: ICON("M4 5.5h16v10.5H9.5L5 20v-4H4z"),
    weather: ICON("M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.5A3.3 3.3 0 0 0 7 18z"),
    due: ICON("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v4M12 16v.5"),
    star: ICON("M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"),
  };
  const CHEVRON = '<svg viewBox="0 0 8 14" aria-hidden="true"><path d="M1.5 1l5 6-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const PREV = '<svg viewBox="0 0 10 16" aria-hidden="true"><path d="M8 1.5 2 8l6 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const NEXT = '<svg viewBox="0 0 10 16" aria-hidden="true"><path d="M2 1.5 8 8l-6 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // Each student's screens wear their school's colors: primary from the
  // school website, secondary and the on-color text from the school logo.
  const kidStyle = (k) => {
    const b = SCHOOLS[k.school].brand;
    return `--kid:${b.primary};--kid-2:${b.secondary};--kid-on:${b.onPrimary}`;
  };
  const logoTile = (school, size = "") => {
    const s = SCHOOLS[school];
    return `<span class="logo-tile ${size}"><img src="${esc(s.brand.logo)}" alt="${esc(t("{name} logo", { name: schoolLabel(s) }))}" width="40" height="40"></span>`;
  };
  // Student tabs: the header becomes that student's school. Today is the
  // family view, so it keeps the app's own navy.
  function applyTheme(kid) {
    const header = document.querySelector(".app-header");
    const b = kid ? SCHOOLS[kid.school].brand : null;
    header.classList.toggle("branded", !!kid);
    $("appBrand").hidden = !!kid;
    $("schoolBrand").hidden = !kid;
    const root = document.documentElement.style;
    if (kid) {
      const s = SCHOOLS[kid.school];
      for (const [k, v] of Object.entries({ "--accent": b.primary, "--accent-2": b.secondary, "--accent-on": b.onPrimary })) root.setProperty(k, v);
      $("schoolBrand").innerHTML = `${logoTile(kid.school)}<span class="school-brand-text"><h1 class="school-brand-name">${esc(schoolLabel(s))}</h1><span class="school-brand-kid">${esc(kidName(kid))}, ${esc(gradeText(kid))}</span></span>`;
    } else {
      for (const k of ["--accent", "--accent-2", "--accent-on"]) root.removeProperty(k);
    }
    document.querySelector('meta[name="theme-color"]').content = b ? b.primary : APP_COLOR;
  }
  const eventStore = new Map(); // id -> event, for the detail sheet

  // A grouped game night: "4:30 PM 9A, JV · 5:15 PM Sophomore, 9B".
  function levelsLine(ev) {
    if (!ev.parts) return "";
    const byTime = new Map();
    for (const p of ev.parts) {
      const k = p.t || "";
      if (!byTime.has(k)) byTime.set(k, []);
      byTime.get(k).push(tt(p.level) || t("Team") + (p.x ? ` ${t("(cancelled)")}` : ""));
    }
    return [...byTime.entries()].map(([t, lv]) => `${t ? fmtTime(t) + ": " : ""}${lv.join(", ")}`);
  }
  const activeKids = () => kids.filter((k) => !k.graduated);
  const dateKey = (ev) => fmtMonthDay(ev.d);
  const throughNote = (ev) => (ev.to && ev.to !== ev.d ? t("Through {date}", { date: fmtShort(ev.to) }) : "");
  // Grade tags ("Juniors, seniors"); Spanish names the grade numbers.
  const gradeTag = (g) => {
    const s = gradeLabel(g);
    if (lang !== "es" || !s) return s;
    if (t(s) !== s) return t(s);
    const names = g.map((n) => (n === -1 ? "JK" : n === 0 ? "K" : String(n)));
    return g.length === 1 ? t("Grade {n}", { n: names[0] }) : t("Grades {list}", { list: names.join(", ") });
  };
  // Lunch lines and diets: "Dairy Free" -> "dairy free" / "sin lácteos".
  const upFirst = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  const dietLow = (id) => t((DIETS.find((x) => x.id === id) || { label: id }).label).toLowerCase();

  // What a parent reads as an event's name, in their language.
  const evTitle = (ev) => (ev.district ? distTitle(ev.title) : tt(ev.title));

  // "Brandon Valley High School Stadium" -> "BV High School Stadium" in
  // lists; the event's own page keeps the full name for directions.
  const shortPlace = (v) => String(v || "").replace(/^Brandon Valley /, "BV ");
  // Games in another time zone (Rapid City): "6:00 PM Mountain time".
  const localTime = (ev) => (ev.lt ? t(ev.lz === "MT" ? "{time} Mountain time" : "{time} local time", { time: fmtTime(ev.lt) }) : "");

  function eventRow(ev, opts = {}) {
    eventStore.set(ev.id, ev);
    const allDay = ev.cat === "noschool" || ev.district;
    const time = allDay ? "" : ev.t ? fmtTime(ev.t) : t("All day");
    const tags = [];
    if (ev.x) tags.push(`<span class="tag x">${t("Cancelled")}</span>`);
    if (ev.home === true) tags.push(`<span class="tag home">${t("Home")}</span>`);
    if (ev.home === false) tags.push(`<span class="tag">${t("Away")}</span>`);
    if (!ev.parts && ev.level && !/^(High School|HS )/.test(ev.level)) tags.push(`<span class="tag">${esc(tt(ev.level))}</span>`);
    if (ev.g && opts.showGrade !== false) tags.push(`<span class="tag grade">${esc(gradeTag(ev.g))}</span>`);
    // Things to bring or wear: picture day, spirit and dress-up days.
    if (opts.heads && /picture|retake|spirit|dress[\s-]?up|wear |jersey|pajama|color day|twin day|tie[\s-]?dye/i.test(ev.title)) tags.push(`<span class="tag heads">${t("Heads up")}</span>`);
    const key = opts.byDate ? dateKey(ev) : time;
    const subs = [];
    const through = throughNote(ev);
    if (ev.lt && !ev.parts) subs.push(localTime(ev));
    if (ev.parts && ev.parts.some((p) => p.lt)) subs.push([...new Set(ev.parts.filter((p) => p.lt).map(localTime))].join(", "));
    const note = ev.district && ev.reasons ? [...new Set(ev.reasons)].map(distTitle).join(", ") : tt(ev.note);
    if (through || note) subs.push([through, note].filter(Boolean).join(". "));
    if (ev.parts) subs.push(...levelsLine(ev));
    else if (opts.byDate && ev.t) subs.push(fmtTime(ev.t));
    if (ev.venue) subs.push(shortPlace(tx(ev.venue)));
    if (opts.byDate && !ev.parts && ev.t && ev.venue) subs.splice(subs.length - 2, 2, `${fmtTime(ev.t)}, ${shortPlace(tx(ev.venue))}`);
    const cls = ["row", "tap", ev.cat === "noschool" ? "off" : "", ev.x ? "x" : ""].filter(Boolean).join(" ");
    return `<button class="${cls}" data-ev="${esc(ev.id)}"><span class="row-k">${esc(key)}</span><span class="row-v"><b>${esc(evTitle(ev))}</b>${tags.join("")}${subs.map((x) => `<span class="sub">${esc(x)}</span>`).join("")}</span></button>`;
  }

  // Back-to-back district days off read as one line: "Oct 12 to 13, No school".
  function collapseDaysOff(list) {
    const out = [];
    for (const e of list) {
      const prev = out[out.length - 1];
      if (prev && prev.district && e.district && prev.cat === "noschool" && e.cat === "noschool" && !prev.kindBreak && e.kind === "noschool") {
        let next = SH.addDays(prev.to || prev.d, 1);
        while (SH.isWeekend(next)) next = SH.addDays(next, 1);
        if (next === e.d) {
          const reasons = [prev, e].flatMap((x) => x.reasons || [x.title.replace(/^No school:?\s*/, "")]).filter(Boolean);
          out[out.length - 1] = { ...prev, id: `${prev.id}+`, to: e.d, title: "No school", reasons, note: [...new Set(reasons)].join(", ") };
          continue;
        }
      }
      out.push(e);
    }
    return out;
  }

  function errorNote(what) {
    return `<p class="empty-note">${t("Couldn't load {what} right now. Check your connection and try again.", { what: esc(what) })}</p>`;
  }

  /* ---------------- views ---------------- */

  let tab = store.get(TAB_KEY, "today");
  let calMode = store.get(CAL_MODE_KEY, "mine");
  let calMonth = null;       // "YYYY-MM"
  let calFilter = "all";
  let schedIndex = 0;
  let schedPicked = false;      // the parent chose a schedule by hand
  const schedHint = {};         // school -> schedule named in today's alert
  const OUT_ICON_SVG = '<svg class="out-icon" viewBox="0 0 16 16" aria-label="Opens another site"><path d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8a1.5 1.5 0 0 0 1.5-1.5V10M9 2h5v5M14 2 7.5 8.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const outIcon = () => OUT_ICON_SVG.replace("Opens another site", esc(t("Opens another site")));
  const CAL_FILTERS = [
    { id: "all", label: "Everything", test: () => true },
    { id: "activities", label: "Games", test: (e) => !!e.act || e.kind === "state" },
    { id: "days", label: "Days off", test: (e) => e.district || e.cat === "noschool" || e.cat === "academic" },
    { id: "college", label: "College", test: (e) => e.cat === "college" },
  ];
  const CAL_ICON = '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4M12 12.5v5M9.5 15h5"/></svg>';
  let lunchWeek = null;      // Monday "YYYY-MM-DD"
  const tokens = {};         // per-view render generation, guards async writes
  const bump = (v) => (tokens[v] = (tokens[v] || 0) + 1);

  function demoBarHtml() {
    return demo ? `<div class="demo-bar"><span>${t("This is an example family.")}</span><button class="btn primary" data-action="demo-own">${t("Add your student")}</button><button class="link-btn" data-action="demo-exit">${t("Leave")}</button></div>` : "";
  }
  function render() {
    // Static labels in index.html carry their English text as the key.
    for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll("[data-i18n-label]")) el.setAttribute("aria-label", t(el.dataset.i18nLabel));
    const has = kids.length > 0;
    document.querySelector(".tab-bar").hidden = !has;
    $("studentsBtn").hidden = !has;
    $("searchBtn").hidden = !has;
    for (const v of document.querySelectorAll(".view")) v.hidden = v.dataset.view !== (has ? tab : "today");
    for (const b of document.querySelectorAll(".tab")) {
      if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    }
    renderKidBar(has && tab !== "today");
    let bar = $("demoBar");
    if (!bar) { bar = document.createElement("div"); bar.id = "demoBar"; document.querySelector("main").prepend(bar); }
    bar.innerHTML = demoBarHtml();
    const back = backBarHtml();
    $("backBar").innerHTML = back;
    $("backBar").hidden = !back;
    if (has) renderAlerts();
    // Offline: say so, and say how old the saved information is.
    const off = $("offlineNote");
    if (!navigator.onLine) {
      const latest = Object.keys(localStorage).filter((k) => /^sfp-(ev|menu)-/.test(k)).map((k) => (store.get(k, {}) || {}).at || 0).reduce((a, b) => Math.max(a, b), 0);
      off.textContent = latest ? t("You're offline. Showing what this phone saved at {time} on {day}.", { time: new Date(latest).toLocaleTimeString(lang === "es" ? "es-US" : "en-US", { hour: "numeric", minute: "2-digit" }), day: fmtShort(ymd(new Date(latest))) }) : t("You're offline. Some information may be missing until you reconnect.");
      off.hidden = false;
    } else off.hidden = true;
    // Today is branded too when the whole family is at one school.
    const oneSchool = has && new Set(activeKids().map((k) => k.school)).size === 1 ? activeKids()[0] : null;
    applyTheme(has && tab !== "today" ? activeKid() : oneSchool);
    if (tab === "today" && oneSchool && activeKids().length > 1) { const sub = document.querySelector(".school-brand-kid"); if (sub) sub.textContent = activeKids().map(kidName).join(` ${t("and")} `); }
    if (!has) return renderWelcome();
    ({ today: renderToday, lunch: renderLunch, calendar: renderCalendar, guide: renderGuide, school: renderSchool })[tab]();
  }

  // Weather closings and emergencies: the district's own alert banners,
  // shown on every screen while they're up. Rechecked every few minutes.
  const PIN_KEY = "sfp-pin-seen";
  async function renderAlerts() {
    const schools = [...new Set((tab === "today" ? kids : [activeKid()]).filter(Boolean).map((k) => k.school))];
    const bar = $("alertBar");
    if (!schools.length) { bar.hidden = true; return; }
    const [results, status] = await Promise.all([Promise.all(schools.map((sc) => getSchool(sc, "alerts").catch(() => null))), getStatus().catch(() => null)]);
    const seen = new Set();
    const alerts = results.flatMap((r) => (r ? r.alerts : [])).filter((a) => !seen.has(a.id) && seen.add(a.id));
    // The district's own announcement from the admin page; a parent can
    // close it, and a new one shows again.
    const pin = status && status.pin && store.get(PIN_KEY, "") !== status.pin.id ? status.pin : null;
    bar.hidden = !alerts.length && !pin;
    // Urgent district alerts first; the announcement after them.
    bar.innerHTML = alerts.map((a) => `<div class="alert-banner" role="alert"><p class="alert-kicker">${t("School alert")}</p><div class="reader">${sanitize(tx(a.html))}</div><a class="alert-official" href="${esc(DISTRICT.closings)}" target="_blank" rel="noopener">${t("KELOLAND closings list")}</a></div>`).join("") + (pin ? `<div class="pin-banner" role="status"><p class="alert-kicker">${t("From the district")}</p><p>${esc(lang === "es" && pin.es ? pin.es : pin.text)}</p><button class="install-close" data-action="pin-done" data-pin="${esc(pin.id)}" aria-label="${t("Dismiss")}">&times;</button></div>` : "");
  }

  function renderKidBar(show) {
    const bar = $("kidBar");
    bar.hidden = !show;
    if (!show) return;
    const k = activeKid();
    // Three or more students: names only, so the switcher stays compact.
    $("kidChips").classList.toggle("compact", kids.length > 2);
    $("kidChips").innerHTML = kids.map((kid) => `
      <button class="kid-chip" data-kid="${esc(kid.id)}" aria-pressed="${kid === k}" style="${kidStyle(kid)}">
        <span class="dot"></span>${esc(kidName(kid))}<span class="chip-sub">${esc(SCHOOLS[kid.school].short)}, ${kid.graduated ? t("graduated") : gradeShort(kid.grade)}</span>
      </button>`).join("");
  }

  function renderWelcome() {
    const promise = (icon, title, sub) => `<li>${icon}<span><b>${title}</b><span>${sub}</span></span></li>`;
    $("view-today").innerHTML = `
      <div class="welcome card">
        <div class="welcome-top">${langToggle("lang-pill")}</div>
        <h2>${t("Know what's happening at school for each of your kids, every day")}</h2>
        <p class="welcome-sub">${t("For families at every Brandon Valley school, junior kindergarten through 12th grade. Free, no account.")}</p>
        <ul class="welcome-promises">
          ${promise(ICONS.clock, t("Tomorrow at a glance"), t("Late starts, days off, lunch and games, for each of your kids"))}
          ${promise(ICONS.alert, t("Know when plans change"), t("Closings, late starts and moved games, flagged when you open the app. Phone alerts if you want them."))}
          ${promise(ICONS.event, t("Their games on your phone's calendar"), t("It updates on its own"))}
          ${promise(ICONS.star, t("What their grade needs, and when"), t("Conferences, supply lists, sports physicals, ACT dates and scholarships"))}
        </ul>
        <button class="btn primary block" data-action="add-kid">${t("Add your student")}</button>
        <button class="btn block" data-action="demo" style="margin-top:8px">${t("See an example family")}</button>
        <div class="welcome-more">
          <button class="link-btn" data-action="new-family">${t("New to Brandon Valley schools? Start here")}</button>
          <button class="link-btn" data-action="restore">${t("Restore with a family code")}</button>
        </div>
        <p class="privacy-note">${t("Takes about a minute. Names stay on this phone.")}</p>
      </div>`;
  }
  // Each label is in its own language, so a parent can always find it.
  function langToggle(cls) {
    return lang === "es"
      ? `<button class="${cls}" data-action="lang" lang="en">English</button>`
      : `<button class="${cls}" data-action="lang" lang="es">Español</button>`;
  }

  /* ----- Today ----- */

  async function renderToday() {
    const v = $("view-today");
    const token = bump("today");
    const td = todayYmd();
    const kidHead = (k) => `<div class="kid-banner">${logoTile(k.school)}<span class="kid-banner-text"><span class="kid-name">${esc(kidName(k))}</span><span class="kid-meta">${esc(schoolLabel(SCHOOLS[k.school]))}, ${esc(gradeText(k))}</span></span></div>`;
    // The answer first ("A normal school day for both"), each student's day
    // under it, then the four things parents come to do.
    v.innerHTML = `
      ${finishSetupHtml()}
      ${activitiesCheckHtml()}
      <div id="changedBox"></div>
      <section class="answer" aria-live="polite">
        <p class="answer-when" id="answerWhen">${esc(cap(fmtLong(td)))}</p>
        <h2 class="answer-line" id="answerLine">${t("Checking the schools")}</h2>
        <p class="answer-sub">${esc(countdownText(td))}</p>
        <p class="answer-weather" id="weatherStrip" hidden></p>
        ${kids.map((k) => `<article class="kid-sum" style="${kidStyle(k)}" data-kidcard="${esc(k.id)}">${kidHead(k)}<p class="loading">${t("Loading {name}'s day", { name: esc(kidName(k)) })}</p></article>`).join("")}
      </section>
      ${tasksHtml()}
      ${seasonHtml(td)}
      <div id="familyWeek"></div>
      ${kids.map(firstWeekHtml).join("")}
      <button class="link-btn add-another" data-action="add-kid">${t("Add another student")}</button>`;
    fillWeather(kids.find((k) => !k.graduated), token);
    await Promise.all([...new Set(kids.filter(isHigh).map((k) => k.school))].filter((sc) => !clubCount[sc]).map((sc) => getSchool(sc, "clubs").then((c) => { clubCount[sc] = c.groups.reduce((n, g) => n + g.items.length, 0); }).catch(() => {})));
    const results = await Promise.all(kids.map((k) => fillKidCard(k, token)));
    if (token !== tokens.today) return;
    fillAnswer(results.filter(Boolean));
    warmSearch();
    renderWeek(results.filter(Boolean));
    renderChanged(results.filter(Boolean), token);
  }

  // The four things parents open the app to do, as big buttons with icons
  // (they read without much English), and search for everything else.
  function tasksHtml() {
    const active = kids.filter((k) => !k.graduated);
    if (!active.length) return "";
    const schools = [...new Set(active.map((k) => k.school))];
    const call = schools.length === 1
      ? `<a class="task" href="tel:+1${SCHOOLS[schools[0]].phone.replace(/\D/g, "")}">${ICONS.phone}<span>${t("Call the school")}</span></a>`
      : `<button class="task" data-action="call-pick">${ICONS.phone}<span>${t("Call the school")}</span></button>`;
    return `<nav class="tasks" aria-label="${t("Things to do")}">
      <button class="task" data-action="absence-pick">${ICONS.absent}<span>${t("Report an absence")}</span></button>
      <button class="task" data-goto="lunch">${ICONS.lunch}<span>${t("Lunch")}</span></button>
      <button class="task" data-goto="calendar">${ICONS.event}<span>${t("Games and events")}</span></button>
      ${call}
    </nav>
    <button class="ask" data-action="search">${ICONS.chat}<span class="ask-label"><b>${t("Have a question?")}</b><span>${t("Type it here and get the answer")}</span></span></button>`;
  }

  // One sentence for the whole family: what kind of day it is.
  function fillAnswer(results) {
    const line = $("answerLine"), when = $("answerWhen");
    if (!line || !results.length) return;
    const day = results[0].day;
    // "Today, Friday, October 9" / "Tomorrow, ..."; a later day is just its
    // date, since the date already starts with the weekday.
    const rel = day === todayYmd() || day === addDays(todayYmd(), 1) ? relLabel(day) : "";
    when.textContent = cap(rel ? `${rel}, ${fmtLong(day)}` : fmtLong(day));
    const kindOf = (r) => (r.off ? `off:${r.off}` : r.changed ? r.changed.kind : "normal");
    const kinds = [...new Set(results.map(kindOf))];
    const who = results.length === 1 ? results[0].kid.name || "" : results.length === 2 ? t("both") : t("everyone");
    const words = (k, name) => {
      if (k === "normal") return name ? t("A normal school day for {who}", { who: name }) : t("A normal school day");
      if (k.startsWith("off:")) {
        const r = k.slice(4);
        if (r === "Summer break") return t("Summer break");
        // The calendar's own wording is "No school: Staff in-service"; the
        // reason is translated on its own so the prefix isn't doubled.
        const reason = r === "Weekend" ? t("Weekend") : t(r.replace(/^No school:?\s*/, ""));
        return reason ? `${t("No school")}: ${reason}` : t("No school");
      }
      return { late2: t("2-hour late start"), late1: t("1-hour late start"), late: t("Late start: see the alert"), early: t("Early release"), remote: t("Remote learning day"), closed: t("School closed"), notice: t("School alert: read it before you go") }[k] || "";
    };
    if (kinds.length === 1) {
      line.textContent = words(kinds[0], who);
      line.classList.toggle("warn", kinds[0] !== "normal");
    } else {
      line.textContent = results.map((r) => `${kidName(r.kid)}: ${words(kindOf(r), kidName(r.kid)).replace(` ${t("for")} ${kidName(r.kid)}`, "")}`).join(". ");
      line.classList.add("warn");
    }
  }

  // "Right now": a short checklist that fits the time of year, worked out
  // from the district calendar so it repeats every year without new code.
  const SEASON_KEY = "sfp-season";
  function seasonFor(td) {
    const year = SH.schoolYearFor(SCHOOL_YEARS, td);
    // Only dates for this family's grades (conferences and tests differ by level).
    const fam = activeKids();
    const famGrades = fam.map((k) => k.grade);
    const anyHigh = fam.some(isHigh);
    const inYear = DISTRICT_CALENDAR.filter((e) => e.d >= SH.addDays(year.first, -30) && e.d <= year.last && (!e.grades || e.grades.some((g) => famGrades.includes(g))));
    const days = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
    const pick = (kind) => inYear.filter((e) => e.kind === kind);
    // Back to school: a month before the first day through its first two weeks.
    if (td >= SH.addDays(year.first, -30) && td <= SH.addDays(year.first, 14)) {
      return { id: `bts-${year.id}`, title: t("Back to school"), sub: td < year.first ? t("First day: {day}", { day: fmtLong(year.first) }) : "", items: [
        { id: "sky", text: t("Check your family information in Skyward Family Access"), url: LINK("Skyward Family Access") },
        { id: "lunch", text: t("Add money to the lunch account in LINQ Connect"), url: LINK("Lunch account") },
        { id: "frm", text: t("Apply for free or reduced meals (any time of year)"), url: LINK("Free and reduced meals") },
        { id: "supplies", text: t("Check the supply list"), action: "supplies" },
        { id: "bus", text: t("Check the bus route and pass"), url: LINK("Bus routes") },
        anyHigh && { id: "park", text: t("Student driver? Read the parking rules in the handbook"), action: "handbook" },
      ].filter(Boolean) };
    }
    // Semester tests: two weeks out through the last test day.
    const tests = pick("tests");
    for (const e of tests) {
      const first = tests.filter((x) => Math.abs(days(x.d, e.d)) <= 3)[0];
      const last = tests.filter((x) => Math.abs(days(x.d, e.d)) <= 3).map((x) => x.to || x.d).sort().pop();
      if (td >= SH.addDays(first.d, -14) && td <= last) {
        return { id: `tests-${first.d}`, title: t("Semester tests"), sub: first.d === last ? fmtLong(first.d) : `${fmtShort(first.d)} – ${fmtShort(last)}`, items: [
          { id: "sched", text: t("See the test-day bell schedule"), action: "test-schedule" },
          { id: "missing", text: t("Check Skyward for missing work before tests"), url: LINK("Skyward Family Access") },
          { id: "sleep", text: t("Plan for full nights of sleep and an early start on test days") },
        ] };
      }
    }
    // Conferences: ten days out through the last evening of the pair.
    // Each level has its own evenings; with students at several levels,
    // each student's dates are named.
    const conf = pick("conferences");
    for (const e of conf) {
      // One conference season: elementary, middle and high school evenings
      // fall within about two weeks of each other.
      const pair = conf.filter((x) => days(e.d, x.d) >= 0 && days(e.d, x.d) <= 15);
      const first = pair[0].d, last = pair[pair.length - 1].d;
      if (td >= SH.addDays(first, -10) && td <= last) {
        const byDates = new Map();
        for (const k of fam) {
          const ds = pair.filter((x) => !x.grades || x.grades.includes(k.grade)).map((x) => x.d);
          if (!ds.length) continue;
          const key = ds.join();
          if (!byDates.has(key)) byDates.set(key, { ds, names: [] });
          byDates.get(key).names.push(kidName(k));
        }
        const dateText = (ds) => ds.map((d) => fmtShort(d)).join(t(" and "));
        const sub = byDates.size === 1 ? dateText([...byDates.values()][0].ds) : [...byDates.values()].map((g) => `${g.names.join(t(" and "))}: ${dateText(g.ds)}`).join(". ");
        return { id: `conf-${first}`, title: t("Parent-teacher conferences"), sub, items: [
          { id: "grades", text: t("Look over grades and missing work in Skyward first"), url: LINK("Skyward Family Access") },
          { id: "how", text: t("Check the school's news for how conferences work this time"), action: "news" },
          { id: "qs", text: t("Write down one or two questions for each teacher") },
        ] };
      }
    }
    // Spring course requests (2026-27 closed Feb 18; the window has run
    // mid-January to mid-February).
    const [yy, mm, dd] = td.split("-").map(Number);
    const md = mm * 100 + dd;
    if (md >= 115 && md <= 218 && fam.some((k) => isHigh(k) || k.grade === 8)) {
      return { id: `reg-${yy}`, title: t("Choosing next year's classes"), sub: t("Course requests usually close in mid-February"), items: [
        { id: "book", text: t("Look through the course book together"), url: (DISTRICT_LINKS.find((l) => l.label === "Course book") || {}).url },
        { id: "sky", text: t("Course requests show in Skyward; check them before the deadline"), url: LINK("Skyward Family Access") },
        { id: "counselor", text: t("Questions about dual credit or career-tech classes go to the counselor"), action: "counselors" },
      ] };
    }
    // Sports physicals, April 1 into summer, for families following a sport.
    if (PHYSICALS && md >= 401 && md <= 820 && fam.some((k) => isHigh(k) && followsSport(k))) {
      return { id: `phys-${yy}`, title: t("Sports physicals"), sub: t("Before the first practice"), items: [
        { id: "book", text: t("Book a sports physical before summer workouts start") },
        { id: "info", text: t("Read the Activities handbook"), url: PHYSICALS.url },
      ] };
    }
    // A quarter ending within a week.
    const q = pick("quarter").find((e) => td >= SH.addDays(e.d, -7) && td <= e.d);
    if (q) return { id: `q-${q.d}`, title: distTitle(q.title), sub: fmtLong(q.d), items: [
      { id: "missing", text: t("Check Skyward for missing or late work before the quarter closes"), url: LINK("Skyward Family Access") },
      { id: "grades", text: t("Quarter grades show up in Skyward afterward"), url: LINK("Skyward Family Access") },
    ] };
    return null;
  }
  function seasonHtml(td) {
    const sea = seasonFor(td);
    if (!sea) return "";
    const all = store.get(SEASON_KEY, {});
    if (all[sea.id] === "hidden") return "";
    const done = all[sea.id] || {};
    return `<article class="card season-card">
      <div class="season-head"><div><p class="section-label" style="margin:0">${t("Right now")}</p><h2 class="season-title">${esc(sea.title)}</h2>${sea.sub ? `<p class="muted">${esc(sea.sub)}</p>` : ""}</div>
        <button class="install-close" data-action="season-hide" data-season="${esc(sea.id)}" aria-label="${esc(t("Hide until next time"))}">&times;</button></div>
      ${sea.items.map((i) => `<div class="check ${done[i.id] ? "done" : ""}"><input type="checkbox" id="sea-${esc(i.id)}" data-season-check="${esc(sea.id)}|${esc(i.id)}" ${done[i.id] ? "checked" : ""}><label for="sea-${esc(i.id)}">${esc(i.text)}</label>${
        i.url ? `<span></span><span><a class="link-btn" href="${esc(i.url)}" target="_blank" rel="noopener">${t("Open")}${outIcon()}</a></span>`
        : i.page ? `<span></span><span><button class="link-btn" data-page="${esc(i.page)}">${t("Read")}</button></span>`
        : i.action ? `<span></span><span><button class="link-btn" data-action="season-${esc(i.action)}">${t("Open")}</button></span>` : ""}</div>`).join("")}
    </article>`;
  }

  // "6 school days until Thanksgiving break" (next run of days off), or the
  // first day of school over the summer.
  function countdownText(td) {
    const year = SH.schoolYearFor(SCHOOL_YEARS, td);
    if (td < year.first) {
      const days = Math.round((parse(year.first) - parse(td)) / 864e5);
      return t(days === 1 ? "First day of school is {date}, {n} day away" : "First day of school is {date}, {n} days away", { date: fmtShort(year.first), n: days });
    }
    if (td > year.last) return t("Summer break");
    const isOff = (e) => e.kind === "break" || e.kind === "noschool" || e.kind === "last";
    let next = DISTRICT_CALENDAR.find((e) => isOff(e) && e.d > td && e.d <= year.last);
    if (!next) return kids.length > 1 ? t("Your students at a glance") : t("At a glance");
    let n = 0;
    for (let d = SH.addDays(td, 1); d < next.d; d = SH.addDays(d, 1)) if (!offReason(d)) n++;
    if (!offReason(td) && nowHM() < "15:30") n++;
    // The headline already names a day off that starts tomorrow (or the
    // next school day); count to the one after it instead.
    if (n <= 0 && next.kind !== "last") {
      const after = DISTRICT_CALENDAR.find((e) => isOff(e) && e.d > (next.to || next.d) && e.d <= year.last);
      if (!after) return kids.length > 1 ? t("Your students at a glance") : t("At a glance");
      for (let d = SH.addDays(next.to || next.d, 1); d < after.d; d = SH.addDays(d, 1)) if (!offReason(d)) n++;
      next = after;
    }
    const what = next.kind === "last" ? "the last day of school" : next.title.replace(/^No school:\s*/, "").replace(/^No school$/, "the next day off");
    // Spanish needs a different sentence for each of the three cases.
    const kind = what === "the last day of school" || what === "the next day off" ? what : "{what}";
    if (n <= 0) return t(`Next up: ${kind}`, { what: distTitle(what) });
    return t(`{n} school ${n === 1 ? "day" : "days"} until ${kind}`, { n, what: distTitle(what) });
  }

  // One weather line for the morning bus and dismissal (every school in the
  // district shares the same forecast).
  async function fillWeather(kid, token) {
    if (!kid) return;
    let w;
    try { w = await getWeather(); } catch { return; }
    if (token !== tokens.today || !$("weatherStrip")) return;
    const day = focusDay(kid);
    if (offReason(day)) return;
    const s = SCHOOLS[kid.school];
    const at = (hm) => w.hours.find((h) => h.at === `${day}T${hm}`);
    const am = at("07:00"), pm = at(`${bellTo24(s.bell.end).slice(0, 2)}:00`);
    if (!am && !pm) return;
    const part = (h, label) => h ? `<span><b>${label}</b> ${h.temp}°${h.feels < h.temp - 2 ? ` ${t("(feels {n}°)", { n: h.feels })}` : ""}, ${esc(tx(h.short).toLowerCase())}${h.pop >= 30 ? `, ${t("{n}% chance of rain or snow", { n: h.pop })}` : ""}</span>` : "";
    // Spanish: "Pronóstico para hoy / mañana / el lunes".
    const dayRef = lang === "es"
      ? (day === todayYmd() ? "hoy" : day === addDays(todayYmd(), 1) ? "mañana" : `el ${fmt(day, { weekday: "long" })}`)
      : relLabel(day) || fmt(day, { weekday: "long" });
    $("weatherStrip").innerHTML = `${ICONS.weather}<span>${[part(am, t("Bus time")), part(pm, t("After school"))].filter(Boolean).join(" &middot; ")}</span>`;
    void dayRef;
    $("weatherStrip").hidden = false;
  }
  let weatherCache = null;
  async function getWeather() {
    if (weatherCache && Date.now() - weatherCache.at < 20 * 60e3) return weatherCache.data;
    const data = await getJson("/.netlify/functions/weather");
    weatherCache = { at: Date.now(), data };
    return data;
  }

  // District alerts that change a school day: "2-hour late start Friday",
  // "Schools closed today", "early dismissal". Returns { kind, day, text }.
  function alertsForDay(alerts, day) {
    const out = [];
    for (const a of alerts || []) {
      const text = String(a.html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
      const low = text.toLowerCase();
      // An alert the app can't classify still reaches the card as a notice,
      // so a card never shows a normal day under a banner that says otherwise.
      const kind = SH.alertKind(text) || "notice";
      const pub = a.at ? new Date(a.at).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) : todayYmd();
      let target = pub;
      const dow = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].findIndex((d) => low.includes(d));
      if (/tomorrow/.test(low)) target = SH.addDays(pub, 1);
      else if (dow >= 0) { while (SH.weekday(target) !== dow) target = SH.addDays(target, 1); }
      if (target === day) out.push({ kind, day, text });
    }
    return out.find((x) => x.kind !== "notice") || out[0] || null;
  }
  function scheduleFor(school, kind) {
    const scheds = (HANDBOOKS[school] || {}).schedules || [];
    const rx = { late1: /1 hour late/i, late2: /2 hour late/i, early: /early release|in-service/i }[kind];
    return rx ? scheds.find((x) => rx.test(x.name)) : null;
  }

  async function fillKidCard(kid, token) {
    const school = kid.school;
    const s = SCHOOLS[school];
    const el0 = () => document.querySelector(`[data-kidcard="${CSS.escape(kid.id)}"]`);
    const banner = `<div class="kid-banner">${logoTile(school)}<span class="kid-banner-text"><span class="kid-name">${esc(kidName(kid))}</span><span class="kid-meta">${esc(schoolLabel(s))}, ${esc(gradeText(kid))}</span></span></div>`;
    if (kid.graduated) {
      const el = el0();
      if (el) el.innerHTML = `${banner}<p class="empty-note">${t("Graduated. Congratulations. Remove {name} under Students when you're ready.", { name: esc(kidName(kid)) })}</p>`;
      return null;
    }
    const day = focusDay(kid);
    const horizon = addDays(day, 14);
    const off = offReason(day);
    // Saturday and Sunday: the weekend's own games and events come first.
    const td0 = todayYmd();
    const weekendFrom = isWeekend(td0) ? td0 : null;
    let menu = null, events = null, alerts = null, menuErr = false, evErr = false;
    await Promise.all([
      getMenu(school, day, day).then((m) => (menu = m)).catch(() => (menuErr = true)),
      getEvents(school, weekendFrom || day, horizon).then((e) => (events = e)).catch(() => (evErr = true)),
      getSchool(school, "alerts").then((a) => (alerts = a.alerts)).catch(() => {}),
    ]);
    if (token !== tokens.today) return null;
    const el = el0();
    if (!el) return null;

    const changed = !off && alertsForDay(alerts, day);
    const sched = changed && scheduleFor(school, changed.kind);
    const bell = bellFor(s, day);
    if (sched && day === todayYmd()) schedHint[school] = sched.name;
    let status, derivedNote = "";
    if (off) status = `<span class="day-status off">${esc(off === "Weekend" ? t("No school") : distTitle(off))}</span>`;
    else if (changed && (changed.kind === "closed" || changed.kind === "remote")) status = `<span class="day-status off">${changed.kind === "remote" ? t("Remote learning day") : t("School closed")}</span>`;
    else if (changed && changed.kind === "late") status = `<span class="day-status off">${t("Late start: see the alert")}</span>`;
    else if (changed && changed.kind === "notice") status = `<span class="day-status off">${t("School alert: read it before you go")}</span>`;
    else if (changed) {
      const first = sched && sched.rows.find((r) => r.start), last = sched && [...sched.rows].reverse().find((r) => r.end);
      const what = { late1: t("1-hour late start"), late2: t("2-hour late start"), early: t("Early release") }[changed.kind];
      // Weather early dismissals are announced as "one/two hours early";
      // the handbook's early-release schedule is for planned in-service days.
      const earlyBy = changed.kind === "early" ? (/(one|1)[\s-]*hours?\s+early/i.test(changed.text) ? 1 : /(two|2)[\s-]*hours?\s+early/i.test(changed.text) ? 2 : /(three|3)[\s-]*hours?\s+early/i.test(changed.text) ? 3 : 0) : 0;
      const shift = (hm, h) => { const [H, M] = bellTo24(hm).split(":").map(Number); return `${pad(H + h)}:${pad(M)}`; };
      if (first && last && !earlyBy) status = `<span class="day-status off">${what}: ${t("{a} to {b}", { a: esc(fmtTime(bellTo24(first.start))), b: esc(fmtTime(bellTo24(last.end))) })}</span>`;
      else {
        // No published schedule (Roosevelt and Jefferson announce theirs in
        // the message): the district shifts the whole day, so work it out
        // from the school's usual hours and say so.
        const hours = changed.kind === "late2" ? [shift(bell.start, 2), bellTo24(bell.end)] : changed.kind === "late1" ? [shift(bell.start, 1), bellTo24(bell.end)] : earlyBy ? [bellTo24(bell.start), shift(bell.end, -earlyBy)] : null;
        status = `<span class="day-status off">${what}${hours ? `: ${t("about {a} to {b}", { a: esc(fmtTime(hours[0])), b: esc(fmtTime(hours[1])) })}` : ""}</span>`;
        if (hours) derivedNote = t("Worked out from {school}'s usual hours. The school's message has the exact times.", { school: s.short });
      }
    } else status = `<span class="day-status">${t(bell.about ? "School about {a} to {b}" : "School {a} to {b}", { a: esc(fmtTime(bellTo24(bell.start))), b: esc(fmtTime(bellTo24(bell.end))) })}</span>`;
    if (!changed && !off && bell.about) derivedNote = t("{school} doesn't publish its hours; these are typical for the district. Call {phone} to check.", { school: s.short, phone: s.phone });

    const rows = [];
    if (off === "Summer break") {
      const year = SH.schoolYearFor(SCHOOL_YEARS, day);
      if (day < year.first) {
        const g = SH.gradeOf(kid.classOf, year.first);
        if (g <= 12) rows.push(`<div class="row"><span class="row-k">${t("Next up")}</span><span class="row-v"><b>${t("First day of {grade}: {date}", { grade: gradeName(g), date: esc(fmtLong(year.first)) })}</b><span class="sub">${t("The {year} calendar is already in the app.", { year: esc(year.id) })}</span></span></div>`);
      } else rows.push(`<div class="row"><span class="row-k">${t("Next up")}</span><span class="row-v"><b>${t("The {year} calendar isn't published yet", { year: esc(year.id) })}</b><span class="sub">${t("It shows up here as soon as the district posts it.")}</span></span></div>`);
    }
    if (changed) rows.push(`<button class="row tap" data-goto="school"><span class="row-k">${t("Alert")}</span><span class="row-v"><b>${esc(changed.text.slice(0, 140))}</b>${sched ? `<span class="sub">${t("See the {name} bell schedule", { name: esc(sched.name.toLowerCase()) })}</span>` : ""}</span></button>`);
    if (!off && !(changed && changed.kind === "closed")) {
      if (menuErr) rows.push(`<div class="row"><span class="row-k">${t("Lunch")}</span><span class="row-v muted">${t("Menu unavailable right now")}</span></div>`);
      else {
        const line = lunchLine(menu.byDay.get(day), kid.diet);
        if (line) {
          const m = describeMeal(line.items);
          const warn = allergyWarning(kid, line.items);
          rows.push(`<button class="row" data-goto="lunch"><span class="row-k">${t("Lunch")}</span><span class="row-v"><b>${esc(m.main)}</b>${kid.diet && line.key !== "Lunch" ? `<span class="tag grade">${esc(dietLow(kid.diet))}</span>` : ""}${m.sides.length ? `<span class="sub">${esc(m.sides.slice(0, 3).join(", "))}</span>` : ""}${warn ? `<span class="sub flag-note">${esc(warn)}</span>` : ""}</span></button>`);
        } else rows.push(`<div class="row"><span class="row-k">${t("Lunch")}</span><span class="row-v muted">${t("Menu not posted yet")}</span></div>`);
      }
    }

    let upcoming = [], mine = [], weekendRows = [];
    if (evErr) rows.push(`<div class="row"><span class="row-k">${t("Events")}</span><span class="row-v muted">${t("Calendar unavailable right now")}</span></div>`);
    else {
      mine = groupEvents(sortEvents(mergeDistrict(events, weekendFrom || day, horizon, kid.grade, kid).filter((e) => mineFilter(kid, e))));
      weekendRows = weekendFrom ? mine.filter((e) => e.d >= weekendFrom && e.d < day && !e.district && e.cat !== "noschool") : [];
      const onDay = mine.filter((e) => e.d <= day && (e.to || e.d) >= day && !(off && e.cat === "noschool"));
      for (const e of onDay.slice(0, 4)) rows.push(eventRow(e, { heads: true }));
      if (onDay.length > 4) rows.push(`<button class="row tap" data-goto="calendar"><span class="row-k"></span><span class="row-v">${t("{more} in Calendar", { more: `<b>${t("{n} more", { n: onDay.length - 4 })}</b>` })}</span></button>`);
      // Games and school dates first; college visits are frequent enough to
      // crowd them out, so at most one makes the list.
      let visits = 0;
      // With several students the family week below carries what's ahead.
      upcoming = kids.filter((k) => !k.graduated).length > 1 ? [] : collapseDaysOff(mine.filter((e) => e.d > day)).filter((e) => e.cat !== "college" || visits++ < 1).slice(0, 3);
    }

    const followNudge = !(kid.follows || []).length
      ? `<button class="link-btn" data-action="follow" data-kid="${esc(kid.id)}">${t("Add {name}'s teams and activities", { name: esc(kidName(kid)) })}</button>` : "";

    // Compact: one line each for hours, events, lunch, what's next.
    // A schedule: times in a left column, what's happening on the right,
    // three labeled sections with space between them instead of rules.
    const srow = (when, what, attrs = "", cls = "") => attrs
      ? `<button class="srow tap${cls}" ${attrs}><span class="when">${when}</span><span class="what">${what}</span></button>`
      : `<div class="srow${cls}"><span class="when">${when}</span><span class="what">${what}</span></div>`;
    const evRow = (e, withDay) => {
      const when = withDay ? esc(fmtShort(e.d)) : e.t ? esc(fmtTime(e.t)) : esc(t("All day"));
      const where = e.home === true ? `, ${t("home")}` : e.home === false ? `, ${t("away")}` : "";
      const time = withDay && e.t ? `<span class="sub">${esc(fmtTime(e.t))}</span>` : "";
      return srow(when, `${esc(evTitle(e))}${esc(where)}${e.x ? ` <span class="tag x">${t("Cancelled")}</span>` : ""}${time}`, `data-ev="${esc(e.id)}"`);
    };
    const onDay = mine.filter((e) => e.d <= day && (e.to || e.d) >= day && !(off && e.cat === "noschool") && !e.district);
    const lunchRow = (() => {
      if (off || (changed && changed.kind === "closed")) return "";
      if (menuErr) return srow(esc(t("Lunch")), esc(t("Menu unavailable right now")), "", " muted");
      const l = lunchLine(menu.byDay.get(day), kid.diet);
      if (!l) return srow(esc(t("Lunch")), esc(t("Menu not posted yet")), "", " muted");
      const m = describeMeal(l.items);
      const warn = allergyWarning(kid, l.items);
      return srow(esc(t("Lunch")), `${esc(m.main)}${kid.diet && l.key !== "Lunch" ? ` <span class="tag grade">${esc(dietLow(kid.diet))}</span>` : ""}${warn ? `<span class="flag-note">${esc(warn)}</span>` : ""}`, `data-goto="lunch"`);
    })();
    const next = activeKids().length > 1 ? [] : upcoming.slice(0, 2);
    el.innerHTML = `
      ${banner}
      <p class="day-status-line${changed || off ? " warn" : ""}">${status}</p>
      ${derivedNote ? `<p class="sum-note">${esc(derivedNote)}</p>` : ""}
      ${weekendRows.length ? `<p class="sum-label">${t("This weekend")}</p><div class="sched">${weekendRows.slice(0, 3).map((e) => evRow(e, true)).join("")}</div>` : ""}
      ${changed && changed.kind === "closed" && onDay.length ? `<p class="sum-note">${t("School is closed, so these may be cancelled. The district's alert says what's still on.")}</p>` : ""}
      <div class="sched">
        ${onDay.slice(0, 3).map((e) => evRow(e)).join("")}
        ${onDay.length > 3 ? srow("", t("{more} in Calendar", { more: `<b>${t("{n} more", { n: onDay.length - 3 })}</b>` }), `data-goto="calendar"`, " more") : ""}
        ${lunchRow}
      </div>
      ${next.length ? `<p class="sum-label">${t("Coming up")}</p><div class="sched">${next.map((e) => evRow(e, true)).join("")}</div>` : ""}
      ${madeForHtml(kid, mine, activeKids().length > 1 ? 2 : 3)}
      ${followNudge ? `<div class="sum-foot">${followNudge}</div>` : ""}`;
    return { kid, mine, day, off, changed };
  }


  // Students that came back by family code (or from another phone) without
  // their name, lunch line and allergies, which only ever live on a phone.
  // Each fall a 5th grader becomes a 6th grader at a middle school (and an
  // 8th grader starts high school): ask for the new school.
  function movingUpHtml() {
    const up = kids.filter(movingUp);
    if (!up.length) return "";
    return `<article class="card finish-setup">
      <p class="finish-title">${t("New school this year?")}</p>
      ${up.map((k) => `<p>${t("{name} is in {grade} now. Pick the new school to see the right lunch, calendar and hours.", { name: esc(kidName(k)), grade: esc(gradeName(k.grade)) })}</p>
      <button class="btn primary block" data-action="edit-kid" data-kid="${esc(k.id)}">${t("Pick {name}'s school", { name: esc(kidName(k)) })}</button>`).join("")}
    </article>`;
  }
  // Each new school year, ask whether each student's teams and activities
  // are still right, so the calendar and alerts start the year accurate.
  // Shown from two weeks before the first day to three weeks after, for
  // students who follow teams (one with none already has an "Add teams"
  // link on their card); a student added in that window is skipped.
  const ACTS_KEY = "sfp-acts-year"; // { kidId: school year id confirmed }
  function actsWindow() {
    const td = todayYmd();
    const year = SH.schoolYearFor(SCHOOL_YEARS, td);
    const open = td >= addDays(year.first, -14) && td <= addDays(year.first, 21);
    return { year, open, from: addDays(year.first, -14) };
  }
  function confirmActs(kidId) {
    const w = actsWindow();
    if (!w.open) return;
    const done = store.get(ACTS_KEY, {});
    done[kidId] = w.year.id;
    store.set(ACTS_KEY, done);
  }
  function activitiesCheckHtml() {
    const w = actsWindow();
    if (!w.open) return "";
    const done = store.get(ACTS_KEY, {});
    const due = activeKids().filter((k) => (k.follows || []).length && !movingUp(k) && done[k.id] !== w.year.id && !(k.addedAt && k.addedAt >= w.from));
    if (!due.length) return "";
    return `<article class="card finish-setup">
      <p class="finish-title">${t("New school year")}</p>
      <p>${t("Teams and activities change from year to year. Check each list so the calendar and alerts are right from the start.")}</p>
      ${due.map((k) => {
        const n = k.follows.length;
        const name = esc(kidName(k));
        return `<div class="acts-row"><p><b>${name}</b>: ${t(n === 1 ? "1 team or activity" : "{n} teams and activities", { n })}</p>
          <div class="sheet-actions"><button class="btn primary block" data-action="follow" data-kid="${esc(k.id)}">${t("Update {name}'s activities", { name })}</button>
          <button class="btn block" data-action="acts-ok" data-kid="${esc(k.id)}">${t("They're still right")}</button></div></div>`;
      }).join("")}
    </article>`;
  }
  function finishSetupHtml() {
    const todo = kids.filter((k) => k.needsDetails && !k.graduated);
    if (!todo.length) return movingUpHtml();
    return `<article class="card finish-setup">
      <p class="finish-title">${t("Finish setting up this phone")}</p>
      <p>${t("Your family code brought back each student's school, grade and teams. Names, lunch lines and food allergies stay on the phone they were entered on, so add them here. Until then, menus can't warn you about allergies.")}</p>
      <div class="sheet-actions">${todo.map((k) => `<button class="btn primary block" data-action="edit-kid" data-kid="${esc(k.id)}">${t("Add details for {who}", { who: esc(`${kidName(k)}, ${SCHOOLS[k.school].short}, ${gradeName(k.grade)}`) })}</button>`).join("")}</div>
    </article>`;
  }

  // "Made for [student]": two or three things this household gains, picked
  // for the student's grade and school. Dated items first (a deadline, a
  // grade event, conferences), then things families often don't know the
  // schools offer. Every fact is from a handbook, the district or the
  // school's own calendar.
  const GEMS = [
    { grades: [10, 11], title: "College classes for about $80 a credit hour", sub: "Dual credit counts in high school and college", go: "guide" },
    { grades: [9, 10], title: "Up to $7,500 for college", sub: "The Opportunity Scholarship starts with the classes taken now", go: "guide" },
    { grades: [12], title: "Tuition, fees and books at a technical college", sub: "Build Dakota Scholarship: apply January 1 to March 31", go: "guide" },
    { levels: ["hs"], grades: [9, 10], months: [8, 9, 10, 11], title: "{n} clubs at {school}", sub: "Something for every interest, with the advisor to ask", action: "clubs" },
    { levels: ["hs", "ms", "is"], title: "The handbook, searchable", sub: "Attendance, phones, dress code, grading: the real wording, in the app", action: "handbook" },
    { levels: ["ms", "hs"], sport: true, title: "A physical before the first practice", sub: "The Activities handbook says what the school needs on file", action: "handbook" },
    { levels: ["es", "is"], months: [7, 8, 9], title: "{school}'s supply list", sub: "Right in the app, grade by grade", action: "supplies-sheet" },
    { levels: ["es"], title: "Breakfast at school from 7:30", sub: "$2.40, every school day. Not served on a two-hour late start.", go: "school" },
    { levels: ["es", "is", "ms"], title: "Free or reduced meals if you qualify", sub: "Apply once a year in LINQ Connect.", url: LINK("Free and reduced meals") },
    { grades: [4], months: [1, 2, 3, 4, 5, 6], title: "The Intermediate School is next fall", sub: "Hours, teams and what changes", go: "guide" },
    { grades: [6], months: [1, 2, 3, 4, 5, 6], title: "Middle school is next fall", sub: "Nine periods, activities and what changes", go: "guide" },
    { grades: [8], months: [1, 2, 3, 4, 5, 6], title: "High school is next fall", sub: "Class choices in the spring", go: "guide" },
  ];
  let clubCount = {};
  function madeForHtml(kid, mine, max) {
    const td = todayYmd(), soon = addDays(td, 30), month = Number(td.slice(5, 7));
    const s = SCHOOLS[kid.school];
    const out = [], dated = [];
    const row = (icon, title, sub, attrs) => `<button class="sum-line tap" ${attrs}>${icon}<span><b>${esc(title)}</b><span class="sub">${esc(sub)}</span></span></button>`;
    // Dated: the next deadline, a grade-only event, conferences or quarter end.
    const dl = SH.deadlinesFor({ DEADLINES, TEST_DATES, TEST_LINKS }, kid.grade, td, addDays(td, 60))[0];
    if (dl) dated.push([3, `<a class="sum-line tap" href="${esc(dl.url)}" target="_blank" rel="noopener">${ICONS.due}<span><b>${esc(t(dl.key, { ...dl.vars, date: dl.vars.date ? fmtMonthDay(dl.vars.date) : "" }))}</b><span class="sub">${esc(cap(fmtLong(dl.d)))}</span></span></a>`]);
    const gradeEv = mine.find((e) => e.d > td && e.d <= soon && e.g && e.g.length < 4 && e.g.includes(kid.grade) && e.cat !== "college");
    if (gradeEv) { eventStore.set(gradeEv.id, gradeEv); dated.push([4, row(ICONS.event, evTitle(gradeEv), t("Just for {grade}: {date}", { grade: gradeName(kid.grade), date: fmtShort(gradeEv.d) }), `data-ev="${esc(gradeEv.id)}" data-school="${esc(kid.school)}"`)]); }
    const visits = mine.filter((e) => e.cat === "college" && e.d >= td && e.d <= soon).length;
    if (kid.grade >= 11 && visits) dated.push([5, row(ICONS.event, t(visits === 1 ? "{n} college or career visit at {school} this month" : "{n} college and career visits at {school} this month", { n: visits, school: s.short }), t("Colleges, the military and employers come to school"), `data-goto="calendar" data-filter="college"`)]);
    // Free help filing the FAFSA, from the school's own calendar.
    const aidNight = kid.grade >= 11 && mine.find((e) => e.d >= td && e.d <= addDays(td, 45) && /FAFSA|financial aid/i.test(e.title));
    if (aidNight) { eventStore.set(aidNight.id, aidNight); dated.push([2, row(ICONS.event, t("Free help with the FAFSA: {title}", { title: evTitle(aidNight) }), `${cap(fmtShort(aidNight.d))}${aidNight.t ? `, ${fmtTime(aidNight.t)}` : ""}`, `data-ev="${esc(aidNight.id)}" data-school="${esc(kid.school)}"`)]); }
    // State tournaments for a team the student follows.
    // State championships are high school events.
    const state = s.level === "hs" && SH.stateFor(STATE_EVENTS, kid, td, addDays(td, 60))[0];
    if (state) { eventStore.set(state.id, state); dated.push([1, row(ICONS.game, distTitle(state.title), `${cap(fmtShort(state.d))}${state.to ? ` ${t("to")} ${fmtShort(state.to)}` : ""}${state.venue ? `, ${state.venue}` : ""}`, `data-ev="${esc(state.id)}" data-school="${esc(kid.school)}"`)]); }
    const dist = DISTRICT_CALENDAR.find((e) => (e.kind === "conferences" || e.kind === "quarter") && e.d > td && e.d <= addDays(td, 21) && (!e.grades || e.grades.includes(kid.grade)));
    if (dist) dated.push([6, row(ICONS.event, distTitle(dist.title), cap(fmtLong(dist.d)), `data-goto="calendar" data-filter="days"`)]);
    // Things families often don't know about.
    for (const g of GEMS) {
      if (g.schools && !g.schools.includes(kid.school)) continue;
      if (g.notSchools && g.notSchools.includes(kid.school)) continue;
      if (g.levels && !g.levels.includes(s.level)) continue;
      if (g.grades && !g.grades.includes(kid.grade)) continue;
      if (g.months && !g.months.includes(month)) continue;
      if (g.es && lang !== "es") continue;
      if (g.sport && !followsSport(kid)) continue;
      const title = t(g.title, { n: clubCount[kid.school] || "", school: s.short });
      if (/^\s/.test(title)) continue; // club count not loaded yet
      if (g.url) { out.push(`<a class="sum-line tap" href="${esc(g.url)}" target="_blank" rel="noopener">${ICONS.star}<span><b>${esc(title)}</b><span class="sub">${esc(t(g.sub, { school: s.short }))}</span></span></a>`); continue; }
      const attrs = g.page ? `data-page="${g.page}"` : g.action ? `data-action="${g.action}" data-kid="${esc(kid.id)}"` : `data-goto="${g.go}"`;
      out.push(row(ICONS.star, title, t(g.sub, { school: s.short }), attrs));
    }
    // A mix: the two most useful dated items (a state tournament, a FAFSA
    // night, a deadline...), then the discoveries.
    const pick = [...dated.sort((a, b) => a[0] - b[0]).slice(0, 2).map((x) => x[1]), ...out].slice(0, max);
    return pick.length ? `<div class="made-for"><p class="sum-label">${kid.name ? t("Made for {name}", { name: esc(kid.name) }) : t("Worth knowing")}</p>${pick.join("")}</div>` : "";
  }

  // "Who is absent?": straight through with one student, a choice with more.
  let pickKidThen = null;
  function pickKid(title, then) {
    const list = activeKids();
    if (list.length === 1) return then(list[0]);
    pickKidThen = then;
    openSheet(title, `<div class="sheet-actions">${list.map((k) => `<button class="btn block" data-action="pick-kid" data-kid="${esc(k.id)}" style="${kidStyle(k)}">${esc(kidName(k))}, ${esc(SCHOOLS[k.school].short)}</button>`).join("")}</div>`);
  }

  // A new student's first week: what matters for their grade right now and
  // where things are, shown for seven days or until the parent closes it.
  const WELCOME_KEY = "sfp-welcomed";
  function firstWeekHtml(kid) {
    if (!kid.addedAt || kid.graduated || addDays(kid.addedAt, 7) < todayYmd() || store.get(WELCOME_KEY, {})[kid.id]) return "";
    const td = todayYmd();
    const soon = SH.deadlinesFor({ DEADLINES, TEST_DATES, TEST_LINKS }, kid.grade, addDays(td, 15), addDays(td, 60)).slice(0, 2);
    return `<article class="card first-week" style="${kidStyle(kid)}">
      <div class="first-week-head"><p class="first-week-title">${t("New to {grade}? Here's what's ahead for {name}.", { grade: esc(gradeName(kid.grade)), name: esc(kidName(kid)) })}</p><button class="install-close" data-action="welcome-done" data-kid="${esc(kid.id)}" aria-label="${t("Dismiss")}">&times;</button></div>
      ${soon.length ? `<div class="rows">${soon.map((x) => `<a class="row tap" href="${esc(x.url)}" target="_blank" rel="noopener"><span class="row-k">${esc(fmtMonthDay(x.d))}</span><span class="row-v"><b>${esc(t(x.key, { ...x.vars, date: x.vars.date ? fmtMonthDay(x.vars.date) : "" }))}</b></span></a>`).join("")}</div>` : ""}
      <button class="btn block" data-goto="guide">${t("See the {grade} checklist", { grade: esc(gradeName(kid.grade)) })}</button>
    </article>`;
  }

  // "Changed since you last looked": game times that moved, games that were
  // cancelled or added for followed teams, and new posts from the schools.
  // The picture is kept on this phone only; the first visit just records it.
  const SEEN_KEY = "sfp-seen-v2"; // v2: game times in local time
  async function renderChanged(results, token) {
    const box = $("changedBox");
    if (!box) return;
    const prev = store.get(SEEN_KEY, null);
    const next = { at: Date.now(), games: {}, news: {}, follows: {} };
    const changes = [];
    const td = todayYmd();
    for (const { kid, mine } of results) {
      // Teams this phone already followed last time: a team just added
      // brings its whole season, and none of that is "new".
      next.follows[kid.id] = (kid.follows || []).map((f) => f.act);
      const known = new Set((prev && prev.follows && prev.follows[kid.id]) || []);
      const games = mine.flatMap((g) => (g.parts ? g.parts.map((p) => ({ ...g, ...p, parts: null })) : [g])).filter((e) => e.act && e.d >= td);
      // A game whose wording was corrected (say "at" became "vs") gets a new
      // id. Same child, same day and time, and the old one gone: a rename,
      // not a new game.
      const nowKeys = new Set(games.map((e) => `${kid.id}|${e.id}`));
      const renamed = (e) => prev && Object.entries(prev.games).some(([k, g]) => k.startsWith(`${kid.id}|`) && !nowKeys.has(k) && g.d === e.d && g.t === (e.t || ""));
      for (const e of games) {
        const key = `${kid.id}|${e.id}`;
        eventStore.set(e.id, e);
        next.games[key] = { t: e.t || "", x: !!e.x, d: e.d };
        const was = prev && prev.games[key];
        if (!prev) continue;
        const title = `${evTitle(e)}${e.level && !/^(High School|HS )/.test(e.level) ? ` (${tt(e.level)})` : ""}`;
        if (!was) { if (known.has(e.act) && Date.now() - prev.at < 21 * 864e5 && !renamed(e)) changes.push({ kid, d: e.d, ev: e.id, text: t("New: {title}", { title }) }); }
        else if (e.x && !was.x) changes.push({ kid, d: e.d, ev: e.id, text: t("Cancelled: {title}", { title }), x: true });
        else if (was.t !== (e.t || "") && e.t) changes.push({ kid, d: e.d, ev: e.id, text: t("{title} moved to {time} (was {was})", { title, time: fmtTime(e.t), was: was.t ? fmtTime(was.t) : t("no time") }) });
        else if (was.d !== e.d) changes.push({ kid, d: e.d, ev: e.id, text: t("{title} moved to {day}", { title, day: fmtShort(e.d) }) });
      }
    }
    for (const sc of [...new Set(results.map((r) => r.kid.school))]) {
      const news = await getSchool(sc, "news").catch(() => null);
      if (token !== tokens.today) return;
      for (const n of (news && news.items) || []) {
        next.news[`${sc}|${n.id}`] = 1;
        if (prev && !prev.news[`${sc}|${n.id}`] && Object.keys(prev.news).some((k) => k.startsWith(`${sc}|`))) {
          newsStore.set(sc, news.items);
          changes.push({ school: sc, news: n.id, text: t("New from {school}: {title}", { school: SCHOOLS[sc].short, title: tx(n.title) }) });
        }
      }
    }
    store.set(SEEN_KEY, next);
    if (!changes.length) { box.innerHTML = ""; return; }
    box.innerHTML = `<article class="card changed-card"><p class="section-label" style="margin:0 0 4px">${t("Changed since you last looked")}</p><div class="rows">${changes.slice(0, 6).map((c) => c.news
      ? `<button class="row tap" data-news="${esc(c.news)}" data-news-school="${esc(c.school)}"><span class="row-k">${t("News")}</span><span class="row-v"><b>${esc(c.text)}</b></span></button>`
      : `<button class="row tap ${c.x ? "x" : ""}" data-ev="${esc(c.ev)}" data-school="${esc(c.kid.school)}"><span class="row-k">${esc(fmtMonthDay(c.d))}</span><span class="row-v"><b>${esc(c.text)}</b><span class="sub">${esc(kidName(c.kid))}</span></span></button>`).join("")}</div></article>`;
  }

  // The family's next seven days in one list: who needs to be where.
  // Two students with events at different places within an hour of each
  // other get a "Same time" flag, the moment parents plan rides around.
  function renderWeek(results) {
    const box = $("familyWeek");
    // One student's week is already in their card.
    if (!box || results.length < 2) { if (box) box.innerHTML = ""; return; }
    // The cards above already show their day; the week starts after it.
    const td = addDays(results[0].day || todayYmd(), 1);
    const end = SH.addDays(td, 6);
    const items = [];
    for (const { kid, mine } of results) {
      for (const e of mine) {
        if (e.d < td || e.d > end) continue;
        if (!(e.act || e.district || e.cat === "noschool" || e.cat === "academic" || (e.cat === "school" && SH.HIGHLIGHT.test(e.title)))) continue;
        if (e.cat === "practice") continue;
        items.push({ kid, e });
      }
    }
    if (!items.length) { box.innerHTML = ""; return; }
    const byDay = new Map();
    for (const it of items) { if (!byDay.has(it.e.d)) byDay.set(it.e.d, []); byDay.get(it.e.d).push(it); }
    const minutes = (hm) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
    const days = [...byDay.keys()].sort().map((d) => {
      const list = byDay.get(d).sort((a, b) => (a.e.t || "").localeCompare(b.e.t || ""));
      const clash = new Set();
      for (const a of list) for (const b of list) {
        if (a === b || a.kid.id === b.kid.id || !a.e.t || !b.e.t || a.e.venue === b.e.venue) continue;
        if (Math.abs(minutes(a.e.t) - minutes(b.e.t)) <= 60) { clash.add(a); clash.add(b); }
      }
      const shown = new Set();
      // A district day off is one line for the whole family, not one per child.
      const merged = [];
      const byDistrict = new Map();
      for (const it of list) {
        const k = `${it.kid.id}|${it.e.id}`;
        if (shown.has(k)) continue;
        shown.add(k);
        if (it.e.district || it.e.cat === "noschool") {
          const key = evTitle(it.e);
          if (byDistrict.has(key)) { byDistrict.get(key).others.push(it.kid); continue; }
          it.others = [];
          byDistrict.set(key, it);
        }
        merged.push(it);
      }
      return `<div class="week-day"><p class="week-date">${esc(cap(fmtShort(d)))}${relLabel(d) ? ` <span class="rel">${esc(cap(relLabel(d)))}</span>` : ""}</p>
        ${merged.map((it) => {
          const { kid, e } = it;
          eventStore.set(e.id, e);
          const where = e.home === true ? t("home") : e.home === false ? t("away") : "";
          const who = it.others && it.others.length ? [kid, ...it.others].map(kidName).join(", ") : kidName(kid);
          return `<button class="week-row" data-ev="${esc(e.id)}" data-school="${esc(kid.school)}" style="${it.others && it.others.length ? "" : kidStyle(kid)}">
            <span class="week-who">${it.others && it.others.length ? "" : '<span class="dot"></span>'}${esc(who)}</span>
            <span class="week-what"><b>${esc(evTitle(e))}</b>${clash.has(it) ? `<span class="tag x">${t("Same time")}</span>` : ""}<span class="sub">${esc([e.t ? fmtTime(e.t) : (e.district || e.cat === "noschool" ? "" : t("All day")), where].filter(Boolean).join(", "))}</span></span>
          </button>`;
        }).join("")}</div>`;
    }).join("");
    // Plain text of the same week, for a grandparent, a carpool partner or
    // anyone without the app.
    weekText = [...byDay.keys()].sort().map((d) => `${cap(fmtShort(d))}\n${byDay.get(d).map(({ kid, e }) => {
      const where = e.home === true ? t("home") : e.home === false ? t("away") : "";
      return `- ${kidName(kid)}: ${evTitle(e)}${e.t ? `, ${fmtTime(e.t).replace("\u00a0", " ")}` : ""}${where ? ` (${where})` : ""}`;
    }).filter((v, i, a) => a.indexOf(v) === i).join("\n")}`).join("\n\n");
    box.innerHTML = `<div class="week-head"><p class="section-label">${kids.length > 1 ? t("The family's week") : t("{name}'s week", { name: esc(kidName(results[0].kid)) })}</p><button class="link-btn" data-action="share-week">${t("Share this week")}</button></div><article class="card week-card">${days}</article>`;
  }
  let weekText = "";
  function shareWeek() {
    const text = `${t("This week")}\n\n${weekText}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast(t("Copied. Paste it into a text or email.")), () => prompt(t("Copy this"), text));
    else prompt(t("Copy this"), text);
  }

  /* ----- Lunch ----- */

  async function renderLunch() {
    const kid = activeKid();
    const v = $("view-lunch");
    const token = bump("lunch");
    if (!lunchWeek) {
      const td = todayYmd();
      lunchWeek = mondayOf(isWeekend(td) ? addDays(td, 2) : td);
    }
    const week = lunchWeek;
    const days = [0, 1, 2, 3, 4].map((i) => addDays(week, i));
    v.innerHTML = `
      <div class="pager">
        <button class="pager-btn" data-week="-1" aria-label="${t("Previous week")}">${PREV}</button>
        <button class="pager-label" data-week="0" title="${t("This week")}">${t("{a} to {b}", { a: esc(fmtMonthDay(days[0])), b: esc(fmtMonthDay(days[4])) })}</button>
        <button class="pager-btn" data-week="1" aria-label="${t("Next week")}">${NEXT}</button>
      </div>
      <div id="lunchDays" class="view"><p class="loading">${t("Loading menu")}</p></div>`;
    // The answer first, like the Brandon Valley app: the next lunch this
    // student will eat, big, with a peek at the one after.
    v.insertAdjacentHTML("afterbegin", `<div id="lunchHero"></div>`);
    fillLunchHero(kid, token);
    let menu;
    try { menu = await getMenu(kid.school, days[0], days[4]); }
    catch { if (token === tokens.lunch) $("lunchDays").innerHTML = errorNote(t("the menu")); return; }
    if (token !== tokens.lunch) return;
    const td = todayYmd();
    $("lunchDays").innerHTML = days.map((d) => {
      const off = offReason(d) || (menu.off && menu.off[d] ? `No school: ${menu.off[d].replace(/\s*-\s*no school/i, "")}` : null);
      const lines = menu.byDay.get(d);
      let body;
      if (off) body = `<div class="menu-off">${esc(distTitle(off))}</div>`;
      else if (!lines) body = `<div class="muted">${t("Menu not posted yet")}</div>`;
      else {
        const lunch = lunchLine(lines, kid.diet);
        const m = lunch ? describeMeal(lunch.items) : null;
        const bf = lines.Breakfast ? describeMeal(lines.Breakfast) : null;
        const warn = lunch ? allergyWarning(kid, lunch.items) : "";
        body = `${m ? `<div class="menu-main">${esc(m.main)}</div>${m.sides.length ? `<div class="menu-sides">${esc(m.sides.join(", "))}</div>` : ""}${warn ? `<div class="flag-note">${esc(warn)}</div>` : ""}` : `<div class="muted">${t("Lunch not posted")}</div>`}
          ${bf ? `<div class="menu-bfast"><b>${t("Breakfast:")}</b> ${esc(bf.main)}</div>` : ""}`;
      }
      if (lines && !off) menuStore.set(d, lines);
      const tag = lines && !off ? "button" : "article";
      return `<${tag} class="card menu-day ${d === td ? "today" : ""} ${d < td ? "past" : ""} ${tag === "button" ? "tap-card" : ""}" style="${kidStyle(kid)}" ${tag === "button" ? `data-menu="${d}" aria-label="${t("Full menu for {date}", { date: esc(fmtLong(d)) })}"` : ""}>
        <div class="menu-date"><div class="dow">${esc(cap(fmt(d, { weekday: "short" })))}</div><div class="dom">${parse(d).getDate()}</div></div>
        <div>${body}</div></${tag}>`;
    }).join("") + `
      <p class="empty-note" style="text-align:center">${menu.prices.lunch ? `${t("Lunch {lunch}, breakfast {breakfast}.", { lunch: `$${menu.prices.lunch.toFixed(2)}`, breakfast: `$${(menu.prices.breakfast || 0).toFixed(2)}` })} ` : ""}<a href="${esc(LINK("Lunch account"))}" target="_blank" rel="noopener">${t("Add money in LINQ Connect")}</a></p>
      <p class="empty-note" style="text-align:center">${t("Tap a day for the full menu, every lunch line and allergens. Menus can change.")}</p>`;
  }

  // Parents mostly check the night before: from 1 PM on, the card looks
  // ahead to the next school day. Days off and unposted menus are skipped.
  async function fillLunchHero(kid, token) {
    const now = new Date();
    const start = now.getHours() >= 13 ? addDays(todayYmd(), 1) : todayYmd();
    let menu;
    try { menu = await getMenu(kid.school, start, addDays(start, 20)); } catch { return; }
    if (token !== tokens.lunch || !$("lunchHero")) return;
    const found = [];
    for (let i = 0; i <= 20 && found.length < 2; i++) {
      const d = addDays(start, i);
      if (isWeekend(d) || offReason(d) || (menu.off && menu.off[d])) continue;
      const lines = menu.byDay.get(d);
      const line = lunchLine(lines, kid.diet);
      if (!line) continue;
      menuStore.set(d, lines);
      found.push({ d, line });
    }
    if (!found.length) return;
    const [{ d, line }, after] = found;
    const mains = line.items.filter((i) => i.t === "ENTREES").map((i) => dish(i.n));
    const main = mains[0] || describeMeal(line.items).main;
    const sides = describeMeal(line.items).sides;
    const warn = allergyWarning(kid, line.items);
    const td = todayYmd();
    const when = d === td ? t("Today") : d === addDays(td, 1) ? t("Tomorrow") : t("Next school day");
    const afterMain = after && ((after.line.items.find((i) => i.t === "ENTREES") || {}).n || describeMeal(after.line.items).main);
    $("lunchHero").innerHTML = `
      <button class="lunch-hero" data-menu="${d}" style="${kidStyle(kid)}" aria-label="${t("Full menu for {date}", { date: esc(fmtLong(d)) })}">
        <span class="lunch-hero-kicker">${esc(when)} &middot; ${esc(cap(fmtLong(d)))}</span>
        <span class="lunch-hero-main">${esc(main)}</span>
        ${sides.length ? `<span class="lunch-hero-sides">${t("with {sides}", { sides: esc(sides.slice(0, 3).join(" · ")) })}</span>` : ""}
        ${mains.length > 1 ? `<span class="lunch-hero-alt">${t("or:")} <b>${mains.slice(1).map(esc).join("</b> · <b>")}</b></span>` : ""}
        ${kid.diet && line.key !== "Lunch" ? `<span class="lunch-hero-line">${esc(upFirst(t("{diet} line for {name}", { diet: dietLow(kid.diet), name: kidName(kid) })))}</span>` : ""}
        ${warn ? `<span class="lunch-hero-flag flag-note">${esc(warn)}</span>` : ""}
      </button>
      ${afterMain ? `<p class="lunch-hero-next">${esc(cap(fmt(after.d, { weekday: "long" })))}: <b>${esc(dish(afterMain))}</b></p>` : ""}`;
  }

  // Full day menu: every line the cafeteria serves, with the nine major
  // allergens on each item. The student's own line comes first.
  const menuStore = new Map();
  function openMenu(d) {
    const kid = activeKid();
    const lines = menuStore.get(d);
    if (!lines) return;
    const order = Object.keys(lines).sort((a, b) => {
      const r = (k) => (k === "Breakfast" ? 2 : kid.diet && k === `Lunch - ${kid.diet}` ? 0 : k === "Lunch" ? (kid.diet ? 1 : 0) : 3);
      return r(a) - r(b) || a.localeCompare(b);
    });
    const label = (k) => (lang === "es"
      ? (/^Lunch - /.test(k) ? `${t("Lunch")}, ${dietLow(k.replace(/^Lunch - /, ""))}` : tt(k))
      : k === "Lunch" ? "Lunch" : k.replace(/^Lunch - /, "Lunch, ").replace(/Free$/, "free"));
    const section = (k) => `
      <div class="menu-line ${kid.diet && k === `Lunch - ${kid.diet}` ? "mine" : ""}">
        <p class="section-label" style="margin:0">${esc(label(k))}${kid.diet && k === `Lunch - ${kid.diet}` ? ` <span class="tag grade">${t("{name}'s line", { name: esc(kidName(kid)) })}</span>` : ""}</p>
        ${lines[k].map((i) => { const f = flagged(kid, i); return `<div class="menu-item ${f.length ? "flag" : ""}"><b>${esc(dish(i.n))}</b>${f.length ? `<span class="flag-note">${t("Contains {list}: flagged for {name}", { list: esc(f.map((a) => t(a)).join(", ").toLowerCase()), name: esc(kidName(kid)) })}</span>` : ""}${i.a ? `<span>${t("Contains {list}", { list: esc(i.a.map((a) => t(a)).join(", ").toLowerCase()) })}</span>` : ""}</div>`; }).join("")}
      </div>`;
    openSheet(cap(fmtLong(d)), `
      ${order.slice(0, 2).map(section).join("")}
      ${order.length > 2 ? `<details class="fold"><summary>${t("Other lines")}</summary>${order.slice(2).map(section).join("")}</details>` : ""}
      <p class="fine">${t("Allergens are the ones the district lists for each item in LINQ Connect. Talk with the school nurse about severe allergies.")}</p>
      ${reportLink({ type: "menu", title: "Lunch menu", date: d, school: kid.school })}`);
  }

  /* ----- Calendar ----- */

  async function renderCalendar() {
    const kid = activeKid();
    const v = $("view-calendar");
    const token = bump("calendar");
    if (!calMonth) calMonth = monthKey(todayYmd());
    const key = calMonth;
    const start = monthStart(key), end = monthEnd(key);
    v.innerHTML = `
      <div class="seg" role="group" aria-label="${t("Whose events")}">
        <button data-calmode="mine" aria-pressed="${calMode === "mine"}">${t("For {name}", { name: esc(kidName(kid)) })}</button>
        <button data-calmode="all" aria-pressed="${calMode === "all"}">${t("All of {school}", { school: esc(SCHOOLS[kid.school].short) })}</button>
      </div>
      <div class="pager">
        <button class="pager-btn" data-month="-1" aria-label="${t("Previous month")}">${PREV}</button>
        <button class="pager-label" data-month="0" title="${t("This month")}">${esc(cap(fmtMonth(key)))}</button>
        <button class="pager-btn" data-month="1" aria-label="${t("Next month")}">${NEXT}</button>
      </div>
      <div class="filter-chips" role="group" aria-label="${t("Show")}">
        ${CAL_FILTERS.map((f) => `<button class="level-chip" data-calfilter="${f.id}" aria-pressed="${calFilter === f.id}">${esc(t(f.label))}</button>`).join("")}
      </div>
      ${calMode === "mine" ? `<div class="cal-actions">
        <button class="btn block" data-action="subscribe" data-kid="${esc(kid.id)}">${CAL_ICON}${t("Put {name}'s calendar on my phone", { name: esc(kidName(kid)) })}</button>
        ${!(kid.follows || []).length ? `<button class="link-btn" data-action="follow" data-kid="${esc(kid.id)}">${t("Add {name}'s teams and activities", { name: esc(kidName(kid)) })}</button>` : ""}
      </div>` : ""}
      <div id="agenda" class="view"><p class="loading">${t("Loading calendar")}</p></div>`;
    let events;
    try { events = await getEvents(kid.school, start, end); }
    catch { if (token === tokens.calendar) $("agenda").innerHTML = errorNote(t("the calendar")); return; }
    if (token !== tokens.calendar) return;
    const filter = calMode === "mine" ? mineFilter : allFilter;
    const typeOk = CAL_FILTERS.find((f) => f.id === calFilter).test;
    const list = groupEvents(sortEvents(mergeDistrict(events, start, end, calMode === "mine" ? kid.grade : SCHOOLS[kid.school].grades, kid).filter((e) => filter(kid, e) && typeOk(e))));
    const byDay = new Map();
    for (const e of list) {
      const d = e.d < start ? start : e.d;
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(e);
    }
    const td = todayYmd();
    const html = [...byDay.entries()].map(([d, evs]) => {
      const rel = relLabel(d);
      return `<article class="card agenda-day ${d < td ? "past" : ""}" style="${kidStyle(kid)}" ${d === td ? 'id="agendaToday"' : ""}>
        <h2 class="agenda-date">${esc(cap(fmtShort(d)))}${rel ? `<span class="rel">${esc(cap(rel))}</span>` : ""}</h2>
        ${evs.map((e) => eventRow(e, { showGrade: calMode === "all" })).join("")}
      </article>`;
    }).join("");
    const emptyMsg = calFilter !== "all"
      ? `<p class="empty-note">${t("Nothing of this kind in {month}.", { month: esc(fmtMonth(key)) })} <button class="link-btn" data-calfilter="all">${t("Show everything")}</button></p>`
      : calMode === "mine"
        ? `<p class="empty-note">${t("Nothing for {name} in {month}.", { name: esc(kidName(kid)), month: esc(fmtMonth(key)) })} <button class="link-btn" data-calmode="all">${t("See all of {school}", { school: esc(SCHOOLS[kid.school].short) })}</button></p>`
        : `<p class="empty-note">${t("Nothing on the calendar in {month}.", { month: esc(fmtMonth(key)) })}</p>`;
    $("agenda").innerHTML = html || emptyMsg;
    // Land on today rather than the 1st.
    const todayEl = $("agendaToday");
    if (todayEl && key === monthKey(td) && !renderCalendar.scrolled) {
      renderCalendar.scrolled = true;
      todayEl.scrollIntoView({ block: "start" });
      window.scrollBy(0, -80);
    }
  }

  /* ----- Guide ----- */

  async function renderGuide() {
    const kid = activeKid();
    const v = $("view-guide");
    const token = bump("guide");
    const s = SCHOOLS[kid.school];
    if (kid.graduated) {
      v.innerHTML = `<article class="card grad-card" style="${kidStyle(kid)}"><div class="big">${t("Graduated")}</div><p>${t("{name}, {school} class of {year}. Congratulations.", { name: esc(kidName(kid)), school: esc(s.short), year: kid.classOf })}</p></article>
        <p class="muted">${t("Remove {name} from Students when you no longer need {school}'s calendar.", { name: esc(kidName(kid)), school: esc(s.short) })}</p>
        <button class="btn block" data-action="edit-kid" data-kid="${esc(kid.id)}">${t("Edit or remove")}</button>`;
      return;
    }
    const g = GUIDE[kid.grade];
    // Spanish guide text lives in i18n.js, keyed by checklist id and fact order.
    const ge = (lang === "es" && window.SFI18N && SFI18N.guideEs && SFI18N.guideEs[kid.grade]) || null;
    const checks = store.get(CHECKS_KEY, {})[kid.id] || {};
    const td = todayYmd();
    // Graduation for this student's class, when the district has published it.
    const gradYear = SCHOOL_YEARS.find((y) => y.last.startsWith(String(kid.classOf)));
    const grad = gradYear && gradYear.graduation;
    const gradDays = grad ? Math.ceil((parse(grad.d) - parse(td)) / 864e5) : -1;
    const linkFor = (l) => {
      if (!l) return null;
      if (l === "supplies") return s.supplies || s.site;
      const d = DISTRICT_LINKS.find((x) => x.label === l);
      return d ? d.url : l;
    };
    // "handbook:SECTION" opens the handbook in the app at that section.
    const linkBtn = (l, label) => (typeof l === "string" && l.startsWith("handbook:")
      ? `<button class="link-btn" data-action="handbook" data-section="${esc(l.slice(9))}">${label}</button>`
      : l === "supplies" ? `<button class="link-btn" data-action="supplies-sheet">${label}</button>`
      : `<a class="link-btn" href="${esc(linkFor(l))}" target="_blank" rel="noopener">${label}${outIcon()}</a>`);
    v.innerHTML = `
      <div><h2 class="view-title">${esc(ge ? ge.headline : g.headline)}</h2><p class="view-sub">${s.level === "hs" ? t("{name}, {grade} at {school}. Class of {year}.", { name: esc(kidName(kid)), grade: gradeName(kid.grade), school: esc(s.short), year: kid.classOf }) : t("{name}, {grade} at {school}.", { name: esc(kidName(kid)), grade: gradeName(kid.grade), school: esc(s.short) })}</p></div>
      ${kid.grade === 12 && gradDays >= 0 ? `<article class="card grad-card" style="${kidStyle(kid)}"><div class="big">${gradDays === 0 ? t("Today") : t(gradDays === 1 ? "{n} day" : "{n} days", { n: gradDays })}</div><p>${t("until graduation: {date}", { date: esc(fmtLong(grad.d)) })}${grad.times[kid.school] ? ` ${t("at {time}", { time: esc(grad.times[kid.school]) })}` : ""}${grad.venue ? `, ${esc(grad.venue)}` : ""}</p></article>` : ""}
      <p class="muted">${esc(ge ? ge.intro : g.intro)}</p>
      <p class="section-label">${kid.grade === -1 ? t("Coming up for junior kindergarten") : kid.grade === 0 ? t("Coming up for kindergarten") : t("Coming up for {ord} graders", { ord: esc(ordinal(kid.grade)), n: kid.grade })}</p>
      <article class="card" id="guideUpcoming" style="${kidStyle(kid)}"><p class="loading">${t("Checking {school}'s calendar", { school: esc(s.short) })}</p></article>
      ${testDatesHtml(kid, td)}
      ${s.level === "hs" ? physicalHtml(kid) : ""}
      <p class="section-label">${t("This year's checklist")}</p>
      <article class="card" style="${kidStyle(kid)}">
        ${g.todo.map((item) => {
          const done = !!checks[item.id];
          const extra = item.action === "follow" ? `${s.level === "hs" ? `<button class="link-btn" data-action="clubs">${t("See clubs")}</button>` : ""}<button class="link-btn" data-action="follow" data-kid="${esc(kid.id)}">${t(s.level === "es" ? "Follow an activity" : "Follow a team")}</button>`
            : item.action === "calendar" ? `<button class="link-btn" data-goto="calendar" data-filter="days">${t("See dates")}</button>`
            : item.action === "college" ? `<button class="link-btn" data-goto="calendar" data-filter="college">${t("See dates")}</button>`
            : item.link ? linkBtn(item.link, t("Open")) : "";
          const text = (ge && ge.todo && ge.todo[item.id]) || item.text;
          return `<div class="check ${done ? "done" : ""}"><input type="checkbox" id="chk-${esc(item.id)}" data-check="${esc(item.id)}" ${done ? "checked" : ""}><label for="chk-${esc(item.id)}">${esc(text)}</label>${extra ? `<span></span><span>${extra}</span>` : ""}</div>`;
        }).join("")}
      </article>
      <p class="section-label">${t("Good to know")}</p>
      ${g.facts.map((f, i) => { const fe = (ge && ge.facts && ge.facts[i]) || f; return `<article class="card fact"><h3>${esc(fe.title)}</h3><p>${esc(fe.body)}</p>${f.link ? linkBtn(f.link, t("Learn more")) : ""}</article>`; }).join("")}
      ${s.level === "hs" ? `<article class="card counselor-card">
        <p><b>${t("Questions about any of this?")}</b> ${t("{school}'s counselors can help with classes, testing, college and careers.", { school: esc(s.short) })}</p>
        <button class="btn block" data-action="counselors">${t("Contact a counselor")}</button>
      </article>
      <p class="empty-note">${t("Requirements and dates change. Confirm the details with your school counselor.")}</p>` : `<article class="card counselor-card">
        <p><b>${t("Questions about any of this?")}</b> ${t("{school}'s office and counselor can help.", { school: esc(s.short) })}</p>
        <a class="btn block" href="tel:+1${esc(s.phone.replace(/\D/g, ""))}">${t("Call {school}", { school: esc(s.short) })}</a>
      </article>`}
      ${reportLink({ type: "guide", title: `${kid.grade === 0 ? "Kindergarten" : `${ordinal(kid.grade)} grade`} guide`, school: kid.school })}`;

    let events;
    try { events = await getEvents(kid.school, td, addDays(td, 60)); }
    catch { if (token === tokens.guide) $("guideUpcoming").innerHTML = errorNote(t("the school calendar")); return; }
    if (token !== tokens.guide) return;
    // Tests, deadlines and meetings first; college visits are frequent
    // enough to crowd those out, so they get at most three places.
    const pool = sortEvents(mergeDistrict(events, td, addDays(td, 60), kid.grade)
      .filter((e) => !e.act && (e.g ? e.g.includes(kid.grade) : e.district && e.cat !== "noschool")));
    // Recurring sessions (ACT prep every week) appear once; items meant for
    // exactly this grade outrank ones shared with other grades.
    const seen = new Set();
    const once = pool.filter((e) => { const k = e.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    const rank = (e) => (e.g && e.g.length === 1 ? 0 : e.district ? 1 : 2);
    const key = once.filter((e) => e.cat !== "college").sort((a, b) => rank(a) - rank(b) || a.d.localeCompare(b.d)).slice(0, 5);
    const visits = once.filter((e) => e.cat === "college").slice(0, 3);
    const targeted = sortEvents(key.concat(visits));
    $("guideUpcoming").innerHTML = targeted.length
      ? `<div class="rows" style="margin-top:0">${targeted.map((e) => eventRow(e, { byDate: true, showGrade: false })).join("")}</div>`
      : `<p class="empty-note">${t("Nothing grade-specific in the next two months.")}</p>`;
  }

  // The next national ACT and SAT dates with their registration deadlines,
  // for 10th through 12th graders.
  function testDatesHtml(kid, td) {
    if (kid.grade < 10) return "";
    const next = (test) => TEST_DATES.filter((x) => x.test === test && x.late >= td).slice(0, 2);
    const rows = ["ACT", "SAT"].flatMap((test) => next(test).map((x) => {
      const deadline = x.reg >= td ? t("Register by {date}", { date: fmtShort(x.reg) }) : t("Late registration by {date}", { date: fmtShort(x.late) });
      return `<a class="list-row" href="${esc(TEST_LINKS[test])}" target="_blank" rel="noopener"><span><b>${test}: ${esc(fmtLong(x.d))}</b><span>${esc(deadline)}</span></span>${outIcon()}</a>`;
    }));
    if (!rows.length) return "";
    return `<p class="section-label">${t("National test dates")}</p><article class="card link-list">${rows.join("")}
      <p class="fine" style="margin-top:6px">${t("Students register on the ACT or College Board website. ACT days held at school are on the school calendar.")}</p></article>`;
  }

  // Sports need a physical on file; the Activities handbook has the rule.
  const SPORT = /Basketball|Volleyball|Football|Soccer|Tennis|Golf|Track|Cross Country|Wrestling|Gymnastics|Softball|Baseball|Bowling|Competitive (Cheer|Dance)|Powerlifting|Unified|Cheer/i;
  const followsSport = (kid) => (kid.follows || []).some((f) => SPORT.test(f.act));
  function physicalHtml(kid) {
    if (!followsSport(kid)) return "";
    return `<article class="card fact"><h3>${t("Sports physical")}</h3>
      <p>${t("A current physical has to be on file before the first practice, tryout or summer workout. The Activities handbook says how often and which form.")}</p>
      <a href="${esc(DISTRICT.handbooks.activities)}" target="_blank" rel="noopener">${t("Activities handbook")}</a></article>`;
  }

  /* ----- School ----- */

  async function renderSchool() {
    const kid = activeKid();
    const s = SCHOOLS[kid.school];
    const high = s.level === "hs";
    // Elementary and middle schools: the rules every school at that level
    // shares (from the 2026-27 handbooks); the school's own handbook links out.
    const hb = HANDBOOKS[kid.school] || (LEVEL_INFO[s.level] ? { policies: LEVEL_INFO[s.level].policies, level: true } : {});
    const v = $("view-school");
    const token = bump("school");
    const tel = (n) => `tel:+1${n.replace(/\D/g, "")}`;
    const att = hb.attendance || {};
    const attPhone = att.phone || s.attendance || s.phone;
    // Everyday schedules as choices; semester-test days tucked away below.
    const sched = (hb.schedules || []).filter((x) => !/test/i.test(x.name));
    const testDays = (hb.schedules || []).filter((x) => /test/i.test(x.name));
    if (!schedPicked && schedHint[kid.school]) schedIndex = Math.max(0, sched.findIndex((x) => x.name === schedHint[kid.school]));
    if (!sched[schedIndex]) schedIndex = 0;
    const outRow = (l) => `<a class="list-row" href="${esc(l.url)}" target="_blank" rel="noopener"><span><b>${esc(l.label)}</b><span>${esc(l.note)}</span></span>${outIcon()}</a>`;
    const signIn = [
      DISTRICT_LINKS.find((l) => l.label === "Skyward Family Access"),
      { label: t("Lunch account"), note: t("Add money in LINQ Connect"), url: LINK("Lunch account") },
      s.level !== "es" && { label: t("Tickets and passes"), note: t("Buy game tickets on Bound"), url: DISTRICT.tickets },
      { label: t("Bus pass"), note: t("Fee-based busing"), url: LINK("Bus routes") },
      LEVEL_INFO[s.level] && LEVEL_INFO[s.level].care && { label: t("Before and after school care"), note: "", url: LEVEL_INFO[s.level].care },
      s.parking && { label: t("Buy a parking permit"), note: t("Student drivers"), url: s.parking },
      s.newsletter && { label: t("{school} newsletter", { school: s.short }), note: t("Monthly, from the school"), url: s.newsletter },
    ].filter(Boolean).map((l) => ({ ...l, label: t(l.label), note: t(l.note) }));

    v.innerHTML = `
      <article class="card school-hero" style="${kidStyle(kid)}">
        <h2>${esc(s.name)}</h2>
        ${s.principal ? `<p>${s.mascot ? t("{mascot}. Principal {name}.", { mascot: esc(s.mascot), name: esc(s.principal) }) : t("Principal {name}.", { name: esc(s.principal) })}</p>` : ""}
        <p>${esc(s.address)}</p>
      </article>
      <div class="action-grid">
        <a class="action" href="${tel(s.phone)}"><b>${t("Call the office")}</b><span>${esc(s.phone)}</span></a>
        <button class="action" data-action="absence"><b>${t("Report an absence")}</b><span>${esc(attPhone)}${att.phone || s.attendance ? "" : ` ${t("(main office)")}`}</span></button>
        <a class="action" href="${esc(mapsUrl(s.address))}" target="_blank" rel="noopener"><b>${t("Directions")}</b><span>${esc(s.address.split(",")[0])}</span></a>
      </div>

      <p class="section-label">${t("Bell schedule")}</p>
      <article class="card" style="${kidStyle(kid)}">
        ${sched.length > 1 ? `<div class="filter-chips" role="group" aria-label="${t("Schedule")}">${sched.map((x, i) => `<button class="level-chip" data-sched="${i}" aria-pressed="${i === schedIndex}">${esc(t(x.name))}</button>`).join("")}</div>` : ""}
        ${sched.length ? bellTable(sched[schedIndex]) : `<p class="menu-main">${t(s.bell.about ? "about {a} to {b}" : "{a} to {b}", { a: esc(fmtTime(bellTo24(s.bell.start))), b: esc(fmtTime(bellTo24(s.bell.end))) })}</p>
          ${s.bell.wed ? `<p class="muted">${t("Wednesdays: out at {time}", { time: esc(fmtTime(bellTo24(s.bell.wed))) })}</p>` : ""}
          ${s.bell.about ? `<p class="fine">${t("{school} doesn't publish its hours; these are typical for the district. Call {phone} to check.", { school: esc(s.short), phone: esc(s.phone) })}</p>` : ""}`}
        ${testDays.length ? `<details class="fold" ${testDays.some((x) => x.name === schedHint[kid.school]) ? "open" : ""}><summary>${t("Semester test days")}</summary>${testDays.map((x) => `<p class="bell-title">${esc(t(x.name).replace(/ - /, ", "))}</p>${bellTable(x)}`).join("")}</details>` : ""}
        ${hb.lunch ? `<details class="fold"><summary>${t("Lunch and open lunch")}</summary><p>${esc(t(hb.lunch))}</p></details>` : ""}
      </article>

      <p class="section-label">${t("People to know")}</p>
      <article class="card" id="peopleCard"><p class="loading">${t("Loading staff")}</p></article>

      <p class="section-label">${t("Support for your student")}</p>
      <article class="card" id="supportCard"><p class="loading">${t("Loading")}</p></article>

      <p class="section-label">${t("Good to know")}</p>
      <article class="card">
        <details class="fold"><summary>${t("What things cost")}</summary><div class="cost-list">${(high ? COSTS.district.concat(COSTS[kid.school] || []) : LEVEL_INFO[s.level].costs).map((c) => `<div class="cost-row"><b>${esc(t(c.what))}</b><span>${esc(t(c.cost))}</span></div>`).join("")}</div></details>
        ${(hb.policies || []).map((p) => `<details class="fold"><summary>${esc(t(p.title))}</summary><p>${esc(t(p.body))}</p></details>`).join("") || `<p class="empty-note">${t("Not available.")}</p>`}
        <p class="fine" style="margin-top:8px">${hb.level ? t("From the district's 2026-27 handbooks.") : `${t("From the {school} student handbook", { school: esc(s.short) })}${hb.year ? `, ${esc(hb.year)}` : ""}.`}</p>
        ${hb.source || s.handbook ? `<button class="link-btn" data-doc="${esc(hb.source || s.handbook)}">${t(hb.level ? "See {school}'s own handbook" : "See the original handbook", { school: esc(s.short) })}</button>` : ""}
      </article>

      <p class="section-label">${t("From the school")}</p>
      <article class="card link-list">
        <button class="list-row" data-action="handbook"><span><b>${t("Student handbook")}</b><span>${t("Every section, searchable, in the app")}</span></span>${CHEVRON}</button>
        ${s.supplies ? `<button class="list-row" data-action="supplies-sheet"><span><b>${t("Supply list")}</b><span>${t("What to bring, by grade")}</span></span>${CHEVRON}</button>` : ""}
        ${s.level !== "es" ? `<button class="list-row" data-action="clubs"><span><b>${t("Clubs and organizations")}</b><span>${t("With the advisor to ask", { school: esc(s.short) })}</span></span>${CHEVRON}</button>` : ""}
        ${s.bellImage ? `<a class="list-row" href="${esc(s.bellImage)}" target="_blank" rel="noopener"><span><b>${t("Bell schedule, as the school posts it")}</b><span>${t("Picture from the school website")}</span></span>${outIcon()}</a>` : ""}
        <button class="list-row" data-action="forms"><span><b>${t("Forms and links")}</b><span>${t("Everything on the school's parent and student menus")}</span></span>${CHEVRON}</button>
      </article>

      <p class="section-label">${t("Sign in, pay, buy")}</p>
      <article class="card link-list">${signIn.map(outRow).join("")}</article>

      <div id="feedBox"></div>
      <p class="section-label">${t("Latest from {school}", { school: esc(s.short) })}</p>
      <article class="card" id="newsList"><p class="loading">${t("Loading news")}</p></article>
      <p class="fine" id="checkedNote"></p>
      ${reportLink({ type: "school", title: `${s.short} school info`, school: kid.school })}`;

    const [staff, news, status, feed] = await Promise.all([
      getSchool(kid.school, "staff").catch(() => null),
      getSchool(kid.school, "news").catch(() => null),
      getStatus().catch(() => null),
      getSchool(kid.school, "feed").catch(() => null),
    ]);
    if (token !== tokens.school) return;
    $("peopleCard").innerHTML = peopleHtml(kid.school, hb, staff);
    $("supportCard").innerHTML = supportHtml(staff);
    // No directory at all: the support section has nothing to offer.
    if (staff && !staff.people.length) { $("supportCard").hidden = true; $("supportCard").previousElementSibling.hidden = true; }
    // Only recent news: a school's newest article from three months ago
    // makes the whole app look out of date.
    const recentNews = news ? news.items.filter((n) => !n.at || n.at >= addDays(todayYmd(), -90)) : [];
    if (!news || !recentNews.length) { const nl = $("newsList"); nl.previousElementSibling.hidden = true; nl.hidden = true; }
    $("newsList").innerHTML = recentNews.length
      ? recentNews.slice(0, 6).map((n) => `<button class="news-item" data-news="${esc(n.id)}"><b>${esc(tx(n.title))}</b><span>${esc(n.at ? fmtMonthDay(n.at) : "")}</span></button>`).join("")
      : news ? `<p class="empty-note">${t("No recent news.")}</p>` : errorNote(t("news"));
    if (news) newsStore.set(kid.school, news.items);
    $("checkedNote").textContent = checkedText(status, kid.school);
    // The school's own posts from the last two months (some schools go quiet
    // over summer; old posts would mislead).
    const recent = feed ? feed.items.filter((p) => p.at && Date.now() - Date.parse(p.at) < 60 * 864e5) : [];
    feedStore.set(kid.school, recent);
    $("feedBox").innerHTML = recent.length ? `<p class="section-label">${t("From {school}", { school: esc(s.short) })}</p>
      <article class="card feed-card">${recent.slice(0, 3).map((p) => {
        const text = plainText(tx(p.html));
        return `<button class="feed-item" data-post="${esc(p.id)}">${p.images[0] ? `<img src="${esc(p.images[0].url)}" alt="${esc(tx(p.images[0].alt))}" loading="lazy">` : ""}<span><span class="feed-text">${esc(clipWords(text, 160))}</span><span class="fine">${esc(fmtMonthDay(p.at.slice(0, 10)))}</span></span></button>`;
      }).join("")}${recent.length > 3 ? `<button class="link-btn" data-action="all-posts">${t("See all {n} posts", { n: recent.length })}</button>` : ""}</article>` : "";
  }

  // For a family not yet enrolled: which school, how to register, what the
  // state requires, and help that's available. Then add the student here.
  function openNewFamily() {
    openSheet(t("New to Brandon Valley schools"), `
      <ol class="steps">
        <li><b>${t("Find your school")}</b><span>${t("Five elementary schools feed one Intermediate School (grades 5 and 6), one Middle School (7 and 8) and one High School. Your address decides the elementary school; the district office can tell you which.")}</span>
          <a class="link-btn" href="tel:+16055822049">${t("District office: {phone}", { phone: "605-582-2049" })}</a></li>
        <li><b>${t("Register")}</b><span>${t("Registration runs through the district. You'll need immunization records, a birth certificate and proof of address.")}</span>
          <a class="btn block" href="${esc(DISTRICT.site)}/co/" target="_blank" rel="noopener">${t("District website")}${outIcon()}</a></li>
        <li><b>${t("Immunizations")}</b><span>${t("South Dakota requires DTaP, polio, two MMR and two chickenpox doses for every student, plus Tdap and meningococcal shots given around age 11. Exemptions are listed on the state form.")}</span>
          <a class="link-btn" href="https://doh.sd.gov/topics/immunizations-vaccinations/immunizations-required-for-sd-school-entry" target="_blank" rel="noopener">${t("State requirements")}</a></li>
        <li><b>${t("Meals")}</b><span>${t("Lunch accounts and free or reduced meal applications are in LINQ Connect, any time of year.")}</span>
          <a class="link-btn" href="${esc(LINK("Free and reduced meals"))}" target="_blank" rel="noopener">${t("Free and reduced meals")}</a></li>
        <li><b>${t("Add your student here")}</b><span>${t("Once you know the school, this app sets everything else up.")}</span>
          <button class="btn primary block" data-action="add-kid">${t("Add a student")}</button></li>
      </ol>`);
  }

  // A post as one line of text for previews: breaks and paragraphs become spaces.
  const plainText = (html) => new DOMParser().parseFromString(sanitize(html).replace(/<br\s*\/?>|<\/(p|li|h3|h4)>/gi, " "), "text/html").body.textContent.replace(/\s+/g, " ").trim();

  // Shorten at a word boundary, never inside a word.
  function clipWords(text, n) {
    if (text.length <= n) return text;
    const cut = text.slice(0, n);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).replace(/[\s,.;:-]+$/, "")}…`;
  }

  // Posts from the school's own feed, read in the app.
  const feedStore = new Map();
  function openPost(id) {
    const p = (feedStore.get(activeKid().school) || []).find((x) => String(x.id) === String(id));
    if (!p) return;
    openSheet(SCHOOLS[activeKid().school].short, `
      <p class="fine" style="margin-top:-4px">${esc(fmtLong(p.at.slice(0, 10)))}</p>
      ${p.images.map((i) => `<img class="reader-cover" src="${esc(i.url)}" alt="${esc(tx(i.alt))}" loading="lazy">`).join("")}
      <div class="reader">${enNote(undefined, p.html)}${sanitize(tx(p.html))}</div>`);
  }
  function openAllPosts() {
    const list = feedStore.get(activeKid().school) || [];
    openSheet(t("From {school}", { school: SCHOOLS[activeKid().school].short }), list.map((p) => {
      const text = plainText(tx(p.html));
      return `<button class="feed-item" data-post="${esc(p.id)}">${p.images[0] ? `<img src="${esc(p.images[0].url)}" alt="${esc(tx(p.images[0].alt))}" loading="lazy">` : ""}<span><span class="feed-text">${esc(clipWords(text, 160))}</span><span class="fine">${esc(fmtMonthDay(p.at.slice(0, 10)))}</span></span></button>`;
    }).join(""));
  }

  // The district's forms library, grouped the way the district files them.
  async function openForms() {
    openSheet(t("Forms"), `<p class="loading">${t("Loading")}</p>`);
    let data;
    try { data = await getSchool(activeKid().school, "forms"); } catch { $("sheetBody").innerHTML = errorNote(t("forms")); return; }
    if ($("sheet").hidden) return;
    $("sheetBody").innerHTML = `<p class="fine">${t("Everything on the school's own menus, grouped the way the school files it. Files open as the originals.")}</p>
      ${data.groups.map((g) => `<details class="fold"><summary>${esc(tx(g.name))} (${g.files.length})</summary><div class="link-list">${g.files.map((f) => `<a class="list-row" href="${esc(f.view || f.url)}" target="_blank" rel="noopener"><span><b>${esc(tx(f.name))}</b><span>${esc(f.view ? t("Picture") : f.ext === "link" ? t("Web page") : f.ext === "email" ? t("Email") : f.ext.toUpperCase())}</span></span>${outIcon()}</a>`).join("")}</div></details>`).join("")}`;
  }

  // The school's supply list, read from its PDF, for the student's grade.
  const SUPPLY_FRESH = 24 * 3600e3;
  async function openSupplies(kid = activeKid()) {
    const s = SCHOOLS[kid.school];
    if (!s.supplies) { openSheet(t("Supply list"), `<p>${t("{school} hasn't posted a supply list online.", { school: esc(s.short) })}</p>`); return; }
    openSheet(t("Supply list"), `<p class="loading">${t("Loading")}</p>`);
    const grade = kid.grade;
    const cacheKey = `${NEWS_PREFIX}${langKey()}supplies:${kid.school}:${grade}`;
    let data = readCache(cacheKey);
    if (!data || Date.now() - data.at > SUPPLY_FRESH) {
      try { const j = await getJson(`${SCHOOL_API}?school=${kid.school}&what=supplies&grade=${grade}`); data = { at: Date.now(), data: j }; writeCache(cacheKey, { data: j }); }
      catch { if (!data) { $("sheetBody").innerHTML = errorNote(t("the supply list")); return; } }
    }
    if ($("sheet").hidden) return;
    const d = data.data;
    const grades = d.grades || [];
    $("sheetBody").innerHTML = `${enNote(undefined, d.items.map((i) => i.item))}
      ${grades.length > 1 ? `<div class="filter-chips" role="group" aria-label="${t("Grade")}">${grades.map((g) => `<button class="level-chip" data-action="supplies-grade" data-grade="${g}" aria-pressed="${g === grade}">${esc(gradeShort(g))}</button>`).join("")}</div>` : ""}
      <p class="section-label">${esc(d.title || t("Supply list"))}</p>
      <div class="cost-list">${d.items.map((i) => `<div class="cost-row"><b>${esc(tx(i.item))}</b><span>${esc(tx(i.amount || ""))}</span></div>`).join("") || `<p class="empty-note">${t("Nothing listed for this grade.")}</p>`}</div>
      <p class="fine">${t("From {school}'s supply list. Teachers may add class-specific items.", { school: esc(s.short) })} <a href="${esc(s.supplies)}" target="_blank" rel="noopener">${t("Open the PDF")}</a></p>`;
  }

  // The handbook, section by section, searchable. "which" picks the
  // district or activities handbook; "section" opens the search on a title.
  const HB_FRESH = 24 * 3600e3;
  async function openHandbook(which, section) {
    const kid = activeKid();
    const s = SCHOOLS[kid.school];
    const books = [[s.handbook, s.short], ["district", t("District")], ...(s.level === "ms" || s.level === "hs" ? [["activities", t("Activities")]] : [])];
    which = which || s.handbook;
    openSheet(t("Handbook"), `<div class="filter-chips" role="group">${books.map(([k, label]) => `<button class="level-chip" data-action="handbook" data-which="${esc(k)}" aria-pressed="${k === which}">${esc(label)}</button>`).join("")}</div>
      <input class="text-input" id="hbSearch" type="search" placeholder="${t("Search the handbook")}" autocomplete="off" aria-label="${t("Search the handbook")}">
      <div id="hbBody"><p class="loading">${t("Loading")}</p></div>`);
    const cacheKey = `${NEWS_PREFIX}${langKey()}handbook:${which}`;
    let data = readCache(cacheKey);
    if (!data || Date.now() - data.at > HB_FRESH) {
      try { const j = await getJson(`${SCHOOL_API}?school=${kid.school}&what=handbook&which=${which}`); data = { at: Date.now(), data: j }; writeCache(cacheKey, { data: j }); }
      catch { if (!data) { if ($("hbBody")) $("hbBody").innerHTML = errorNote(t("the handbook")); return; } }
    }
    if (!$("hbBody")) return;
    const d = data.data;
    const nice = (x) => x.replace(/[A-Za-z][\w'’]*/g, (w, at, str) => (/^(ID|ICU|PTA|PTO|GPA|ACT|SAT|PSAT|NHS|FFA|FCCLA|BV|BVHS|BVMS|BVIS|SD|US|TV|CPR|AED|IEP|ESL|ELL|FAQ|PE|AP|CTE|FERPA|ADA|STEM|ISS|OSS)$/.test(w) || (w.length === 1 && str[at + 1] === ")") ? w : w.toLowerCase())).replace(/^([^A-Za-z]*)([a-z])/, (m, pre, c) => pre + c.toUpperCase());
    const paint = (q) => {
      const needle = (q || "").trim().toLowerCase();
      const hits = d.sections.filter((sec) => !needle || sec.title.toLowerCase().includes(needle) || sec.text.toLowerCase().includes(needle));
      $("hbBody").innerHTML = (hits.length ? hits.map((sec) => `<details class="fold"${needle ? " open" : ""}><summary>${esc(nice(tx(sec.title)))}</summary><p style="line-height:1.55;white-space:pre-line">${esc(tx(sec.text))}</p></details>`).join("")
        : `<p class="empty-note">${t("Nothing in this handbook mentions \"{q}\".", { q: esc(q) })}</p>`) +
        `${enNote("Handbook text from the district, in English.", d.sections.slice(0, 3).map((x) => x.text))}<p class="fine">${t("Read from the district's {title} PDF, checked daily.", { title: esc(d.title) })} <a href="${esc(d.source)}" target="_blank" rel="noopener">${t("Open the PDF")}</a></p>`;
    };
    paint(section || "");
    if (section) $("hbSearch").value = section;
    $("hbSearch").addEventListener("input", (e) => paint(e.target.value));
  }

  function bellTable(x) {
    return `<div class="bell">${x.rows.map((r) => `<div class="bell-row"><span>${esc(t(r.label))}</span><span>${r.start ? esc(r.start) : ""}${r.end ? ` ${t("to")} ${esc(r.end)}` : r.start ? ` ${t("on")}` : ""}</span></div>`).join("")}</div>
      ${x.note ? `<p class="fine" style="margin-top:8px">${esc(t(x.note))}</p>` : ""}`;
  }

  // Office leaders from the handbook, counselors and the nurse from the
  // live staff directory (the handbook rarely names them).
  function peopleHtml(school, hb, staff) {
    const rows = [];
    const seen = new Set();
    const add = (name, role, email, phone) => {
      const key = (name || role).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(`<div class="person"><span><b>${esc(name || role)}</b><span>${esc(name ? role : "")}</span></span><span class="person-actions">${email ? `<a class="small-btn" href="mailto:${esc(email)}">${t("Email")}</a>` : ""}${phone ? `<a class="small-btn" href="tel:+1${esc(phone.replace(/\D/g, "").slice(-10))}">${t("Call")}</a>` : ""}</span></div>`);
    };
    const people = staff ? staff.people : [];
    const find = (name) => people.find((p) => name && p.n.toLowerCase().includes(name.toLowerCase().replace(/^(mr|mrs|ms|dr)\.?\s+/, "").split(" ").pop()));
    for (const c of hb.contacts || []) {
      if (!c.name || /clerical|liaison|tutoring/i.test(c.role)) continue;
      const p = find(c.name);
      add(c.name.replace(/^(Mr|Mrs|Ms|Dr)\.?\s+/, ""), t(c.role), c.email || (p && p.email), c.phone);
    }
    for (const p of people) {
      if (/^School Counselor$|^School Nurse$|Principal|Activities Director|Athletic Director/i.test(p.dept) || /PRINCIPAL|COUNSELOR$|NURSE$/i.test(p.title)) {
        if ([...seen].some((k) => k.includes(p.n.toLowerCase().split(" ").pop()))) continue;
        add(p.n, staffTitle({ title: p.title }), p.email, p.phone);
      }
    }
    const rank = (r) => (/^<div class="person"><span><b>[^<]*<\/b><span>Principal</.test(r) ? 0 : /Assistant Principal/.test(r) ? 1 : /Counselor/.test(r) ? 2 : /Nurse/.test(r) ? 3 : 4);
    rows.sort((a, b) => rank(a) - rank(b));
    // The school publishes no directory: say so, and point to the office.
    if (!rows.length && staff && !people.length) return `<p class="empty-note">${t("{school} doesn't publish a staff list online. The office can connect you: {phone}.", { school: esc(SCHOOLS[school].short), phone: esc(SCHOOLS[school].phone) })}</p>`;
    return `${rows.join("") || `<p class="empty-note">${t("Staff list unavailable right now.")}</p>`}
      <button class="btn block" data-action="staff" style="margin-top:10px">${t("Find a teacher or staff member")}</button>`;
  }
  // The people families look for beyond teachers, grouped by need, from
  // the district's own staff directory.
  const SUPPORT = [
    { name: "Special education, IEPs and 504 plans", rx: /^(Iep Facilitator|School Psychologist|Speech Language Pathologist|Behavior Facilitator|504)/i },
    { name: "English learners and family liaisons", rx: /English (Learner|Language Learner|Language Development) Teacher|School\/home Liaison/i },
    { name: "Wellbeing, attendance and student success", rx: /School Social Worker|Student Success Facilitator|Success Coordinator|Dean Of Students|Student Attendance Clerical/i },
    { name: "College and career advisors", rx: /College & Career/i },
    { name: "Records and transcripts", rx: /Registrar/i },
  ];
  function supportHtml(staff) {
    if (!staff) return `<p class="empty-note">${t("Staff list unavailable right now.")}</p>`;
    const folds = SUPPORT.map((g) => {
      const people = staff.people.filter((p) => g.rx.test(p.dept));
      if (!people.length) return "";
      return `<details class="fold"><summary>${esc(t(g.name))} (${people.length})</summary>
        ${people.map((p) => `<div class="person"><span><b>${esc(p.n)}</b><span>${esc(staffTitle(p))}</span></span><span class="person-actions">${p.email ? `<a class="small-btn" href="mailto:${esc(p.email)}">${t("Email")}</a>` : ""}</span></div>`).join("")}
      </details>`;
    }).join("");
    return folds || `<p class="empty-note">${t("No support staff listed.")}</p>`;
  }
  const titleCaseLower = (t) => String(t).toLowerCase().replace(/(^|\s)(\w)/g, (m, a, b) => a + b.toUpperCase());
  // "SCHOOL COUNSELOR" -> "School Counselor" / "Consejero escolar".
  const staffTitle = (p) => { const s = p.title || p.dept || ""; const es = tx(s); return es !== s ? es : titleCaseLower(s); };

  function checkedText(status, school) {
    if (!status || !status.at) return "";
    const mins = Math.max(1, Math.round((Date.now() - status.at) / 60000));
    const ago = mins < 60 ? t("{n} min ago", { n: mins }) : mins < 1440 ? t("{n} hr ago", { n: Math.round(mins / 60) }) : t("{n} days ago", { n: Math.round(mins / 1440) });
    const changed = Object.values(status.docs || {}).filter((d) => (!d.school || d.school === school) && d.changedAt && Date.now() - d.changedAt < 14 * 864e5 && d.changedAt > (status.firstSeen || 0));
    return `${t("Checked the school's sources {ago}.", { ago })}${changed.length ? ` ${t("Updated recently: {list}.", { list: changed.map((d) => d.label).join(", ") })}` : ""}`;
  }

  /* ---------------- in-app readers ---------------- */

  // Website HTML is shown inside the app, reduced to plain text structure:
  // no scripts, no styles, links open outside.
  // District pages the app shows itself (school.js PAGES), so links to them stay in the app.
  const APP_PAGES = new Set(["tripper-bus-information", "parking-permits", "parking-permit", "activities", "closing-delays", "graduation", "health-services", "high-school-counseling", "busing-boundary-information", "fee-based-busing", "free-reduced-meal-application"]);
  const SAFE = new Set(["P", "BR", "STRONG", "B", "EM", "I", "U", "UL", "OL", "LI", "H1", "H2", "H3", "H4", "A", "IMG", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "BLOCKQUOTE"]);
  function sanitize(html) {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
    const walk = (node) => {
      for (const el of [...node.children]) {
        if (/^(SCRIPT|STYLE|NOSCRIPT|IFRAME|OBJECT|EMBED|TEMPLATE|SVG|FORM|INPUT|BUTTON|SELECT|TEXTAREA)$/.test(el.tagName)) { el.remove(); continue; }
        walk(el);
        if (!SAFE.has(el.tagName)) { el.replaceWith(...el.childNodes); continue; }
        const href = el.getAttribute("href"), src = el.getAttribute("src");
        for (const a of [...el.attributes]) el.removeAttribute(a.name);
        if (el.tagName === "A") {
          // Links written for the district's own site ("/o/rhs/page/...").
          const abs = href && /^\/[^/]/.test(href) ? `https://www.sf.k12.sd.us${href}` : href;
          const inApp = abs && (abs.match(/^https:\/\/www\.sf\.k12\.sd\.us\/(?:o\/\w+\/)?page\/([a-z0-9-]+)\/?$/) || [])[1];
          if (inApp && (APP_PAGES.has(inApp) || /^tripper-bus-route-\d{1,2}$/.test(inApp))) {
            el.setAttribute("href", abs);
            el.setAttribute("data-page", inApp);
          } else if (abs && /^(https?:|mailto:|tel:)/i.test(abs)) {
            const href = abs;
            el.setAttribute("href", href);
            // A bare web address as link text would wrap mid-word; show the site.
            if (/^\s*https?:\/\/\S+\s*$/.test(el.textContent)) { try { el.textContent = new URL(el.textContent.trim()).hostname.replace(/^www\./, ""); } catch {} }
            if (/^https?:/i.test(href)) { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener"); }
            if (/5il\.co|aptg\.co|\.pdf(\?|$)/i.test(href)) el.setAttribute("data-docl", href);
          } else el.replaceWith(...el.childNodes);
        }
        if (el.tagName === "IMG") {
          if (src && /^https:/i.test(src)) { el.setAttribute("src", src); el.setAttribute("loading", "lazy"); el.setAttribute("alt", ""); }
          else el.remove();
        }
        if (/^H[12]$/.test(el.tagName)) { const h = doc.createElement("h3"); h.append(...el.childNodes); el.replaceWith(h); }
      }
    };
    const root = doc.body.firstElementChild;
    walk(root);
    // Tables (bus stops and times, fees) read as stacked lines on a phone,
    // never a sideways-scrolling grid. The district uses three layouts:
    // a label in each row ("Stop 1 | Lyons and Newcomb"), labels across the
    // top, and label rows alternating with value rows ("Stop 1..4" / times).
    for (const table of [...root.querySelectorAll("table")]) {
      const cell = (c) => c.innerHTML.replace(/<\/?p>/g, " ").replace(/<br\s*\/?>/g, " ").replace(/\s+/g, " ").trim();
      const text = (h) => h.replace(/<[^>]+>/g, "").trim();
      const trs = [...table.querySelectorAll("tr")].map((tr) => [...tr.children]).filter((r) => r.some((c) => text(cell(c))));
      const isLabelRow = (r) => r.every((c) => c.tagName === "TH" || (!text(cell(c)) || c.querySelector("strong, b") && text(c.querySelector("strong, b").textContent) === text(cell(c))));
      const lines = [];
      if (trs.length && trs.every((r) => r[0].tagName === "TH" && r.length >= 2)) {
        for (const r of trs) lines.push(`<b>${text(cell(r[0]))}:</b> ${r.slice(1).map(cell).filter((x) => text(x)).join(", ")}`);
      } else if (trs.length >= 2 && trs.length % 2 === 0 && trs.every((r, i) => (i % 2 === 0) === isLabelRow(r))) {
        for (let i = 0; i < trs.length; i += 2) trs[i].forEach((c, k) => { const v = trs[i + 1][k]; if (text(cell(c)) && v && text(cell(v))) lines.push(`<b>${text(cell(c))}:</b> ${cell(v)}`); });
      } else if (trs.length >= 2 && isLabelRow(trs[0])) {
        const head = trs[0].map((c) => text(cell(c)));
        for (const r of trs.slice(1)) lines.push(r.map((c, k) => (text(cell(c)) ? `${head[k] ? `<b>${head[k]}:</b> ` : ""}${cell(c)}` : "")).filter(Boolean).join("<br>"));
      } else for (const r of trs) lines.push(r.map(cell).filter((x) => text(x)).join(" &middot; "));
      const box = doc.createElement("div");
      box.className = "table-rows";
      box.innerHTML = lines.map((l) => `<p class="trow">${l}</p>`).join("");
      table.replaceWith(box);
    }
    // No emoji in the app, including in posts the schools write.
    const tw = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) n.nodeValue = n.nodeValue.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu, "").replace(/[ \t]{2,}/g, " ");
    for (const p of [...root.querySelectorAll("p, li, h3, h4")]) if (!p.textContent.trim() && !p.querySelector("img")) p.remove();
    return root.innerHTML;
  }

  async function openPage(slug) {
    const kid = activeKid();
    openSheet(t("Loading"), `<p class="loading">${t("Loading")}</p>`);
    try {
      const page = await getSchool(kid.school, "page", slug);
      if ($("sheet").hidden) return;
      // The page's own top heading repeats the sheet title; drop it.
      const plain = (h) => h.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim().toLowerCase();
      const blocks = page.blocks.filter((b, i) => !(i === 0 && /^<h1/i.test(b) && plain(b) === plain(page.name)));
      let body = blocks.map((b) => sanitize(tx(b))).join("");
      // Graduation lists the four ceremony times next to school logos the
      // app can't show; name each school from the district calendar instead.
      if (slug === "graduation") {
        const grad = SH.schoolYearFor(SCHOOL_YEARS, todayYmd()).graduation;
        if (grad) body = body.replace(/<h3>(\d{1,2}:\d\d) ?([ap])\.?m\.?<\/h3>/gi, (m, time, ap) => {
          const sc = Object.keys(grad.times).find((k) => grad.times[k].toLowerCase().replace(/\s/g, "") === `${time}${ap}m`.toLowerCase());
          return sc ? `<h3>${time} ${ap.toUpperCase()}M: ${esc(SCHOOLS[sc].short)}</h3>` : m;
        });
      }
      openSheet(tx(page.name), `${enNote("Content from the district, in English.", page.blocks)}<div class="reader">${body}</div>
        <p class="fine">${t("From the district website.")} <a href="${esc(page.url)}" target="_blank" rel="noopener">${t("Open there")}</a></p>
        ${reportLink({ type: "page", title: page.name, school: kid.school })}`);
    } catch { openSheet(t("Unavailable"), errorNote(t("this page"))); }
  }

  const newsStore = new Map();
  function openNews(id, school) {
    const items = newsStore.get(school || activeKid().school) || [];
    const n = items.find((x) => String(x.id) === String(id));
    if (!n) return;
    openSheet(tx(n.title), `
      <p class="fine" style="margin-top:-4px">${esc(n.at ? cap(fmtLong(n.at)) : "")}</p>${enNote(undefined, n.title, n.html)}
      ${n.image ? `<img class="reader-cover" src="${esc(n.image)}" alt="" loading="lazy">` : ""}
      <div class="reader">${sanitize(tx(n.html))}</div>
      ${n.link ? `<p class="fine"><a href="${esc(n.link)}" target="_blank" rel="noopener">${t("Open on the school website")}</a></p>` : ""}`);
  }

  // Counselors by last name when the handbook lists them; otherwise the
  // counseling office's own site and the school office.
  function openCounselors() {
    const kid = activeKid();
    const s = SCHOOLS[kid.school];
    const byName = ((HANDBOOKS[kid.school] || {}).contacts || []).filter((c) => /Counselor \(students/i.test(c.role) && c.name);
    if (!byName.length) {
      return openSheet(t("{school} counselors", { school: s.short }), `
        <p>${t("The counseling office handles classes, testing, college visits and scholarships.")}</p>
        <div class="sheet-actions">
          ${s.level === "hs" ? `<a class="btn primary block" href="${esc(LINK("Counseling"))}" target="_blank" rel="noopener">${t("Counseling website")}${outIcon()}</a>` : ""}
          <a class="btn block" href="tel:+1${esc(s.phone.replace(/\D/g, ""))}">${t("Call {school}", { school: esc(s.short) })}: ${esc(s.phone)}</a>
        </div>`);
    }
    openSheet(t("{school} counselors", { school: SCHOOLS[kid.school].short }), `
      <p>${t("Counselors are assigned by your student's last name.")}</p>
      <div>${byName.map((c) => `<div class="person"><span><b>${esc(c.role.replace(/^Counselor \(students\s*/i, `${t("Last names")} `).replace(/\)$/, ""))}</b><span>${esc(c.name)}</span></span><span class="person-actions">${c.email ? `<a class="small-btn" href="mailto:${esc(c.email)}">${t("Email")}</a>` : ""}${c.phone ? `<a class="small-btn" href="tel:+1${esc(c.phone.replace(/\D/g, "").slice(-10))}">${t("Call")}</a>` : ""}</span></div>`).join("")}</div>`);
  }

  async function openStaff(initial = "") {
    const kid = activeKid();
    openSheet(t("{school} staff", { school: SCHOOLS[kid.school].short }), `<p class="loading">${t("Loading staff")}</p>`);
    let staff;
    try { staff = await getSchool(kid.school, "staff"); } catch { $("sheetBody").innerHTML = errorNote(t("the staff list")); return; }
    if ($("sheet").hidden) return;
    $("sheetBody").innerHTML = `
      <input class="text-input" id="staffSearch" type="search" placeholder="${t("Search by name, subject or role")}" autocomplete="off" aria-label="${t("Search staff")}">
      <div id="staffList" class="staff-list"></div>`;
    const draw = (q) => {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = staff.people.filter((p) => words.every((w) => `${p.n} ${p.title} ${p.dept}`.toLowerCase().includes(w)));
      $("staffList").innerHTML = hits.slice(0, 80).map((p) => `<div class="person"><span><b>${esc(p.n)}</b><span>${esc(staffTitle(p))}</span></span><span class="person-actions">${p.email ? `<a class="small-btn" href="mailto:${esc(p.email)}">${t("Email")}</a>` : ""}</span></div>`).join("")
        + (hits.length > 80 ? `<p class="fine">${t("{n} more. Keep typing to narrow it down.", { n: hits.length - 80 })}</p>` : "")
        + (!hits.length ? `<p class="empty-note">${t("No one matches \"{q}\".", { q: esc(q) })}</p>` : "");
    };
    $("staffSearch").value = initial;
    draw(initial);
    $("staffSearch").addEventListener("input", (e) => draw(e.target.value));
  }

  async function openClubs() {
    const kid = activeKid();
    openSheet(t("Clubs at {school}", { school: SCHOOLS[kid.school].short }), `<p class="loading">${t("Loading clubs")}</p>`);
    let clubs;
    try { clubs = await getSchool(kid.school, "clubs"); } catch { $("sheetBody").innerHTML = errorNote(t("the clubs list")); return; }
    if ($("sheet").hidden) return;
    $("sheetBody").innerHTML = clubs.groups.map((g) => `
      <p class="section-label" style="margin-top:4px">${esc(tx(g.name))}</p>
      <div class="club-list">${g.items.map((c) => `<span class="club">${esc(tx(c))}</span>`).join("")}</div>`).join("")
      + `<p class="fine">${t("Ask the activities office or the club advisor how to join. Teams and activities with a schedule can be followed from Today.")}</p>`;
  }

  // A sick day, start to finish: call, the note on return, missed work,
  // and a running count of days missed this semester. The count lives only
  // on this phone (attendance itself is behind the Infinite Campus login).
  const ABS_KEY = "sfp-absences";
  function semesterOf(ymd) {
    const [, m, d] = ymd.split("-").map(Number);
    return m >= 7 || (m === 1 && d <= 15) ? `${SH.yearEnd(ymd)}-1` : `${SH.yearEnd(ymd)}-2`;
  }
  function absencesFor(kid) {
    const all = store.get(ABS_KEY, {});
    const sem = semesterOf(todayYmd());
    return (all[kid.id] || []).filter((d) => semesterOf(d) === sem).sort();
  }
  function openAbsence() {
    const kid = activeKid();
    const s = SCHOOLS[kid.school];
    const att = (HANDBOOKS[kid.school] || {}).attendance || {};
    const phone = att.phone || s.attendance || s.phone;
    const days = absencesFor(kid);
    const docRule = /10 or more|ten or more/i.test(att.howTo || "");
    const td = todayYmd();
    openSheet(t("Report an absence"), `
      <ol class="steps">
        <li><b>${t("Tell the school")}</b><span>${esc(t(att.howTo || s.attendanceNote))}</span>
          <a class="btn primary block" href="tel:+1${esc(phone.replace(/\D/g, ""))}">${t("Call {phone}", { phone: esc(phone) })}</a>
          ${att.email ? `<a class="btn block" href="mailto:${esc(att.email)}">${t("Email the attendance office")}</a>` : ""}
        </li>
        <li><b>${t("Catch up on missed work")}</b><span>${t("Ask the teacher what was missed. Attendance and grades are in Skyward Family Access.")}</span>
          <a class="btn block" href="${esc(LINK("Skyward Family Access"))}" target="_blank" rel="noopener">${t("Open Skyward")}${outIcon()}</a>
        </li>
        <li><b>${t("Keep count")}</b><span>${days.length === 1 ? t("{name} has missed 1 day this semester, by your count on this phone.", { name: esc(kidName(kid)) }) : t("{name} has missed {n} days this semester, by your count on this phone.", { name: esc(kidName(kid)), n: days.length })}${docRule ? ` ${t("At 10 days the school asks for a doctor's note.")}` : ""}</span>
          ${docRule && days.length >= 8 ? `<p class="alert-note">${t("{n} days so far. A doctor's note will be needed at 10.", { n: days.length })}</p>` : ""}
          ${days.includes(td) ? "" : `<button class="btn block" data-action="log-absence" data-day="${td}">${t("Count today as a missed day")}</button>`}
          ${days.length ? `<div class="absence-list">${days.slice().reverse().map((d) => `<span class="absence-day">${esc(fmtShort(d))}<button class="link-btn" data-action="unlog-absence" data-day="${d}" aria-label="${esc(t("Remove {day}", { day: fmtShort(d) }))}">${t("Remove")}</button></span>`).join("")}</div>` : ""}
        </li>
      </ol>`);
  }
  function logAbsence(day, add) {
    const kid = activeKid();
    const all = store.get(ABS_KEY, {});
    const list = new Set(all[kid.id] || []);
    if (add) list.add(day); else list.delete(day);
    all[kid.id] = [...list];
    store.set(ABS_KEY, all);
    openAbsence();
    if (!add) toast(t("Removed"), () => logAbsence(day, true));
  }

  function openDoc(url) {
    openSheet(t("Original document"), `<p>${t("This opens the school's PDF. Everything parents need from it is already in the app.")}</p>
      <div class="sheet-actions"><a class="btn block" href="${esc(url)}" target="_blank" rel="noopener">${t("Open the PDF")}</a></div>`);
  }

  /* ---------------- sheet ---------------- */

  let sheetOpener = null;
  let sheetOpenedAt = 0;
  // Sheets take a history entry, so the phone's back button (or swipe-back)
  // closes the sheet instead of leaving the app.
  // Sheets opened from inside another sheet stack up, so Back returns to the one before.
  // A tap inside the sheet arms one level; loading-to-content swaps reuse that level.
  let sheetStack = [];
  let sheetNavArmed = false;
  function openSheet(title, html) {
    if ($("sheet").hidden) { sheetOpener = document.activeElement; sheetStack = []; }
    else if (sheetNavArmed && title !== $("sheetTitle").textContent) {
      const body = $("sheetBody");
      sheetStack.push({ title: $("sheetTitle").textContent, nodes: [...body.childNodes], scroll: $("sheet").scrollTop });
      body.replaceChildren();
      const st = history.state || {};
      if (st.spentNest) history.replaceState({ tab, sheet: 1, depth: sheetStack.length }, "");
      else history.pushState({ tab, sheet: 1, depth: sheetStack.length }, "");
    }
    sheetNavArmed = false;
    $("sheetBack").hidden = !sheetStack.length;
    $("sheetTitle").textContent = title;
    $("sheetBody").innerHTML = html;
    $("sheet").scrollTop = 0;
    if ($("sheet").hidden) {
      $("sheet").hidden = false;
      $("sheetBackdrop").hidden = false;
      document.body.style.overflow = "hidden";
      // Reuse a history entry left by an earlier closed sheet; otherwise add one.
      const st = history.state || {};
      if (st.spent) history.replaceState({ tab, sheet: 1 }, "");
      else if (!st.sheet) history.pushState({ tab, sheet: 1 }, "");
    }
    sheetOpenedAt = Date.now();
    $("sheetClose").focus({ preventScroll: true });
  }
  let pendingReload = false;  // a new version arrived while a sheet was open
  function closeSheet(fromHistory) {
    if ($("sheet").hidden) return;
    if (pendingReload) setTimeout(() => location.reload(), 50);
    $("sheet").hidden = true;
    $("sheetBackdrop").hidden = true;
    $("sheet").style.transform = "";
    document.body.style.overflow = "";
    sheetOpenedAt = 0;
    sheetStack = [];
    $("sheetBack").hidden = true;
    draft = null;
    followDraft = null;
    // Closed by a tap: mark the entry spent rather than calling history.back(),
    // whose late popstate could undo a tab the parent taps right after.
    if (fromHistory !== true && history.state && history.state.sheet) history.replaceState({ tab, spent: 1 }, "");
    if (sheetOpener && document.contains(sheetOpener)) sheetOpener.focus({ preventScroll: true });
  }
  function sheetBack(fromHistory) {
    const prev = sheetStack.pop();
    if (!prev) return closeSheet(fromHistory);
    draft = null;
    $("sheetTitle").textContent = prev.title;
    $("sheetBody").replaceChildren(...prev.nodes);
    $("sheetBack").hidden = !sheetStack.length;
    $("sheet").scrollTop = prev.scroll;
    // Tapped Back: keep the history entry but mark it reusable by the next nested sheet.
    if (fromHistory !== true) history.replaceState({ tab, sheet: 1, depth: sheetStack.length, spentNest: 1 }, "");
    $("sheetBack").hidden ? $("sheetClose").focus({ preventScroll: true }) : $("sheetBack").focus({ preventScroll: true });
  }
  $("sheetBack").addEventListener("click", () => sheetBack());
  $("sheetBody").addEventListener("click", (e) => {
    const b = e.target.closest("button, a, [data-action], [data-ev], [data-page]");
    // Saving or joining moves a flow forward; going "back" into a saved form
    // would re-save it. Choices in a form change it in place: not a new sheet.
    if (!b || b.classList.contains("choice") || b.classList.contains("follow-toggle")) return;
    sheetNavArmed = !/^(save|join|restore|add-these|confirm|delete|remove)/.test(b.dataset.action || "");
    setTimeout(() => { sheetNavArmed = false; }, 4000);
  }, true);
  $("sheetClose").addEventListener("click", () => closeSheet());
  // The elementary school list narrows as the parent types.
  $("sheetBody").addEventListener("input", (e) => {
    if (e.target.id !== "schoolFilter") return;
    const q = e.target.value.trim().toLowerCase();
    for (const b of $("sheetBody").querySelectorAll(".school-list .choice")) b.hidden = !!q && !b.dataset.name.includes(q);
  });
  $("sheetBackdrop").addEventListener("click", () => closeSheet());
  document.addEventListener("keydown", (e) => {
    if ($("sheet").hidden) return;
    if (e.key === "Escape") closeSheet();
    if (e.key === "Tab") {
      const f = [...$("sheet").querySelectorAll("button, a[href], input, select")].filter((x) => !x.disabled && x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  // Swipe the sheet down to close it (only when it's scrolled to the top).
  (() => {
    const sheet = $("sheet");
    let y0 = null, dy = 0;
    sheet.addEventListener("touchstart", (e) => { y0 = sheet.scrollTop <= 0 ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
    sheet.addEventListener("touchmove", (e) => {
      if (y0 === null) return;
      dy = e.touches[0].clientY - y0;
      if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    sheet.addEventListener("touchend", () => {
      if (y0 === null) return;
      sheet.style.transform = "";
      if (dy > 90) closeSheet();
      y0 = null;
    });
  })();

  const GOOGLE_G_ICON = `<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"> <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"/> <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18z"/> <path fill="#FBBC05" d="M3.95 10.7A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.27-1.7V4.97H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.03z"/> <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z"/> </svg>`;

  function googleCalUrl(ev) {
    const day = ev.d.replace(/-/g, "");
    let dates;
    if (ev.t) {
      const st = `${day}T${ev.t.replace(":", "")}00`;
      const en = ev.e ? `${day}T${ev.e.replace(":", "")}00` : (() => { const [h, m] = ev.t.split(":").map(Number); return `${day}T${pad(Math.min(h + 1, 23))}${pad(m)}00`; })();
      dates = `${st}/${en}`;
    } else {
      dates = `${day}/${addDays(ev.to || ev.d, 1).replace(/-/g, "")}`;
    }
    const title = (ev.x ? `${t("Cancelled").toUpperCase()}: ` : "") + evTitle(ev) + (ev.level && !/^(High School|HS )/.test(ev.level) ? ` (${tt(ev.level)})` : "");
    const p = new URLSearchParams({ action: "TEMPLATE", text: title, dates, ctz: "America/Chicago" });
    if (ev.venue) p.set("location", ev.venue);
    return `https://calendar.google.com/calendar/render?${p}`;
  }
  function icsUrl(ev, school) {
    if (ev.district) {
      const p = new URLSearchParams({ format: "ics", custom: "1", start: ev.d, title: ev.title });
      if (ev.to) p.set("end", ev.to);
      return `${EVENTS_API}?${p}`;
    }
    const ids = ev.ids || [ev.id];
    return `${EVENTS_API}?school=${school}&start=${ev.d}&end=${ev.d}&format=ics&ids=${encodeURIComponent(ids.join(","))}`;
  }
  // Apple Maps on iPhone, Google Maps everywhere else. With a pin (Bound
  // gives one for every venue), the map goes to that exact spot; a town is
  // never guessed, because away games are often hours from home.
  function mapsUrl(place, geo) {
    if (geo && /^-?[\d.]+,-?[\d.]+$/.test(geo)) return isIOS ? `https://maps.apple.com/?ll=${geo}&q=${encodeURIComponent(place)}` : `https://www.google.com/maps/search/?api=1&query=${geo}`;
    return isIOS ? `https://maps.apple.com/?q=${encodeURIComponent(place)}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
  }

  function openEvent(id, school) {
    const ev = eventStore.get(id);
    if (!ev) return;
    const when = ev.to && ev.to !== ev.d ? t("{a} to {b}", { a: cap(fmtLong(ev.d)), b: fmtLong(ev.to) }) : `${cap(fmtLong(ev.d))}${ev.t && !ev.parts ? `, ${fmtTime(ev.t)}${ev.e ? ` ${t("to")} ${fmtTime(ev.e)}` : ""}${ev.lt ? ` (${localTime(ev)})` : ""}` : ""}`;
    const rows = [
      [t("When"), when],
      ev.home === true && [t("Game"), t("Home")],
      ev.home === false && [t("Game"), t("Away")],
      ev.reasons && [t("Why"), [...new Set(ev.reasons)].map(distTitle).join(", ")],
      ev.act && !ev.parts && [t("Team"), tt(ev.act) + (ev.level ? `, ${tt(ev.level)}` : "")],
      ev.g && [t("For"), gradeTag(ev.g)],
      [t("From"), ev.kind === "state" ? t("South Dakota High School Activities Association") : ev.district ? t("District calendar") : t("{school} activities calendar", { school: SCHOOLS[school].short })],
    ].filter(Boolean);
    // Per-level rows name only what differs ("Gym Main"), not the building.
    const venues = ev.parts ? [...new Set(ev.parts.map((p) => tx(p.venue)).filter(Boolean))] : [];
    const common = (() => {
      if (venues.length < 2) return "";
      const w = venues.map((v) => v.split(" "));
      const shortest = Math.min(...w.map((x) => x.length));
      let n = 0;
      while (n < shortest && w.every((x) => x[n] === w[0][n])) n++;
      return w[0].slice(0, Math.max(0, n - 1)).join(" ");
    })();
    const shortVenue = (v) => (common && v.startsWith(common) ? v.slice(common.length).trim() : v);
    const levels = ev.parts ? `
      <div class="level-table">
        <p class="section-label" style="margin:0">${t("{act} teams playing", { act: esc(tt(ev.act)) })}</p>
        ${ev.parts.map((p) => `<div class="level-row ${p.x ? "x" : ""}"><b>${esc(tt(p.level) || t("Team"))}</b><span>${p.t ? esc(fmtTime(p.t)) + (p.lt ? ` (${esc(localTime(p))})` : "") : t("Time not set")}${p.x ? ` ${t("(cancelled)")}` : ""}${venues.length > 1 && p.venue ? `<span class="muted">${esc(shortVenue(tx(p.venue)).replace(/^,\s*/, ""))}</span>` : ""}</span></div>`).join("")}
      </div>` : "";
    // The pin of the venue the map is for (the first, when levels split).
    const firstName = (ev.venue || "").split(" and ")[0];
    const firstGeo = ev.parts ? (ev.parts.find((p) => p.venue === firstName && p.geo) || ev.parts.find((p) => p.geo) || {}).geo : ev.geo;
    const place = ev.venue && !/^(TBD|TBA)$/i.test(ev.venue.trim()) ? `
      <a class="place" href="${esc(ev.map ? mapsUrl(ev.map) : mapsUrl(ev.venue.split(" and ")[0], firstGeo))}" target="_blank" rel="noopener">
        <span><b>${esc(tx(ev.venue))}</b><span>${t("Directions")}</span></span>${CHEVRON}
      </a>` : "";
    const gUrl = googleCalUrl(ev.parts ? { ...ev, level: "" } : ev);
    openSheet(evTitle(ev), `
      ${ev.x ? `<p class="alert-note">${t("This event has been cancelled.")}</p>` : ""}
      <dl class="detail-list">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      ${levels}
      ${place}
      <div class="sheet-actions">
        <a class="btn primary block" href="${esc(icsUrl(ev, school))}">${t("Add to my calendar")}</a>
        <a class="btn block" href="${esc(gUrl)}" target="_blank" rel="noopener">${GOOGLE_G_ICON}${t("Add to Google Calendar")}</a>
        ${ev.parts ? `<p class="sheet-hint">${t("My calendar adds every team. Google adds the first game only.")}</p>` : ""}
        ${ev.url ? `<a class="btn block" href="${esc(ev.url)}" target="_blank" rel="noopener">${t("Tickets and live scores on Bound")}</a>` : ""}
      </div>
      ${reportLink({ type: "event", title: ev.title, date: ev.d, school, id: ev.id })}`);
  }

  // Google's own copies of the feeds (netlify/functions/mirror.mjs): the
  // one thing Google's phone apps can add in a single tap. One calendar per
  // grade and one per activity, kept by a script in the owner's account.
  const MIRROR_API = "/.netlify/functions/mirror";
  let mirrorCache = null;
  async function getMirror() {
    if (mirrorCache) return mirrorCache;
    try { const res = await fetch(MIRROR_API); if (res.ok) mirrorCache = (await res.json()).calendars || {}; } catch {}
    return mirrorCache || {};
  }
  const googleAddUrl = (id) => `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(btoa(id).replace(/=+$/, ""))}`;
  function mirrorPieces(kid) {
    const s = SCHOOLS[kid.school];
    const linq = s.linq;
    const follows = (kid.follows || []).map((f) => f.act);
    const secondary = s.grades[0] >= 5;
    if (!follows.length && secondary) return [{ key: `ga:${linq}:${kid.grade}`, label: t("{grade}, school-wide events and every activity", { grade: gradeName(kid.grade) }) }];
    return [{ key: `g:${linq}:${kid.grade}`, label: t("{grade} and school-wide events", { grade: gradeName(kid.grade) }) }, ...follows.map((a) => ({ key: `a:${linq}:${a}`, label: tt(a) }))];
  }

  // Calendar subscription: the student's calendar as a feed the phone keeps
  // checking, so new games and changed times show up on their own.
  async function openSubscribe(kid) {
    // Through the family code when possible, so teams added later reach
    // this subscription too. Falls back to a self-contained link offline.
    let code = null;
    try { code = await ensureFamily(); } catch {}
    const p = new URLSearchParams(code ? { family: code, kid: kid.id } : SH.encodeFeed(kid));
    if (lang === "es") p.set("lang", "es");
    // A plain .ics address (robots.txt allows /feed/). iPhones only know
    // webcal:// (webcals:// is "address is invalid"); the calendar follows
    // the redirect to https. Google's add-by-link takes the webcal:// form.
    const id = btoa(unescape(encodeURIComponent(p.toString()))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const https = `${location.origin}/feed/${id}/calendar.ics`;
    const webcal = https.replace(/^https?:\/\//, "webcal://");
    const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
    // Google's phone apps cannot add a calendar by link, so phones get only
    // what works there: the iPhone calendar, or the link to add on a computer.
    const phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const android = /Android/i.test(navigator.userAgent);
    const n = esc(kidName(kid));
    const mirror = await getMirror();
    const pieces = mirrorPieces(kid).map((p) => ({ ...p, cal: mirror[p.key] })).filter((p) => p.cal && p.cal.synced);
    const googleRows = pieces.length
      ? `<p class="section-label" style="margin-top:12px">${GOOGLE_G_ICON} ${t("Add to Google Calendar")}</p>
        ${pieces.map((p) => `<div class="sub-row"><span>${esc(p.label)}</span><a class="btn small-btn" href="${esc(googleAddUrl(p.cal.id))}" target="_blank" rel="noopener">${t("Add")}</a></div>`).join("")}
        <p class="sheet-hint">${pieces.length === 1 ? t("Google asks you to confirm, then it shows in the Google Calendar app and keeps itself current.") : t("One calendar per activity, so you can add or drop them later. Google asks you to confirm each one.")}</p>`
      : "";
    openSheet(t("{name}'s calendar on your phone", { name: kidName(kid) }), `
      <p>${(kid.follows || []).length
        ? t("Days off, conferences, tests, and {name}'s {acts} schedule go straight into your phone's calendar.", { name: n, acts: (kid.follows || []).map((f) => esc(tt(f.act).toLowerCase())).join(", ") })
        : t("Days off, conferences, tests go straight into your phone's calendar.")} ${t("It updates itself when the school changes something.")}</p>
      <div class="sheet-actions">
        ${android ? "" : `<a class="btn primary block" href="${esc(webcal)}">${CAL_ICON}${t("iPhone or Mac calendar")}</a>`}
        ${phone || pieces.length ? "" : `<a class="btn block" href="${esc(google)}" target="_blank" rel="noopener">${GOOGLE_G_ICON}Google Calendar</a>`}
        ${pieces.length ? "" : `<button class="btn ${android ? "primary " : ""}block" data-action="copy" data-copy="${esc(https)}">${t("Copy calendar link")}</button>`}
      </div>
      ${googleRows}
      ${phone && !pieces.length ? `<p class="sheet-hint">${t("Google Calendar can only add it from a computer: open calendar.google.com, then Other calendars, From URL, and paste the link.")}</p>` : ""}
      <p class="sheet-hint">${t("Names stay on this phone. The calendar only knows the school, grade and teams.")}</p>
      <p class="sheet-hint">${code ? t("Teams you add for {name} later show up in this calendar on their own.", { name: n }) : t("Change {name}'s teams later? Add the calendar again to include them.", { name: n })}</p>`);
  }

  /* ----- student editor ----- */

  function openStudents() {
    openSheet(t("Students"), `
      <div>${kids.map((k) => `
        <div class="student-row">
          <span class="who"><span class="dot" style="background:${SCHOOLS[k.school].brand.primary}"></span><span><b>${esc(kidName(k))}</b><br><span class="muted">${esc(SCHOOLS[k.school].short)}, ${esc(gradeText(k))}</span></span></span>
          <span class="actions"><button class="small-btn" data-action="edit-kid" data-kid="${esc(k.id)}">${t("Edit")}</button></span>
        </div>`).join("")}</div>
      <button class="btn primary block" data-action="add-kid">${t("Add a student")}</button>
      <button class="btn block" data-action="notifications">${pushPrefs && pushPrefs.on ? t("Notifications: on") : t("Notifications")}</button>
      <button class="btn block" data-action="share-setup">${t("Set up another parent's phone")}</button>
      ${langToggle("btn block")}
      ${family ? `<div class="code-box"><p class="section-label" style="margin:0">${t("Your family code")}</p><p class="family-code">${esc(family.code.slice(0, 4))}-${esc(family.code.slice(4))}</p><p class="fine">${t("Write this down. If this phone is reset, enter it on the welcome screen to bring your students and teams back.")}</p></div>` : ""}
      <p class="privacy-note">${t("Saved only on this phone.")}</p>`);
  }

  /* ----- report a mistake, usage counts ----- */

  const REPORT_API = "/.netlify/functions/report";
  let reportContext = null;
  const reportLink = (ctx) => `<button class="link-btn report-link" data-action="report" data-ctx="${esc(JSON.stringify(ctx))}">${t("Something wrong here? Tell us")}</button>`;
  function openReport(ctx) {
    reportContext = ctx;
    openSheet(t("Report a mistake"), `
      ${ctx.title ? `<p class="fine">${t("About: {title}", { title: esc(ctx.title) })}${ctx.date ? `, ${esc(fmtShort(ctx.date))}` : ""}</p>` : ""}
      <label class="field"><span class="field-label">${t("What's wrong?")}</span>
        <textarea class="text-input text-area" id="reportText" rows="4" maxlength="1000" placeholder="${t("The game moved to 5:00, the bell times changed, a link is broken")}"></textarea></label>
      <p class="field-hint">${t("Please don't include your student's name. We use this only to fix the app.")}</p>
      <div class="sheet-actions"><button class="btn primary block" data-action="send-report">${t("Send")}</button></div>`);
    $("reportText").focus();
  }
  async function sendReport() {
    const message = ($("reportText").value || "").trim();
    if (message.length < 3) { $("reportText").focus(); return; }
    try {
      const res = await fetch(REPORT_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "report", message, context: reportContext || {} }) });
      if (!res.ok) throw new Error();
      closeSheet();
      toast(t("Thanks. We'll look into it."));
    } catch { toast(t("Couldn't send right now. Try again in a minute.")); }
  }
  // One anonymous count per phone per day: how many phones opened the app,
  // and for which schools. No id, no names.
  function pingUsage() {
    const day = todayYmd();
    if (store.get("sfp-ping", "") === day || !kids.length || demo) return;
    store.set("sfp-ping", day);
    fetch(REPORT_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ping", schools: [...new Set(kids.map((k) => k.school))], installed: isStandalone }) }).catch(() => {});
  }

  /* ----- search across the app ----- */

  // One box for "when is prom", "nurse", "late start", "pizza": calendar,
  // staff, handbook rules, bell schedules, pages, clubs and lunch for every
  // student's school. Everything is fetched once and filtered as you type.
  let searchIndex = null;
  // Search takes a few seconds to gather everything; start it quietly once
  // Today has loaded so it's ready when a parent taps "Ask".
  let searchWarming = null;
  function warmSearch() {
    if (searchIndex && Date.now() - searchIndex.at < 10 * 60e3) return;
    if (searchWarming) return;
    const go = () => {
      const forLang = lang;
      searchWarming = buildSearchIndex().then((items) => { if (lang === forLang) searchIndex = { at: Date.now(), items }; return items; }).finally(() => { setTimeout(() => { searchWarming = null; }, 0); });
    };
    if ("requestIdleCallback" in window) requestIdleCallback(go, { timeout: 3000 }); else setTimeout(go, 1500);
  }

  async function buildSearchIndex() {
    const td = todayYmd();
    const end = SH.schoolYearFor(SCHOOL_YEARS, td).last;
    const schools = [...new Set(kids.filter((k) => !k.graduated).map((k) => k.school))];
    const items = [];
    // A person's role counts as part of their title ("counselor" finds counselors).
    const add = (group, title, sub, action, extra = "") => items.push({ group, title, sub, action, t: (group === "People" ? `${title} ${sub}` : title).toLowerCase(), hay: `${title} ${sub} ${extra}`.toLowerCase() });
    const districtSeen = new Set();
    // Answers written on the admin page for questions parents search for.
    const status = await getStatus().catch(() => null);
    for (const x of (status && status.answers) || []) {
      const q = lang === "es" && x.qEs ? x.qEs : x.q;
      const a = lang === "es" && x.aEs ? x.aEs : x.a;
      add("Answers", q, a.length > 110 ? `${a.slice(0, a.lastIndexOf(" ", 110))}...` : a, { answer: { q, a, link: x.link } }, `${x.q} ${x.a} ${x.qEs || ""} ${x.aEs || ""}`);
    }
    await Promise.all(schools.map(async (sc) => {
      const s = SCHOOLS[sc];
      const [events, staff, clubs, menu] = await Promise.all([
        getEvents(sc, td, end).catch(() => []),
        getSchool(sc, "staff").catch(() => null),
        getSchool(sc, "clubs").catch(() => null),
        getMenu(sc, td, SH.addDays(td, 13)).catch(() => null),
      ]);
      for (const e of groupEvents(sortEvents(mergeDistrict(events, td, end, null).filter((e) => e.cat !== "practice")))) {
        if (e.district) { if (districtSeen.has(e.id)) continue; districtSeen.add(e.id); }
        eventStore.set(e.id, e);
        const title = evTitle(e);
        add("Calendar", title, `${fmtShort(e.d)}${e.t ? `, ${fmtTime(e.t)}` : ""}${e.district ? `, ${t("all high schools")}` : `, ${s.short}`}`, { ev: e.id, school: sc }, `${e.act || ""} ${tt(e.act) || ""} ${e.level || ""} ${e.venue || ""}${title !== e.title ? ` ${e.title}` : ""}`);
      }
      for (const p of (staff && staff.people) || []) add("People", p.n, `${staffTitle(p)}, ${s.short}`, { email: p.email }, `${p.dept} ${p.title} ${tx(p.dept)}`);
      for (const g of (clubs && clubs.groups) || []) for (const c of g.items) add("Clubs", tx(c), `${s.short}, ${tx(g.name).toLowerCase()}`, { clubs: sc }, c);
      // Elementary and middle schools: the rules shared by every school at that level.
      const hb = HANDBOOKS[sc] || (LEVEL_INFO[s.level] ? { policies: LEVEL_INFO[s.level].policies, level: s.level } : {});
      for (const x of hb.policies || []) add("Rules", t(x.title), s.short, { policy: { title: x.title, body: x.body, school: sc, level: hb.level } }, `${t(x.body)} ${x.title} ${x.body}`);
      for (const x of hb.schedules || []) add("Bell schedules", t(x.name), s.short, { sched: { school: sc, name: x.name } }, `${x.name} bell schedule times periods ${t("Bell schedule")}`);
      if (hb.lunch) add("Rules", t("Lunch and open lunch"), s.short, { policy: { title: "Lunch and open lunch", body: hb.lunch, school: sc } }, `${t(hb.lunch)} ${hb.lunch}`);
      if (menu) for (const [d, lines] of menu.byDay) {
        menuStore.set(d, lines);
        // Each dish on its own, so "pizza" finds the pizza, not the day.
        const seen = new Set();
        for (const [line, list] of Object.entries(lines)) for (const i of list) {
          if (["MILK", "OTHER"].includes(i.t) || seen.has(i.n)) continue;
          seen.add(i.n);
          add("Lunch", dish(i.n), `${fmtShort(d)}, ${s.short}${line === "Lunch" ? "" : `, ${t("{line} line", { line: lang === "es" ? dietLow(line.replace(/^Lunch - /, "")) : line.replace(/^Lunch - /, "").toLowerCase() })}`}`, { menu: d, school: sc }, i.n);
        }
      }
    }));
    for (const sc of schools) {
      if (SCHOOLS[sc].supplies) add("Pages", t("Supply list"), SCHOOLS[sc].short, { supplies: sc });
      add("Pages", t("Student handbook"), SCHOOLS[sc].short, { handbook: sc });
    }
    for (const l of DISTRICT_LINKS) add("Links", t(l.label), t(l.note), { url: l.url });
    for (const [g, guide] of Object.entries(GUIDE)) {
      // Spanish guide text when it exists, keyed the same way as renderGuide.
      const ge = (lang === "es" && window.SFI18N && SFI18N.guideEs && SFI18N.guideEs[g]) || null;
      const todo = guide.todo.map((x) => ({ ...x, text: (ge && ge.todo && ge.todo[x.id]) || x.text }));
      const facts = guide.facts.map((f, i) => (ge && ge.facts && ge.facts[i]) || f);
      for (const x of todo.concat(facts.map((f) => ({ text: f.title, body: f.body })))) add("Guide", x.text, gradeName(Number(g)), { tab: "guide", grade: Number(g) }, x.body || "");
    }
    return items;
  }
  // Ask: an AI answer from what the app knows about this family's schools,
  // with buttons to where it lives. Off (plain search) until the server has
  // its Claude key. Only schools, grades and teams are sent, never names.
  const ASK_API = "/.netlify/functions/ask";
  let askReady = null, askHistory = [];
  async function checkAsk() {
    if (askReady !== null) return askReady;
    try { askReady = !!(await (await fetch(`${ASK_API}?ready=1`)).json()).ready; } catch { askReady = false; }
    return askReady;
  }
  // Ready-made questions show what Ask is for. No child's name goes in
  // them: the question text is sent to the server as typed.
  function askStartHtml() {
    const act = activeKids();
    const qs = [];
    if (act.some((k) => (k.follows || []).length)) qs.push(t("When is the next game?"));
    qs.push(t("What's for lunch tomorrow?"));
    qs.push(t("When are parent-teacher conferences?"));
    if (qs.length < 3) qs.push(act.some((k) => SCHOOLS[k.school].level === "es") ? t("Can my child bring medicine to school?") : t("When is the next day off?"));
    return `<p>${t("Type a question the way you'd ask a person. The answer comes from what's in this app, with a button to where it lives.")}</p>
      <p class="section-label">${t("Try one")}</p>
      <div class="ask-tries">${qs.slice(0, 3).map((q) => `<button class="ask-try" data-action="ask-try" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>`;
  }
  async function sendAsk() {
    const input = $("searchInput"), box = $("askAnswer");
    if (!input || !box) return;
    const q = input.value.trim();
    if (q.length < 2) return;
    box.hidden = false;
    box.innerHTML = `<p class="loading">${t("Finding the answer")}</p>`;
    const kidsOut = activeKids().map((k) => ({ school: k.school, grade: k.grade, follows: (k.follows || []).map((f) => f.act) }));
    let out;
    try {
      const r = await fetch(ASK_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q, lang, kids: kidsOut, history: askHistory }) });
      out = await r.json();
      if (!r.ok) throw new Error(out.error || "failed");
    } catch {
      if ($("askAnswer")) $("askAnswer").innerHTML = `<p class="fine">${t("The assistant can't answer right now. The search results below still work.")}</p>`;
      return;
    }
    if (!$("askAnswer")) return;
    askHistory = askHistory.concat({ q, a: out.answer }).slice(-3);
    $("askAnswer").innerHTML = `<p class="ask-q">${esc(q)}</p><p class="ask-a">${esc(out.answer)}</p>
      ${out.links.length ? `<div class="ask-links">${out.links.map((l) => `<button class="btn block" data-askgo="${esc(l.go)}">${esc(l.label)}</button>`).join("")}</div>` : ""}
      <p class="fine">${t("Answered by AI from the information in this app. Check with the school for anything important.")}</p>`;
  }
  function askGo(go) {
    const k = activeKid();
    const tabs = ["today", "lunch", "calendar", "guide", "school"];
    if (tabs.includes(go)) { closeSheet(); return goTab(go); }
    if (go === "absence") { closeSheet(); goTab("school"); return openAbsence(); }
    if (go === "staff") return openStaff();
    if (go === "forms") return openForms();
    if (go === "subscribe" && k) return openSubscribe(k);
    if (go === "notifications") return openNotifications();
    if (go === "students") return openStudents();
    if (go === "search" && $("searchInput")) $("searchInput").focus();
  }
  async function openSearch() {
    askHistory = [];
    openSheet(t("Search"), `<div class="ask-row"><input class="text-input" id="searchInput" type="search" enterkeyhint="search" placeholder="${t("Prom, nurse, late start, pizza")}" autocomplete="off" aria-label="${t("Search everything")}"><button class="btn primary" id="askBtn" data-action="ask" hidden>${t("Ask")}</button></div><div id="askStart" class="ask-start" hidden></div><div id="askAnswer" class="ask-answer" hidden></div><div id="searchResults" class="search-results"><p class="loading">${t("Getting everything ready")}</p></div>`);
    $("searchInput").focus();
    checkAsk().then((ok) => {
      if (!ok || !$("askBtn")) return;
      $("sheetTitle").textContent = t("Ask a question");
      $("searchInput").placeholder = t("Type your question");
      $("askBtn").hidden = false;
      $("askStart").innerHTML = askStartHtml();
      $("askStart").hidden = false;
      if (!$("searchInput").value.trim()) $("searchResults").innerHTML = "";
      $("searchInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendAsk(); } });
    });
    try { searchIndex = searchIndex && Date.now() - searchIndex.at < 10 * 60e3 ? searchIndex : { at: Date.now(), items: await (searchWarming || buildSearchIndex()) }; }
    catch { $("searchResults").innerHTML = errorNote(t("search")); return; }
    if (!$("searchInput")) return;
    const draw = () => {
      const q = $("searchInput").value.trim().toLowerCase();
      if (q.length < 2) { $("searchResults").innerHTML = askReady ? "" : `<p class="fine">${t("Search the calendar, staff, school rules, bell schedules, clubs and lunch for {names}.", { names: esc(kids.filter((k) => !k.graduated).map(kidName).join(` ${t("and")} `)) })}</p>`; return; }
      // Whole words in the title score highest, then word starts, then any
      // mention; groups are ordered by their best hit.
      const words = q.split(/\s+/);
      const esc2 = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const score = (i) => {
        let sc = 0;
        for (const w of words) {
          if (!i.hay.includes(w)) return 0;
          if (new RegExp(`\\b${esc2(w)}\\b`).test(i.t)) sc += 6;
          else if (new RegExp(`\\b${esc2(w)}`).test(i.t)) sc += 3;
          else if (new RegExp(`\\b${esc2(w)}\\b`).test(i.hay)) sc += 2;
          else sc += 1;
        }
        return sc;
      };
      const hits = searchIndex.items.map((i) => ({ ...i, sc: score(i) })).filter((i) => i.sc > 0).sort((a, b) => b.sc - a.sc);
      // Written answers always come first.
      const groupNames = [...new Set(hits.map((h) => h.group))].sort((a, b) => (b === "Answers") - (a === "Answers"));
      const groups = groupNames.map((g) => [g, hits.filter((h) => h.group === g)]);
      searchHits = hits;
      $("searchResults").innerHTML = groups.length ? groups.map(([g, list]) => `
        <p class="section-label">${esc(t(g))}</p>
        ${list.slice(0, g === "Calendar" ? 8 : 5).map((h) => `<button class="list-row" data-hit="${hits.indexOf(h)}"><span><b>${esc(h.title)}</b><span>${esc(h.sub)}</span></span>${CHEVRON}</button>`).join("")}`).join("")
        : askReady ? "" : `<p class="empty-note">${t("Nothing matches \"{q}\".", { q: esc(q) })}</p>`;
      // Tell the district what parents couldn't find (the words only, once
      // the parent stops typing; no name or phone id is sent).
      clearTimeout(missTimer);
      // With Ask on, an unmatched question goes to the assistant instead.
      if (!groups.length && q.length >= 3 && !askReady) missTimer = setTimeout(() => { if (!missSent.has(q) && $("searchInput") && $("searchInput").value.trim().toLowerCase() === q) { missSent.add(q); fetch(REPORT_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "miss", q }) }).catch(() => {}); } }, 2500);
    };
    draw();
    $("searchInput").addEventListener("input", () => { if ($("askStart")) $("askStart").hidden = !askReady || !!$("searchInput").value.trim(); draw(); });
  }
  let searchHits = [];
  let missTimer = null;
  const missSent = new Set();
  function openHit(h) {
    const a = h.action;
    if (a.ev) return openEvent(a.ev, a.school);
    if (a.email) return openSheet(h.title, `<p>${esc(h.sub)}</p><div class="sheet-actions"><a class="btn primary block" href="mailto:${esc(a.email)}">${t("Email {name}", { name: esc(h.title.split(" ")[0]) })}</a></div>`);
    if (a.answer) return openSheet(a.answer.q, `<p style="line-height:1.55">${esc(a.answer.a)}</p>${a.answer.link ? `<div class="sheet-actions"><a class="btn primary block" href="${esc(a.answer.link)}" target="_blank" rel="noopener">${t("Open the link")}${outIcon()}</a></div>` : ""}`);
    if (a.policy) return openSheet(t(a.policy.title), `<p class="fine">${a.policy.level ? t("From the district's 2026-27 handbooks.") : t("{school} student handbook", { school: esc(SCHOOLS[a.policy.school].short) })}</p><p style="line-height:1.55">${esc(t(a.policy.body))}</p>`);
    if (a.page) return openPage(a.page);
    if (a.supplies) { const k = kids.find((x) => x.school === a.supplies); return openSupplies(k || activeKid()); }
    if (a.handbook) { const k = kids.find((x) => x.school === a.handbook); if (k) { activeKidId = k.id; store.set(KID_KEY, activeKidId); } return openHandbook(); }
    if (a.menu) { const k = kids.find((x) => x.school === a.school); if (k) { activeKidId = k.id; store.set(KID_KEY, activeKidId); } return openMenu(a.menu); }
    if (a.clubs) { const k = kids.find((x) => x.school === a.clubs); if (k) activeKidId = k.id; return openClubs(); }
    if (a.sched) { const k = kids.find((x) => x.school === a.sched.school); if (k) { activeKidId = k.id; store.set(KID_KEY, activeKidId); } schedHint[a.sched.school] = a.sched.name; schedPicked = false; closeSheet(); return goTab("school"); }
    if (a.url) { window.open(a.url, "_blank", "noopener"); return; }
    if (a.tab) { const k = kids.find((x) => x.grade === a.grade) || activeKid(); activeKidId = k.id; store.set(KID_KEY, activeKidId); closeSheet(); return goTab(a.tab); }
  }

  /* ----- notifications ----- */

  const PUSH_API = "/.netlify/functions/push";
  const PUSH_PUBLIC = "BOYD5uomNO9nb90AldR52cgWW2BUdzKMeYpeB-1dwGU2V-CSZU_huH3zXUEU00GJY2Ul26NC5VSYp0t9YsUdVsY";
  const PUSH_KEY = "sfp-push";
  let pushPrefs = store.get(PUSH_KEY, null); // { on, evening, changes, alerts }
  const urlKey = (b64s) => { const p = "=".repeat((4 - (b64s.length % 4)) % 4); const raw = atob((b64s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
  const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  function openNotifications() {
    const p = pushPrefs || { on: false, evening: true, changes: true, alerts: true };
    let body;
    if (!pushSupported()) {
      body = isIOS && !isStandalone
        ? `<p>${t("On iPhone, notifications work once the app is on your home screen. Tap Share, then Add to Home Screen, then open it from there and come back here.")}</p>`
        : `<p>${t("This browser can't receive notifications. Try Chrome, Edge, Firefox, or Safari on a phone with the app on the home screen.")}</p>`;
    } else if (Notification.permission === "denied") {
      body = `<p>${t("Notifications are blocked for this site. Turn them on in your browser or phone settings, then come back here.")}</p>`;
    } else {
      const row = (key, label, note) => `<button class="follow-toggle" data-pushpref="${key}" aria-pressed="${p[key] !== false}"><span class="box"></span><span><b>${label}</b><br><span class="muted">${note}</span></span></button>`;
      body = `
        <div>
          ${row("evening", t("Tomorrow, at 7 PM"), t("Days off, games and grade events, the evening before each school day"))}
          ${row("changes", t("Game changes"), t("When a followed team's game is cancelled or moves"))}
          ${row("alerts", t("School alerts"), t("Weather closings, late starts and emergencies"))}
        </div>
        ${kids.length > 1 ? `<p class="section-label">${t("Which students")}</p><div>${kids.filter((k) => !k.graduated).map((k) => `<button class="follow-toggle" data-pushkid="${esc(k.id)}" aria-pressed="${!(p.mute || []).includes(k.id)}"><span class="box"></span><span><b>${esc(kidName(k))}</b><br><span class="muted">${esc(SCHOOLS[k.school].short)}</span></span></button>`).join("")}</div>` : ""}
        <div class="sheet-actions">
          ${p.on ? `<button class="btn primary block" data-action="push-save">${t("Save")}</button>
            <button class="btn block" data-action="push-test">${t("Send me tonight's message now")}</button>
            <button class="btn block" data-action="push-off">${t("Turn off notifications")}</button>`
          : `<button class="btn primary block" data-action="push-on">${t("Turn on notifications")}</button>`}
        </div>
        <p class="sheet-hint">${t("Messages use your students' names on this phone only. The server never has them.")}</p>`;
    }
    openSheet(t("Notifications"), body);
  }
  function readPushPrefs() {
    const p = { ...(pushPrefs || {}) };
    for (const b of $("sheetBody").querySelectorAll("[data-pushpref]")) p[b.dataset.pushpref] = b.getAttribute("aria-pressed") === "true";
    // Students this phone should not hear about.
    p.mute = [...$("sheetBody").querySelectorAll("[data-pushkid]")].filter((b) => b.getAttribute("aria-pressed") !== "true").map((b) => b.dataset.pushkid);
    return p;
  }
  async function pushSubscribe(prefs) {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast(t("Notifications were not allowed")); return false; }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlKey(PUSH_PUBLIC) }));
    let code = null;
    try { code = await ensureFamily(); } catch {}
    writeLocalNames();
    const res = await fetch(PUSH_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "subscribe", sub: sub.toJSON(), family: code, kids: code ? [] : familyKids(), prefs, lang }) });
    if (!res.ok) throw new Error("subscribe failed");
    pushPrefs = { ...prefs, on: true };
    store.set(PUSH_KEY, pushPrefs);
    return true;
  }
  async function pushAction(action) {
    try {
      if (action === "push-on" || action === "push-save") {
        if (await pushSubscribe(readPushPrefs())) { closeSheet(); toast(action === "push-on" ? t("Notifications are on") : t("Saved")); }
      } else if (action === "push-test") {
        const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
        if (!sub) return pushSubscribe(readPushPrefs());
        const res = await fetch(PUSH_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test", endpoint: sub.endpoint }) });
        toast(res.ok ? t("Sent. It should arrive in a moment.") : t("Couldn't send a test right now"));
      } else if (action === "push-off") {
        const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
        if (sub) {
          await fetch(PUSH_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "unsubscribe", endpoint: sub.endpoint }) }).catch(() => {});
          await sub.unsubscribe().catch(() => {});
        }
        pushPrefs = { ...(pushPrefs || {}), on: false };
        store.set(PUSH_KEY, pushPrefs);
        closeSheet();
        toast(t("Notifications are off"));
      }
    } catch { toast(t("Notifications aren't available right now")); }
  }

  function openRestore() {
    openSheet(t("Restore with a family code"), `
      <label class="field"><span class="field-label">${t("Family code")}</span>
        <input class="text-input code-input" id="restoreCode" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-2345"></label>
      <p class="field-hint">${t("It's under Students on a phone that's already set up.")}</p>
      <p class="alert-note" id="restoreError" hidden></p>
      <div class="sheet-actions"><button class="btn primary block" data-action="restore-go">${t("Restore")}</button></div>`);
    $("restoreCode").focus();
  }
  async function restoreFamily() {
    // Pasted from a text: spaces, a dash, "Family code: ABCD-2345" all work.
    const raw = ($("restoreCode").value || "").toUpperCase().replace(/FAMILY\s*CODE\s*:?/, "").replace(/C[OÓ]DIGO( FAMILIAR)?\s*:?/, "");
    const code = raw.replace(/[^A-Z0-9]/g, "");
    const err = (m) => { $("restoreError").textContent = m; $("restoreError").hidden = false; };
    if (code.length !== 8) return err(t("Family codes have 8 letters and numbers."));
    try {
      const j = await familyCall({ action: "load", code });
      family = { code, updatedAt: j.updatedAt };
      store.set(FAMILY_KEY, family);
      kids = [];
      mergeFamily(j.kids);
      if (kids[0]) { activeKidId = kids[0].id; store.set(KID_KEY, activeKidId); }
      closeSheet();
      render();
      toast(t("Restored")); // the Finish setting up card on Today says what's left
    } catch (e) { err(e.status === 404 ? t("That code wasn't found. Check it and try again.") : e.status === 429 ? t(BUSY_NETWORK) : t("Couldn't reach the server. Try again in a minute.")); }
  }

  /* ----- family code: same students on every phone ----- */

  // The server keeps school, class and teams per student under a family
  // code. Names, lunch lines and allergies never leave the phone; they ride
  // along only inside the setup link, in the #fragment browsers don't send.
  const FAMILY_API = "/.netlify/functions/family";
  // FAMILY_KEY is declared near the top, beside the other storage keys.
  let family = store.get(FAMILY_KEY, null); // { code, updatedAt }
  const familyKids = () => kids.map(({ id, school, classOf, follows }) => ({ id, school, classOf, follows: follows || [] }));
  // The server's per-address limit, reached when a crowd shares one network.
  const BUSY_NETWORK = "Lots of families are setting up on this network right now. Try again in a few minutes.";
  async function familyCall(body) {
    const res = await fetch(FAMILY_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(j.error || res.status), { status: res.status });
    return j;
  }
  async function ensureFamily() {
    if (family) return family.code;
    const j = await familyCall({ action: "create", kids: familyKids() });
    family = { code: j.code, updatedAt: j.updatedAt };
    store.set(FAMILY_KEY, family);
    return family.code;
  }
  let familyTimer = null;
  function queueFamilySave() {
    if (!family) return;
    clearTimeout(familyTimer);
    familyTimer = setTimeout(async () => {
      try {
        const j = await familyCall({ action: "save", code: family.code, kids: familyKids() });
        family.updatedAt = j.updatedAt;
        store.set(FAMILY_KEY, family);
      } catch (err) { if (err.status === 404) { family = null; store.del(FAMILY_KEY); } }
    }, 800);
  }
  // Another phone changed something: take its students and teams, keep this
  // phone's own names, lunch lines and allergies.
  function mergeFamily(remote, extras = {}) {
    const local = new Map(kids.map((k) => [k.id, k]));
    kids = remote.map((r) => {
      const l = local.get(r.id) || {};
      const x = extras[r.id] || {};
      // Names, lunch lines and allergies never travel through the server, so
      // a student restored by code (or added on another phone) arrives
      // without them: ask for them on Today until they're filled in.
      const needsDetails = l.id ? !!l.needsDetails : !extras[r.id];
      return { name: l.name ?? x.name ?? "", diet: l.diet ?? x.diet ?? "", allergies: l.allergies ?? x.allergies ?? [], ...r, ...(needsDetails ? { needsDetails: true } : {}) };
    });
    hydrateKids();
    store.set(KIDS_KEY, kids.map(({ grade, graduated, ...k }) => k));
    if (!kids.some((k) => k.id === activeKidId)) activeKidId = kids[0] ? kids[0].id : null;
  }
  async function pullFamily() {
    if (!family) return false;
    try {
      const j = await familyCall({ action: "load", code: family.code });
      if (j.updatedAt <= (family.updatedAt || 0)) return false;
      mergeFamily(j.kids);
      family.updatedAt = j.updatedAt;
      store.set(FAMILY_KEY, family);
      return true;
    } catch (err) {
      if (err.status === 404) { family = null; store.del(FAMILY_KEY); }
      return false;
    }
  }

  const b64 = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64 = (str) => JSON.parse(decodeURIComponent(escape(atob(str.replace(/-/g, "+").replace(/_/g, "/")))));

  async function shareSetup() {
    openSheet(t("Set up another parent's phone"), `<p class="loading">${t("Making a link")}</p>`);
    let code;
    try { code = await ensureFamily(); } catch (e) { $("sheetBody").innerHTML = e.status === 429 ? `<p class="alert-note">${t(BUSY_NETWORK)}</p>` : errorNote(t("a family link")); return; }
    if ($("sheet").hidden) return;
    const extras = Object.fromEntries(kids.map((k) => [k.id, { name: k.name, diet: k.diet, allergies: k.allergies }]));
    const url = `${location.origin}${location.pathname}#family=${code}&n=${b64(extras)}`;
    $("sheetBody").innerHTML = `
      <p>${t("Send this link to another parent, guardian or grandparent. It sets up {names} on their phone, and from then on both phones stay in step: add a team on one and it shows on the other.", { names: kids.map((k) => esc(kidName(k))).join(` ${t("and")} `) })}</p>
      <div class="sheet-actions">
        ${navigator.share ? `<button class="btn primary block" data-action="share-native" data-copy="${esc(url)}">${t("Share the link")}</button>` : ""}
        <button class="btn ${navigator.share ? "" : "primary"} block" data-action="copy" data-copy="${esc(url)}">${t("Copy the link")}</button>
      </div>
      <p class="sheet-hint">${t("Family code {code}. The server keeps only each student's school, class year and teams. Names, lunch lines and allergies stay on the phones.", { code: `${esc(code.slice(0, 4))}-${esc(code.slice(4))}` })}</p>`;
  }

  async function readSetupLink() {
    const fam = location.hash.match(/^#family=([A-Z0-9]{8})(?:&n=([A-Za-z0-9_-]+))?$/);
    const legacy = location.hash.match(/^#setup=([A-Za-z0-9_-]+)$/);
    if (!fam && !legacy) return;
    history.replaceState({ tab }, "", `${location.pathname}#${tab}`);
    if (fam) {
      let j;
      try { j = await familyCall({ action: "load", code: fam[1] }); } catch { toast(t("That family link has expired")); return; }
      let extras = {};
      try { extras = fam[2] ? unb64(fam[2]) : {}; } catch {}
      pendingSetup = { family: { code: fam[1], updatedAt: j.updatedAt }, kids: j.kids, extras };
      const td = todayYmd();
      openSheet(t("Join this family?"), `
        <div>${j.kids.map((k) => { const g = SH.gradeOf(k.classOf, td); const n = (extras[k.id] || {}).name; return `<div class="student-row"><span class="who"><span class="dot" style="background:${SCHOOLS[k.school].brand.primary}"></span><span><b>${esc(n || t("Student"))}</b><br><span class="muted">${esc(SCHOOLS[k.school].short)}, ${g > 12 ? t("graduated") : gradeName(g)}</span></span></span></div>`; }).join("")}</div>
        <p class="muted">${kids.length ? `${t("These replace the students on this phone.")} ` : ""}${t("Changes on either phone will show on both.")}</p>
        <div class="sheet-actions"><button class="btn primary block" data-action="accept-setup">${t("Set up this phone")}</button></div>`);
      return;
    }
    let incoming;
    try {
      const t = todayYmd();
      incoming = unb64(legacy[1]).filter((k) => k && SCHOOLS[k.school] && (Number.isInteger(k.classOf) || GUIDE[k.grade])).slice(0, 8).map((k) => ({
        id: `k${Math.random().toString(36).slice(2, 9)}`,
        name: String(k.name || "").slice(0, 24), school: k.school,
        classOf: Number.isInteger(k.classOf) ? k.classOf : SH.classFor(Number(k.grade), t),
        diet: DIETS.some((d) => d.id === k.diet) ? k.diet : "",
        allergies: Array.isArray(k.allergies) ? k.allergies.filter((a) => ALLERGENS.includes(a)) : [],
        follows: Array.isArray(k.follows) ? k.follows.slice(0, 40).map((f) => ({ act: String(f.act || "").slice(0, 60), level: String(f.level || "").slice(0, 40) })) : [],
      }));
    } catch { return; }
    pendingSetup = { kids: incoming };
    openSheet(t("Add these students?"), `
      <div>${incoming.map((k) => `<div class="student-row"><span class="who"><span class="dot" style="background:${SCHOOLS[k.school].brand.primary}"></span><span><b>${esc(k.name || t("Student"))}</b></span></span></div>`).join("")}</div>
      <div class="sheet-actions"><button class="btn primary block" data-action="accept-setup">${incoming.length === 1 ? t("Add student") : t("Add {n} students", { n: incoming.length })}</button></div>`);
  }
  let pendingSetup = null;

  let draft = null;
  function openEditor(kid) {
    draft = kid ? { ...kid, follows: [...(kid.follows || [])], allergies: [...(kid.allergies || [])] } : { id: `k${Date.now().toString(36)}`, name: "", school: "", grade: null, diet: "", follows: [], allergies: [], isNew: true };
    renderEditor();
  }
  function renderEditor() {
    const d = draft;
    const choice = (attr, val, label, extra = "") => `<button class="choice" data-${attr}="${esc(val)}" aria-pressed="${String(d[attr]) === String(val)}">${extra}${esc(label)}</button>`;
    openSheet(d.isNew ? t("Add a student") : t("Edit {name}", { name: kidName(kids.find((k) => k.id === d.id) || d) }), `
      <label class="field"><span class="field-label">${t("First name or nickname")}</span>
        <input class="text-input" id="kidName" maxlength="24" autocomplete="off" value="${esc(d.name)}" placeholder="${t("Optional")}"></label>
      <div class="field"><span class="field-label">${t("Grade this year")}</span>
        <div class="choice-grid grades">${ALL_GRADES.map((g) => choice("grade", g, gradeShort(g))).join("")}</div></div>
      <div class="field" id="schoolField">${schoolFieldHtml(d)}</div>
      ${DIETS.length > 1 ? `<div class="field"><span class="field-label">${t("Lunch line")}</span>
        <span class="field-hint">${t("Schools serve a separate line for these needs.")}</span>
        <div class="choice-grid">${DIETS.map((x) => choice("diet", x.id, t(x.label))).join("")}</div></div>` : ""}
      <details class="fold" ${d.allergies.length ? "open" : ""}><summary>${t("Food allergies to flag")}${d.allergies.length ? ` (${d.allergies.length})` : ""}</summary>
        <p class="field-hint">${t("Menu items that contain these are marked for {name}.", { name: esc(d.name || t("this student")) })}</p>
        <div class="choice-grid allergy-grid">${ALLERGENS.map((a) => `<button class="choice" data-allergy="${esc(a)}" aria-pressed="${d.allergies.includes(a)}">${esc(t(a))}</button>`).join("")}</div>
      </details>
      <div class="sheet-actions">
        <button class="btn primary block" data-action="save-kid" ${d.school && d.grade !== null ? "" : "disabled"}>${d.isNew ? t("Save student") : t("Save changes")}</button>
        ${d.isNew ? "" : `<button class="btn block" data-action="follow" data-kid="${esc(d.id)}">${t("Teams and activities ({n})", { n: (d.follows || []).length })}</button>
        <button class="btn block" data-action="remove-kid" data-kid="${esc(d.id)}">${t("Remove student")}</button>`}
      </div>`);
  }
  // Grades and levels come from the district file: the grade decides the
  // level, and a level with a single building picks itself.
  const ALL_GRADES = [...new Set(Object.values(SCHOOLS).flatMap((x) => { const out = []; for (let g = x.grades[0]; g <= x.grades[1]; g++) out.push(g); return out; }))].sort((a, b) => a - b);
  const levelForGrade = (g) => (g === null || g === undefined ? null : (Object.values(SCHOOLS).find((x) => g >= x.grades[0] && g <= x.grades[1]) || {}).level || null);
  const LEVEL_WORD = { es: "Elementary school", is: "Intermediate school", ms: "Middle school", hs: "High school" };
  function schoolFieldHtml(d) {
    const level = levelForGrade(d.grade);
    if (!level) return `<span class="field-label">${t("School")}</span><p class="field-hint">${t("Pick a grade first.")}</p>`;
    const list = Object.values(SCHOOLS).filter((s) => s.level === level).sort((a, b) => a.short.localeCompare(b.short));
    if (list.length === 1 && d.school !== list[0].id) d.school = list[0].id;
    const choice = (s) => `<button class="choice" data-school="${esc(s.id)}" data-name="${esc(`${s.name} ${s.short}`.toLowerCase())}" aria-pressed="${d.school === s.id}"><span class="dot" style="background:${s.brand.primary}"></span>${esc(s.short)}</button>`;
    return `<span class="field-label">${t(LEVEL_WORD[level] || "School")}</span>
      ${list.length > 8 ? `<input class="text-input school-filter" id="schoolFilter" type="search" placeholder="${t("Type to find the school")}" autocomplete="off" aria-label="${t("Find the school")}">` : ""}
      <div class="choice-grid${list.length > 8 ? " school-list" : ""}">${list.map(choice).join("")}</div>
      ${level === "es" && list.length > 1 ? `<p class="field-hint">${t("Not sure which school? It comes from your home address; the district office can tell you.")}</p>` : ""}`;
  }
  // Choices update in place so the sheet never jumps while filling it in.
  function syncEditor() {
    for (const b of $("sheetBody").querySelectorAll(".choice")) {
      if (b.dataset.allergy !== undefined) { b.setAttribute("aria-pressed", String(draft.allergies.includes(b.dataset.allergy))); continue; }
      const attr = ["school", "grade", "diet"].find((a) => b.dataset[a] !== undefined);
      b.setAttribute("aria-pressed", String(String(draft[attr]) === b.dataset[attr]));
    }
    const save = $("sheetBody").querySelector('[data-action="save-kid"]');
    if (save) save.disabled = !(draft.school && draft.grade !== null);
  }
  function saveDraft() {
    const d = draft;
    if (!d || !d.school || d.grade === null || d.grade === undefined) return;
    d.name = ($("kidName")?.value || d.name || "").trim().slice(0, 24);
    const { isNew, ...kid } = d;
    delete kid.needsDetails; // saving the editor fills in the details
    kid.classOf = SH.classFor(kid.grade, todayYmd());
    kid.graduated = false;
    if (isNew) kid.addedAt = todayYmd();
    const i = kids.findIndex((k) => k.id === kid.id);
    if (i >= 0) {
      // Teams belong to a school; switching schools clears them.
      if (kids[i].school !== kid.school) kid.follows = [];
      kids[i] = kid;
    } else kids.push(kid);
    activeKidId = kid.id;
    store.set(KID_KEY, activeKidId);
    saveKids();
    draft = null;
    if (!isNew) closeSheet();
    render();
    if (isNew) openFollow(kid.id, true);
  }

  function removeKid(id) {
    const i = kids.findIndex((k) => k.id === id);
    if (i < 0) return;
    const [gone] = kids.splice(i, 1);
    saveKids();
    if (activeKidId === id) { activeKidId = kids[0]?.id || null; store.set(KID_KEY, activeKidId); }
    closeSheet();
    render();
    toast(t("{name} removed", { name: kidName(gone) }), () => {
      kids.splice(i, 0, gone);
      saveKids();
      render();
    });
  }

  /* ----- follow teams ----- */

  let followDraft = null;
  async function openFollow(kidId, afterAdd = false) {
    const kid = kids.find((k) => k.id === kidId);
    if (!kid) return;
    followDraft = { kidId, follows: [...(kid.follows || [])], afterAdd };
    openSheet(t("{name}'s teams and activities", { name: kidName(kid) }), `<p class="loading">${t("Loading {school} activities", { school: esc(SCHOOLS[kid.school].short) })}</p>`);
    let acts;
    try { acts = await getActivities(kid.school); }
    catch { $("sheetBody").innerHTML = errorNote(t("activities")); return; }
    if (!followDraft || followDraft.kidId !== kidId || $("sheet").hidden) return;
    followDraft.acts = acts;
    renderFollow();
  }
  // Boys and girls teams of the same sport show as one row ("Soccer") with
  // a Boys / Girls choice, the way levels work. What's saved is still the
  // exact team ("Boys Soccer"), so family codes, calendar feeds and alerts
  // are unchanged.
  const sportOf = (act) => act.replace(/^(Boys|Girls)\s+/, "").replace(/\s*\((Fall|Spring|Winter)\)$/i, "");
  const genderOf = (act) => { const m = /^(Boys|Girls)\s+.*?(?:\((Fall|Spring|Winter)\))?$/i.exec(act); return m ? { g: m[1], season: m[2] || "" } : null; };
  function followGroups(acts) {
    const by = new Map();
    for (const a of acts) { const k = genderOf(a.act) ? sportOf(a.act) : a.act; if (!by.has(k)) by.set(k, []); by.get(k).push(a); }
    return [...by.entries()].map(([sport, members]) => ({ sport: members.length > 1 ? sport : members[0].act, members })).sort((a, b) => a.sport.localeCompare(b.sport));
  }
  function renderFollow() {
    const fd = followDraft;
    const kid = kids.find((k) => k.id === fd.kidId);
    fd.open = fd.open || new Set();
    const levelChips = (a, label) => {
      const f = fd.follows.find((x) => x.act === a.act);
      const levels = a.levels.filter((l) => !/^(High School|HS )/.test(l));
      if (!f || levels.length < 2) return "";
      return `<div class="level-chips">${label ? `<span class="chip-label">${esc(label)}</span>` : ""}${["", ...levels].map((l) => `<button class="level-chip" data-follow-level="${esc(l)}" data-follow-act="${esc(a.act)}" aria-pressed="${(f.level || "") === l}">${esc(tt(l) || t("All levels"))}</button>`).join("")}</div>`;
    };
    const rows = followGroups(fd.acts).map((grp) => {
      if (grp.members.length === 1) {
        const a = grp.members[0];
        const on = fd.follows.some((x) => x.act === a.act);
        return `<div class="follow-row"><button class="follow-toggle" data-follow="${esc(a.act)}" aria-pressed="${on}"><span class="box"></span>${esc(tt(a.act))}</button>${levelChips(a)}</div>`;
      }
      const picked = grp.members.filter((a) => fd.follows.some((x) => x.act === a.act));
      const open = picked.length > 0 || fd.open.has(grp.sport);
      const word = (a) => { const g = genderOf(a.act); return g.season ? t(`${g.g}, ${g.season.toLowerCase()}`) : t(g.g); };
      return `<div class="follow-row">
        <button class="follow-toggle" data-follow-sport="${esc(grp.sport)}" aria-pressed="${picked.length > 0}" aria-expanded="${open}"><span class="box"></span>${esc(tt(grp.sport))}</button>
        ${open ? `<div class="level-chips">${picked.length ? "" : `<span class="chip-label">${t("Boys or girls?")}</span>`}${grp.members.map((a) => `<button class="level-chip" data-follow-team="${esc(a.act)}" aria-pressed="${picked.includes(a)}">${esc(word(a))}</button>`).join("")}</div>` : ""}
        ${picked.map((a) => levelChips(a, picked.length > 1 ? word(a) : "")).join("")}
      </div>`;
    }).join("");
    $("sheetTitle").textContent = t("{name}'s teams and activities", { name: kidName(kid) });
    $("sheetBody").innerHTML = `
      <p class="muted">${t("Pick what {name} is in. Their games, meets and performances show up on Today and in the calendar.", { name: esc(kidName(kid)) })}</p>
      <div>${rows || `<p class="empty-note">${t("No activities are scheduled yet.")}</p>`}</div>
      <div class="sheet-actions" style="position:sticky;bottom:0;background:var(--surface);padding-top:8px">
        <button class="btn primary block" data-action="save-follow">${fd.follows.length ? t(fd.follows.length === 1 ? "Save {n} activity" : "Save {n} activities", { n: fd.follows.length }) : fd.afterAdd ? t("Skip for now") : t("Save")}</button>
      </div>`;
  }
  function saveFollow() {
    const fd = followDraft;
    const kid = kids.find((k) => k.id === fd.kidId);
    if (kid) { kid.follows = fd.follows; saveKids(); confirmActs(kid.id); }
    followDraft = null;
    closeSheet();
    render();
    // Right after adding a student is when parents decide whether this app
    // will reach them. Offer the two things that bring them back.
    if (fd.afterAdd && kid) setTimeout(() => openStayInLoop(kid), 250);
  }

  // "Stay in the loop": the 7 PM heads-up and the calendar subscription, one
  // tap each, offered once per new student and never again if declined.
  function openStayInLoop(kid) {
    const pushOn = !!(pushPrefs && pushPrefs.on);
    const canPush = pushSupported();
    const teams = (kid.follows || []).length;
    if (pushOn && !teams) return;
    const rows = [];
    if (!pushOn) {
      rows.push(canPush
        ? `<li><b>${t("A heads-up at 7 PM")}</b><span>${t("The night before: no school, late starts, {name}'s games and what's for lunch. Game changes and school closings as they happen.", { name: esc(kidName(kid)) })}</span><button class="btn primary block" data-action="push-quick">${t("Turn on the 7 PM heads-up")}</button></li>`
        : isIOS && !isStandalone
          ? `<li><b>${t("A heads-up at 7 PM")}</b><span>${t("On iPhone, notifications work once the app is on your home screen. Tap Share, then Add to Home Screen, then open it from there and come back here.")}</span></li>`
          : "");
    }
    if (teams) rows.push(`<li><b>${t("{name}'s games on your phone's calendar", { name: esc(kidName(kid)) })}</b><span>${t("New games and changed times update on their own.")}</span><button class="btn block" data-action="subscribe" data-kid="${esc(kid.id)}">${t("Add to my calendar")}</button></li>`);
    if (!rows.filter(Boolean).length) return;
    openSheet(t("Stay in the loop"), `<ol class="steps">${rows.filter(Boolean).join("")}</ol>
      <div class="sheet-actions"><button class="btn block" data-action="close-sheet">${t("Not now")}</button></div>
      <p class="fine">${t("You can change these any time under Students.")}</p>`);
  }

  /* ---------------- what's new ---------------- */

  // One card per change, dated. A parent sees only the cards newer than
  // the last walkthrough they finished; "Show me" jumps to the feature.
  const WN_KEY = "sfp-whatsnew";
  const WHATS_NEW = [
    { since: "2026-10-10", go: "today", h: "A new look, same app", p: "Today shows each child's day at a glance: hours, lunch, games and anything that changed. Lunch, Calendar, Guide and School each have their own tab." },
    { since: "2026-10-10", go: "students", h: "Names, if you want them", p: "Give each child a first name or nickname under Students. It stays on this phone and never reaches a server." },
    { since: "2026-10-10", go: "guide", h: "A guide for every grade", p: "What to do this year, dates that matter, and what the district's handbooks say, from junior kindergarten to senior year." },
    { since: "2026-10-10", go: "search", h: "Ask a question", p: "Type it the way you'd ask a person: when is the next game, what's for lunch Thursday, can my child bring medicine. The answer comes from what's in the app." },
    { since: "2026-10-10", go: "lang", h: "En español", p: "Toca Español en Students para ver la aplicación en español." },
  ];
  const wnSeen = () => store.get(WN_KEY, migrated ? "2000-01-01" : "");
  const wnDue = () => WHATS_NEW.filter((c) => c.since > (wnSeen() || "9999"));
  function openWhatsNew(step = 0) {
    const cards = wnDue().length ? wnDue() : WHATS_NEW;
    store.set(WN_KEY, todayYmd());
    const c = cards[step];
    if (!c) return closeSheet();
    const last = step === cards.length - 1;
    openSheet(t("What's new"), `<div class="tour">${cards.length > 1 ? `<p class="section-label">${step + 1} ${t("of")} ${cards.length}</p>` : ""}
      <h2 class="view-title" style="margin-top:4px">${esc(t(c.h))}</h2><p style="line-height:1.55">${esc(t(c.p))}</p></div>
      <div class="sheet-actions">
        <button class="btn block" data-action="wn-go" data-go="${esc(c.go)}">${t("Show me")}</button>
        <button class="btn primary block" data-action="${last ? "close-sheet" : "wn-next"}" data-step="${step}">${last ? t("Done") : t("Next")}</button>
      </div>`);
  }
  function whatsNewGo(go) {
    if (go === "students") return openStudents();
    if (go === "search") return openSearch();
    if (go === "lang") return openStudents();
    if (TABS.includes(go)) { cameFrom = tab; goTab(go); }
  }

  /* ---------------- toast with undo ---------------- */

  let toastTimer = null;
  let toastUndo = null;
  function toast(text, undo) {
    $("toastText").textContent = text;
    $("toastUndo").hidden = !undo;
    toastUndo = undo || null;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $("toast").hidden = true; toastUndo = null; }, 6000);
  }
  $("toastUndo").addEventListener("click", () => {
    const u = toastUndo;
    $("toast").hidden = true;
    toastUndo = null;
    if (u) u();
  });

  /* ---------------- events ---------------- */

  document.addEventListener("click", (e) => {
    const el = e.target.closest("button, a");
    if (!el) return;
    const ds = el.dataset;
    // Anything tapped inside a student's card on Today is about that student.
    const ownCard = el.closest(".kid-sum[data-kidcard]");
    if (ownCard && ownCard.dataset.kidcard !== activeKidId && (ds.action || ds.page)) { activeKidId = ownCard.dataset.kidcard; store.set(KID_KEY, activeKidId); }
    if (ds.tab) { if (!el.closest(".tab-bar")) cameFrom = tab; goTab(ds.tab); return; }
    if (ds.kid && el.classList.contains("kid-chip")) { activeKidId = ds.kid; store.set(KID_KEY, activeKidId); renderCalendar.scrolled = false; render(); return; }
    if (ds.goto) {
      if (ds.filter) { calFilter = ds.filter; calMode = "mine"; }
      const card = el.closest("[data-kidcard]");
      if (card) { activeKidId = card.dataset.kidcard; store.set(KID_KEY, activeKidId); }
      if (!$("sheet").hidden) closeSheet();
      if (ds.goto !== tab) cameFrom = tab;
      goTab(ds.goto);
      return;
    }
    if (ds.ev) {
      // On Today, the card the row sits in says which student it's for.
      const card = el.closest("[data-kidcard]");
      const kid = card ? kids.find((k) => k.id === card.dataset.kidcard) : activeKid();
      openEvent(ds.ev, ds.school || kid.school);
      return;
    }
    if (ds.sched !== undefined) { schedIndex = Number(ds.sched); schedPicked = true; render(); return; }
    if (ds.page) { if (el.tagName === "A") e.preventDefault(); openPage(ds.page); return; }
    if (ds.news) { openNews(ds.news, ds.newsSchool); return; }
    if (ds.menu) { openMenu(ds.menu); return; }
    if (ds.post) { openPost(ds.post); return; }
    if (ds.askgo) { askGo(ds.askgo); return; }
    if (ds.hit !== undefined) { const h = searchHits[Number(ds.hit)]; if (h) openHit(h); return; }
    if (ds.doc) { openDoc(ds.doc); return; }
    if (ds.calfilter) { calFilter = ds.calfilter; render(); return; }
    if (ds.calmode) { calMode = ds.calmode; store.set(CAL_MODE_KEY, calMode); render(); return; }
    if (ds.month) { calMonth = ds.month === "0" ? monthKey(todayYmd()) : addMonths(calMonth, Number(ds.month)); renderCalendar.scrolled = ds.month !== "0"; render(); return; }
    if (ds.week) { const t = todayYmd(); lunchWeek = ds.week === "0" ? mondayOf(isWeekend(t) ? addDays(t, 2) : t) : addDays(lunchWeek, 7 * Number(ds.week)); render(); return; }
    if (draft && el.classList.contains("choice")) {
      if (ds.allergy !== undefined) {
        const i = draft.allergies.indexOf(ds.allergy);
        if (i >= 0) draft.allergies.splice(i, 1); else draft.allergies.push(ds.allergy);
      }
      if (ds.school !== undefined) draft.school = ds.school;
      if (ds.grade !== undefined) {
        const before = levelForGrade(draft.grade);
        draft.grade = Number(ds.grade);
        // A different level means a different list of schools.
        if (levelForGrade(draft.grade) !== before) {
          if (draft.school && SCHOOLS[draft.school].level !== levelForGrade(draft.grade)) draft.school = "";
          $("schoolField").innerHTML = schoolFieldHtml(draft); // may pick a lone school
        }
      }
      if (ds.diet !== undefined) draft.diet = ds.diet;
      syncEditor();
      return;
    }
    if (ds.pushkid) { el.setAttribute("aria-pressed", String(el.getAttribute("aria-pressed") !== "true")); return; }
    if (ds.pushpref) { el.setAttribute("aria-pressed", String(el.getAttribute("aria-pressed") !== "true")); return; }
    if (ds.follow !== undefined && followDraft) {
      const i = followDraft.follows.findIndex((f) => f.act === ds.follow);
      if (i >= 0) followDraft.follows.splice(i, 1); else followDraft.follows.push({ act: ds.follow, level: "" });
      renderFollow();
      return;
    }
    if (ds.followSport !== undefined && followDraft) {
      // A two-team sport: open the Boys / Girls choice, or clear it.
      const grp = followGroups(followDraft.acts).find((x) => x.sport === ds.followSport);
      const any = grp && grp.members.some((a) => followDraft.follows.some((f) => f.act === a.act));
      followDraft.open = followDraft.open || new Set();
      if (any || followDraft.open.has(ds.followSport)) {
        followDraft.follows = followDraft.follows.filter((f) => !grp.members.some((a) => a.act === f.act));
        followDraft.open.delete(ds.followSport);
      } else followDraft.open.add(ds.followSport);
      renderFollow();
      return;
    }
    if (ds.followTeam !== undefined && followDraft) {
      const i = followDraft.follows.findIndex((f) => f.act === ds.followTeam);
      if (i >= 0) followDraft.follows.splice(i, 1); else followDraft.follows.push({ act: ds.followTeam, level: "" });
      renderFollow();
      return;
    }
    if (ds.followLevel !== undefined && followDraft) {
      const f = followDraft.follows.find((x) => x.act === ds.followAct);
      if (f) f.level = ds.followLevel;
      renderFollow();
      return;
    }
    if (demo && /^(subscribe|push-quick|push-on|notifications|share-setup|add-kid)$/.test(ds.action || "")) {
      if (ds.action === "add-kid") { demo = false; store.del(DEMO_KEY); kids = store.get(KIDS_KEY, []) || []; hydrateKids(); render(); openEditor(null); return; }
      toast(t("Add your own student to turn this on")); return;
    }
    switch (ds.action) {
      case "add-kid": openEditor(null); break;
      case "edit-kid": openEditor(kids.find((k) => k.id === ds.kid)); break;
      case "save-kid": saveDraft(); break;
      case "remove-kid": removeKid(ds.kid); break;
      case "follow": {
        if (draft && !draft.isNew) { draft.name = $("kidName")?.value ?? draft.name; }
        draft = null;
        openFollow(ds.kid);
        break;
      }
      case "save-follow": saveFollow(); break;
      case "acts-ok": confirmActs(ds.kid); render(); break;
      case "absence": openAbsence(); break;
      case "forms": openForms(); break;
      case "new-family": openNewFamily(); break;
      case "restore": openRestore(); break;
      case "restore-go": restoreFamily(); break;
      case "supplies-sheet": openSupplies(ds.kid ? kids.find((k) => k.id === ds.kid) : activeKid()); break;
      case "supplies-grade": { const k = { ...activeKid(), grade: Number(ds.grade) }; openSupplies(k); break; }
      case "handbook": openHandbook(ds.which, ds.section); break;
      case "whats-new": openWhatsNew(); break;
      case "wn-next": openWhatsNew(Number(ds.step) + 1); break;
      case "wn-go": closeSheet(); setTimeout(() => whatsNewGo(ds.go), 320); break;
      case "all-posts": openAllPosts(); break;
      case "log-absence": logAbsence(ds.day, true); break;
      case "share-week": shareWeek(); break;
      case "season-hide": { const all = store.get(SEASON_KEY, {}); all[ds.season] = "hidden"; store.set(SEASON_KEY, all); el.closest(".season-card")?.remove(); break; }
      case "season-supplies": openSupplies(activeKid()); break;
      case "season-handbook": openHandbook(); break;
      case "season-news": goTab("school"); break;
      case "season-counselors": openCounselors(); break;
      case "season-test-schedule": { const k = activeKid(); const sc = ((HANDBOOKS[k.school] || {}).schedules || []).find((x) => /test/i.test(x.name)); if (sc) { schedHint[k.school] = sc.name; schedPicked = false; } goTab("school"); break; }
      case "unlog-absence": logAbsence(ds.day, false); break;
      case "report": { let ctx = {}; try { ctx = JSON.parse(ds.ctx || "{}"); } catch {} openReport(ctx); break; }
      case "send-report": sendReport(); break;
      case "counselors": openCounselors(); break;
      case "back-tab": goTab(cameFrom || "today"); break;
      case "share-setup": shareSetup(); break;
      case "notifications": openNotifications(); break;
      case "push-on": case "push-save": case "push-test": case "push-off": pushAction(ds.action); break;
      case "push-quick": pushSubscribe({ on: true, evening: true, changes: true, alerts: true }).then((ok) => { if (ok) { closeSheet(); toast(t("Notifications are on")); } }).catch(() => toast(t("Couldn't turn on notifications right now"))); break;
      case "close-sheet": closeSheet(); break;
      case "share-native": navigator.share({ title: APP_NAME, url: ds.copy }).catch(() => {}); break;
      case "accept-setup": {
        const p = pendingSetup;
        pendingSetup = null;
        if (p && p.family) {
          family = p.family;
          store.set(FAMILY_KEY, family);
          kids = [];
          mergeFamily(p.kids, p.extras);
        } else if (p) {
          kids.push(...p.kids);
          hydrateKids();
          saveKids();
        }
        if (kids[0]) { activeKidId = kids[0].id; store.set(KID_KEY, activeKidId); }
        closeSheet(); render(); toast(t("This phone is set up"));
        break;
      }
      case "staff": openStaff(); break;
      case "clubs": openClubs(); break;
      case "subscribe": openSubscribe(kids.find((k) => k.id === ds.kid)); break;
      case "copy": {
        const done = () => toast(t("Link copied"));
        if (navigator.clipboard) navigator.clipboard.writeText(ds.copy).then(done, () => prompt(t("Copy this link"), ds.copy));
        else prompt(t("Copy this link"), ds.copy);
        break;
      }
      case "absence-pick": pickKid(t("Who is absent?"), (k) => { activeKidId = k.id; store.set(KID_KEY, k.id); openAbsence(); }); break;
      case "call-pick": {
        const schools = [...new Set(activeKids().map((k) => k.school))];
        openSheet(t("Call the school"), `<div class="sheet-actions">${schools.map((sc) => `<a class="btn primary block" href="tel:+1${SCHOOLS[sc].phone.replace(/\D/g, "")}">${t("Call {school}", { school: esc(SCHOOLS[sc].short) })}: ${esc(SCHOOLS[sc].phone)}</a>`).join("")}</div>`);
        break;
      }
      case "pick-kid": { const k = kids.find((x) => x.id === ds.kid); const fn = pickKidThen; pickKidThen = null; if (k && fn) fn(k); break; }
      case "search": openSearch(); break;
      case "ask": sendAsk(); break;
      case "ask-try": if ($("searchInput")) { $("searchInput").value = ds.q; $("askStart").hidden = true; sendAsk(); } break;
      case "demo": demo = true; store.set(DEMO_KEY, true); kids = demoKids(); hydrateKids(); activeKidId = kids[0].id; render(); window.scrollTo(0, 0); break;
      case "demo-exit": case "demo-own": demo = false; store.del(DEMO_KEY); kids = store.get(KIDS_KEY, []) || []; hydrateKids(); activeKidId = kids[0] ? kids[0].id : null; goTab("today"); render(); if (ds.action === "demo-own") openEditor(null); break;
      case "pin-done": store.set(PIN_KEY, ds.pin); renderAlerts(); break;
      case "welcome-done": { const w = store.get(WELCOME_KEY, {}); w[ds.kid] = 1; store.set(WELCOME_KEY, w); el.closest(".first-week")?.remove(); break; }
      case "lang": {
        lang = lang === "es" ? "en" : "es";
        store.set("sfp-lang", lang);
        document.documentElement.lang = lang;
        searchIndex = null; // search results were built in the other language
        searchWarming = null;
        weatherCache = null; // its Spanish comes with the answer
        if (installKey) $("installText").textContent = t(installKey);
        closeSheet();
        render();
        break;
      }
    }
  });
  $("studentsBtn").addEventListener("click", openStudents);
  $("searchBtn").addEventListener("click", openSearch);

  document.addEventListener("change", (e) => {
    const sc = e.target.dataset?.seasonCheck;
    if (sc) {
      const [sid, iid] = sc.split("|");
      const all = store.get(SEASON_KEY, {});
      all[sid] = { ...(typeof all[sid] === "object" ? all[sid] : {}), [iid]: e.target.checked };
      store.set(SEASON_KEY, all);
      e.target.closest(".check").classList.toggle("done", e.target.checked);
      return;
    }
    const id = e.target.dataset?.check;
    if (!id) return;
    const kid = activeKid();
    const all = store.get(CHECKS_KEY, {});
    all[kid.id] = { ...(all[kid.id] || {}), [id]: e.target.checked };
    store.set(CHECKS_KEY, all);
    e.target.closest(".check").classList.toggle("done", e.target.checked);
  });

  /* ---------------- install banner ---------------- */

  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let deferredInstall = null;
  let installKey = ""; // English text of the banner, re-translated on a language switch
  const dismissInstall = () => { $("installBanner").hidden = true; store.set(INSTALL_KEY, "done"); };
  $("installClose").addEventListener("click", dismissInstall);
  $("installBtn").addEventListener("click", async () => {
    if (!deferredInstall) return;
    const p = deferredInstall; deferredInstall = null;
    p.prompt();
    await p.userChoice.catch(() => {});
    dismissInstall();
  });
  window.addEventListener("appinstalled", dismissInstall);
  if (!isStandalone && store.get(INSTALL_KEY, "") !== "done" && kids.length) {
    if (isIOS) {
      installKey = "Add to your home screen: tap Share, then Add to Home Screen.";
      $("installText").textContent = t(installKey);
      $("installBanner").hidden = false;
    } else {
      window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredInstall = e;
        installKey = "Keep this on your home screen.";
        $("installText").textContent = t(installKey);
        $("installBtn").hidden = false;
        $("installBanner").hidden = false;
      });
    }
  }

  /* ---------------- freshness ---------------- */

  // Re-render when the app comes back into view, and every 5 minutes while
  // it stays open, so a phone left on the counter never shows yesterday.
  let lastDay = todayYmd();
  function refreshIfVisible() {
    if (document.visibilityState !== "visible") return;
    if (sheetOpenedAt && Date.now() - sheetOpenedAt > 5 * 60 * 1000) closeSheet();
    if (!$("sheet").hidden) return;
    const t = todayYmd();
    if (t !== lastDay) { lastDay = t; lunchWeek = null; calMonth = null; hydrateKids(); }
    pullFamily().finally(render);
    navigator.serviceWorker?.getRegistration().then((r) => r && r.update()).catch(() => {});
  }
  document.addEventListener("visibilitychange", refreshIfVisible);
  window.addEventListener("offline", render);
  window.addEventListener("online", refreshIfVisible);
  setInterval(refreshIfVisible, 5 * 60 * 1000);

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    // Reload only when a NEW version replaces an old one. On a first visit
    // there was no old version, and reloading would wipe whatever the parent
    // was in the middle of (it reset student setup).
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded || !hadController) return;
      // Don't yank a sheet out from under someone mid-task; wait until it closes.
      if (!$("sheet").hidden) { pendingReload = true; return; }
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  /* ---------------- tabs and the back button ---------------- */

  const TABS = ["today", "lunch", "calendar", "guide", "school"];
  // The tab a parent left by tapping a shortcut (not the tab bar), for the Back to link.
  let cameFrom = null;
  function backBarHtml() {
    if (!cameFrom || cameFrom === tab || !kids.length) return "";
    const name = { today: "Today", lunch: "Lunch", calendar: "Calendar", guide: "Guide", school: "School" }[cameFrom];
    return `<button class="back-link" data-action="back-tab"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>${t("Back to {tab}", { tab: t(name) })}</button>`;
  }
  function goTab(t, fromHistory) {
    if (!TABS.includes(t)) t = "today";
    const changed = t !== tab;
    // Shortcut taps set cameFrom to the tab being left just before calling here; anything else clears it.
    if (changed && (fromHistory || cameFrom !== tab)) cameFrom = null;
    tab = t;
    store.set(TAB_KEY, tab);
    if (!fromHistory && changed) {
      if (history.state && history.state.spent) history.replaceState({ tab }, "", `#${tab}`);
      else history.pushState({ tab }, "", `#${tab}`);
    }
    renderCalendar.scrolled = false;
    window.scrollTo(0, 0);
    render();
  }
  window.addEventListener("popstate", (e) => {
    if (!$("sheet").hidden) { if (sheetStack.length) sheetBack(true); else closeSheet(true); return; }
    // Entries left by nested sheets that were closed all at once: step past them.
    if (e.state && e.state.sheet && e.state.depth) { history.back(); return; }
    if (e.state && e.state.sheet) { history.replaceState({ tab: e.state.tab, spent: 1 }, ""); }
    const t = (e.state && e.state.tab) || location.hash.slice(1) || "today";
    if (t !== tab) goTab(t, true);
  });

  writeLocalNames();
  setTimeout(pingUsage, 3000);
  if (kids.length) setTimeout(keepData, 4000);
  const setupHash = /^#(setup|family)=/.test(location.hash);
  const hashTab = setupHash ? "" : location.hash.slice(1);
  if (TABS.includes(hashTab)) tab = hashTab;
  if (!TABS.includes(tab)) tab = "today";
  if (setupHash) setTimeout(readSetupLink, 0);
  else {
    history.replaceState({ tab }, "", `#${tab}`);
    setTimeout(() => pullFamily().then((changed) => changed && render()), 0);
  }
  // Words never split at a hyphen ("2026-" / "27", "half-" / "periods"):
  // every hyphen between letters or digits on screen becomes a no-break
  // hyphen. Text only; links, phone numbers in tel: and inputs are untouched.
  const HYPHEN = /([\p{L}\p{N}])-(?=[\p{L}\p{N}])/gu;
  const fixText = (n) => { if (n.nodeValue.includes("-") && !(n.parentElement && n.parentElement.closest("script, style, textarea"))) { const v = n.nodeValue.replace(HYPHEN, "$1\u2011"); if (v !== n.nodeValue) n.nodeValue = v; } };
  const fixTree = (root) => { if (root.nodeType === 3) return fixText(root); if (root.nodeType !== 1) return; const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); for (let n = tw.nextNode(); n; n = tw.nextNode()) fixText(n); };
  new MutationObserver((list) => { for (const m of list) { if (m.type === "characterData") fixText(m.target); else m.addedNodes.forEach(fixTree); } }).observe(document.body, { childList: true, subtree: true, characterData: true });
  fixTree(document.body);
  render();
  // Returning phones: the cards for what changed since they last looked.
  if (kids.length && !demo && !setupHash && wnDue().length) setTimeout(() => { if ($("sheet").hidden) openWhatsNew(); }, 1200);
})();
