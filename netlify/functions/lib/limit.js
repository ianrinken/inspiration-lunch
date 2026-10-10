/* Per-address request limits for the endpoints anyone can write to (family
 * codes, reports, notification sign-ups). The address is hashed with a
 * secret before it's counted, so no IP address is ever stored. Counts are
 * approximate (storage is eventually consistent), which is fine for stopping
 * floods.
 *
 * Limits are set for a crowd, not a person: phones on a school's Wi-Fi at a
 * back-to-school night, and many customers of one cell carrier, share a
 * single address. (Family code creation was once 10 an hour; the 11th family
 * at an event would have been refused.) */
const crypto = require("crypto");
const { openStore } = require("./store.js");

function clientId(event) {
  const h = (event && event.headers) || {};
  const ip = h["x-nf-client-connection-ip"] || String(h["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const salt = process.env.ADMIN_KEY || "local";
  return crypto.createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 20);
}

// Stored counts lag up to a minute behind (eventually consistent), so a fast
// burst would read zero every time. A burst from one address almost always
// lands on the same warm function instance, so count in memory too.
const memory = new Map();

/** true when this caller is over `max` requests per `minutes` for `bucket`. */
async function overLimit(event, bucket, max, minutes) {
  const win = Math.floor(Date.now() / (minutes * 60e3));
  const key = `${bucket}:${win}:${clientId(event)}`;
  const inMemory = (memory.get(key) || 0) + 1;
  memory.set(key, inMemory);
  if (memory.size > 5000) memory.clear();
  if (inMemory > max) return true;
  try {
    const store = openStore("limits");
    const n = ((await store.get(key)) || { n: 0 }).n + 1;
    await store.set(key, { n, at: Date.now() });
    return n > max;
  } catch {
    return false; // never block a parent because the counter itself failed
  }
}

const tooMany = () => ({ statusCode: 429, headers: { "Content-Type": "application/json", "Retry-After": "600" }, body: JSON.stringify({ error: "Too many requests. Try again in a few minutes." }) });

module.exports = { overLimit, tooMany, clientId };
