/* Scheduled nightly (netlify.toml): compare what parents see with the
 * sources and email the owner when something stops matching. */
const { connect } = require("./lib/store.js");
const { runDrift } = require("./lib/drift.js");

exports.handler = async (event) => {
  connect(event);
  const report = await runDrift();
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) };
};
