/* Scheduled every 10 minutes (netlify.toml). Brandon Valley reports closings,
 * late starts and early dismissals to KELOLAND; snow-day calls go out around
 * 5 to 6 AM, early dismissals at midday and next-day calls in the evening,
 * so from 5:00 AM to 11:00 PM Central every day this checks the list every
 * ten minutes instead of waiting for the half-hourly sync. Overnight it
 * exits immediately. */
const { connect } = require("./lib/store.js");
const { checkAlerts } = require("./lib/watch.js");

const OPEN = 500, CLOSE = 2300;

exports.handler = async (event) => {
  connect(event);
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "numeric", hour12: false })
    .formatToParts(new Date()).reduce((o, x) => ((o[x.type] = x.value), o), {});
  const hm = (parseInt(p.hour, 10) % 24) * 100 + parseInt(p.minute, 10);
  if (hm < OPEN || hm >= CLOSE) return { statusCode: 200, body: "outside the daytime window" };
  const result = await checkAlerts();
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) };
};
