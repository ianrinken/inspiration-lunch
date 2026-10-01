/* Evening heads-up subscriptions. Stores a device's push address and the
 * kids it should hear about (school, grade, activities; never a name),
 * and can send that device its own digest right now as a test. */

import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import digest from "./lib/digest.js";

const { buildDigest, send } = digest;
const store = () => getStore({ name: "push", consistency: "strong" });
const keyFor = (endpoint) => createHash("sha256").update(endpoint).digest("hex");
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
  const sub = body.sub;
  const endpoint = (sub && sub.endpoint) || body.endpoint;
  if (!endpoint || !/^https:\/\//.test(endpoint)) return json({ error: "bad subscription" }, 400);
  const key = keyFor(endpoint);

  try {
    if (body.action === "unsubscribe") {
      await store().delete(key);
      return json({ ok: true });
    }
    if (body.action === "subscribe") {
      if (!sub || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return json({ error: "bad subscription" }, 400);
      const kids = (Array.isArray(body.kids) ? body.kids : []).map(cleanKid).filter(Boolean).slice(0, 8);
      const record = {
        sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
        kids, school: typeof body.school === "string" ? body.school : null,
        role: body.role === "student" ? "student" : "parent", savedAt: Date.now(),
      };
      await store().setJSON(key, record);
      return json({ ok: true });
    }
    if (body.action === "test") {
      const record = await store().get(key, { type: "json" });
      if (!record) return json({ error: "not subscribed" }, 404);
      const d = await buildDigest(record, {});
      await send(record, d || { title: "Brandon Valley Lunch", body: "Nothing on the calendar for the next school day.", url: "/" });
      return json({ ok: true, sent: d });
    }
    return json({ error: "unknown action" }, 400);
  } catch (err) {
    const gone = err && (err.statusCode === 404 || err.statusCode === 410);
    if (gone) { try { await store().delete(key); } catch {} }
    console.error("push:", err && (err.stack || err.message || err));
    return json({ error: gone ? "subscription expired" : "push unavailable" }, gone ? 410 : 502);
  }
};
