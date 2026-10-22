/* Scheduled hourly (netlify.toml): at 7 PM Central on evenings before a
 * school day (Sunday through Thursday), send each subscribed phone its
 * heads-up. Sunday's message covers the whole week. Every run, including
 * the hours it sits out, leaves a heartbeat ("notify-run" in the sources
 * store), so a schedule that stopped firing can be told from a quiet one. */
const { connect } = require("./lib/store.js");
const { buildDigest, buildWeekAhead, broadcast } = require("./lib/notify.js");
const { save } = require("./lib/sources.js");

// Best effort: a heartbeat that cannot be written never stops the messages.
const beat = (what) => save("notify-run", { at: Date.now(), hash: "", body: JSON.stringify(what) }).catch(() => {});

exports.handler = async (event) => {
  connect(event);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false, weekday: "short" })
    .formatToParts(new Date()).reduce((o, p) => ((o[p.type] = p.value), o), {});
  const hour = parseInt(parts.hour, 10) % 24;
  const force = event && event.queryStringParameters && event.queryStringParameters.force === "1" && !process.env.NETLIFY_BLOBS_CONTEXT;
  if (!force && (hour !== 19 || parts.weekday === "Fri" || parts.weekday === "Sat")) {
    await beat({ sent: false, why: `not now (${parts.weekday} ${hour}h Central)` });
    return { statusCode: 200, body: `not now (${parts.weekday} ${hour}h Central)` };
  }
  const cache = {};
  const build = parts.weekday === "Sun" ? buildWeekAhead : buildDigest;
  const result = await broadcast((record) => (record.prefs && record.prefs.evening === false ? null : build(record, cache)));
  await beat({ sent: true, result });
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) };
};
