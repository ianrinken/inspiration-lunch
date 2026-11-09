/* One public page per school, written into dist/ at build time, so a parent
 * who searches "BV High lunch menu" or "Inspiration supply list" lands on
 * something Google can read: the school's hours, days off, handbook and
 * supply list, with this week's menu and the next events filled in live.
 * Every page's one button opens the app for that school. */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const DATA = require(path.join(ROOT, "data.js"));
const HB = require(path.join(ROOT, "handbooks.js"));
const SFHANDBOOKS = HB.SFHANDBOOKS || HB;

const SITE = "https://brandonvalleylunch.com";
const SLUG = { bes: "brandon-elementary", bve: "burkman-valley", fae: "fred-assam", ies: "inspiration", rbe: "robert-bennis", bvis: "bv-intermediate", bvms: "bv-middle", bvhs: "bv-high" };
const LEVEL = { es: "elementary school", is: "intermediate school", ms: "middle school", hs: "high school" };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

function schedules(s) {
  const hb = SFHANDBOOKS[s.id];
  const list = (hb && hb.schedules || []).filter((x) => !/test/i.test(x.name));
  if (!list.length) return `<p>School runs ${s.bell.start} AM to ${s.bell.end} PM${s.bell.about ? " (typical for the district; the school has not published exact times)" : ""}.</p>`;
  return list.map((x, i) => `
      <details class="fold" ${i === 0 ? "open" : ""}><summary>${esc(x.name)}</summary>
        <table class="bell"><tbody>${x.rows.map((r) => `<tr><th>${esc(r.label)}</th><td>${esc(r.start || "")}${r.start && r.end ? " to " : ""}${esc(r.end || "")}</td></tr>`).join("")}</tbody></table>
        ${x.note ? `<p class="fine">${esc(x.note)}</p>` : ""}
      </details>`).join("");
}
function daysOff(s) {
  const year = DATA.SCHOOL_YEARS[0];
  const grades = [];
  for (let g = s.grades[0]; g <= s.grades[1]; g++) grades.push(g);
  const items = DATA.DISTRICT_CALENDAR.filter((e) => e.d >= year.first && e.d <= year.last && ["noschool", "break", "early", "conferences", "last"].includes(e.kind) && (!e.grades || e.grades.some((g) => grades.includes(g))));
  return `<ul class="plain-list">${items.map((e) => `<li><b>${esc(fmt(e.d))}${e.to ? ` to ${esc(fmt(e.to))}` : ""}</b> ${esc(e.title.replace(/^No school:\s*/, ""))}</li>`).join("")}</ul>`;
}
function page(s) {
  const slug = SLUG[s.id];
  const others = Object.values(DATA.SCHOOLS).filter((x) => x.id !== s.id);
  const title = `${s.name}: lunch menu, bell schedule, games and days off`;
  const desc = `${s.name} in Brandon, SD: this week's lunch menu, the bell schedule, upcoming games and events, days off, the student handbook and the supply list, in one place for parents.`;
  const ld = { "@context": "https://schema.org", "@type": "School", name: s.name, url: s.site, telephone: s.phone, address: { "@type": "PostalAddress", streetAddress: s.address.split(",")[0], addressLocality: "Brandon", addressRegion: "SD", postalCode: "57005" } };
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${SITE}/schools/${slug}/">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:image" content="${SITE}/icons/og-v4.png">
  <meta name="theme-color" content="#A8181A">
  <link rel="icon" href="/favicon.ico">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/pages.css">
  <script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body class="page" data-school="${s.id}">
  <header class="app-header"><div class="header-inner"><a class="brand" href="/">Brandon Valley <span>Lunch</span></a></div></header>
  <main class="page-main">
    <section class="pview" id="view-today">
      <p class="crumb"><a href="/">Brandon Valley Lunch</a> / ${esc(s.short)}</p>
      <h1>${esc(s.name)}</h1>
      <p class="lede">Brandon Valley ${LEVEL[s.level]}, grades ${s.grades[0] === -1 ? "junior kindergarten" : s.grades[0] === 0 ? "kindergarten" : s.grades[0]} to ${s.grades[1]}. School ${esc(s.bell.start)} AM to ${esc(s.bell.end)} PM.</p>
      <a class="btn primary block cta" href="/?school=${s.id}">Open the app for your student</a>
      <p class="fine center">Tomorrow's lunch, games, days off and alerts for your child, on your phone. No account needed.</p>
      <h2>Next lunch</h2>
      <div id="menu-next" class="card"><p class="muted">Loading the menu.</p></div>
      <h2>Coming up</h2>
      <div id="events-next" class="card"><p class="muted">Loading games and events.</p></div>
      <p class="fine">Tap Lunch or Calendar below for the rest.</p>
    </section>

    <section class="pview" id="view-lunch" hidden>
      <h2>This week's lunch</h2>
      <div id="menu" class="card"><p class="muted">Loading this week's menu.</p></div>
      <p class="fine">Menus come from the district's LINQ Connect and can change. Breakfast $${s.prices.breakfast.toFixed(2)}, lunch $${s.prices.lunch.toFixed(2)}. The app shows every line and flags your child's allergens.</p>
    </section>

    <section class="pview" id="view-calendar" hidden>
      <h2>Next three weeks</h2>
      <div id="events" class="card"><p class="muted">Loading games and events.</p></div>
      <h2>Days off and early dismissals, ${esc(DATA.SCHOOL_YEARS[0].id)}</h2>
      <div class="card">${daysOff(s)}</div>
    </section>

    <section class="pview" id="view-hours" hidden>
      <h2>Bell schedule</h2>
      <div class="card">${schedules(s)}</div>
    </section>

    <section class="pview" id="view-school" hidden>
      <h2>${esc(s.name)}</h2>
      <div class="card link-list">
        <a class="list-row" href="tel:+1${s.phone.replace(/\D/g, "")}"><span><b>Call the office</b><span>${esc(s.phone)}</span></span></a>
        <a class="list-row" href="https://maps.apple.com/?q=${encodeURIComponent(s.address)}" target="_blank" rel="noopener"><span><b>Directions</b><span>${esc(s.address)}</span></span></a>
        ${s.supplies ? `<a class="list-row" href="${esc(s.supplies)}" target="_blank" rel="noopener"><span><b>Supply list</b><span>What to bring, by grade</span></span></a>` : ""}
        <a class="list-row" href="${esc(DATA.DISTRICT.handbooks[s.handbook])}" target="_blank" rel="noopener"><span><b>Student handbook</b><span>${esc(s.handbook[0].toUpperCase() + s.handbook.slice(1))} handbook, ${esc(DATA.SCHOOL_YEARS[0].id)}</span></span></a>
        <a class="list-row" href="${esc(s.site)}" target="_blank" rel="noopener"><span><b>School website</b><span>${esc(s.site.replace(/^https?:\/\//, ""))}</span></span></a>
      </div>
      <h2>Other Brandon Valley schools</h2>
      <p class="others">${others.map((x) => `<a href="/schools/${SLUG[x.id]}/">${esc(x.short)}</a>`).join(" · ")}</p>
      <footer class="app-footer">
        <p>An independent app, not run by the Brandon Valley School District. Built from public district, LINQ Connect and Bound information; for anything official, check with your school. <a href="/privacy.html">Privacy</a></p>
        <p class="footer-credit">Created by <a href="https://scratchmarketing.net" target="_blank" rel="noopener">Scratch Marketing &amp; Solutions</a></p>
      </footer>
    </section>
  </main>
  <nav class="tab-bar" aria-label="Sections">
    <a class="tab" href="#today" data-tab="today" aria-current="page"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg><span>Today</span></a>
    <a class="tab" href="#lunch" data-tab="lunch"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v8M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10M16.5 21V3c-2.2 1.3-3.5 4-3.5 7.5V13h3.5"/></svg><span>Lunch</span></a>
    <a class="tab" href="#calendar" data-tab="calendar"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></svg><span>Calendar</span></a>
    <a class="tab" href="#hours" data-tab="hours"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg><span>Hours</span></a>
    <a class="tab" href="#school" data-tab="school"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20.5h18M5 20.5V10l7-5.5 7 5.5v10.5"/><path d="M10 20.5v-5h4v5"/></svg><span>School</span></a>
  </nav>
  <script src="/pages.js"></script>
</body>
</html>
`;
}
function sitemap() {
  const urls = [`${SITE}/`, ...Object.values(DATA.SCHOOLS).map((s) => `${SITE}/schools/${SLUG[s.id]}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc><changefreq>daily</changefreq></url>`).join("\n")}\n</urlset>\n`;
}
function write(out) {
  for (const s of Object.values(DATA.SCHOOLS)) {
    const dir = path.join(out, "schools", SLUG[s.id]);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), page(s));
  }
  fs.writeFileSync(path.join(out, "sitemap.xml"), sitemap());
  return Object.keys(SLUG).length;
}
module.exports = { write, SLUG, page };
if (require.main === module) console.log(`${write(path.join(ROOT, "dist"))} school pages`);
