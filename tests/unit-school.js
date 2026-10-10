/* Unit tests for the Brandon Valley school relay (netlify/functions/school.js
 * and its libs), run against saved copies of the district's own pages and
 * PDFs in tests/fixtures. No network.
 *   node tests/unit-school.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FIX = path.join(__dirname, "fixtures");
process.env.SFP_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sfp-school-test-"));
delete process.env.NETLIFY_BLOBS_CONTEXT;

// A KELOLAND closings list with the district and a same-named decoy
// (constructed: the live list is empty on an ordinary day).
const KELO = JSON.parse(fs.readFileSync(path.join(FIX, "kelo-closings-sample.json"), "utf8"));
let kelo = KELO;
let down = new Set(); // URL substrings that answer 503 for a test

// Offline: every fetch is answered from fixtures or refused.
const file = (name, binary) => fs.readFileSync(path.join(FIX, name), binary ? undefined : "utf8");
const okText = (body) => ({ ok: true, status: 200, headers: new Map(), text: async () => body, arrayBuffer: async () => Buffer.from(body) });
const okBytes = (buf) => ({ ok: true, status: 200, headers: new Map(), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), text: async () => buf.toString("latin1") });
const fail = { ok: false, status: 503, headers: new Map(), text: async () => "", json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
const calls = [];
global.fetch = async (url) => {
  const u = String(url);
  calls.push(u);
  if ([...down].some((d) => u.includes(d))) return fail;
  if (/brandonvalley\.k12\.sd\.us\/bvhs\/library\/navbar\.html$/.test(u)) return okText(file("bv-navbar-bvhs.html"));
  if (/brandonvalley\.k12\.sd\.us\/bvhs\/library\/footer\.html$/.test(u)) return okText(file("bv-footer-bvhs.html"));
  if (/brandonvalley\.k12\.sd\.us\/bvhs\/clubsOrg\.html$/.test(u)) return okText(file("bv-clubs-bvhs.html"));
  if (/brandonvalley\.k12\.sd\.us\/bvhs\/ClassTimeSchedule\.html$/.test(u)) return okText(file("bv-bell-bvhs.html"));
  if (/brandonvalley\.k12\.sd\.us\/ies\/Documents\/IESSchoolSupply26-27\.pdf$/.test(u)) return okBytes(file("bv-supply-ies.pdf", true));
  if (/@HighSchoolHandbook\.pdf$/.test(u)) return okBytes(file("bv-handbook-high.pdf", true));
  if (/keloland\.com\/wp-json/.test(u)) return { ok: true, status: 200, headers: new Map(), json: async () => kelo, text: async () => JSON.stringify(kelo) };
  return fail;
};

const SH = require(path.join(ROOT, "shared.js"));
const DATA = require(path.join(ROOT, "data.js"));
const relay = require(path.join(ROOT, "netlify/functions/school.js"));
const closingsLib = require(path.join(ROOT, "netlify/functions/lib/closings.js"));

const call = async (q) => {
  const r = await relay.handler({ queryStringParameters: q });
  return { status: r.statusCode, headers: r.headers || {}, body: r.body ? JSON.parse(r.body) : null };
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* ---------- forms: the navbar menus ---------- */

test("forms: Parents, Students and Activities menus become groups, sub-menus their own groups", async () => {
  const r = await call({ school: "bvhs", what: "forms" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers["Access-Control-Allow-Origin"], "*");
  assert.ok(r.body.checkedAt > 0);
  const names = r.body.groups.map((g) => g.name);
  assert.ok(names.includes("Parents"), names.join(", "));
  assert.ok(names.includes("Parents: Nurse / Health Info"), names.join(", "));
  assert.ok(names.includes("Students"), names.join(", "));
  assert.ok(names.includes("Students: Student Handbooks"), names.join(", "));
  assert.ok(names.includes("Activities"), names.join(", "));
  assert.ok(names.includes("Skyward"), names.join(", "));
  // Staff-only menus never reach parents.
  assert.ok(!names.some((n) => /Teachers|Departments|Schools|Calendar/.test(n)), names.join(", "));
  const nurse = r.body.groups.find((g) => g.name === "Parents: Nurse / Health Info");
  assert.ok(nurse.files.some((f) => f.name === "Medication Consent Form" && f.ext === "pdf" && f.url === "https://brandonvalley.k12.sd.us/District%20Documents/Nurses/MedicationConsentForm.pdf"));
  // PDFs off the district's site and web pages are links; mailto is email.
  assert.ok(nurse.files.some((f) => f.name === "Concussion Checklist" && f.ext === "link"));
  const parents = r.body.groups.find((g) => g.name === "Parents");
  assert.ok(parents.files.some((f) => f.name === "Report Attendance" && f.ext === "email" && f.url.startsWith("mailto:")));
  assert.ok(parents.files.some((f) => f.name === "Drivers Education" && f.ext === "link" && f.url === "https://brandonvalley.k12.sd.us/bvhs/DriversEd.html"));
  const sky = r.body.groups.find((g) => g.name === "Skyward");
  assert.deepStrictEqual(sky.files.map((f) => f.name), ["Skyward Family Access"]);
  assert.ok(/fwemnu01/.test(sky.files[0].url));
  // Commented-out menu items stay out.
  assert.ok(!r.body.groups.flatMap((g) => g.files).some((f) => /Link to the Lynx|Middle School/.test(f.name)));
});

test("forms: the bell-schedule page resolves to its picture (view)", async () => {
  const r = await call({ school: "bvhs", what: "forms" });
  const bell = r.body.groups.flatMap((g) => g.files).find((f) => /Class Time Schedules/.test(f.name));
  assert.ok(bell, "bell schedule link present");
  assert.strictEqual(bell.ext, "link");
  assert.strictEqual(bell.view, "https://brandonvalley.k12.sd.us/bvhs/Images/BVHSBell26-27.jpg");
  assert.strictEqual(bell.view, DATA.SCHOOLS.bvhs.bellImage, "data.js and the live page agree");
});

test("forms: the second call is served from the saved copy (no refetch)", async () => {
  calls.length = 0;
  const r = await call({ school: "bvhs", what: "forms" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(calls.length, 0, "no network on a fresh saved copy");
});

/* ---------- clubs ---------- */

test("clubs: cards with their advisors, one group", async () => {
  const r = await call({ school: "bvhs", what: "clubs" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.groups.length, 1);
  assert.strictEqual(r.body.groups[0].name, "Clubs and organizations");
  const items = r.body.groups[0].items;
  assert.strictEqual(items.length, 20);
  assert.ok(items.includes("Art Club (advisor: Chad Nelson)"), items.join(" | "));
  assert.ok(items.includes("Cinema Club (advisor: Chad Nelson)"), "Advisors: as well as Advisor:");
  assert.ok(items.every((i) => !/\p{Extended_Pictographic}/u.test(i)));
  const art = r.body.details.find((d) => d.name === "Art Club");
  assert.ok(/inclusive sister organization/.test(art.about));
  assert.strictEqual(art.advisor, "Chad Nelson");
});

test("clubs: a school without the page gets an empty list, not an error", async () => {
  const relayInternals = relay._internals;
  // Inspiration Elementary's navbar isn't in the fixtures: the relay must not throw on a missing page link.
  const r = await relayInternals.buildClubs({ ...DATA.SCHOOLS.ies, site: "https://brandonvalley.k12.sd.us/nowhere/" }).catch((e) => ({ error: e.message }));
  // The navbar fetch itself fails (503) here, which is an error; with a navbar that has no clubs link the answer is empty.
  assert.ok(r.error, "a missing navbar is a source failure");
  const sections = relayInternals.sections('<li class="nav-item dropdown"><a class="nav-link dropdown-toggle" href="#">Students</a><ul class="dropdown-menu"><li><a class="dropdown-item" href="Library.html">Library</a></li></ul></li>', "https://brandonvalley.k12.sd.us/ies/");
  assert.deepStrictEqual(sections, [{ title: "Students", items: [{ label: "Library", href: "https://brandonvalley.k12.sd.us/ies/Library.html" }] }]);
});

/* ---------- supplies ---------- */

test("supplies: grade 2 from Inspiration's PDF, amounts split out, every grade listed", async () => {
  const r = await call({ school: "ies", what: "supplies", grade: "2" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.title, "2nd grade supply list");
  assert.strictEqual(r.body.grade, 2);
  assert.deepStrictEqual(r.body.grades, [-1, 0, 1, 2, 3, 4]);
  assert.ok(r.body.items.length >= 15, `${r.body.items.length} items`);
  assert.deepStrictEqual(r.body.items[0], { amount: "1", item: "Set of headphones labeled with name (for computer)" });
  assert.ok(r.body.items.some((i) => i.amount === "2" && /Kleenex/.test(i.item)));
  assert.ok(r.body.sections.length === 6 && r.body.sections.every((s) => s.items.length));
  assert.deepStrictEqual(r.body.notes, ["All students need tennis shoes for PE."]);
  assert.strictEqual(r.body.source, DATA.SCHOOLS.ies.supplies);
});

test("supplies: no grade asked gives the first section; kindergarten is grade 0", async () => {
  const first = await call({ school: "ies", what: "supplies" });
  assert.strictEqual(first.body.items.length, first.body.sections[0].items.length);
  const k = await call({ school: "ies", what: "supplies", grade: "0" });
  assert.strictEqual(k.body.title, "Kindergarten supply list");
  assert.ok(k.body.items.some((i) => /Ticonderoga/.test(i.item)));
  // A grade the sheet doesn't have falls back rather than failing.
  const none = await call({ school: "ies", what: "supplies", grade: "9" });
  assert.strictEqual(none.status, 200);
  assert.ok(none.body.items.length);
});

test("supplies: a school with no list answers an empty list", async () => {
  const r = await call({ school: "bvhs", what: "supplies", grade: "10" });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.items, []);
  assert.deepStrictEqual(r.body.grades, []);
});

/* ---------- handbook ---------- */

test("handbook: the high school handbook in sections, with ATTENDANCE", async () => {
  const r = await call({ school: "bvhs", what: "handbook" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.title, "High School handbook");
  assert.strictEqual(r.body.which, "high");
  assert.strictEqual(r.body.source, DATA.DISTRICT.handbooks.high);
  assert.ok(r.body.sections.length >= 45 && r.body.sections.length <= 55, `${r.body.sections.length} sections`);
  const att = r.body.sections.find((s) => s.title === "ATTENDANCE");
  assert.ok(att, "ATTENDANCE section");
  assert.ok(/See ATTENDANCE in District section/.test(att.text), att.text.slice(0, 120));
  assert.ok(/planned absences/i.test(att.text));
  assert.ok(r.body.sections.every((s) => s.title && s.text.length > 20));
  // Ligatures the PDF mislabels are repaired.
  assert.ok(!/[ƞƟƩ]/.test(JSON.stringify(r.body.sections)));
});

test("handbook: which= picks the district or activities handbook; unknown is 400", async () => {
  const bad = await call({ school: "bvhs", what: "handbook", which: "cafeteria" });
  assert.strictEqual(bad.status, 400);
  // The activities PDF is not in the fixtures, so the source is down: 502 with no saved copy.
  const act = await call({ school: "bvhs", what: "handbook", which: "activities" });
  assert.strictEqual(act.status, 502);
  assert.strictEqual(act.body.error, "Source unavailable");
});

/* ---------- page: contact ---------- */

test("page contact: phone, email and address from the footer; other slugs 404", async () => {
  const r = await call({ school: "bvhs", what: "page", slug: "contact" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.name, "Contact");
  assert.strictEqual(r.body.url, DATA.SCHOOLS.bvhs.site);
  assert.strictEqual(r.body.phone, "605-582-3211");
  assert.strictEqual(r.body.email, "Mark.Schlekeway@k12.sd.us");
  assert.strictEqual(r.body.address, "301 S. Splitrock Blvd Brandon, SD 57005");
  assert.ok(r.body.blocks.length === 2 && /tel:6055823211/.test(r.body.blocks[1]));
  assert.strictEqual((await call({ school: "bvhs", what: "page", slug: "graduation" })).status, 404);
});

/* ---------- empty kinds ---------- */

test("staff, news, feed and scholarships are empty lists, never errors", async () => {
  assert.deepStrictEqual((await call({ school: "bvhs", what: "staff" })).body.people, []);
  assert.deepStrictEqual((await call({ school: "bvhs", what: "news" })).body.items, []);
  assert.deepStrictEqual((await call({ school: "ies", what: "feed" })).body.items, []);
  assert.deepStrictEqual((await call({ school: "bvhs", what: "scholarships" })).body.items, []);
  assert.strictEqual((await call({ school: "nowhere", what: "staff" })).status, 400);
  assert.strictEqual((await call({ school: "bvhs", what: "lockers" })).status, 400);
});

/* ---------- alerts: KELOLAND closings ---------- */

test("alerts: the district's KELO entry becomes a banner the app classifies; the bank is ignored", async () => {
  const r = await call({ school: "bvhs", what: "alerts" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.alerts.length, 1, JSON.stringify(r.body.alerts));
  const a = r.body.alerts[0];
  assert.strictEqual(a.html, "<b>Brandon Valley School District:</b> Two hours late (No morning preschool)");
  assert.ok(/^kelo-[0-9a-f]{16}$/.test(a.id));
  assert.strictEqual(a.at, "2026-01-12T11:45:00.000Z");
  assert.strictEqual(SH.alertKind(a.html), "late2");
  assert.ok(!JSON.stringify(r.body).includes("Bank"));
});

test("alerts: closed, two hours late and early dismissal wordings all classify", () => {
  const banner = (status, detail = "") => closingsLib.toBanner({ name: "Brandon Valley School District", status, text: `Brandon Valley School District: ${status}`, detail, at: null }, new Date("2026-01-12T12:00:00Z"));
  assert.strictEqual(SH.alertKind(banner("Closed").html), "closed");
  assert.strictEqual(SH.alertKind(banner("Closed Monday", "All activities cancelled").html), "closed");
  assert.strictEqual(SH.alertKind(banner("Two hours late").html), "late2");
  assert.strictEqual(SH.alertKind(banner("2 hour late start").html), "late2");
  assert.strictEqual(SH.alertKind(banner("Starting 2 hours late").html), "late2");
  assert.strictEqual(SH.alertKind(banner("Early dismissal at 1:00 PM").html), "early");
  assert.strictEqual(SH.alertKind(banner("Dismissing 2 hours early").html), "early");
  assert.strictEqual(SH.alertKind(banner("No school").html), "closed");
  // Different wording, different id; same wording, same id.
  assert.notStrictEqual(banner("Closed").id, banner("Two hours late").id);
  assert.strictEqual(banner("Closed").id, banner("Closed").id);
  assert.strictEqual(banner("Closed").at, "2026-01-12T12:00:00.000Z");
});

test("alerts: findOurs reads any field layout and rejects the decoys", () => {
  const found = closingsLib.findOurs([
    { name: "Brandon Valley Bank", closing_status: "Closed" },
    { organization: "Brandon Valley Community Church", message: "Services cancelled" },
    { org_name: "Brandon Valley Schools", closing_status: "Closed", note: "Snow" },
    { weird: { nested: ["Brandon Valley School District", "Early dismissal at 1:00"] } },
    "not an object",
    null,
  ]);
  assert.strictEqual(found.length, 2, JSON.stringify(found));
  assert.strictEqual(found[0].text, "Brandon Valley Schools: Closed");
  assert.strictEqual(found[0].detail, "Snow");
  assert.ok(/Early dismissal/.test(found[1].text));
  assert.deepStrictEqual(closingsLib.findOurs([]), []);
  assert.deepStrictEqual(closingsLib.findOurs({ data: [{ title: "Brandon Valley Bowl", status: "Closed" }] }), []);
});

test("alerts: the scheduled check's banner hooks", async () => {
  const d = await relay._internals.districtBanners();
  assert.strictEqual(d.length, 1);
  assert.strictEqual(SH.alertKind(d[0].html), "late2");
  assert.deepStrictEqual(await relay._internals.schoolBanners("bvhs"), []);
});

test("alerts: an ordinary day is an empty list", async () => {
  kelo = [];
  // The saved copy is two minutes fresh; force past it.
  const { load, save } = require(path.join(ROOT, "netlify/functions/lib/sources.js"));
  const saved = await load("school-district-alerts");
  await save("school-district-alerts", { ...saved, at: Date.now() - 10 * 60e3 });
  const r = await call({ school: "ies", what: "alerts" });
  assert.deepStrictEqual(r.body.alerts, []);
  kelo = KELO;
});

/* ---------- failure: the saved copy ---------- */

test("a 503 from the district serves the saved copy; a never-saved kind is 502", async () => {
  const { load, save } = require(path.join(ROOT, "netlify/functions/lib/sources.js"));
  const key = "school-bvhs-forms";
  const saved = await load(key);
  assert.ok(saved, "forms were saved by the earlier call");
  await save(key, { ...saved, at: Date.now() - 2 * 24 * 3600e3 }); // two days old: a refetch is due
  down = new Set(["brandonvalley.k12.sd.us"]);
  const r = await call({ school: "bvhs", what: "forms" });
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.groups.length > 3, "the saved groups came back");
  assert.strictEqual(r.headers["Netlify-CDN-Cache-Control"], "public, s-maxage=60", "stale answers leave the CDN quickly");
  const fresh = await call({ school: "bvms", what: "forms" });
  assert.strictEqual(fresh.status, 502);
  assert.deepStrictEqual(fresh.body, { error: "Source unavailable" });
  down = new Set();
});

test("doc passthrough: district PDFs only", async () => {
  const bad = await relay.handler({ queryStringParameters: { what: "doc", url: "https://example.com/x.pdf" } });
  assert.strictEqual(bad.statusCode, 403);
  const notPdf = await relay.handler({ queryStringParameters: { what: "doc", url: "https://brandonvalley.k12.sd.us/bvhs/index.html" } });
  assert.strictEqual(notPdf.statusCode, 403);
  const ok = await relay.handler({ queryStringParameters: { what: "doc", url: DATA.SCHOOLS.ies.supplies } });
  assert.strictEqual(ok.statusCode, 200);
  assert.strictEqual(ok.headers["Content-Type"], "application/pdf");
  assert.ok(ok.isBase64Encoded && Buffer.from(ok.body, "base64").slice(0, 4).toString() === "%PDF");
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (err) { failed++; console.log(`  FAIL ${name}\n       ${String(err.message).split("\n")[0]}`); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} school relay tests passed`);
  fs.rmSync(process.env.SFP_CACHE_DIR, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})();
