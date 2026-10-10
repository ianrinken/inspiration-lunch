/* Scheduled hourly (netlify.toml): at 7 PM Central on evenings before a
 * school day (Sunday through Thursday), send each subscribed phone its
 * heads-up. Sunday's message covers the whole week. */
const { connect } = require("./lib/store.js");
const { buildDigest, buildWeekAhead, broadcast } = require("./lib/notify.js");

exports.handler = async (event) => {
  connect(event);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false, weekday: "short" })
    .formatToParts(new Date()).reduce((o, p) => ((o[p.type] = p.value), o), {});
  const hour = parseInt(parts.hour, 10) % 24;
  const force = event && event.queryStringParameters && event.queryStringParameters.force === "1" && !process.env.NETLIFY_BLOBS_CONTEXT;
  if (!force && (hour !== 19 || parts.weekday === "Fri" || parts.weekday === "Sat")) return { statusCode: 200, body: `not now (${parts.weekday} ${hour}h Central)` };
  const cache = {};
  const build = parts.weekday === "Sun" ? buildWeekAhead : buildDigest;
  const result = await broadcast((record) => (record.prefs && record.prefs.evening === false ? null : build(record, cache)));
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) };
};
