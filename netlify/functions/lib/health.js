/* "Something broke" watch. After each sync, every source is marked healthy or
 * failing. Three failures in a row (about 90 minutes), or a school calendar
 * that suddenly comes back empty, sends the owner one email; recovery sends
 * another. Parents keep seeing the last good copy the whole time. */
const { load, save } = require("./sources.js");
const { sendOwnerEmail } = require("./mail.js");

const FAILS_BEFORE_EMAIL = 3;

async function recordHealth(checks) {
  const prev = JSON.parse((await load("health"))?.body || "{}");
  const next = {};
  const broke = [], fixed = [];
  for (const [name, c] of Object.entries(checks)) {
    const was = prev[name] || { fails: 0, alerted: false };
    if (c.ok) {
      if (was.alerted) fixed.push(name);
      next[name] = { fails: 0, alerted: false, lastOk: Date.now() };
    } else {
      const fails = was.fails + 1;
      const alert = fails >= FAILS_BEFORE_EMAIL && !was.alerted;
      if (alert) broke.push(`${name}: ${c.why}`);
      next[name] = { fails, alerted: was.alerted || alert, lastOk: was.lastOk || null, why: c.why };
    }
  }
  await save("health", { at: Date.now(), hash: "", body: JSON.stringify(next) });
  const mails = [];
  if (broke.length) mails.push(await sendOwnerEmail(`${broke.length} source${broke.length > 1 ? "s" : ""} failing`, `These have failed ${FAILS_BEFORE_EMAIL} checks in a row. The app is showing the last good copy until they recover.\n\n${broke.join("\n")}\n\nStatus: https://brandonvalleylunch.com/.netlify/functions/status`).catch((e) => ({ error: e.message })));
  if (fixed.length) mails.push(await sendOwnerEmail("Recovered", `Working again:\n\n${fixed.join("\n")}`).catch((e) => ({ error: e.message })));
  return { failing: Object.keys(next).filter((k) => next[k].fails), mails };
}

module.exports = { recordHealth, FAILS_BEFORE_EMAIL };
