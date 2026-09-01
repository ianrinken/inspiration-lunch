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

  const CACHE_PREFIX = "bvl-menu-v3:"; // v3: MS/HS alternate-line parsing
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
  if (!SCHOOLS.some((s) => s.id === schoolId)) schoolId = DEFAULT_SCHOOL;

  const today = new Date();
  let view = { year: today.getFullYear(), month: today.getMonth() }; // month is 0-based
  let currentMonthData = null; // parsed data for the viewed month

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
    const out = { days: {}, empty: true };
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

  /* ---------------- today hero ---------------- */

  const fmtHero = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
  const dkey = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

  async function renderHero() {
    const heroEl = $("hero");
    const now = new Date();

    // Parents mostly check the night before: after lunchtime the hero
    // looks ahead to the next school day instead of today.
    const probe = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (now.getHours() >= 13) probe.setDate(probe.getDate() + 1);

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
    const label = dkey(target) === dkey(now) ? "Today"
      : dkey(target) === dkey(t1) ? "Tomorrow"
      : "Next school day";

    const info = days[dkey(target)];
    $("heroLabel").textContent = label;
    $("heroDate").textContent = fmtHero.format(target);
    $("heroName").textContent = info.entree || info.alternates[0] || "";
    $("heroSides").textContent = info.sides.length ? `with ${info.sides.join(" · ")}` : "";
    $("heroAlt").innerHTML = info.alternates.length
      ? `or: <b>${info.alternates.map(esc).join("</b> · <b>")}</b>` : "";
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

    const data = currentMonthData;
    const days = (data && data.days) || {};
    const hasAny = Object.keys(days).length > 0;

    if (!hasAny) {
      calendarEl.hidden = true;
      weekdayRow.style.display = "none";
      statusEl.hidden = false;
      if (data && data.error) {
        statusEl.innerHTML = `
          <h2>Couldn&rsquo;t load the menu</h2>
          <p>Check your connection and try again. If you&rsquo;ve opened this month before, it would show from memory.</p>
          <button id="retryBtn">Try again</button>`;
      } else {
        statusEl.innerHTML = `
          <h2>Menu not posted yet</h2>
          <p>The district hasn&rsquo;t published the ${MONTHS[month]} menu on LINQ Connect. Check back closer to the month.</p>
          <button id="retryBtn">Check again</button>`;
      }
      $("retryBtn").addEventListener("click", () => loadMonth(true));
      renderUpdated();
      return;
    }

    calendarEl.hidden = false;
    weekdayRow.style.display = "";

    // The phone list hides no-school days outside the in-session range
    // (mid-session holidays like Labor Day still show).
    const schoolDays = Object.keys(days).sort();
    const firstSchool = schoolDays[0], lastSchool = schoolDays[schoolDays.length - 1];

    const lastDate = new Date(year, month + 1, 0).getDate();
    let started = false;
    for (let d = 1; d <= lastDate; d++) {
      const dow = new Date(year, month, d).getDay(); // 0=Sun
      if (dow === 0 || dow === 6) continue; // Mon–Fri grid
      if (!started) {
        for (let i = 0; i < dow - 1; i++) calendarEl.appendChild(emptyCell());
        started = true;
      }
      const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const cell = dayCell(d, key, days[key]);
      if (!days[key] && (key < firstSchool || key > lastSchool)) cell.classList.add("out-of-session");
      calendarEl.appendChild(cell);
    }
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

  function dayCell(dayNum, key, info) {
    const { year, month } = view;
    const dow = new Date(year, month, dayNum).getDay();
    const state = isToday(year, month, dayNum) ? " today" : (isPast(year, month, dayNum) ? " past" : "");
    const top = `<span class="day-top"><span class="day-num">${dayNum}</span><span class="day-dow">${DOW_ABBR[dow]}</span></span>`;
    if (!info) {
      const el = document.createElement("div");
      el.className = "day-cell no-school" + state;
      el.dataset.dow = dow;
      el.innerHTML = `${top}<span class="day-note">No school</span>`;
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

  function openSheet(key, info) {
    const [y, m, d] = key.split("-").map(Number);
    $("sheetDate").textContent = fmtDay.format(new Date(y, m - 1, d));
    const sections = [];
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

  async function loadMonth(force = false) {
    const { year, month } = view;
    const cached = readCache(year, month);
    if (cached && !force) {
      currentMonthData = { ...cached, fromCache: true };
      render();
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
    if (view.year === year && view.month === month) render();
  }

  function shiftMonth(delta) {
    const m = view.month + delta;
    view = { year: view.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    loadMonth();
  }

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
})();
