/* The current Brandon Valley closings, late starts and early dismissals,
 * for the bar at the top of the app. Empty most days. */

import closings from "./lib/closings.js";

export default async () => {
  try {
    const cur = await closings.current();
    return new Response(JSON.stringify({ active: cur.active || [], since: cur.since || null, checked: cur.checked || null }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=120",
        "Netlify-CDN-Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ active: [] }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
  }
};
