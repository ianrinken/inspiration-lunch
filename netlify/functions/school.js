/* School info relay: the parent-facing links and office contact for one
 * building, read live from the school's own site so the app never carries
 * a stale phone number or last year's supply list.
 *
 * The district site is plain HTML. Each school page pulls a shared
 * navbar.html and footer.html fragment; the Parents menu, the district
 * calendar PDF and the Skyward family login live in the first, the office
 * address/phone/email in the second.
 */

const SITE = "https://brandonvalley.k12.sd.us";

const SLUGS = {
  "041717d0-8f8d-ec11-8df7-eb7b319a32d1": "bes",
  "d8f8bcbf-1b2a-f111-bb4f-02558335d9c7": "bve",
  "af61ff49-908d-ec11-8df7-9c80cb6a95ae": "fae",
  "0c65b2bc-908d-ec11-8df7-9566c4096294": "ies",
  "ec90bc02-908d-ec11-8df7-eb7b319a32d1": "rbe",
  "82b0714f-8f8d-ec11-8df7-d30e05c96286": "bvis",
  "2e94e37a-8f8d-ec11-8df7-eb7b319a32d1": "bvms",
  "ffc1d3ff-8e8d-ec11-8df7-c6813137b210": "bvhs",
};

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, "");

function absolute(href, base) {
  try { return new URL(href.trim(), base).href; } catch { return null; }
}

// Top-level dropdowns -> [{ title, items: [{ label, href, group }] }]
function sections(nav, base) {
  const out = [];
  // Each top-level menu runs until the next one starts (nested sub-menus
  // close their own <li>s along the way, so a lazy match would stop early).
  for (const block of nav.split(/<li class="nav-item dropdown[^"]*">/).slice(1)) {
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

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const slug = SLUGS[q.school];
  if (!slug) return { statusCode: 400, body: JSON.stringify({ error: "bad params" }) };
  const base = `${SITE}/${slug}/`;
  const ua = { "User-Agent": "brandonvalleylunch.com school app" };
  const grab = async (file) => {
    const r = await fetch(`${base}library/${file}`, { headers: ua });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    return stripComments(await r.text());
  };

  try {
    const [nav, footer] = await Promise.all([grab("navbar.html"), grab("footer.html")]);
    const all = sections(nav, base);
    const pick = (title) => (all.find((s) => s.title === title) || { items: [] }).items;

    const links = [];
    const seen = new Set();
    const add = (item, section) => {
      const key = item.href.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      links.push({ label: item.label, href: item.href, section, ...(item.group ? { group: item.group } : {}) });
    };
    // Family-facing menus only; Teachers/Staff, Departments and the
    // school list are skipped.
    for (const title of ["Parents", "Students", "Activities"]) for (const item of pick(title)) add(item, title);
    // The newest district calendar PDF ("26-27 BVSD Calendar").
    const cals = pick("Calendar").filter((i) => /^\d\d-\d\d BVSD Calendar$/.test(i.label)).sort((a, b) => b.label.localeCompare(a.label));
    if (cals[0]) add({ ...cals[0], label: `District calendar ${cals[0].label.slice(0, 5)}` }, "District");
    const sky = pick("Skyward").find((i) => /Family/.test(i.label));
    if (sky) add({ ...sky, label: "Skyward family access" }, "District");

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
        "Netlify-CDN-Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      },
      body: JSON.stringify({ site: base, ...contact(footer), links }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "school site unavailable" }),
    };
  }
};
