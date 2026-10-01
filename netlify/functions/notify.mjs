/* Runs hourly; sends the evening heads-up at 7 pm Central on evenings
 * before a school day. One digest per device, built from the kids it
 * asked about. Dead subscriptions are dropped. */

import { getStore } from "@netlify/blobs";
import digest from "./lib/digest.js";

const { buildDigest, buildGameDay, send, nextSchoolDay } = digest;

export default async () => {
  const central = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false, weekday: "short" })
    .formatToParts(new Date()).reduce((o, p) => ((o[p.type] = p.value), o), {});
  const hour = parseInt(central.hour, 10) % 24;
  // 7 pm: the evening heads-up for everyone. 7 am: a game-day ping for
  // students who have a game today.
  const morning = hour === 7;
  if (hour !== 19 && !morning) return new Response(`not now (${central.weekday} ${hour}h Central)`);
  if (!morning && (central.weekday === "Fri" || central.weekday === "Sat")) return new Response("no school tomorrow");

  const store = getStore({ name: "push", consistency: "strong" });
  const cache = {};
  let sent = 0, skipped = 0, dropped = 0;
  const { blobs } = await store.list();
  for (const { key } of blobs) {
    const record = await store.get(key, { type: "json" });
    if (!record || !record.sub) { await store.delete(key); dropped++; continue; }
    if (morning && record.role !== "student") { skipped++; continue; }
    try {
      const d = morning ? await buildGameDay(record, cache) : await buildDigest(record, cache);
      if (!d) { skipped++; continue; }
      await send(record, d);
      sent++;
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) { await store.delete(key); dropped++; }
      else { skipped++; console.error("notify:", err && err.message); }
    }
  }
  const summary = `${morning ? "game day" : `day ${nextSchoolDay()}`}: sent ${sent}, skipped ${skipped}, dropped ${dropped}`;
  console.log(summary);
  return new Response(summary);
};

export const config = { schedule: "0 * * * *" };
