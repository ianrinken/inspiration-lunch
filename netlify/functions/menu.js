/* Relay for the district's public LINQ Connect menus. LINQ answers with a
 * month of every recipe's nutrients and allergen ids (0.8 to 1 MB per
 * school), refuses requests without a browser User-Agent, and knows nothing
 * about which item is the day's meal. This trims a month to names and lines
 * and applies the district's conventions, so the app can read Brandon Valley
 * exactly as it reads Sioux Falls.
 *
 * GET /.netlify/functions/menu?school=ies&start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Response: { school, start, end,
 *   days: [{ d, lines: { "Breakfast": [..], "Lunch": [..], "Cold Grab n' Go": [..], ... } }],
 *   prices: { breakfast, lunch, milk },
 *   off: { "YYYY-MM-DD": "Comp Day - No School" } }
 * Each item is { n: name, t: type, a: [major allergens] }. In a "Lunch"
 * line the order is the day's hot entrée (first ENTREES item), the sides
 * that come with it (SIDES), the standing alternates (ENTREES: Bagel Bag,
 * Uncrustable), then the Garden Bar (VEGETABLES, FRUIT), MILK and the
 * condiments (OTHER, so they stay out of the summaries). Middle and high
 * school serving lines that run every day (Cold Grab n' Go, Pizza) are their
 * own lines, like Sioux Falls' "Lunch - Dairy Free", so the day's summary
 * stays the hot meal.
 */

const DATA = require("../../data.js");
// Every school's LINQ building id and meal prices come from the one school list.
const SCHOOLS = Object.fromEntries(Object.values(DATA.SCHOOLS).map((s) => [s.id, s]));
const DISTRICT_ID = DATA.DISTRICT.linqDistrict;

// LINQ returns 403 to anything that doesn't look like a browser.
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
// LINQ lists allergens as ids; these are the district's, named the way the
// app's ALLERGENS list spells them.
const ALLERGEN_IDS = {
  "b3d7358a-818b-ec11-90c7-d2d97b40e955": "Egg", "b4d7358a-818b-ec11-90c7-d2d97b40e955": "Milk",
  "b5d7358a-818b-ec11-90c7-d2d97b40e955": "Fish", "b6d7358a-818b-ec11-90c7-d2d97b40e955": "Shellfish",
  "b7d7358a-818b-ec11-90c7-d2d97b40e955": "Tree nuts", "b8d7358a-818b-ec11-90c7-d2d97b40e955": "Peanuts",
  "b9d7358a-818b-ec11-90c7-d2d97b40e955": "Wheat", "bad7358a-818b-ec11-90c7-d2d97b40e955": "Soy",
};
// Standing alternates offered beside the day's hot meal. LINQ lists them in
// the same "Main Entrée" category, sometimes ahead of the hot meal.
const ALTERNATE_RX = /bagel bag|uncrustable|jammer/i;
const BREAKFAST_ALTERNATE_RX = /cereal variety|mini donuts/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 42;
const FRESH_MS = 20 * 60 * 1000;
const { load, save } = require("./lib/sources.js");
const { withSpanish, cdnFor } = require("./lib/translate.js");

// "2026-10-01" -> "10-1-2026" (LINQ's query format, unpadded)
function linqDate(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${m}-${d}-${y}`;
}

// "10/1/2026" -> "2026-10-01"; null for anything else.
function ymdOf(mdy) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(mdy || ""));
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

// Kitchen names to plate names: "(Elem)" tags, purchasing sizes ("5#",
// "BULK"), packaging ("IW", "frozen") and grain codes ("WG") at the end.
function cleanName(name) {
  return String(name || "")
    .replace(/\s*\((elem|ms|hs)\.?\)\s*/gi, " ")
    .replace(/,\s*(frozen|bulk|iw|wg)\b\.?/gi, "")
    .replace(/\s+\d+#$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// "HS Pizza Line" -> "Pizza"; "Cold Grab n' Go Line" -> "Cold Grab n' Go".
// The app already says "line" around these names.
const lineLabel = (mealName) => cleanName(mealName).replace(/^(elem|ms|hs)\s+/i, "").replace(/\s+line$/i, "").trim() || "Lunch line";

// "Second Chance Breakfast 26/27", "High School Lunch SY 26/27" -> no year.
const planLabel = (planName) => String(planName || "").replace(/\s*(SY\s*)?\d{2}\/\d{2}\s*$/i, "").trim();

// A meal (LINQ's word for a serving station) by its name.
function mealKind(mealName) {
  const n = String(mealName || "").toLowerCase();
  if (/garden/.test(n)) return "garden";
  if (/^milk\b/.test(n)) return "milk";
  if (/condiment/.test(n)) return "condiments";
  if (/^week\b/.test(n)) return "hot"; // "Week 2 Tuesday": the rotating hot line
  return "line"; // a serving line that runs every day (Cold Grab n' Go, Pizza)
}

const catType = (catName) => {
  const c = String(catName || "").toLowerCase();
  if (c.includes("entr")) return "ENTREES";
  if (c.includes("fruit")) return "FRUIT";
  if (c.includes("veg")) return "VEGETABLES";
  if (c.includes("milk")) return "MILK";
  if (c.includes("condiment")) return "OTHER";
  if (c.includes("grain")) return "GRAINS";
  return "SIDES"; // meat/meat alternate, soup, anything new: shown, not hidden
};

function toItem(recipe, t) {
  const n = cleanName(recipe.RecipeName);
  if (!n) return null;
  const it = { n, t };
  const a = [...new Set((recipe.Allergens || []).map((id) => ALLERGEN_IDS[String(id).toLowerCase()]).filter(Boolean))];
  if (a.length) it.a = a;
  return it;
}

// One item per name per line (LINQ lists Ranch Dressing twice).
function dedupe(items) {
  const seen = new Set();
  return items.filter((i) => i && !seen.has(i.n) && seen.add(i.n));
}

const recipesOf = (meal) => (meal.RecipeCategories || []).flatMap((cat) => (cat.Recipes || []).map((r) => [cat.CategoryName, r]));

// The lunch session for one day: the hot line, the Garden Bar, milk and
// condiments become the "Lunch" line; every other station is its own line.
function shapeLunch(meals, lines, base) {
  let hot = meals.filter((m) => mealKind(m.MenuMealName) === "hot");
  let rest = meals.filter((m) => !hot.includes(m));
  if (!hot.length) {
    // No rotation-named meal: the first station is the hot line (the old
    // client's rule), so a renamed plan never loses the day's meal.
    const first = rest.find((m) => mealKind(m.MenuMealName) === "line");
    if (first) { hot = [first]; rest = rest.filter((m) => m !== first); }
  }
  const mains = [], sides = [], alts = [], veg = [], fruit = [], milk = [], cond = [];
  const extra = {};
  for (const m of hot) {
    for (const [cat, r] of recipesOf(m)) {
      const t = catType(cat);
      if (t === "ENTREES") (ALTERNATE_RX.test(r.RecipeName) ? alts : mains).push(toItem(r, "ENTREES"));
      else if (t === "MILK") milk.push(toItem(r, "MILK"));
      else sides.push(toItem(r, "SIDES"));
    }
  }
  for (const m of rest) {
    const kind = mealKind(m.MenuMealName);
    for (const [cat, r] of recipesOf(m)) {
      const t = catType(cat);
      if (kind === "garden") (t === "FRUIT" ? fruit : veg).push(toItem(r, t === "FRUIT" ? "FRUIT" : "VEGETABLES"));
      else if (kind === "milk") milk.push(toItem(r, "MILK"));
      else if (kind === "condiments") cond.push(toItem(r, "OTHER"));
      else {
        const k = lineLabel(m.MenuMealName);
        (extra[k] = extra[k] || []).push(toItem(r, t));
      }
    }
  }
  const items = dedupe([...mains, ...sides, ...alts, ...veg, ...fruit, ...milk, ...cond]);
  if (items.length) lines[base] = dedupe([...(lines[base] || []), ...items]);
  for (const [k, list] of Object.entries(extra)) {
    const key = k === base ? `${base} line` : k;
    const got = dedupe(list);
    if (got.length) lines[key] = dedupe([...(lines[key] || []), ...got]);
  }
}

// Breakfast, snack and any other session: the featured item first, what
// comes with it, then the standing choices, fruit, milk, condiments.
function shapeMeal(meals, lines, base, entreeType) {
  const mains = [], alts = [], grains = [], sides = [], fruit = [], veg = [], milk = [], cond = [];
  for (const m of meals) {
    for (const [cat, r] of recipesOf(m)) {
      const t = catType(cat);
      if (t === "ENTREES") (BREAKFAST_ALTERNATE_RX.test(r.RecipeName) ? alts : mains).push(r);
      else if (t === "GRAINS") grains.push(r);
      else if (t === "FRUIT") fruit.push(toItem(r, "FRUIT"));
      else if (t === "VEGETABLES") veg.push(toItem(r, "VEGETABLES"));
      else if (t === "MILK") milk.push(toItem(r, "MILK"));
      else if (t === "OTHER") cond.push(toItem(r, "OTHER"));
      else sides.push(toItem(r, "SIDES"));
    }
  }
  // A breakfast of only grains ("Bread Variety, Cereal Variety, Mini
  // Donuts") is still a meal; the grain is the day's item then.
  if (!mains.length && !alts.length) {
    for (const r of grains) (BREAKFAST_ALTERNATE_RX.test(r.RecipeName) ? alts : mains).push(r);
    grains.length = 0;
  }
  const items = dedupe([
    ...mains.map((r) => toItem(r, entreeType)),
    ...grains.map((r) => toItem(r, "GRAINS")),
    ...sides,
    ...alts.map((r) => toItem(r, entreeType)),
    ...fruit, ...veg, ...milk, ...cond,
  ]);
  if (items.length) lines[base] = dedupe([...(lines[base] || []), ...items]);
}

function shape(json, { school, start, end }) {
  const byDate = new Map();
  for (const session of json.FamilyMenuSessions || []) {
    const sessionName = String(session.ServingSession || "").trim() || "Lunch";
    const isLunch = /lunch/i.test(sessionName);
    const isBreakfast = /breakfast/i.test(sessionName);
    (session.MenuPlans || []).forEach((plan, pi) => {
      // The first plan of a session is the line parents know ("Lunch",
      // "Breakfast"); a second plan is named for itself ("Second Chance
      // Breakfast").
      const base = pi === 0 ? (isLunch ? "Lunch" : isBreakfast ? "Breakfast" : sessionName) : planLabel(plan.MenuPlanName) || `${sessionName} ${pi + 1}`;
      for (const day of plan.Days || []) {
        const d = ymdOf(day.Date);
        if (!d || d < start || d > end) continue;
        const meals = (day.MenuMeals || []).filter((m) => m && Array.isArray(m.RecipeCategories));
        if (!meals.length) continue;
        const lines = byDate.get(d) || {};
        if (isLunch) shapeLunch(meals, lines, base);
        else shapeMeal(meals, lines, base, isBreakfast ? "BREAKFAST" : "ENTREES");
        if (Object.keys(lines).length) byDate.set(d, lines);
      }
    });
  }
  const days = [...byDate.keys()].sort().map((d) => ({ d, lines: byDate.get(d) }));
  // No-school notes from the district's calendar, for "No school: Labor Day".
  const off = {};
  for (const cal of json.AcademicCalendars || []) {
    for (const day of cal.Days || []) {
      const d = ymdOf(day.Date);
      const note = String(day.Note || "").trim();
      if (d && note && d >= start && d <= end) off[d] = note;
    }
  }
  // LINQ carries no prices; the district publishes them per level.
  const prices = { ...((SCHOOLS[school] && SCHOOLS[school].prices) || {}) };
  return { days, prices, off };
}

exports.handler = async (event) => {
  require("./lib/store.js").connect(event);
  const q = event.queryStringParameters || {};
  const school = SCHOOLS[q.school];
  if (!school || !school.linq || !YMD.test(q.start || "") || !YMD.test(q.end || "") || q.end < q.start) {
    return { statusCode: 400, body: "Bad request" };
  }
  const span = (Date.parse(q.end) - Date.parse(q.start)) / 864e5;
  if (span > MAX_DAYS) return { statusCode: 400, body: "Range too long" };
  // Live first; if LINQ is down or blocks us, the last good copy for the
  // same range is served instead of an empty month.
  const key = `menu-${q.school}-${q.start}-${q.end}`;
  const saved = await load(key).catch(() => null);
  if (saved && Date.now() - saved.at < FRESH_MS) return reply(await withSpanish(event, saved.body, "menu"), false);
  try {
    const url = `https://api.linqconnect.com/api/FamilyMenu?buildingId=${school.linq}&districtId=${DISTRICT_ID}&startDate=${linqDate(q.start)}&endDate=${linqDate(q.end)}`;
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (res.status !== 200) throw new Error(`LINQ ${res.status}`);
    const json = await res.json();
    if (!json || !Array.isArray(json.FamilyMenuSessions)) throw new Error("unexpected shape");
    const body = JSON.stringify({ school: q.school, start: q.start, end: q.end, ...shape(json, { school: q.school, start: q.start, end: q.end }) });
    await save(key, { at: Date.now(), hash: "", body }).catch(() => {});
    return reply(await withSpanish(event, body, "menu"), false);
  } catch (err) {
    if (saved) return reply(await withSpanish(event, saved.body, "menu"), true);
    return { statusCode: 502, headers: { "Cache-Control": "no-store" }, body: JSON.stringify({ error: "Could not reach the menu service." }) };
  }
};

function reply(body, stale) {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Netlify-CDN-Cache-Control": stale ? "public, s-maxage=120" : cdnFor(body, "public, s-maxage=1800, stale-while-revalidate=600"),
    },
    body,
  };
}

exports._internals = { shape, linqDate, ymdOf, cleanName, lineLabel, planLabel, mealKind, ALLERGEN_IDS };
