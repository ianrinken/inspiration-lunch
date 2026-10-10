/* When each source was last checked, and when a district document last
 * changed. GET /.netlify/functions/status */
const { readStatus } = require("./lib/watch.js");

exports.handler = async (event) => {
  require("./lib/store.js").connect(event);
  const status = await readStatus().catch(() => null);
  // The district's pinned announcement, until its end date (Central time).
  const settings = require("./lib/store.js").openStore("settings");
  const [pin, answers] = await Promise.all([settings.get("pin").catch(() => null), settings.get("answers").catch(() => null)]);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const live = pin && (!pin.until || pin.until >= today) ? { id: pin.id, text: pin.text, es: pin.es || "" } : null;
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=120", "Netlify-CDN-Cache-Control": "public, s-maxage=60" },
    // answers: the district's own answers to common questions, for search.
    body: JSON.stringify({ ...(status || { at: null, bound: {}, docs: {} }), pin: live, answers: (answers || []).map(({ id, q, a, link, qEs, aEs }) => ({ id, q, a, link, qEs, aEs })) }),
  };
};
