/* Parents' mistake reports, anonymous daily usage counts, and the owner's
 * corrections (overrides) to events.
 *
 *   POST { kind: "report", id, date, title, school, note }   a parent flags an event
 *   POST { kind: "use", features: ["subscribe", ...] }        once per device per day per feature
 *   GET  ?key=ADMIN_KEY                                        everything, for admin.html
 *   POST { kind: "overrides", key, list }                     replace the corrections
 *   POST { kind: "resolve", key, id }                         drop a report
 *
 * No names, no identifiers: a usage count is a number per feature per
 * day, a report is the event plus whatever the parent typed.
 */
import { getStore } from "@netlify/blobs";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
});
const FEATURES = new Set(["open", "kids", "subscribe", "apple", "google", "supplies", "school", "family", "share", "push", "viewer", "student", "report"]);
const day = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
const ok = (key) => { const k = Netlify.env.get("ADMIN_KEY"); return !!k && typeof key === "string" && key === k; };
const clip = (v, n) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);

async function bump(features) {
  const store = getStore({ name: "usage", consistency: "strong" });
  const key = `use:${day()}`;
  const cur = (await store.get(key, { type: "json" })) || {};
  for (const f of features) cur[f] = (cur[f] || 0) + 1;
  await store.setJSON(key, cur);
}

async function everything() {
  const [reports, usage, overrides] = await Promise.all([
    (async () => {
      const s = getStore({ name: "reports" });
      const { blobs } = await s.list();
      const keys = blobs.map((b) => b.key).sort().reverse().slice(0, 100);
      const list = await Promise.all(keys.map(async (k) => { const r = await s.get(k, { type: "json" }); return r ? { key: k, ...r } : null; }));
      return list.filter(Boolean);
    })(),
    (async () => {
      const s = getStore({ name: "usage" });
      const out = {};
      const d = new Date();
      for (let i = 0; i < 14; i++) {
        const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(d.getTime() - i * 86400000));
        out[iso] = (await s.get(`use:${iso}`, { type: "json" })) || {};
      }
      return out;
    })(),
    getStore({ name: "overrides" }).get("events", { type: "json" }).then((v) => v || []),
  ]);
  return { reports, usage, overrides };
}

const cleanOverride = (o) => o && typeof o.id === "string" && /^[a-z0-9]{1,8}$/.test(o.id)
  ? {
      id: o.id,
      ...(o.date && /^\d{4}-\d\d-\d\d$/.test(o.date) ? { date: o.date } : {}),
      ...(o.hide ? { hide: true } : {}),
      ...(o.title ? { title: clip(o.title, 120) } : {}),
      ...(Array.isArray(o.grades) ? { grades: o.grades.map(Number).filter((g) => Number.isInteger(g) && g >= -1 && g <= 12) } : {}),
      ...(o.act !== undefined ? { act: clip(o.act, 40) } : {}),
      ...(o.why ? { why: clip(o.why, 160) } : {}),
    }
  : null;

export default async (req) => {
  const url = new URL(req.url);
  try {
    if (req.method === "GET") {
      if (!ok(url.searchParams.get("key"))) return json({ error: "forbidden" }, 403);
      return json(await everything());
    }
    if (req.method !== "POST") return json({ error: "method" }, 405);
    let body;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

    if (body.kind === "use") {
      const feats = (Array.isArray(body.features) ? body.features : []).filter((f) => FEATURES.has(f)).slice(0, 20);
      if (feats.length) await bump(feats);
      return json({ ok: true });
    }
    if (body.kind === "report") {
      const rec = {
        at: Date.now(), id: clip(body.id, 12), date: clip(body.date, 10), title: clip(body.title, 160),
        school: clip(body.school, 40), note: clip(body.note, 300), ua: clip(req.headers.get("user-agent"), 80),
      };
      if (!rec.title && !rec.note) return json({ error: "empty" }, 400);
      await getStore({ name: "reports" }).setJSON(`${String(rec.at).padStart(14, "0")}-${Math.random().toString(36).slice(2, 7)}`, rec);
      return json({ ok: true });
    }
    if (!ok(body.key)) return json({ error: "forbidden" }, 403);
    if (body.kind === "overrides") {
      const list = (Array.isArray(body.list) ? body.list : []).map(cleanOverride).filter(Boolean).slice(0, 500);
      await getStore({ name: "overrides" }).setJSON("events", list);
      return json({ ok: true, count: list.length });
    }
    if (body.kind === "resolve") {
      if (typeof body.id === "string" && /^[0-9]{14}-[a-z0-9]{1,8}$/.test(body.id)) await getStore({ name: "reports" }).delete(body.id);
      return json({ ok: true });
    }
    return json({ error: "unknown" }, 400);
  } catch (err) {
    console.error("report:", err && (err.stack || err.message || err));
    return json({ error: "unavailable" }, 502);
  }
};
