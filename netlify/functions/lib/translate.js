/* Spanish for live content (menus, game titles, staff titles, news, pages).
 *
 * The relays keep their data in English, because the app's rules read it
 * ("2-hour late start", "at O'Gorman", "Lunch - Dairy Free"). With lang=es
 * they add a dictionary, { english: spanish }, for the strings in that
 * answer, and the app swaps text only where it displays it.
 *
 * Each string is translated once by Claude and saved (Netlify Blobs store
 * "tr-es", or a folder locally), so a parent never waits on a translation
 * twice and the bill stays tied to new content, not to traffic. Without an
 * ANTHROPIC_API_KEY, or when a call fails or runs out of time, the string
 * stays in English and the next request tries again.
 */
const crypto = require("crypto");
const { openStore } = require("./store.js");

const MODEL = "claude-opus-5-5";
const CHUNK_CHARS = 6000; // per request; long news articles get their own
const MAX_ITEMS = 60;
// Calls to Claude per day across everyone. New content is a few dozen calls a
// day; this ceiling keeps a runaway (or a flood of new pages) from becoming an
// open-ended bill. Past it, strings stay in English until tomorrow.
const DAILY_CALLS = 400;
const memory = new Map(); // per warm instance: english -> spanish

const SYSTEM = `You translate school information for parents in Brandon, South Dakota (the Brandon Valley School District, near Sioux Falls), from English into clear, warm Latin American Spanish that a parent reads on a phone.

Rules:
- Keep proper names exactly as written: people, schools (Brandon Valley, Inspiration, Fred Assam, Robert Bennis, Burkman Valley, and opponents like Sioux Falls Lincoln or O'Gorman), team names, mascots (Lynx), cities, buildings, venues, organizations, programs with official English names (for example DECA, FCCLA, AP, ACT, PSAT), brand names and product names.
- Translate generic words around those names: "Football: Brandon Valley at O'Gorman" becomes "Fútbol americano: Brandon Valley en O'Gorman".
- Places: keep the school or building name and translate the room words after it ("Brandon Valley High School Gym Main" -> "Brandon Valley High School, gimnasio principal"; "Commons" -> "área común").
- Food: translate the dish in plain words a family would recognize ("Lactose Free Milk" -> "Leche sin lactosa", "Chicken Nuggets" -> "Nuggets de pollo"). Keep brand names.
- HTML: keep every tag and attribute exactly as given, in the same order, and translate only the visible text between tags. Never add, drop or reorder tags. Never translate URLs, email addresses or phone numbers.
- Keep times, dates, numbers, room numbers and grade numbers as written; translate month and weekday names.
- Keep the same capitalization style (Title Case stays Title Case in Spanish style, ALL CAPS stays ALL CAPS).
- Never add explanations, notes or emoji. If a string is only a name or a code, return it unchanged.

You receive a JSON array of strings. Return {"t": [...]} with exactly one translation per input string, in the same order.`;

const keyOf = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 40);

// Nothing to translate: empty, numbers, codes, emails, URLs.
const skip = (s) => !s || !/[A-Za-z]{2}/.test(s.replace(/https?:\/\/\S+|\S+@\S+/g, ""));

let clientPromise = null;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!clientPromise) {
    const Anthropic = require("@anthropic-ai/sdk");
    clientPromise = new (Anthropic.default || Anthropic)({ maxRetries: 1, timeout: 120e3 });
  }
  return clientPromise;
}

async function underDailyCap() {
  try {
    const store = openStore("limits");
    const key = `tr-day:${new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" })}`;
    const n = ((await store.get(key)) || { n: 0 }).n + 1;
    await store.set(key, { n, at: Date.now() });
    return n <= DAILY_CALLS;
  } catch { return true; }
}

async function callClaude(list) {
  if (!(await underDailyCap())) throw new Error("daily translation cap reached");
  const res = await client().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: { type: "object", properties: { t: { type: "array", items: { type: "string" } } }, required: ["t"], additionalProperties: false },
      },
    },
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(list) }],
  });
  if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") throw new Error(`stopped: ${res.stop_reason}`);
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text).t;
}

// Tests swap in a stand-in translator.
let caller = callClaude;
const ready = () => caller !== callClaude || !!client();

function chunks(list) {
  const out = [];
  let cur = [], size = 0;
  for (const s of list) {
    if (cur.length && (size + s.length > CHUNK_CHARS || cur.length >= MAX_ITEMS)) { out.push(cur); cur = []; size = 0; }
    cur.push(s);
    size += s.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * strings: English strings shown to parents. Returns { english: spanish }
 * for every string that has a Spanish version so far. budgetMs caps how
 * long this request waits on new translations; whatever isn't back by
 * then shows in English this time.
 */
async function toSpanish(strings, { budgetMs = 5000 } = {}) {
  const store = openStore("tr-es");
  const wanted = [...new Set(strings.map((s) => String(s || "").trim()).filter((s) => !skip(s)))];
  const dict = {};
  const missing = [];
  await Promise.all(wanted.map(async (s) => {
    if (memory.has(s)) { dict[s] = memory.get(s); return; }
    const hit = await store.get(keyOf(s)).catch(() => null);
    if (hit && hit.en === s) { memory.set(s, hit.es); dict[s] = hit.es; } else missing.push(s);
  }));
  if (!missing.length || !ready() || budgetMs <= 0) return dict;
  const work = Promise.all(chunks(missing).map(async (list) => {
    try {
      const out = await caller(list);
      // One answer per string, in order, or none of it is trusted.
      if (!Array.isArray(out) || out.length !== list.length) throw new Error("translation count mismatch");
      await Promise.all(list.map((en, i) => {
        const es = String(out[i] || "").trim();
        if (!es) return null;
        memory.set(en, es);
        dict[en] = es;
        return store.set(keyOf(en), { en, es, at: Date.now() }).catch(() => {});
      }));
    } catch (err) {
      console.error("translate:", err.message || err);
    }
  }));
  await Promise.race([work, new Promise((r) => setTimeout(r, budgetMs))]);
  return { ...dict };
}

// What parents see in each relay's answer.
const COLLECT = {
  menu: (d) => (d.days || []).flatMap((day) => Object.entries(day.lines || {}).flatMap(([line, items]) => [line, ...items.map((i) => i.n)])),
  // Game nights are grouped in the app ("Gym Main and Gym Auxiliary"), so
  // the grouped venue names are sent too.
  events: (d) => (d.events || []).flatMap((e) => [e.title, e.act, e.level, e.venue])
    .concat(require("../../../shared.js").groupEvents(d.events || []).map((g) => g.venue)),
  activities: (d) => (d.activities || []).flatMap((a) => [a.act, ...(a.levels || [])]),
  weather: (d) => (d.hours || []).map((h) => h.short),
  staff: (d) => (d.people || []).flatMap((p) => [p.title, p.dept]),
  page: (d) => [d.name, ...(d.blocks || [])],
  clubs: (d) => (d.groups || []).flatMap((g) => [g.name, ...g.items]),
  news: (d) => (d.items || []).flatMap((n) => [n.title, n.html]),
  alerts: (d) => (d.alerts || []).map((a) => a.html),
  scholarships: (d) => (d.items || []).flatMap((i) => [i.name, i.about, i.deadline]),
  feed: (d) => (d.items || []).flatMap((p) => [p.html, ...(p.images || []).map((i) => i.alt)]),
  forms: (d) => (d.groups || []).flatMap((g) => [g.name, ...g.files.map((f) => f.name)]),
  supplies: (d) => [d.title, ...(d.items || []).flatMap((i) => [i.amount, i.item])],
  // The handbooks are long; the daily call cap spreads the first pass over a few days.
  handbook: (d) => (d.sections || []).flatMap((s) => [s.title, s.text]),
};

/** A relay's JSON body, plus { es: dictionary } when the app asked for Spanish. */
async function withSpanish(event, body, kind, { budgetMs } = {}) {
  const q = (event && event.queryStringParameters) || {};
  if (q.lang !== "es" || !COLLECT[kind]) return body;
  try {
    const data = JSON.parse(body);
    const wanted = COLLECT[kind](data).filter((s) => typeof s === "string" && !skip(s.trim()));
    const es = await toSpanish(wanted, { budgetMs: budgetMs != null ? budgetMs : event._budgetMs });
    const missing = new Set(wanted.map((s) => s.trim()).filter((s) => !es[s])).size;
    return JSON.stringify({ ...data, es, ...(missing ? { esMissing: missing } : {}) });
  } catch (err) {
    console.error("withSpanish:", err.message || err);
    return body;
  }
}

// Answers still waiting on translations shouldn't sit in the CDN for long.
const cdnFor = (body, normal) => (/"esMissing":[1-9]/.test(body) ? "public, s-maxage=30" : normal);

module.exports = { toSpanish, withSpanish, cdnFor, COLLECT, _internals: { chunks, skip, keyOf, useCaller: (fn) => { caller = fn || callClaude; memory.clear(); } } };
