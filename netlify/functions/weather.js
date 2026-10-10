/* Bus-stop weather: the National Weather Service hourly forecast for Brandon
 * Valley, trimmed to what a parent checks before school and at dismissal.
 * GET /.netlify/functions/weather  ->  { hours: [{ at: "2026-10-01T07:00", temp, wind, feels, short, pop }] }
 */
const { load, save } = require("./lib/sources.js");
const { withSpanish, cdnFor } = require("./lib/translate.js");

const HOURLY = "https://api.weather.gov/gridpoints/FSD/103,67/forecast/hourly";
const UA = "brandonvalleylunch.com (scratchmarketing.net)";

// NWS wind chill formula (F, mph); only meaningful at 50F and below with wind.
function feelsLike(t, mph) {
  if (t > 50 || mph < 3) return t;
  return Math.round(35.74 + 0.6215 * t - 35.75 * mph ** 0.16 + 0.4275 * t * mph ** 0.16);
}

exports.handler = async (event) => {
  require("./lib/store.js").connect(event);
  const saved = await load("weather").catch(() => null);
  let body = saved && Date.now() - saved.at < 30 * 60e3 ? saved.body : null;
  if (!body) {
    try {
      const res = await fetch(HOURLY, { headers: { "User-Agent": UA, Accept: "application/geo+json" } });
      if (res.status !== 200) throw new Error(`NWS ${res.status}`);
      const j = await res.json();
      const hours = (j.properties.periods || []).slice(0, 72).map((p) => {
        const wind = parseInt(String(p.windSpeed).match(/\d+/g)?.pop() || "0", 10);
        return {
          at: String(p.startTime).slice(0, 16), // local Central time as published
          temp: p.temperature,
          wind,
          feels: feelsLike(p.temperature, wind),
          short: p.shortForecast,
          pop: p.probabilityOfPrecipitation ? p.probabilityOfPrecipitation.value || 0 : 0,
        };
      });
      if (!hours.length) throw new Error("empty forecast");
      body = JSON.stringify({ hours });
      await save("weather", { at: Date.now(), hash: "", body }).catch(() => {});
    } catch (err) {
      if (!saved) return { statusCode: 502, headers: { "Cache-Control": "no-store" }, body: JSON.stringify({ error: "Forecast unavailable" }) };
      body = saved.body;
    }
  }
  body = await withSpanish(event, body, "weather");
  return { statusCode: 200, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600", "Netlify-CDN-Cache-Control": cdnFor(body, "public, s-maxage=1200") }, body };
};

exports._internals = { feelsLike };
