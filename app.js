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

  const CACHE_PREFIX = "bvl-menu-v4:"; // v4: + holidays from AcademicCalendars
  const EVENTS_PREFIX = "bvl-events-v2:"; // v2: per-event ids
  const EVENTS_API = "/.netlify/functions/events";
  const SCHOOL_KEY = "bvl-school";
  const FRESH_MS = 6 * 60 * 60 * 1000;       // refetch menus older than 6h
  const EMPTY_FRESH_MS = 2 * 60 * 60 * 1000; // recheck unposted months every 2h

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

  const today = new Date();
  let view = { year: today.getFullYear(), month: today.getMonth() }; // month is 0-based
  let currentMonthData = null;   // parsed menu data for the viewed month
  let currentMonthEvents = {};   // per-day school events for the viewed month

  const TAB_KEY = "bvl-tab";
  let tab = "lunch";
  try { if (localStorage.getItem(TAB_KEY) === "events") tab = "events"; } catch {}

  /* ---------------- data ---------------- */

  const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;
  const cacheKey = (y, m) => `${CACHE_PREFIX}${schoolId}:${monthKey(y, m)}`;

  function apiUrl(y, m) {
    const last = new Date(y, m + 1, 0).getDate();
    return `${API_BASE}?buildingId=${schoolId}&districtId=${DISTRICT_ID}` +
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

  function readCache(y, m) {
    try {
      const raw = localStorage.getItem(cacheKey(y, m));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function writeCache(y, m, parsed) {
    try {
      localStorage.setItem(cacheKey(y, m), JSON.stringify({ fetchedAt: Date.now(), ...parsed }));
    } catch { /* storage full/unavailable — app still works from network */ }
  }

  async function fetchMonth(y, m) {
    const res = await fetch(apiUrl(y, m), { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const parsed = parseMenu(await res.json());
    writeCache(y, m, parsed);
    return { fetchedAt: Date.now(), ...parsed };
  }

  // Cache-first month data for the hero (doesn't touch the calendar view).
  async function getMonthData(y, m) {
    const cached = readCache(y, m);
    if (cached && Date.now() - cached.fetchedAt < (cached.empty ? EMPTY_FRESH_MS : FRESH_MS)) return cached;
    try { return await fetchMonth(y, m); }
    catch { return cached; }
  }

  /* ---------------- school events (public Google Calendars via relay) ---------------- */

  // {'YYYY-MM-DD': [{t, time?, multi}]} for every day an event covers
  function eventsByDay(events) {
    const map = {};
    for (const ev of events || []) {
      const multi = addDaysIso(ev.s, 1) < ev.e;
      for (let d = ev.s; d < ev.e; d = addDaysIso(d, 1)) {
        (map[d] = map[d] || []).push({ t: ev.t, time: ev.time, id: ev.id, multi });
      }
    }
    return map;
  }

  function addDaysIso(iso, n) {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + n);
    return dkey(d);
  }

  async function getEventsData(y, m) {
    const key = `${EVENTS_PREFIX}${schoolId}:${monthKey(y, m)}`;
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
    if (cached && Date.now() - cached.fetchedAt < FRESH_MS) return cached;
    try {
      const last = new Date(y, m + 1, 0).getDate();
      const start = `${y}-${String(m + 1).padStart(2, "0")}-01`;
      const end = addDaysIso(`${y}-${String(m + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`, 1);
      const res = await fetch(`${EVENTS_API}?school=${schoolId}&start=${start}&end=${end}`);
      if (!res.ok) throw new Error(`events ${res.status}`);
      const fresh = { fetchedAt: Date.now(), events: (await res.json()).events || [] };
      try { localStorage.setItem(key, JSON.stringify(fresh)); } catch {}
      return fresh;
    } catch { return cached; } // menus never depend on events working
  }

  /* ---------------- today hero ---------------- */

  const fmtHero = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
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

  function renderHero() {
    return tab === "events" ? renderEventsHero() : renderLunchHero();
  }

  // The next weekday on or after d — weekends never carry school events.
  function nextWeekday(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate() + 1);
    return x;
  }

  async function renderEventsHero() {
    const heroEl = $("hero");
    let byDay = {};
    const loaded = new Set();
    const ensureMonth = async (dt) => {
      const k = `${dt.getFullYear()}-${dt.getMonth()}`;
      if (loaded.has(k)) return;
      loaded.add(k);
      const ed = await getEventsData(dt.getFullYear(), dt.getMonth());
      byDay = { ...byDay, ...eventsByDay((ed && ed.events) || []) };
    };

    // Always the next school day itself — never skip ahead to find one that
    // happens to have events; an empty day honestly reads "No events".
    const target = nextWeekday(heroStart());
    await ensureMonth(target);
    const key = dkey(target);
    const evs = byDay[key] || [];

    $("heroLabel").textContent = heroLabel(target);
    $("heroDate").textContent = fmtHero.format(target);
    $("heroName").textContent = evs.length ? evs[0].t : "No events";
    $("heroSides").textContent = evs.length ? (evs[0].time || "") : "";
    $("heroAlt").innerHTML = evs.length > 1
      ? `also: <b>${evs.slice(1, 4).map((ev) => esc(ev.t)).join("</b> · <b>")}</b>${evs.length > 4 ? ` +${evs.length - 4} more` : ""}`
      : "";
    $("heroEvents").textContent = "";
    $("heroCard").classList.toggle("no-tap", !evs.length);
    $("heroCard").onclick = evs.length ? () => openSheet(key, null, "events") : null;

    // Teaser: the following school day, empty or not.
    const teaser = $("heroTomorrow");
    const after = new Date(target.getFullYear(), target.getMonth(), target.getDate() + 1);
    const p2 = nextWeekday(after);
    await ensureMonth(p2);
    const next = byDay[dkey(p2)] || [];
    const now = new Date();
    const t1 = new Date(now); t1.setDate(t1.getDate() + 1);
    const word = dkey(p2) === dkey(t1) ? "Tomorrow" : fmtHero.format(p2).split(",")[0];
    teaser.innerHTML = `${word}: <b>${esc(next.length ? next[0].t : "No events")}</b>`;
    teaser.hidden = false;
    heroEl.hidden = false;
  }

  async function renderLunchHero() {
    const heroEl = $("hero");
    const now = new Date();
    const probe = heroStart();

    let days = {};
    const loaded = new Set();
    const ensureMonth = async (dt) => {
      const k = `${dt.getFullYear()}-${dt.getMonth()}`;
      if (loaded.has(k)) return;
      loaded.add(k);
      const md = await getMonthData(dt.getFullYear(), dt.getMonth());
      days = { ...days, ...((md && md.days) || {}) };
    };

    let target = null;
    for (let i = 0; i < 45; i++) {
      await ensureMonth(probe);
      if (days[dkey(probe)]) { target = new Date(probe); break; }
      probe.setDate(probe.getDate() + 1);
    }
    if (!target) { heroEl.hidden = true; return; }

    const t1 = new Date(now); t1.setDate(t1.getDate() + 1);

    const info = days[dkey(target)];
    $("heroLabel").textContent = heroLabel(target);
    $("heroDate").textContent = fmtHero.format(target);
    $("heroName").textContent = info.entree || info.alternates[0] || "";
    $("heroSides").textContent = info.sides.length ? `with ${info.sides.join(" · ")}` : "";
    $("heroAlt").innerHTML = info.alternates.length
      ? `or: <b>${info.alternates.map(esc).join("</b> · <b>")}</b>` : "";
    $("heroEvents").textContent = "";
    $("heroCard").onclick = () => openSheet(dkey(target), info);

    // One-line teaser for the school day after the hero day.
    const teaser = $("heroTomorrow");
    teaser.hidden = true;
    const p2 = new Date(target);
    for (let i = 0; i < 7; i++) {
      p2.setDate(p2.getDate() + 1);
      await ensureMonth(p2);
      const nfo = days[dkey(p2)];
      if (nfo) {
        const word = dkey(p2) === dkey(t1) ? "Tomorrow" : fmtHero.format(p2).split(",")[0];
        teaser.innerHTML = `${word}: <b>${esc(nfo.entree || nfo.alternates[0] || "")}</b>`;
        teaser.hidden = false;
        break;
      }
    }
    heroEl.hidden = false;
  }

  /* ---------------- calendar ---------------- */

  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const fmtDay = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });

  function isToday(y, m, d) {
    const now = new Date();
    return y === now.getFullYear() && m === now.getMonth() && d === now.getDate();
  }

  function render() {
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

  // Walk the month's weekdays, appending one cell per Mon–Fri day.
  function eachWeekday(year, month, makeCell) {
    const lastDate = new Date(year, month + 1, 0).getDate();
    let started = false;
    for (let d = 1; d <= lastDate; d++) {
      const dow = new Date(year, month, d).getDay(); // 0=Sun
      if (dow === 0 || dow === 6) continue;
      if (!started) {
        for (let i = 0; i < dow - 1; i++) calendarEl.appendChild(emptyCell());
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

    eachWeekday(year, month, (d, key) => {
      const cell = dayCell(d, key, days[key]);
      if (!days[key] && (key < firstSchool || key > lastSchool)) cell.classList.add("out-of-session");
      return cell;
    });
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
    eachWeekday(year, month, (d, key) => eventCell(d, key));
    renderUpdated();
  }

  function emptyCell() {
    const el = document.createElement("div");
    el.className = "day-cell empty";
    return el;
  }

  const DOW_ABBR = ["", "Mon", "Tue", "Wed", "Thu", "Fri"];

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
    const first = evs.find((ev) => !ev.multi) || evs[0];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "day-cell" + cellState(dayNum);
    btn.dataset.dow = dow;
    btn.setAttribute("aria-label", `${fmtDay.format(new Date(year, month, dayNum))}: ${first.t}`);
    btn.innerHTML = `${cellTop(dayNum, dow)}<span class="day-entree"></span>${evs.length > 1 ? `<span class="day-more">+${evs.length - 1} more</span>` : ""}`;
    btn.querySelector(".day-entree").textContent = first.t + (first.time ? ` · ${first.time}` : "");
    btn.addEventListener("click", () => openSheet(key, null, "events"));
    return btn;
  }

  function dayCell(dayNum, key, info) {
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
      el.querySelector(".day-note").textContent = holidays[key] || "No school";
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
    const data = currentMonthData;
    if (!data || !data.fetchedAt) { updatedEl.textContent = ""; return; }
    const mins = Math.round((Date.now() - data.fetchedAt) / 60000);
    let when;
    if (mins < 2) when = "just now";
    else if (mins < 60) when = `${mins} min ago`;
    else if (mins < 36 * 60) when = `${Math.round(mins / 60)}h ago`;
    else when = new Date(data.fetchedAt).toLocaleDateString();
    updatedEl.textContent = data.fromCache ? `Showing saved menu · updated ${when}` : `Updated ${when}`;
    updatedEl.classList.toggle("stale", !!data.fromCache && mins > 36 * 60);
  }

  /* ---------------- detail sheet ---------------- */

  const sheet = $("daySheet");
  const backdrop = $("sheetBackdrop");
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

  function openSheet(key, info, mode = "lunch") {
    const [y, m, d] = key.split("-").map(Number);
    $("sheetDate").textContent = fmtDay.format(new Date(y, m - 1, d));
    const sections = [];
    if (mode === "events") {
      const dayEvents = currentMonthEvents[key] || [];
      const rows = dayEvents.map((ev, i) => {
        const label = esc(ev.t + (ev.time ? ` · ${ev.time}` : ""));
        const id = ev.id || String(i);
        return `<li><label class="ev-pick">` +
          `<input type="checkbox" class="ev-check" value="${esc(id)}">` +
          `<span>${label}</span></label></li>`;
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
    if (mode === "events" && (currentMonthEvents[key] || []).length) {
      // A real link (not script) so iOS hands the file to the Calendar app.
      const a = document.createElement("a");
      a.className = "sheet-action";
      a.addEventListener("click", (e) => {
        if (a.classList.contains("disabled")) { e.preventDefault(); return; }
        dismissWhatsNew();
      });
      const boxes = [...$("sheetBody").querySelectorAll(".ev-check")];
      const sync = () => {
        const picked = boxes.filter((b) => b.checked).map((b) => b.value);
        a.classList.toggle("disabled", !picked.length);
        a.textContent = picked.length > 1
          ? `Add ${picked.length} to my calendar`
          : "Add to my calendar";
        a.href = picked.length
          ? `${EVENTS_API}?school=${schoolId}&start=${key}&end=${addDaysIso(key, 1)}` +
            `&format=ics&ids=${picked.join(",")}`
          : "#";
      };
      boxes.forEach((b) => b.addEventListener("change", sync));
      // One event on the day: nothing to choose between, so pre-select it.
      if (boxes.length === 1) boxes[0].checked = true;
      sync();
      $("sheetBody").appendChild(a);
    }
    sheet.hidden = false; backdrop.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      sheet.classList.add("show"); backdrop.classList.add("show");
      $("sheetClose").focus({ preventScroll: true });
    }));
  }

  function section(title, items) {
    return `<div class="menu-section"><h3>${esc(title)}</h3><ul>` +
      items.map((i) => `<li${i.hero ? ' class="hero-item"' : ""}>${esc(i.name)}</li>`).join("") +
      `</ul></div>`;
  }

  function closeSheet() {
    sheet.classList.remove("show"); backdrop.classList.remove("show");
    setTimeout(() => { sheet.hidden = true; backdrop.hidden = true; }, 280);
  }
  $("sheetClose").addEventListener("click", closeSheet);
  backdrop.addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) closeSheet(); });

  /* ---------------- loading ---------------- */

  async function refreshEvents(year, month) {
    const data = await getEventsData(year, month);
    if (view.year !== year || view.month !== month) return;
    currentMonthEvents = eventsByDay((data && data.events) || []);
    render();
  }

  async function loadMonth(force = false) {
    const { year, month } = view;
    currentMonthEvents = {};
    const cached = readCache(year, month);
    if (cached && !force) {
      currentMonthData = { ...cached, fromCache: true };
      render();
      refreshEvents(year, month);
      const maxAge = cached.empty ? EMPTY_FRESH_MS : FRESH_MS;
      if (Date.now() - cached.fetchedAt < maxAge) return;
      try {
        const fresh = await fetchMonth(year, month);
        if (view.year === year && view.month === month) { currentMonthData = fresh; render(); }
      } catch { /* keep showing cache */ }
      return;
    }

    updatedEl.textContent = "Loading…";
    try {
      currentMonthData = await fetchMonth(year, month);
    } catch {
      currentMonthData = cached ? { ...cached, fromCache: true } : { days: {}, empty: true, error: true };
    }
    if (view.year === year && view.month === month) {
      render();
      refreshEvents(year, month);
    }
  }

  function shiftMonth(delta) {
    const m = view.month + delta;
    view = { year: view.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    loadMonth();
  }

  /* ---------------- what's new ---------------- */

  const WHATS_NEW_KEY = "bvl-whatsnew-cal";
  let whatsNewEligible = false;
  let whatsNewCounted = false;

  try {
    const seen = localStorage.getItem(WHATS_NEW_KEY);
    // Nothing is "new" to a first-time visitor, and it retires after 3 views.
    whatsNewEligible = isReturning && seen !== "done" && (parseInt(seen, 10) || 0) < 3;
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

  /* ---------------- tabs ---------------- */

  function setTab(t) {
    tab = t;
    try { localStorage.setItem(TAB_KEY, t); } catch {}
    for (const [id, name] of [["tabLunch", "lunch"], ["tabEvents", "events"]]) {
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
  for (const s of SCHOOLS) {
    const opt = document.createElement("option");
    opt.value = s.id; opt.textContent = s.name;
    select.appendChild(opt);
  }
  select.value = schoolId;
  $("schoolLabel").textContent = SCHOOLS.find((s) => s.id === schoolId).name;
  select.addEventListener("change", () => {
    schoolId = select.value;
    try { localStorage.setItem(SCHOOL_KEY, schoolId); } catch {}
    $("schoolLabel").textContent = SCHOOLS.find((s) => s.id === schoolId).name;
    currentMonthData = null;
    loadMonth();
    renderHero();
  });

  // Refresh when the PWA comes back to the foreground.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { loadMonth(); renderHero(); }
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  loadMonth();
  renderHero();
  updateWhatsNew();
})();
