/* Builds the evening heads-up for one subscription: tomorrow's lunch and
 * events for each child (or for one school). Shared by the scheduled
 * sender and the "send me a test" button. */

const webpush = require("web-push");
const { eventsFor, allowsFor, SCHOOL_NAMES, toCentral, addDays } = require("../events.js");

const VAPID_PUBLIC = "BPwNi91GO_Q3BvtYJodMYYajTDU3b_opYxbzXLS7r4TDpdPaMqX4NWx-TSVW-trBTi8GZV-ob8TqKKuQELU1SI8";
const LINQ = "https://api.linqconnect.com/api/FamilyMenu";
const DISTRICT_ID = "b1d7358a-818b-ec11-90c7-d2d97b40e955";
const ALTERNATE_RX = /bagel bag|uncrustable|jammer/i;
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

function configure() {
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!priv) throw new Error("VAPID_PRIVATE_KEY is not set");
  webpush.setVapidDetails("https://brandonvalleylunch.com", VAPID_PUBLIC, priv);
}

// The next weekday after today (Central). Friday and Saturday evenings
// have nothing to say; Sunday's message is about Monday.
function nextSchoolDay() {
  const today = toCentral(new Date()).date;
  let d = addDays(today, 1);
  for (let i = 0; i < 3; i++) {
    const dow = new Date(`${d}T12:00:00`).getUTCDay();
    if (dow !== 0 && dow !== 6) return d;
    d = addDays(d, 1);
  }
  return d;
}

// Tomorrow's hot entrée at one school, from LINQ. The menu API answers
// browsers only, so this asks like one.
async function lunchFor(school, iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const url = `${LINQ}?buildingId=${school}&districtId=${DISTRICT_ID}&startDate=${m}-${d}-${y}&endDate=${m}-${d}-${y}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", Accept: "application/json" } });
    if (!r.ok) return null;
    const json = await r.json();
    for (const session of json.FamilyMenuSessions || []) {
      if (session.ServingSession !== "Lunch") continue;
      for (const plan of session.MenuPlans || []) {
        for (const day of plan.Days || []) {
          if (day.Date !== `${m}/${d}/${y}` && day.Date !== `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`) continue;
          for (const meal of day.MenuMeals || []) {
            for (const cat of meal.RecipeCategories || []) {
              if (!/entr/i.test(cat.CategoryName || "")) continue;
              const hot = (cat.Recipes || []).map((x) => x.RecipeName).find((n) => n && !ALTERNATE_RX.test(n));
              if (hot) return hot.replace(/\s*\((?:ELEM|MS|HS)\)\s*/gi, " ").replace(/,\s*Frozen/i, "").replace(/\s+/g, " ").trim();
            }
          }
        }
      }
    }
  } catch { /* lunch is a bonus */ }
  return null;
}

const compact = (t) => t.replace(/^([^:]+):\s*Brandon Valley\s+(vs|at)\s+/, "$1 $2 ").replace(/\s*\((?:Fall|Spring|Winter)\)/, "");

// { title, body } for one subscription, or null when there's nothing to say.
async function buildDigest(record, cache) {
  const day = nextSchoolDay();
  const label = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "America/Chicago" }).format(new Date(`${day}T12:00:00Z`));
  const targets = (record.kids && record.kids.length)
    ? record.kids
    : [{ school: record.school, grade: null, acts: [] }];
  const lines = [];
  for (const t of targets) {
    if (!SCHOOL_NAMES[t.school]) continue;
    const key = `${t.school}|${day}`;
    if (!cache[key]) {
      cache[key] = Promise.all([
        eventsFor(t.school, day, addDays(day, 1)).catch(() => []),
        lunchFor(t.school, day),
      ]);
    }
    const [events, lunch] = await cache[key];
    const mine = events.filter((ev) => allowsFor(ev, t.grade, t.acts));
    const parts = [];
    if (lunch) parts.push(`Lunch: ${lunch}`);
    for (const ev of mine.slice(0, 3)) {
      parts.push(`${ev.x ? (ev.x === "postponed" ? "Postponed: " : "Cancelled: ") : ""}${compact(ev.t)}${ev.time ? ` ${ev.time}` : ""}`);
    }
    if (mine.length > 3) parts.push(`+${mine.length - 3} more`);
    if (!parts.length) continue;
    const who = t.grade === null || t.grade === undefined
      ? SCHOOL_NAMES[t.school]
      : `${t.grade === -1 ? "Jr. K" : t.grade === 0 ? "K" : `${t.grade}${["th", "st", "nd", "rd"][(t.grade % 100 > 10 && t.grade % 100 < 14) || t.grade % 10 > 3 ? 0 : t.grade % 10]}`} · ${SHORT[t.school]}`;
    lines.push(targets.length > 1 ? `${who}: ${parts.join(" · ")}` : parts.join(" · "));
  }
  if (!lines.length) return null;
  const who = record.role === "student" ? "you"
    : targets.length > 1 ? "your kids" : (targets[0].grade === null || targets[0].grade === undefined ? SHORT[targets[0].school] : "your child");
  return { title: `${label} for ${who}`, body: lines.join("\n"), url: "/", day };
}

// A student's game-day ping: today's competitions for them, morning of.
async function buildGameDay(record, cache) {
  const today = toCentral(new Date()).date;
  const t = (record.kids && record.kids[0]) || null;
  if (!t || !SCHOOL_NAMES[t.school]) return null;
  const key = `gd|${t.school}|${today}`;
  if (!cache[key]) cache[key] = eventsFor(t.school, today, addDays(today, 1)).catch(() => []);
  const events = await cache[key];
  const games = events.filter((ev) => allowsFor(ev, t.grade, t.acts) && ev.home !== undefined && !ev.x);
  if (!games.length) return null;
  const lines = games.slice(0, 3).map((ev) =>
    `${compact(ev.t)}${ev.time ? ` ${ev.time}` : ""} · ${ev.home ? "Home" : "Away"}${ev.where ? ` · ${ev.where}` : ""}`);
  if (games.length > 3) lines.push(`+${games.length - 3} more`);
  return { title: games.length === 1 ? "Game day" : `Game day: ${games.length} today`, body: lines.join("\n"), url: "/", day: today };
}

async function send(record, payload) {
  configure();
  await webpush.sendNotification(record.sub, JSON.stringify(payload), { TTL: 6 * 60 * 60 });
}

module.exports = { buildDigest, buildGameDay, send, nextSchoolDay, VAPID_PUBLIC };
