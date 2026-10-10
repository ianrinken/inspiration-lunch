/* Push subscriptions. Stores a device's push address, its family code (or
 * a snapshot of school, class and teams per student) and which messages it
 * wants. Never a name.
 *
 * POST { action: "subscribe", sub, family?, kids?, prefs }
 * POST { action: "unsubscribe", endpoint }
 * POST { action: "test", endpoint }   send this device tonight's heads-up now
 */
const crypto = require("crypto");
const { openStore } = require("./lib/store.js");
const { overLimit, tooMany } = require("./lib/limit.js");
const { buildDigest, send } = require("./lib/notify.js");

const json = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });
const keyFor = (endpoint) => crypto.createHash("sha256").update(endpoint).digest("hex");
const cleanKids = (list) => require("./family.js")._internals.cleanKids(list);

exports.handler = async (event) => {
  require("./lib/store.js").connect(event);
  if (event.httpMethod && event.httpMethod !== "POST") return json(405, { error: "POST only" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "bad json" }); }
  const sub = body.sub;
  const endpoint = (sub && sub.endpoint) || body.endpoint;
  if (!endpoint || !/^https:\/\//.test(endpoint)) return json(400, { error: "bad subscription" });
  if (await overLimit(event, `push-${body.action}`, body.action === "test" ? 60 : 300, 60)) return tooMany();
  const store = openStore("push");
  const key = keyFor(endpoint);
  try {
    if (body.action === "unsubscribe") { await store.delete(key); return json(200, { ok: true }); }
    if (body.action === "subscribe") {
      if (!sub.keys || !sub.keys.p256dh || !sub.keys.auth) return json(400, { error: "bad subscription" });
      const family = require("./family.js")._internals.CODE.test(String(body.family || "")) ? String(body.family).toUpperCase() : null;
      const mute = (Array.isArray(body.prefs?.mute) ? body.prefs.mute : []).map((x) => String(x).replace(/[^a-z0-9]/gi, "").slice(0, 16)).filter(Boolean).slice(0, 8);
      const prefs = { evening: body.prefs?.evening !== false, changes: body.prefs?.changes !== false, alerts: body.prefs?.alerts !== false, mute };
      await store.set(key, { sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, family, kids: family ? [] : cleanKids(body.kids), prefs, lang: body.lang === "es" ? "es" : "en", savedAt: Date.now() });
      return json(200, { ok: true });
    }
    if (body.action === "test") {
      const record = await store.get(key);
      if (!record) return json(404, { error: "not subscribed" });
      const d = await buildDigest(record, {});
      await send(record, d || { title: "Brandon Valley Lunch", body: "Notifications are on. Nothing is scheduled for tomorrow yet.", url: "/#today", tag: "sfp-test" });
      return json(200, { ok: true, sent: d });
    }
    return json(400, { error: "unknown action" });
  } catch (err) {
    const gone = err && (err.statusCode === 404 || err.statusCode === 410);
    if (gone) await store.delete(key).catch(() => {});
    console.error("push:", err && (err.stack || err.message));
    return json(gone ? 410 : 502, { error: gone ? "subscription expired" : "push unavailable" });
  }
};
