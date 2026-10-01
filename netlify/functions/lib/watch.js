/* Watches each school's supply list for a new upload. Runs from the
 * scheduled job: daily, and every six hours in the run-up to a school
 * year. When a school's file changes, parents subscribed at that school
 * get one notification, and the app's caches for that school are told to
 * refresh. Fingerprints live in the "watch" blob store. */

const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

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
const NAMES = {
  "041717d0-8f8d-ec11-8df7-eb7b319a32d1": "Brandon Elementary",
  "d8f8bcbf-1b2a-f111-bb4f-02558335d9c7": "Burkman Valley Elementary",
  "af61ff49-908d-ec11-8df7-9c80cb6a95ae": "Fred Assam Elementary",
  "0c65b2bc-908d-ec11-8df7-9566c4096294": "Inspiration Elementary",
  "ec90bc02-908d-ec11-8df7-eb7b319a32d1": "Robert Bennis Elementary",
  "82b0714f-8f8d-ec11-8df7-d30e05c96286": "BV Intermediate School",
  "2e94e37a-8f8d-ec11-8df7-eb7b319a32d1": "BV Middle School",
  "ffc1d3ff-8e8d-ec11-8df7-c6813137b210": "BV High School",
};
const UA = { "User-Agent": "brandonvalleylunch.com school app" };

// The supply-list link from the school's own menu (same reading as the
// School tab), then the file itself, hashed.
async function currentList(school) {
  const base = `${SITE}/${SLUGS[school]}/`;
  const nav = (await (await fetch(`${base}library/navbar.html`, { headers: UA })).text()).replace(/<!--[\s\S]*?-->/g, "");
  const m = [...nav.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((x) => ({ href: x[1].trim(), label: x[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }))
    .find((x) => /supply/i.test(x.label) && /\.pdf$/i.test(x.href));
  if (!m) return null;
  const href = new URL(m.href, base).href;
  const r = await fetch(href, { headers: UA });
  if (!r.ok) return null;
  const bytes = Buffer.from(await r.arrayBuffer());
  let sections = -1;
  try {
    const { parseSupplyPdf } = require("./supplies.js");
    sections = (await parseSupplyPdf(bytes)).sections.length;
  } catch { /* the app falls back to the PDF itself */ }
  return { href, label: m.label, hash: crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16), bytes: bytes.length, sections };
}

// Compare every school's list with what we saw last time. Returns the
// schools whose list changed (with the new record), after saving.
async function checkSupplies() {
  const store = getStore({ name: "watch", consistency: "strong" });
  const changed = [];
  const now = Date.now();
  for (const school of Object.keys(SLUGS)) {
    let cur = null;
    try { cur = await currentList(school); } catch { cur = null; }
    const key = `supplies:${school}`;
    const prev = await store.get(key, { type: "json" }).catch(() => null);
    const rec = { ...(cur || { href: null, hash: null, sections: 0 }), checkedAt: now, changedAt: prev ? prev.changedAt : now, firstSeen: prev ? prev.firstSeen : now };
    const isChange = prev && cur && prev.hash && (prev.hash !== cur.hash || prev.href !== cur.href);
    if (isChange) { rec.changedAt = now; changed.push({ school, name: NAMES[school], rec }); }
    await store.setJSON(key, rec);
  }
  return changed;
}

// Tell the parents at a school that a new list is up: one notification
// per device whose kids (or chosen school) include it.
async function notifyNewList(changed, sendFn) {
  const push = getStore({ name: "push", consistency: "strong" });
  const { blobs } = await push.list();
  let sent = 0;
  for (const { key } of blobs) {
    const record = await push.get(key, { type: "json" }).catch(() => null);
    if (!record || !record.sub) continue;
    const mine = new Set([...(record.kids || []).map((k) => k.school), record.school].filter(Boolean));
    const hits = changed.filter((c) => mine.has(c.school));
    if (!hits.length) continue;
    const one = hits.length === 1;
    const payload = {
      title: one ? "New supply list" : "New supply lists",
      body: one ? `${hits[0].name} posted a new supply list. Tap to see ${record.role === "student" ? "yours" : "your child's grade"}.`
        : `${hits.map((h) => h.name).join(" and ")} posted new supply lists.`,
      url: `/?tab=school&fresh=1&school=${hits[0].school}`,
    };
    try { await sendFn(record, payload); sent++; }
    catch (err) { if (err && (err.statusCode === 404 || err.statusCode === 410)) await push.delete(key); }
  }
  return sent;
}

async function status() {
  const store = getStore({ name: "watch", consistency: "strong" });
  const out = {};
  for (const school of Object.keys(SLUGS)) out[NAMES[school]] = await store.get(`supplies:${school}`, { type: "json" }).catch(() => null);
  return out;
}

module.exports = { checkSupplies, notifyNewList, status };
