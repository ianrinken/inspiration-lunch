/* Mirrored Google Calendars.
 *
 * Google's phone apps can't subscribe to a calendar feed by link; the only
 * thing they add in one tap is one of Google's own calendars. So a small
 * script in the site owner's Google account (tools/google-mirror.gs) keeps
 * one public Google Calendar per grade (school-wide plus that grade's
 * events) and one per activity, filled from this site's own feeds, and
 * reports their ids here. The app then offers "Add to Google Calendar"
 * as the one tap Google allows.
 *
 *   GET  ?list=1   the calendars the script should keep: key, name, feed
 *   GET            the ids the script has reported (what the app reads)
 *   POST           the script's report { secret, calendars }
 *
 * Keys and feed addresses use each school's LINQ id, as the first app did,
 * so the calendars the script already built are kept rather than rebuilt.
 */
import { getStore } from "@netlify/blobs";
import events from "./events.js";

const SITE = "https://brandonvalleylunch.com";
const store = () => getStore({ name: "mirror", consistency: "strong" });
const json = (body, status = 200, cache = "no-store") => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": cache },
});

const gradeLabel = (g) => (g === -1 ? "Junior kindergarten" : g === 0 ? "Kindergarten" : `Grade ${g}`);

// Secondary schools first: that's where activities live and where the
// phone-only Google users were stuck.
const ORDER = ["bvhs", "bvms", "bvis"];

// Every calendar the script should keep, in the order it should get to
// them: every grade at every school first (so each child's view works
// within the first few hours), then whole schools, then activities. Keys
// are stable so a calendar survives renames: g:<linq>:<grade>,
// ga:<linq>:<grade>, s:<linq>, a:<linq>:<activity>.
export async function needed() {
  const schools = [...ORDER, ...Object.keys(events.SCHOOLS).filter((s) => !ORDER.includes(s))];
  const grades = [], whole = [], acts = [], gradesAll = [];
  for (const id of schools) {
    const school = events.SCHOOLS[id];
    const key = school.linq || id;
    const name = school.name;
    const [lo, hi] = school.grades;
    for (let g = lo; g <= hi; g++) {
      grades.push({ key: `g:${key}:${g}`, name: `${name} · ${gradeLabel(g)}`, feed: `${SITE}/feed/${key}/${g}/none/calendar.ics` });
      // Secondary schools also get the grade plus every activity: the view
      // of a child with no activities picked.
      if (lo >= 5) gradesAll.push({ key: `ga:${key}:${g}`, name: `${name} · ${gradeLabel(g)} with activities`, feed: `${SITE}/feed/${key}/${g}/all/calendar.ics` });
    }
    whole.push({ key: `s:${key}`, name: `${name} · All events`, feed: `${SITE}/feed/${key}/all/all/calendar.ics` });
    let list = [];
    try { list = await events.activitiesFor(id); } catch { /* a school without activities is fine */ }
    for (const act of list) {
      acts.push({ key: `a:${key}:${act}`, name: `${name} · ${act}`, feed: `${SITE}/feed/${key}/all/${encodeURIComponent(act)}/calendar.ics?only=1` });
    }
  }
  return [...grades, ...gradesAll, ...whole, ...acts];
}

const cleanEntry = (e) => e && typeof e.id === "string" && /^[\w.-]+@(group\.)?calendar\.google\.com$/.test(e.id)
  ? { id: e.id, name: String(e.name || "").slice(0, 120), synced: !!e.synced, count: Number(e.count) || 0 }
  : null;

export default async (req) => {
  const url = new URL(req.url);
  try {
    if (req.method === "GET") {
      if (url.searchParams.get("list") === "1") {
        return json({ calendars: await needed() }, 200, "public, max-age=600");
      }
      const rec = (await store().get("calendars", { type: "json" })) || { calendars: {}, reported: 0 };
      return json(rec, 200, "public, max-age=300");
    }
    if (req.method === "POST") {
      const secret = Netlify.env.get("MIRROR_SECRET");
      let body;
      try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
      if (!secret || typeof body.secret !== "string" || body.secret !== secret) return json({ error: "forbidden" }, 403);
      const calendars = {};
      for (const [key, entry] of Object.entries(body.calendars || {})) {
        if (!/^(g|ga|a|s):/.test(key) || key.length > 200) continue;
        const c = cleanEntry(entry);
        if (c) calendars[key] = c;
      }
      await store().setJSON("calendars", { calendars, reported: Date.now() });
      return json({ ok: true, calendars: Object.keys(calendars).length });
    }
    return json({ error: "method" }, 405);
  } catch (err) {
    console.error("mirror:", err && (err.stack || err.message || err));
    return json({ error: "unavailable" }, 502);
  }
};
