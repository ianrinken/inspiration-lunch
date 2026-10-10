/* Unit tests for the Brandon Valley menu relay (netlify/functions/menu.js),
 * run against trimmed copies of real LINQ Connect months in tests/fixtures.
 * No network.
 *   node tests/unit-menu.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FIX = path.join(__dirname, "fixtures");
process.env.SFP_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sfp-menu-test-"));
delete process.env.ANTHROPIC_API_KEY;
delete process.env.SFSD_API_Key;

const DATA = require(path.join(ROOT, "data.js"));
const BUILDINGS = { [DATA.SCHOOLS.bvhs.linq]: "linq-bvhs.json", [DATA.SCHOOLS.ies.linq]: "linq-ies.json" };

// Offline: LINQ is answered from fixtures, or refused when `down` is set.
let down = false;
let lastRequest = null;
global.fetch = async (url, init) => {
  const u = String(url);
  lastRequest = { url: u, headers: (init && init.headers) || {} };
  const b = u.match(/api\.linqconnect\.com\/api\/FamilyMenu\?buildingId=([0-9a-f-]+)/);
  if (!down && b && BUILDINGS[b[1]]) {
    const body = fs.readFileSync(path.join(FIX, BUILDINGS[b[1]]), "utf8");
    return { ok: true, status: 200, headers: new Map(), json: async () => JSON.parse(body), text: async () => body };
  }
  return { ok: false, status: 503, headers: new Map(), text: async () => "", json: async () => ({}) };
};

const menu = require(path.join(ROOT, "netlify/functions/menu.js"));
const { cleanName, lineLabel, planLabel, linqDate } = menu._internals;

const get = async (school, start, end, extra = {}) => {
  const r = await menu.handler({ httpMethod: "GET", queryStringParameters: { school, start, end, ...extra }, headers: {} });
  return { r, j: r.statusCode === 200 ? JSON.parse(r.body) : null };
};
const dayOf = (j, d) => j.days.find((x) => x.d === d);
const names = (items) => items.map((i) => i.n);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* ---------- request shape ---------- */

test("LINQ is asked by building id, unpadded dates, with a browser User-Agent", async () => {
  const { r } = await get("ies", "2026-10-01", "2026-10-31");
  assert.strictEqual(r.statusCode, 200);
  assert.ok(lastRequest.url.includes(`buildingId=${DATA.SCHOOLS.ies.linq}`));
  assert.ok(lastRequest.url.includes(`districtId=${DATA.DISTRICT.linqDistrict}`));
  assert.ok(lastRequest.url.includes("startDate=10-1-2026&endDate=10-31-2026"));
  assert.ok(/iPhone.*Safari/.test(lastRequest.headers["User-Agent"]));
  assert.strictEqual(linqDate("2026-01-09"), "1-9-2026");
});

test("bad requests are refused before any fetch", async () => {
  assert.strictEqual((await get("nope", "2026-10-01", "2026-10-31")).r.statusCode, 400);
  assert.strictEqual((await get("ies", "10/1/2026", "2026-10-31")).r.statusCode, 400);
  assert.strictEqual((await get("ies", "2026-10-31", "2026-10-01")).r.statusCode, 400);
  assert.strictEqual((await get("ies", "2026-10-01", "2026-12-31")).r.statusCode, 400);
});

/* ---------- output contract ---------- */

test("output contract: school/start/end, sorted YMD days, lines of {n,t,a?}, prices, off", async () => {
  const { r, j } = await get("ies", "2026-10-01", "2026-10-31");
  assert.strictEqual(r.headers["Content-Type"], "application/json; charset=utf-8");
  assert.ok(/s-maxage=1800/.test(r.headers["Netlify-CDN-Cache-Control"]));
  assert.deepStrictEqual([j.school, j.start, j.end], ["ies", "2026-10-01", "2026-10-31"]);
  assert.ok(r.body.length < 80000, `month is ${r.body.length} bytes`);
  assert.strictEqual(j.days.length, 20, "20 school days in October");
  assert.deepStrictEqual(j.days.map((d) => d.d), [...j.days.map((d) => d.d)].sort());
  for (const day of j.days) {
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(day.d));
    assert.ok(day.lines.Lunch && day.lines.Breakfast, `${day.d} has Lunch and Breakfast`);
    for (const items of Object.values(day.lines)) {
      assert.ok(items.length);
      for (const i of items) {
        assert.ok(typeof i.n === "string" && i.n.trim() === i.n && i.n.length, "name");
        assert.ok(/^[A-Z]+$/.test(i.t), "type");
        if (i.a) assert.ok(Array.isArray(i.a) && i.a.length);
      }
      assert.strictEqual(new Set(names(items)).size, items.length, "no duplicate names in a line");
    }
  }
});

test("a day's Lunch has the hot entrée first even when LINQ lists the alternates first", async () => {
  const { j } = await get("ies", "2026-10-01", "2026-10-31");
  // LINQ order that day: Bagel Bag | Grape Jammer Uncrustable Sandwich | Chicken Patty on WG Bun
  const lunch = dayOf(j, "2026-10-06").lines.Lunch;
  assert.deepStrictEqual(lunch[0], { n: "Chicken Patty on WG Bun", t: "ENTREES", a: ["Wheat", "Soy"] });
  const entrees = lunch.filter((i) => i.t === "ENTREES");
  assert.deepStrictEqual(names(entrees), ["Chicken Patty on WG Bun", "Bagel Bag", "Grape Jammer Uncrustable Sandwich"]);
  // Sides that come with the hot meal sit between the entrée and the alternates.
  const friday = dayOf(j, "2026-10-02").lines.Lunch;
  assert.deepStrictEqual(names(friday).slice(0, 3), ["Chicken Tenders", "Belgium Waffle", "Bagel Bag"]);
  assert.deepStrictEqual(friday.map((i) => i.t).slice(0, 3), ["ENTREES", "SIDES", "ENTREES"]);
});

test("garden bar is VEGETABLES then FRUIT, milk is MILK, condiments are OTHER and listed once", async () => {
  const { j } = await get("ies", "2026-10-01", "2026-10-31");
  const lunch = dayOf(j, "2026-10-01").lines.Lunch;
  assert.deepStrictEqual(lunch.map((i) => `${i.t}:${i.n}`), [
    "ENTREES:Pepperoni Pizza", "ENTREES:Bagel Bag", "ENTREES:Grape Jammer Uncrustable Sandwich",
    "VEGETABLES:Steamed Carrots", "VEGETABLES:Lettuce", "VEGETABLES:Baby Carrots",
    "FRUIT:Tropical Fruit", "FRUIT:Kiwi",
    "MILK:1% Milk", "MILK:Chocolate Milk", "MILK:Skim Milk",
    "OTHER:Ranch Dressing",
  ]);
  // The summary rule in app.js: ENTREES are the meal, MILK/OTHER are left out, the rest are sides.
  const sides = lunch.filter((i) => !["ENTREES", "BREAKFAST", "MILK", "OTHER"].includes(i.t));
  assert.strictEqual(sides.length, 5);
});

test("allergen ids become the app's names, only the major ones", async () => {
  const { j } = await get("ies", "2026-10-01", "2026-10-31");
  const lunch = dayOf(j, "2026-10-01").lines.Lunch;
  assert.deepStrictEqual(lunch.find((i) => i.n === "Pepperoni Pizza").a, ["Milk", "Wheat", "Soy"]);
  assert.deepStrictEqual(lunch.find((i) => i.n === "Ranch Dressing").a, ["Egg", "Milk"]);
  assert.strictEqual(lunch.find((i) => i.n === "Kiwi").a, undefined, "no allergens means no field");
  const majors = new Set(["Milk", "Egg", "Wheat", "Soy", "Peanuts", "Tree nuts", "Fish", "Shellfish", "Sesame"]);
  const items = j.days.flatMap((d) => Object.values(d.lines).flat());
  assert.ok(items.every((i) => !i.a || i.a.every((a) => majors.has(a))));
  assert.ok(items.some((i) => i.a && i.a.includes("Egg")), "Eggs is spelled Egg, as the app's allergy picker does");
});

test("breakfast line: featured item first typed BREAKFAST, standing choices after, fruit and milk typed", async () => {
  const { j } = await get("ies", "2026-10-01", "2026-10-31");
  const bf = dayOf(j, "2026-10-01").lines.Breakfast;
  assert.deepStrictEqual(bf.map((i) => `${i.t}:${i.n}`), [
    "BREAKFAST:Strawberry & Granola Parfait", "BREAKFAST:Cereal Variety", "BREAKFAST:Mini Donuts",
    "FRUIT:Applesauce Cup", "FRUIT:Red Grapes",
    "MILK:1% Milk", "MILK:Chocolate Milk", "MILK:Skim Milk",
  ]);
  // A grains-only breakfast still has a day's item.
  const grains = dayOf(j, "2026-10-14").lines.Breakfast;
  assert.deepStrictEqual(grains[0], { n: "Bread Variety", t: "BREAKFAST", a: ["Egg", "Milk", "Wheat", "Soy"] });
  assert.deepStrictEqual(names(grains.filter((i) => i.t === "BREAKFAST")), ["Bread Variety", "Cereal Variety", "Mini Donuts"]);
  // The elementary second breakfast is its own line, named without the school year.
  const second = dayOf(j, "2026-10-01").lines["Second Chance Breakfast"];
  assert.strictEqual(second[0].n, "Blueberry Muffin");
  assert.strictEqual(second[0].t, "BREAKFAST");
  assert.ok(dayOf(j, "2026-10-01").lines.Snack, "the snack program is listed too");
});

test("high school: the hot line is Lunch; Cold Grab n' Go and Pizza are their own lines", async () => {
  const { j } = await get("bvhs", "2026-10-01", "2026-10-31");
  const day = dayOf(j, "2026-10-01");
  assert.deepStrictEqual(Object.keys(day.lines).sort(), ["Breakfast", "Cold Grab n' Go", "Lunch", "Pizza"]);
  const lunch = day.lines.Lunch;
  assert.deepStrictEqual(names(lunch.filter((i) => i.t === "ENTREES")), ["Chicken Tenders", "Grilled Chicken Patty Sandwich"]);
  assert.deepStrictEqual(lunch[2], { n: "Belgium Waffle", t: "SIDES", a: ["Milk", "Wheat", "Soy"] });
  assert.ok(lunch.some((i) => i.t === "VEGETABLES") && lunch.some((i) => i.t === "FRUIT") && lunch.some((i) => i.t === "MILK"));
  assert.ok(!names(lunch).includes("Buffalo Chicken Wrap"), "grab n' go items do not join the hot meal");
  assert.ok(names(day.lines["Cold Grab n' Go"]).includes("Buffalo Chicken Wrap"));
  assert.ok(day.lines["Cold Grab n' Go"].every((i) => i.t === "ENTREES"));
  assert.deepStrictEqual(day.lines.Pizza, [{ n: "Meateaters Pizza", t: "ENTREES", a: ["Milk", "Wheat", "Soy"] }]);
  assert.strictEqual(names(lunch).filter((n) => n === "Ranch Dressing").length, 1);
  assert.ok(names(lunch).includes("Sweet Potato Stick"), "purchasing sizes are cleaned off");
});

test("prices come from data.js, per level", async () => {
  const ies = (await get("ies", "2026-10-01", "2026-10-31")).j;
  assert.deepStrictEqual(ies.prices, { breakfast: 2.40, lunch: 3.50, milk: 0.65 });
  const hs = (await get("bvhs", "2026-10-01", "2026-10-31")).j;
  assert.strictEqual(hs.prices.lunch, 3.85);
  assert.strictEqual(hs.prices.breakfast, 2.40);
});

test("no-school notes ride along as off, and those days have no menu", async () => {
  const { j } = await get("ies", "2026-10-01", "2026-10-31");
  assert.deepStrictEqual(j.off, { "2026-10-09": "Comp Day - No School", "2026-10-12": "Staff In-Service" });
  assert.ok(!dayOf(j, "2026-10-09") && !dayOf(j, "2026-10-12"));
  // Only the requested range.
  const first = (await get("ies", "2026-10-01", "2026-10-08")).j;
  assert.deepStrictEqual(first.off, {});
  assert.strictEqual(first.days.length, 6);
});

test("name cleaning and labels", () => {
  assert.strictEqual(cleanName("Sweet Potato Stick 5#"), "Sweet Potato Stick");
  assert.strictEqual(cleanName("Croutons, BULK"), "Croutons");
  assert.strictEqual(cleanName("Cornbread, IW"), "Cornbread");
  assert.strictEqual(cleanName("Fortune Cookie, WG"), "Fortune Cookie");
  assert.strictEqual(cleanName("Chicken Nuggets (Elem)"), "Chicken Nuggets");
  assert.strictEqual(cleanName("Hot Dog on WG Bun"), "Hot Dog on WG Bun", "WG inside a name stays");
  assert.strictEqual(cleanName("Grapes, Lunch Bunch"), "Grapes, Lunch Bunch");
  assert.strictEqual(lineLabel("HS Pizza Line"), "Pizza");
  assert.strictEqual(lineLabel("Cold Grab n' Go Line"), "Cold Grab n' Go");
  assert.strictEqual(planLabel("Second Chance Breakfast 26/27"), "Second Chance Breakfast");
  assert.strictEqual(planLabel("High School Lunch SY 26/27"), "High School Lunch");
});

/* ---------- caching ---------- */

test("a 503 from LINQ serves the saved copy, marked stale; nothing saved means 502", async () => {
  const live = await get("bvhs", "2026-10-01", "2026-10-31");
  assert.strictEqual(live.r.statusCode, 200);
  // Age the saved copy past freshness so the relay goes live again.
  const file = path.join(process.env.SFP_CACHE_DIR, "menu-bvhs-2026-10-01-2026-10-31.json");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({ ...saved, at: Date.now() - 60 * 60 * 1000 }));
  down = true;
  try {
    const stale = await get("bvhs", "2026-10-01", "2026-10-31");
    assert.strictEqual(stale.r.statusCode, 200);
    assert.strictEqual(stale.r.body, live.r.body);
    assert.strictEqual(stale.r.headers["Netlify-CDN-Cache-Control"], "public, s-maxage=120");
    const none = await get("bvhs", "2026-11-01", "2026-11-30");
    assert.strictEqual(none.r.statusCode, 502);
    assert.strictEqual(none.r.headers["Cache-Control"], "no-store");
  } finally { down = false; }
});

test("a fresh saved copy is served without calling LINQ", async () => {
  await get("ies", "2026-10-13", "2026-10-17");
  lastRequest = null;
  const again = await get("ies", "2026-10-13", "2026-10-17");
  assert.strictEqual(again.r.statusCode, 200);
  assert.strictEqual(lastRequest, null, "no fetch");
  assert.strictEqual(again.j.days.length, 4, "Tue to Fri; Monday Oct 12 is the in-service day");
});

test("a body that isn't a LINQ menu is never saved", async () => {
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, headers: new Map(), json: async () => ({ message: "Service Unavailable" }), text: async () => "{}" });
  try {
    const r = await get("ies", "2026-11-02", "2026-11-06");
    assert.strictEqual(r.r.statusCode, 502);
    assert.ok(!fs.existsSync(path.join(process.env.SFP_CACHE_DIR, "menu-ies-2026-11-02-2026-11-06.json")));
  } finally { global.fetch = realFetch; }
});

test("lang=es without a translator still answers, in English, with an empty dictionary", async () => {
  const { r, j } = await get("ies", "2026-10-01", "2026-10-31", { lang: "es" });
  assert.strictEqual(r.statusCode, 200);
  assert.deepStrictEqual(j.es, {});
  assert.ok(j.esMissing > 0);
  assert.strictEqual(r.headers["Netlify-CDN-Cache-Control"], "public, s-maxage=30", "answers waiting on Spanish don't sit in the CDN");
  assert.strictEqual(dayOf(j, "2026-10-01").lines.Lunch[0].n, "Pepperoni Pizza");
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (err) { failed++; console.log(`  FAIL ${name}\n       ${String(err.message).split("\n")[0]}`); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} menu unit tests passed`);
  process.exit(failed ? 1 : 0);
})();
