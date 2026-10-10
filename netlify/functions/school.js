/* School information relay: everything a family needs from each school's
 * own website, read live and served as small JSON so the app can show it
 * natively (no PDFs, no squinting at another site on a phone).
 *
 * Brandon Valley's district site is plain HTML. Every school page pulls a
 * shared navbar.html (the Parents, Students and Activities menus, the
 * Skyward login) and footer.html (office phone, email, address). Supply
 * lists and handbooks are PDFs, read into sections by lib/supplies.js and
 * lib/handbook.js. Closings come from KELOLAND (lib/closings.js).
 *
 * GET ?school=bvhs&what=forms            the family-facing menus, grouped: { groups: [{ name, files: [{ name, ext, url, view? }] }] }
 * GET ?school=bvhs&what=clubs            clubs and organizations with advisors: { groups: [{ name, items }], details }
 * GET ?school=ies&what=supplies&grade=2  one grade's supply list: { title, items: [{ amount, item }], grades, sections, notes }
 * GET ?school=bvhs&what=handbook         the school's handbook in sections: { title, source, sections: [{ title, text }] }
 *     ...&which=district|activities      the district or activities handbook instead
 * GET ?school=bvhs&what=page&slug=contact  the office contact block: { name, blocks: [html], url }
 * GET ?school=bvhs&what=alerts           closings and late starts now showing: { alerts: [{ id, html, at }] }
 * GET ?school=bvhs&what=staff|news|feed|scholarships   empty lists (no public source)
 * GET ?what=doc&url=<district pdf>       one of the district's PDFs with CORS headers, for the in-app viewer
 *
 * Every answer carries checkedAt and is saved, so if the district's site is
 * down the last good copy is served instead of an error. PDFs are parsed
 * once and the parsed JSON is what gets saved.
 */
const { load, save } = require("./lib/sources.js");
const { withSpanish, cdnFor } = require("./lib/translate.js");
const closings = require("./lib/closings.js");

const DATA = require("../../data.js");
const SCHOOLS = DATA.SCHOOLS;
const SITE = DATA.DISTRICT.site;
const UA = "brandonvalleylunch.com school app";
// Pages the app may show (the district has no CMS pages; the office contact
// block is built from the footer). drift.js walks these keys.
const PAGES = { contact: "school" };
const DAY = 24 * 3600e3;
const TTL = { staff: DAY, page: DAY, clubs: DAY, news: DAY, alerts: 2 * 60e3, scholarships: DAY, feed: DAY, forms: DAY, supplies: DAY, handbook: DAY };
const PDF_MAX = 5 * 1024 * 1024;

async function getText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return stripComments(await res.text());
}
async function getBytes(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("empty file");
  if (buf.length > PDF_MAX) throw new Error("too large");
  return buf;
}

// No emoji anywhere in the app, including what the schools type.
const NO_EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
const text = (html) => String(html || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(NO_EMOJI, "").replace(/\s+/g, " ").trim();
const stripComments = (html) => String(html || "").replace(/<!--[\s\S]*?-->/g, "");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const titleCase = (s) => text(s).toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\bMc(\p{L})/gu, (m, a) => "Mc" + a.toUpperCase());
const onSite = (u) => typeof u === "string" && u.startsWith(SITE + "/");
const isPdf = (u) => /\.pdf(\?|$)/i.test(String(u || ""));

function absolute(href, base) {
  try { return new URL(href.trim(), base).href; } catch { return null; }
}

/* ---------- the shared navbar and footer ---------- */

// Top-level dropdowns -> [{ title, items: [{ label, href, group }] }]
function sections(nav, base) {
  const out = [];
  // Each top-level menu runs until the next one starts (nested sub-menus
  // close their own <li>s along the way, so a lazy match would stop early).
  for (const block of stripComments(nav).split(/<li class="nav-item dropdown[^"]*">/).slice(1)) {
    const top = block.match(/<a[^>]*dropdown-toggle[^>]*>([\s\S]*?)<\/a>/);
    if (!top) continue;
    const title = text(top[1]);
    const items = [];
    // Walk the menu in order, tracking <ul> depth so a nested sub-menu's
    // heading ("Nurse | Health Info") applies to its own items only.
    let depth = 0, group = null, pendingGroup = null;
    const tokenRx = /<ul\b[^>]*>|<\/ul>|<a\b([^>]*)>([\s\S]*?)<\/a>/g;
    for (const tok of block.matchAll(tokenRx)) {
      if (tok[0].startsWith("<ul")) { depth++; if (depth >= 2) group = pendingGroup; continue; }
      if (tok[0] === "</ul>") { depth--; if (depth < 2) group = null; if (depth <= 0) break; continue; }
      const attrs = tok[1] || "";
      if (!/dropdown-(?:toggle|item)/.test(attrs)) continue;
      const href = ((attrs.match(/href="([^"]*)"/) || [])[1] || "").trim();
      const label = text(tok[2] || "");
      if (!label) continue;
      if (href === "#" || href === "") {
        if (label !== title) pendingGroup = label; // heading of the sub-menu about to open
        continue;
      }
      const url = href.startsWith("mailto:") ? href : absolute(href, base);
      if (!url) continue;
      items.push({ label, href: url, ...(group ? { group } : {}) });
    }
    out.push({ title, items });
  }
  return out;
}

function contact(footer) {
  const t = text(footer);
  const email = (t.match(/Email:\s*([^\s]+@[^\s]+)/) || [])[1] || "";
  const phone = (t.match(/Phone:\s*([\d-]{12})/) || [])[1] || "";
  const fax = (t.match(/Fax:\s*([\d-]{12})/) || [])[1] || "";
  // "... Brandon Valley School District 301 S. Splitrock Blvd Brandon, SD 57005 Email:"
  const addr = (t.match(/School District\s+(.+?\b(?:SD|South Dakota)\s+\d{5})/) || [])[1] || "";
  return { email, phone, fax, address: addr.trim() };
}

const navbar = async (s) => sections(await getText(`${s.site}library/navbar.html`), s.site);

/* ---------- builders ---------- */

// No public staff directory, news feed, posts or scholarship list: the
// empty list is the answer, and the app says so instead of an error.
const buildStaff = async () => ({ people: [] });
const buildNews = async () => ({ items: [] });
const buildFeed = async () => ({ items: [] });
const buildScholarships = async () => ({ items: [] });

// Parent forms and links: the Parents, Students and Activities menus, each
// sub-menu ("Nurse | Health Info") as its own group, plus the Skyward
// family login. District PDFs are marked so the app can open them in its
// own viewer; a bell-schedule page resolves to its picture (view).
const MENUS = ["Parents", "Students", "Activities"];
async function buildForms(s) {
  const all = await navbar(s);
  const pick = (title) => (all.find((x) => x.title === title) || { items: [] }).items;
  const groups = [];
  const seen = new Set();
  const groupNamed = (name) => {
    let g = groups.find((x) => x.name === name);
    if (!g) { g = { name, files: [] }; groups.push(g); }
    return g;
  };
  const add = (item, groupName) => {
    const key = item.href.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const ext = item.href.startsWith("mailto:") ? "email" : isPdf(item.href) && onSite(item.href) ? "pdf" : "link";
    groupNamed(groupName).files.push({ name: item.label, ext, url: item.href });
  };
  for (const title of MENUS) for (const item of pick(title)) add(item, item.group ? `${title}: ${item.group.replace(/\s*\|\s*/g, " / ")}` : title);
  const sky = pick("Skyward").find((i) => /Family/.test(i.label));
  if (sky) add({ ...sky, label: "Skyward Family Access" }, "Skyward");
  if (!groups.length) throw new Error("no menus");
  // Bell schedules are pictures on a bare page: resolve to the picture so
  // the app can show it in place; data.js knows the picture when the page
  // doesn't say.
  const files = groups.flatMap((g) => g.files);
  await Promise.all(files.map(async (f) => {
    if (!/bell schedule|class time/i.test(f.name)) return;
    let view = null;
    if (/\.html?$/i.test(f.url) && onSite(f.url)) {
      try { view = bellImage(await getText(f.url), f.url); } catch { view = null; }
    }
    if (!view && s.bellImage) view = s.bellImage;
    if (view) f.view = view;
  }));
  return { groups };
}
function bellImage(html, base) {
  const img = html.match(/<img[^>]+class="[^"]*img-fluid[^"]*"[^>]+src="([^"]+)"|<img[^>]+src="([^"]+)"[^>]+class="[^"]*img-fluid/i);
  const src = img && (img[1] || img[2]);
  return src ? absolute(src, base) : null;
}

// Clubs and Organizations is a page of cards: name, a paragraph, advisor.
function parseClubs(html) {
  const out = [];
  for (const card of stripComments(html).split(/<div class="card">/).slice(1)) {
    const name = text((card.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/) || [])[1] || "");
    const advisor = text((card.match(/Advisors?:\s*([^<]+)/i) || [])[1] || "");
    const about = text((card.match(/<p class="card-text">([\s\S]*?)<\/p>/) || [])[1] || "");
    if (name) out.push({ name, advisor, about });
  }
  return out;
}
async function buildClubs(s) {
  const link = (await navbar(s)).flatMap((x) => x.items).find((i) => /clubs/i.test(i.label) && /\.html?$/i.test(i.href) && onSite(i.href));
  if (!link) return { groups: [], details: [] };
  const details = parseClubs(await getText(link.href));
  if (!details.length) throw new Error("no clubs");
  const items = details.map((c) => (c.advisor ? `${c.name} (advisor: ${c.advisor})` : c.name));
  return { groups: [{ name: "Clubs and organizations", items }], details, url: link.href };
}

// The one "page": the office contact block from the footer.
async function buildPage(s, slug) {
  if (slug !== "contact") throw new Error("unknown page");
  const c = contact(await getText(`${s.site}library/footer.html`));
  const blocks = [`<h2>${esc(s.name)}</h2>`];
  const lines = [];
  if (c.phone) lines.push(`<b>Phone:</b> <a href="tel:${esc(c.phone.replace(/[^\d+]/g, ""))}">${esc(c.phone)}</a>`);
  if (c.fax) lines.push(`<b>Fax:</b> ${esc(c.fax)}`);
  if (c.email) lines.push(`<b>Email:</b> <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`);
  if (c.address) lines.push(`<b>Address:</b> ${esc(c.address)}`);
  if (!lines.length) throw new Error("no contact details");
  blocks.push(`<p>${lines.join("<br>")}</p>`);
  return { name: "Contact", blocks, url: s.site, ...c };
}

// Supply lists: the school's PDF read into per-grade (or per-class)
// sections; "(2) Boxes of crayons" splits into amount and item.
function parseItem(line) {
  const m = String(line).match(/^\(?(\d{1,3})\)?\s*[-–:]?\s+(.+)$/);
  return m ? { amount: m[1], item: m[2].trim() } : { amount: "", item: String(line).trim() };
}
async function buildSupplies(s) {
  if (!s.supplies) return { source: null, sections: [], notes: [], grades: [] };
  const { parseSupplyPdf } = require("./lib/supplies.js");
  const parsed = await parseSupplyPdf(await getBytes(s.supplies));
  // "SECOND GRADE" -> "Second Grade"; PE stays PE.
  const sectionTitle = (t) => titleCase(t).replace(/\bPe\b/g, "PE");
  const sectionsOut = parsed.sections.map((sec) => ({ title: sectionTitle(sec.title), grade: sec.grade, items: sec.lines.map(parseItem) })).filter((sec) => sec.items.length);
  if (!sectionsOut.length) throw new Error("no supply sections");
  const grades = [...new Set(sectionsOut.map((sec) => sec.grade).filter((g) => g !== null))].sort((a, b) => a - b);
  return { source: s.supplies, sections: sectionsOut, notes: parsed.notes || [], grades };
}
const GRADE_NAME = { "-1": "Junior kindergarten", 0: "Kindergarten", 1: "1st grade", 2: "2nd grade", 3: "3rd grade", 4: "4th grade", 5: "5th grade", 6: "6th grade", 7: "7th grade", 8: "8th grade" };
// The saved copy holds every section; each request gets one grade's view.
function viewSupplies(data, q) {
  const sectionsAll = data.sections || [];
  const want = q.grade !== undefined && q.grade !== "" && !isNaN(parseInt(q.grade, 10)) ? parseInt(q.grade, 10) : null;
  const sec = (want !== null && sectionsAll.find((x) => x.grade === want)) || sectionsAll[0] || null;
  // "2nd grade supply list"; a class section ("Core Classes Supplies", "Band") keeps its own name.
  const title = !sec ? "Supply list" : sec.grade !== null && GRADE_NAME[sec.grade] ? `${GRADE_NAME[sec.grade]} supply list` : /suppl/i.test(sec.title) ? sec.title : `${sec.title} supplies`;
  return { ...data, title, grade: sec ? sec.grade : null, section: sec ? sec.title : "", items: sec ? sec.items : [] };
}

// Handbooks: the school's own by default (data.js says which level), or
// the district or activities handbook on request.
async function buildHandbook(s, which) {
  const { HANDBOOKS, parseHandbook } = require("./lib/handbook.js");
  const entry = HANDBOOKS[which];
  if (!entry) throw new Error("unknown handbook");
  const [title, url] = entry;
  const parsed = await parseHandbook(await getBytes(url));
  if (!parsed.sections.length) throw new Error("empty handbook");
  return { title, source: url, which, sections: parsed.sections };
}

async function buildAlerts() {
  return { alerts: await closings.banners() };
}

const BUILDERS = { staff: buildStaff, page: buildPage, clubs: buildClubs, news: buildNews, alerts: buildAlerts, scholarships: buildScholarships, feed: buildFeed, forms: buildForms, supplies: buildSupplies, handbook: buildHandbook };

// ?what=doc&url=<url>: pass one of the district's own PDFs through with
// CORS headers so the app can draw its pages fitted to the phone (the
// district's server sends no CORS headers). District domain, PDFs only.
async function passDoc(url) {
  let u;
  try { u = new URL(String(url || "")); } catch { return { statusCode: 400, body: JSON.stringify({ error: "bad url" }) }; }
  if (u.origin !== SITE || !/\.pdf$/i.test(u.pathname)) return { statusCode: 403, body: JSON.stringify({ error: "district documents only" }) };
  let buf;
  try { buf = await getBytes(u.href); } catch (err) { return { statusCode: /too large/.test(err.message) ? 413 : 502, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "document unavailable" }) }; }
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
      "Netlify-CDN-Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
    },
    isBase64Encoded: true,
    body: buf.toString("base64"),
  };
}

const json = (statusCode, obj) => ({ statusCode, headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  require("./lib/store.js").connect(event);
  const q = event.queryStringParameters || {};
  if (q.what === "doc") return passDoc(q.url);
  const s = SCHOOLS[q.school];
  const build = BUILDERS[q.what];
  if (!s || !build) return json(400, { error: "Bad request" });
  if (q.what === "page" && !PAGES[q.slug]) return json(404, { error: "No such page" });
  const which = q.what === "handbook" ? q.which || s.handbook : null;
  if (q.what === "handbook" && !DATA.DISTRICT.handbooks[which]) return json(400, { error: "Unknown handbook" });
  // Handbooks and closings are district-wide: one saved copy serves every school.
  const scope = q.what === "handbook" || q.what === "alerts" ? "district" : q.school;
  const key = `school-${scope}-${q.what}${q.what === "page" ? `-${q.slug}` : ""}${which ? `-${which}` : ""}`;
  const saved = await load(key).catch(() => null);
  let body, stale = false;
  if (saved && Date.now() - saved.at < TTL[q.what]) body = saved.body;
  else {
    try {
      const built = await build(s, q.what === "handbook" ? which : q.slug);
      body = JSON.stringify({ ...built, checkedAt: Date.now() });
      await save(key, { at: Date.now(), hash: "", body }).catch(() => {});
    } catch (err) {
      if (!saved) return json(502, { error: "Source unavailable" });
      body = saved.body;
      stale = true;
    }
  }
  if (q.what === "supplies") body = JSON.stringify(viewSupplies(JSON.parse(body), q));
  body = await withSpanish(event, body, q.what);
  const cdn = Math.max(60, Math.floor(TTL[q.what] / 1000 / 4));
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60",
      "Netlify-CDN-Cache-Control": stale ? "public, s-maxage=60" : cdnFor(body, `public, s-maxage=${cdn}, stale-while-revalidate=300`),
    },
    body,
  };
};

// For the scheduled alert check (lib/watch.js): the district's closings are
// the only banners; schools have none of their own.
const districtBanners = () => closings.banners();
const schoolBanners = async () => [];
exports._internals = { sections, contact, parseClubs, bellImage, parseItem, viewSupplies, titleCase, PAGES, buildForms, buildClubs, buildSupplies, buildHandbook, buildPage, buildAlerts, districtBanners, schoolBanners, findOurs: closings.findOurs };
