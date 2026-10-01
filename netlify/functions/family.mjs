/* Family codes: a short code that holds a family's kids (school, grade,
 * activities; never a name) so they can be brought back after a phone
 * clears the site's data, or set up on a second phone. No account. */

import { getStore } from "@netlify/blobs";

const store = () => getStore({ name: "family", consistency: "strong" });
const CODE = /^[A-Z0-9]{6,12}$/; // a family's own pick: letters and numbers
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
});
const cleanKid = (k) => k && typeof k.school === "string" && Number.isInteger(k.grade) && Array.isArray(k.acts)
  ? { school: k.school, grade: k.grade, acts: k.acts.filter((a) => typeof a === "string").slice(0, 40) }
  : null;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const code = String(body.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!CODE.test(code)) return json({ error: "bad code" }, 400);

  try {
    if (body.action === "load") {
      const rec = await store().get(code, { type: "json" });
      if (!rec) return json({ error: "not found" }, 404);
      return json({ kids: rec.kids });
    }
    if (body.action === "save") {
      const kids = (Array.isArray(body.kids) ? body.kids : []).map(cleanKid).filter(Boolean).slice(0, 8);
      if (!kids.length) return json({ error: "nothing to save" }, 400);
      const rec = { kids, savedAt: Date.now() };
      if (body.create) {
        // A brand-new code must not land on someone else's.
        const r = await store().set(code, JSON.stringify(rec), { onlyIfNew: true });
        if (r && r.modified === false) return json({ error: "taken" }, 409);
      } else {
        await store().setJSON(code, rec);
      }
      return json({ ok: true });
    }
    return json({ error: "unknown action" }, 400);
  } catch (err) {
    console.error("family:", err && (err.stack || err.message || err));
    return json({ error: "unavailable" }, 502);
  }
};
