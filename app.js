/* Inspiration Lunch — Inspiration Elementary, Brandon Valley School District
 * Pulls live menu data from the LINQ Connect public API, month by month,
 * with a localStorage cache so the app keeps working offline.
 */
(() => {
  "use strict";

  const API_BASE = "https://api.linqconnect.com/api/FamilyMenu";
  const BUILDING_ID = "0c65b2bc-908d-ec11-8df7-9566c4096294"; // Inspiration Elementary
  const DISTRICT_ID = "b1d7358a-818b-ec11-90c7-d2d97b40e955"; // Brandon Valley School District
  const CACHE_PREFIX = "iel-menu-v1:";
  const FRESH_MS = 12 * 60 * 60 * 1000;      // refetch menus older than 12h
  const EMPTY_FRESH_MS = 2 * 60 * 60 * 1000; // recheck unposted months every 2h

  // Standing alternate entrées that appear alongside the day's hot meal.
  const ALTERNATE_RX = /bagel bag|uncrustable/i;

  const $ = (id) => document.getElementById(id);
  const calendarEl = $("calendar");
  const monthLabelEl = $("monthLabel");
  const statusEl = $("statusArea");
  const updatedEl = $("updatedNote");

  const today = new Date();
  let view = { year: today.getFullYear(), month: today.getMonth() }; // month is 0-based
  let currentMonthData = null; // parsed data for the viewed month

  /* ---------------- data ---------------- */

  const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;

  function apiUrl(y, m) {
    const last = new Date(y, m + 1, 0).getDate();
    const s = `${m + 1}-1-${y}`;
    const e = `${m + 1}-${last}-${y}`;
    return `${API_BASE}?buildingId=${BUILDING_ID}&districtId=${DISTRICT_ID}&startDate=${s}&endDate=${e}`;
  }

  function cleanName(name) {
    return name
      .replace(/\s*\(elem\.?\)\s*/gi, " ")
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
          alternates: [], // standing alternates (Bagel Bag, Uncrustable)
          vegetable: [],
          fruit: [],
          milk: [],
          condiments: [],
        };
        for (const meal of meals) {
          const name = (meal.MenuMealName || "").toLowerCase();
          const isFirstMeal = meal === meals[0];
          for (const cat of meal.RecipeCategories || []) {
            const catName = (cat.CategoryName || "").toLowerCase();
            for (const r of cat.Recipes || []) {
              const recipe = cleanName(r.RecipeName || "");
              if (!recipe) continue;
              if (isFirstMeal && catName.includes("entr")) {
                if (ALTERNATE_RX.test(recipe)) {
                  if (!d.alternates.includes(recipe)) d.alternates.push(recipe);
                } else if (!d.entree) {
                  d.entree = recipe;
                } else {
                  d.sides.push(recipe);
                }
              } else if (isFirstMeal) {
                d.sides.push(recipe); // grain / soup that comes with the hot meal
              } else if (name.includes("garden") || catName.includes("veg") || catName.includes("fruit")) {
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
          // key as YYYY-MM-DD
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
      const raw = localStorage.getItem(CACHE_PREFIX + monthKey(y, m));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function writeCache(y, m, parsed) {
    try {
      localStorage.setItem(
        CACHE_PREFIX + monthKey(y, m),
        JSON.stringify({ fetchedAt: Date.now(), ...parsed })
      );
    } catch { /* storage full/unavailable — app still works from network */ }
  }

  async function fetchMonth(y, m) {
    const res = await fetch(apiUrl(y, m), { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const parsed = parseMenu(await res.json());
    writeCache(y, m, parsed);
    return { fetchedAt: Date.now(), ...parsed };
  }

  /* ---------------- rendering ---------------- */

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
      document.querySelector(".weekday-row").style.display = "none";
      statusEl.hidden = false;
      if (data && data.error) {
        statusEl.innerHTML = `
          <div class="big">📡</div>
          <h2>Couldn&rsquo;t load the menu</h2>
          <p>Check your connection and try again. If you&rsquo;ve opened this month before, it would show from memory.</p>
          <button id="retryBtn">Try again</button>`;
        $("retryBtn").addEventListener("click", () => loadMonth(true));
      } else {
        statusEl.innerHTML = `
          <div class="big">🍎</div>
          <h2>Menu not posted yet</h2>
          <p>The district hasn&rsquo;t published the ${MONTHS[month]} menu on LINQ Connect. Check back closer to the month.</p>
          <button id="retryBtn">Check again</button>`;
        $("retryBtn").addEventListener("click", () => loadMonth(true));
      }
      renderUpdated();
      return;
    }

    calendarEl.hidden = false;
    document.querySelector(".weekday-row").style.display = "";

    const first = new Date(year, month, 1);
    const lastDate = new Date(year, month + 1, 0).getDate();
    // Column index for Mon–Fri grid: Mon=0 … Fri=4
    let started = false;
    for (let d = 1; d <= lastDate; d++) {
      const dow = new Date(year, month, d).getDay(); // 0=Sun
      if (dow === 0 || dow === 6) continue; // skip weekends
      const col = dow - 1;
      if (!started) {
        for (let i = 0; i < col; i++) calendarEl.appendChild(emptyCell());
        started = true;
      }
      const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const info = days[key];
      calendarEl.appendChild(dayCell(d, key, info));
    }
    renderUpdated();
  }

  function emptyCell() {
    const el = document.createElement("div");
    el.className = "day-cell empty";
    return el;
  }

  function dayCell(dayNum, key, info) {
    const { year, month } = view;
    if (!info) {
      const el = document.createElement("div");
      el.className = "day-cell no-school" + (isToday(year, month, dayNum) ? " today" : "");
      el.innerHTML = `<span class="day-num">${dayNum}</span><span class="day-note">No school</span>`;
      return el;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "day-cell" + (isToday(year, month, dayNum) ? " today" : "");
    btn.setAttribute("aria-label", `${fmtDay.format(new Date(year, month, dayNum))}: ${info.entree || info.alternates[0]}`);
    btn.innerHTML = `<span class="day-num">${dayNum}</span><span class="day-entree"></span>`;
    btn.querySelector(".day-entree").textContent = info.entree || info.alternates[0] || "";
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

  function openSheet(key, info) {
    const [y, m, d] = key.split("-").map(Number);
    $("sheetDate").textContent = fmtDay.format(new Date(y, m - 1, d));
    const sections = [];
    if (info.entree) {
      const items = [ { name: info.entree, hero: true }, ...info.sides.map((s) => ({ name: s })) ];
      sections.push(section("Main Entrée", items));
    }
    if (info.alternates.length) sections.push(section("Or choose instead", info.alternates.map((n) => ({ name: n }))));
    if (info.vegetable.length) sections.push(section("Garden Bar · Vegetables", info.vegetable.map((n) => ({ name: n }))));
    if (info.fruit.length) sections.push(section("Garden Bar · Fruit", info.fruit.map((n) => ({ name: n }))));
    if (info.milk.length) sections.push(section("Milk", info.milk.map((n) => ({ name: n }))));
    if (info.condiments.length) sections.push(section("Condiments", info.condiments.map((n) => ({ name: n }))));
    $("sheetBody").innerHTML = sections.join("");
    sheet.hidden = false; backdrop.hidden = false;
    requestAnimationFrame(() => { sheet.classList.add("show"); backdrop.classList.add("show"); });
  }

  function section(title, items) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return `<div class="menu-section"><h3>${esc(title)}</h3><ul>` +
      items.map((i) => `<li${i.hero ? ' class="hero"' : ""}>${esc(i.name)}</li>`).join("") +
      `</ul></div>`;
  }

  function closeSheet() {
    sheet.classList.remove("show"); backdrop.classList.remove("show");
    setTimeout(() => { sheet.hidden = true; backdrop.hidden = true; }, 250);
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
      // stale — refresh in the background
      try {
        const fresh = await fetchMonth(year, month);
        if (view.year === year && view.month === month) {
          currentMonthData = fresh;
          render();
        }
      } catch { /* keep showing cache */ }
      return;
    }

    updatedEl.textContent = "Loading…";
    try {
      currentMonthData = await fetchMonth(year, month);
    } catch (err) {
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

  // Refresh when the PWA comes back to the foreground on a new day / stale data
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadMonth();
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  loadMonth();
})();
