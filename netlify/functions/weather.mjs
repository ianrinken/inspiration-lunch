/* Hourly forecast for Brandon from the National Weather Service, trimmed
 * to what the app shows: the bus-time and after-school hours. The last
 * good copy is served when NWS is slow or down. */
import sources from "./lib/sources.js";

const HOURLY = "https://api.weather.gov/gridpoints/FSD/103,67/forecast/hourly";
const UA = { "User-Agent": "brandonvalleylunch.com (weather for parents)", Accept: "application/geo+json" };

// NWS wind chill, in F and mph.
function feelsLike(t, mph) {
  if (t > 50 || mph < 3) return t;
  return Math.round(35.74 + 0.6215 * t - 35.75 * mph ** 0.16 + 0.4275 * t * mph ** 0.16);
}

export default async () => {
  try {
    const j = JSON.parse(await sources.fetchText(HOURLY, UA));
    const hours = ((j.properties && j.properties.periods) || []).slice(0, 72).map((p) => {
      const wind = parseInt((String(p.windSpeed).match(/\d+/g) || ["0"]).pop(), 10);
      return {
        at: String(p.startTime).slice(0, 16),
        temp: p.temperature, wind, feels: feelsLike(p.temperature, wind),
        short: p.shortForecast || "",
        pop: p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value ? p.probabilityOfPrecipitation.value : 0,
      };
    });
    if (!hours.length) throw new Error("empty forecast");
    return new Response(JSON.stringify({ hours }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=600",
        "Netlify-CDN-Cache-Control": "public, s-maxage=1200, stale-while-revalidate=3600",
      },
    });
  } catch (err) {
    console.error("weather:", err && err.message);
    return new Response(JSON.stringify({ hours: [] }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
  }
};
