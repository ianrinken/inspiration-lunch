/* Every ten minutes from 5 am to 11 pm Central: look for Brandon Valley on
 * KELOLAND's closings list. A new or changed entry (closed, late start,
 * early dismissal) is pushed to every phone with notifications on and
 * shown as a bar in the app. See lib/closings.js. */

import closings from "./lib/closings.js";
import digest from "./lib/digest.js";

export default async () => {
  const hour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false })
    .format(new Date()), 10) % 24;
  if (hour < 5 || hour >= 23) return new Response(`not now (${hour}h Central)`);
  try {
    const { fresh, active, changed } = await closings.check();
    const sent = await closings.announce(fresh, digest.send);
    const line = `closings: ${active.length} active${changed ? " (changed)" : ""}, ${fresh.length} new, ${sent} notified`;
    console.log(line);
    return new Response(line);
  } catch (err) {
    console.error("closings:", err && (err.stack || err.message || err));
    return new Response("closings check failed", { status: 502 });
  }
};

export const config = { schedule: "*/10 * * * *" };
