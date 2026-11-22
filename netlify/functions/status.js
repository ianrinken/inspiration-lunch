/* When each source was last checked, and when a district document last
 * changed. GET /.netlify/functions/status */
const { readStatus } = require("./lib/watch.js");

exports.handler = async (event) => {
  require("./lib/store.js").connect(event);
  const status = await readStatus().catch(() => null);
  // The district's pinned announcement, until its end date (Central time).
  const settings = require("./lib/store.js").openStore("settings");
  const [pin, answers, sp, don] = await Promise.all([settings.get("pin").catch(() => null), settings.get("answers").catch(() => null), settings.get("sponsors").catch(() => null), settings.get("donate").catch(() => null)]);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const live = pin && (!pin.until || pin.until >= today) ? { id: pin.id, text: pin.text, es: pin.es || "" } : null;
  // One sponsor per screen, each through its end date.
  const sponsors = {};
  for (const [tab, x] of Object.entries(sp || {})) if (x && x.name && (!x.until || x.until >= today)) sponsors[tab] = { name: x.name, line: x.line || "", url: x.url, logo: x.logo || "" };
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=120", "Netlify-CDN-Cache-Control": "public, s-maxage=60" },
    // answers: the district's own answers to common questions, for search.
    body: JSON.stringify({ ...(status || { at: null, bound: {}, docs: {} }), pin: live, sponsors, donate: don && (don.page || (don.monthly || []).length + (don.once || []).length) && don.recipient && don.fee !== null && don.fee !== undefined ? { page: don.page || "", monthly: don.monthly || [], once: don.once || [], fee: don.fee, procPct: don.procPct ?? 2.99, procFixed: don.procFixed ?? 0, recipient: don.recipient, sent: don.sent || 0, sentAsOf: don.sentAsOf || "", goal: don.goal || 0, raised: don.raised || 0, checkDate: don.checkDate || "" } : null, answers: (answers || []).map(({ id, q, a, link, qEs, aEs }) => ({ id, q, a, link, qEs, aEs })) }),
  };
};
