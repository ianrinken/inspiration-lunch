/* Scheduled every 30 minutes (netlify.toml): refresh every upstream source,
 * detect game changes and new alerts, warm the school data, so parents read
 * saved copies (fast, never blank) and changes land within the hour.
 * Written in the same style as the other functions so its packages are
 * bundled (the .mjs version shipped without them). */
const { connect } = require("./lib/store.js");
const { runSync } = require("./lib/watch.js");

exports.handler = async (event) => {
  connect(event);
  const report = await runSync();
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) };
};
