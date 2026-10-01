/* What the supply-list watch last saw, per school. For a quick glance. */
import watch from "./lib/watch.js";

export default async () => {
  try {
    return new Response(JSON.stringify(await watch.status(), null, 1), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "status unavailable" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
};
