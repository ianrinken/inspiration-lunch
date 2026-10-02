/* What the supply-list watch last saw, per school, and how far the Google
 * Calendar mirror has got. For a quick glance. */
import { getStore } from "@netlify/blobs";
import watch from "./lib/watch.js";

export default async () => {
  try {
    const supplies = await watch.status();
    const rec = (await getStore({ name: "mirror" }).get("calendars", { type: "json" }).catch(() => null)) || null;
    const cals = rec ? Object.values(rec.calendars || {}) : [];
    const mirror = {
      reported: rec && rec.reported ? new Date(rec.reported).toISOString() : null,
      calendars: cals.length,
      filled: cals.filter((c) => c.synced).length,
    };
    return new Response(JSON.stringify({ supplies, mirror }, null, 1), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "status unavailable" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
};
