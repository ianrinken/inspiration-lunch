/* When each source was last checked, and when a district document last
 * changed. GET /.netlify/functions/status */
const { readStatus } = require("./lib/watch.js");
const { DISTRICT } = require("../../data.js");

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
  // The fund's link, recipient and share come from the district's data once
  // it is live; anything saved on the owner page wins over those.
  const base = DISTRICT.fund && (DISTRICT.fund.live || process.env.FUND_LIVE === "1") ? DISTRICT.fund : {};
  const d = don || {};
  const give = { page: d.page || base.page || "", monthly: d.monthly || [], once: d.once || [], fee: d.fee ?? base.fee ?? null, procPct: d.procPct ?? 2.99, procFixed: d.procFixed ?? 0, recipient: d.recipient || base.recipient || "", plan: base.plan || "", sent: d.sent || 0, sentAsOf: d.sentAsOf || "", goal: d.goal || 0, raised: d.raised || 0, checkDate: d.checkDate || "" };
  const giveLive = !!((give.page || give.monthly.length + give.once.length) && give.recipient && give.fee !== null);
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=120", "Netlify-CDN-Cache-Control": "public, durable, s-maxage=60, stale-while-revalidate=120" },
    // answers: the district's own answers to common questions, for search.
    body: JSON.stringify({ ...(status || { at: null, bound: {}, docs: {} }), pin: live, sponsors, donate: giveLive ? give : null, sponsorInquiries: !!(DISTRICT.sponsorInquiries || process.env.SPONSOR_INQUIRIES === "1"), answers: (answers || []).map(({ id, q, a, link, qEs, aEs }) => ({ id, q, a, link, qEs, aEs })) }),
  };
};
