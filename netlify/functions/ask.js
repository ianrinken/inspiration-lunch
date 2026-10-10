/* Ask: a parent types a question; Claude answers from what the app already
 * knows about this family's schools and says where in the app to find it.
 *
 * POST { q, lang, kids: [{ school, grade, follows: [act] }], history: [{ q, a }] }
 *   -> { answer, links: [{ label, go }] }
 * GET ?ready=1 -> { ready } (false until ANTHROPIC_API_KEY is set, so the
 * app keeps its plain search).
 *
 * The facts come only from the app's own data (data.js, the transcribed
 * handbooks, and the same relays the app reads), gathered for the family's
 * schools and grades. No names are sent; questions are not stored.
 */
const { connect, openStore } = require("./lib/store.js");
const { overLimit, tooMany } = require("./lib/limit.js");
const SHARED = require("../../shared.js");
const SFDATA = require("../../data.js");
const HANDBOOKS = require("../../handbooks.js");

const MODEL = "claude-opus-5-5";
const DAILY_CAP = 600; // questions per day across all families: a cost ceiling
const GO = ["today", "lunch", "calendar", "guide", "school", "absence", "staff", "forms", "subscribe", "notifications", "students", "search"];

// Where things are in the app, so answers can say "School tab, Report an absence".
const APP_MAP = `Where things are in the Brandon Valley Lunch app (tabs along the bottom):
- Today (go "today"): one line about tomorrow for the family, then a card per child with that school's hours, lunch on the child's lunch line, games for followed teams, and "Made for" highlights (deadlines, conferences, programs). "Changed since you last looked" shows moved or cancelled games and new school news. "The family's week" lists the next days for all children.
- Lunch (go "lunch"): the next lunch in a big card, then the week's menus. Tap a day for the full menu and the allergens the district lists.
- Calendar (go "calendar"): "For [child]" (their grade, their teams, days off) or "All of [school]"; filters Everything, Games, Days off, College; the button "Put [child]'s calendar on my phone" (go "subscribe") adds it to the phone's own calendar.
- Guide (go "guide"): the grade's checklist, what's coming up for that grade, national test dates for 10th-12th, and facts for that year.
- School (go "school"): call the office, report an absence (go "absence"), directions, hours or bell schedule, "Good to know" (costs and rules), the student handbook read in the app (searchable), the supply list by grade, clubs with advisors, "Forms and links" from the school website (go "forms"), and sign-in links (Skyward Family Access for grades and attendance, LINQ Connect for the lunch account, Bound for tickets).
- Students button at the top (go "students"): add or edit a student, notifications (go "notifications"), set up another parent's phone, Español.
- The magnifying glass at the top (go "search"): search across calendar, staff, rules, schedules, clubs and lunch.`;

const SYSTEM = `You are the help assistant inside Brandon Valley Lunch, an independent app (not run by the Brandon Valley School District in Brandon, South Dakota) that shows families their children's school information.

Answer the parent's question using ONLY the facts provided in the family context and the app map. Follow these rules:
- If the facts don't answer the question, say plainly that the app doesn't have that, and point them to the right school office phone number from the context, or to the district website. Never guess times, dates, prices, names or rules.
- Keep answers short: one to three sentences, plain words a busy parent reads on a phone. No lists unless the question asks for several items.
- When the answer lives somewhere in the app, add links (at most 3) using only these destinations: ${GO.join(", ")}. Each link label says where it goes in a few words, in the parent's language.
- Answer in the language given ("en" English, "es" clear Latin American Spanish). Keep school, program and people's names as written.
- The parent's children are described by school, grade and teams only. Say "your 7th grader" or "your student at Inspiration"; never ask for names, birthdays or student IDs.
- Medicine, allergies, custody or safety questions: give what the school rules in the context say, and tell them to call the school (or the school nurse) to confirm.
- You only help with school information for this family. Politely decline anything else.

${APP_MAP}`;

const ymd = (d) => d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const relay = async (fn, q) => { try { const r = await fn.handler({ queryStringParameters: q, headers: {} }); return r.statusCode === 200 ? JSON.parse(r.body) : null; } catch { return null; } };

// Everything the app knows that matters to this family, as plain text.
async function familyContext(kids, lang) {
  const today = ymd(new Date());
  const events = require("./events.js")._internals;
  const school = require("./school.js");
  const menu = require("./menu.js");
  const out = [`Today is ${today} (${new Date().toLocaleDateString("en-US", { weekday: "long", timeZone: "America/Chicago" })}), Central time. Language: ${lang}.`];
  const seen = new Set();
  for (const [i, k] of kids.entries()) {
    const s = SFDATA.SCHOOLS[k.school];
    if (!s) continue;
    const kid = { school: k.school, grade: k.grade, follows: k.follows.map((act) => ({ act, level: "" })) };
    out.push(`\n## Child ${i + 1}: ${k.grade === -1 ? "junior kindergarten" : k.grade === 0 ? "kindergarten" : `grade ${k.grade}`} at ${s.name}${k.follows.length ? `; follows ${k.follows.join(", ")}` : ""}`);
    // Upcoming for this child: their grade, their teams, the district dates.
    try {
      const end = SHARED.addDays(today, 21);
      const all = (await events.loadSchool(k.school)).filter((e) => e.d >= today && e.d <= end);
      const mine = SHARED.sortEvents(SHARED.mergeDistrict(SFDATA.DISTRICT_CALENDAR, all, today, SHARED.addDays(today, 60), k.grade).filter((e) => SHARED.mineFilter(kid, e)));
      out.push("Coming up for this child:", ...mine.slice(0, 30).map((e) => `- ${e.d}${e.to ? ` to ${e.to}` : ""}${e.t ? ` ${e.t}` : ""}: ${e.x ? "CANCELLED " : ""}${e.title}${e.level ? ` (${e.level})` : ""}${e.venue ? `, ${e.venue}` : ""}`));
    } catch { out.push("(Calendar unavailable right now.)"); }
    for (const d of SHARED.deadlinesFor(SFDATA, k.grade, today, SHARED.addDays(today, 90))) out.push(`- Deadline ${d.d}: ${d.key.replace(/\{(\w+)\}/g, (m, v) => d.vars[v] || "")}`);
    const g = SFDATA.GUIDE[k.grade];
    if (g) out.push(`Grade guide "${g.headline}": ${g.intro} Checklist: ${g.todo.map((x) => x.text).join("; ")}. Facts: ${g.facts.map((f) => `${f.title}: ${f.body}`).join(" ")}`);
    if (seen.has(k.school)) continue;
    seen.add(k.school);
    // The school itself, once per school.
    const b = s.bell;
    out.push(`\n## ${s.name}`, `Office phone ${s.phone}${s.attendance ? `; attendance line ${s.attendance}` : ""}. Address ${s.address}. ${s.principal ? `Principal ${s.principal}.` : ""} School hours ${b.about ? "about " : ""}${b.start} to ${b.end}${b.wed ? `, Wednesdays out at ${b.wed}` : ""}${b.about ? " (not published by the school; call to confirm)" : ""}. ${s.attendanceNote || ""} Website ${s.site}.`);
    const hb = HANDBOOKS[k.school];
    if (hb) {
      for (const x of hb.schedules || []) out.push(`Bell schedule "${x.name}": ${x.rows.map((r) => `${r.label} ${r.start || ""}${r.end ? `-${r.end}` : ""}`).join("; ")}`);
      if (hb.lunch) out.push(`Lunch rules: ${hb.lunch}`);
      for (const p of hb.policies || []) out.push(`Rule "${p.title}": ${p.body}`);
    } else if (SFDATA.LEVEL_INFO[s.level]) {
      for (const p of SFDATA.LEVEL_INFO[s.level].policies) out.push(`Rule "${p.title}" (all ${s.level === "es" ? "elementary" : "middle"} schools): ${p.body}`);
    }
    const costs = s.level === "hs" ? SFDATA.COSTS.district.concat(SFDATA.COSTS[k.school] || []) : SFDATA.LEVEL_INFO[s.level].costs;
    out.push(`Costs: ${costs.map((c) => `${c.what} ${c.cost}`).join("; ")}.`);
    const [staff, alerts, food] = await Promise.all([
      relay(school, { school: k.school, what: "staff" }),
      relay(school, { school: k.school, what: "alerts" }),
      relay(menu, { school: k.school, start: today, end: SHARED.addDays(today, 7) }),
    ]);
    const key = (staff && staff.people || []).filter((p) => /principal|nurse|counselor|clerical|secretary|attendance|registrar|activities director|athletic director|social worker|liaison/i.test(`${p.title} ${p.dept}`));
    if (key.length) out.push(`Staff to know: ${key.slice(0, 25).map((p) => `${p.n} (${p.title || p.dept}${p.email ? `, ${p.email}` : ""})`).join("; ")}.`);
    if (alerts && alerts.alerts && alerts.alerts.length) out.push(`Alerts posted now: ${alerts.alerts.map((a) => String(a.html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).join(" | ")}`);
    if (food && food.days) {
      for (const d of food.days.slice(0, 6)) {
        const lunch = (d.lines && (d.lines.Lunch || Object.entries(d.lines).find(([n]) => /^Lunch/.test(n))?.[1])) || [];
        if (lunch.length) out.push(`Lunch ${d.d}: ${lunch.filter((x) => x.t === "ENTREES").map((x) => x.n).join(" or ") || lunch[0].n}. Special lines: ${Object.keys(d.lines).filter((n) => /^Lunch - /.test(n)).join(", ") || "none"}.`);
      }
    }
  }
  // The whole rest of the year, so "when is winter break" has an answer.
  const yearEnd = (SFDATA.SCHOOL_YEARS.find((y) => y.first <= today && y.last >= today) || SFDATA.SCHOOL_YEARS[0]).last;
  const off = SFDATA.DISTRICT_CALENDAR.filter((e) => (e.kind === "noschool" || e.kind === "break") && (e.to || e.d) >= today && e.d <= yearEnd);
  out.push(`\nDistrict days off for the rest of this school year (last day ${yearEnd}): ${off.map((e) => `${e.d}${e.to ? ` to ${e.to}` : ""} ${e.title}`).join("; ")}.`);
  // Every state championship, followed or not ("where is state soccer?").
  const state = (SFDATA.STATE_EVENTS || []).filter((e) => (e.to || e.d) >= today);
  if (state.length) out.push(`\nSDHSAA state championships for high schools this year: ${state.map((e) => `${e.title}, ${e.d}${e.to ? ` to ${e.to}` : ""}, ${e.venue}`).join("; ")}.`);
  return out.join("\n");
}

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) { const Anthropic = require("@anthropic-ai/sdk"); client = new (Anthropic.default || Anthropic)({ maxRetries: 0, timeout: 20e3 }); }
  return client;
}

const json = (code, body) => ({ statusCode: code, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });

// One shared counter per day, so a busy day can't run up an open-ended bill.
async function underDailyCap() {
  try {
    const store = openStore("limits");
    const key = `ask-day:${ymd(new Date())}`;
    const n = ((await store.get(key)) || { n: 0 }).n + 1;
    await store.set(key, { n, at: Date.now() });
    return n <= DAILY_CAP;
  } catch { return true; }
}

// Local preview only (SFP_FAKE_ASK=1, never on Netlify): a stand-in answer,
// so the screens can be checked without a Claude key.
const fake = () => !!process.env.SFP_FAKE_ASK && !process.env.NETLIFY;

exports.handler = async (event) => {
  connect(event);
  const ready = !!getClient() || fake();
  if (event.httpMethod === "GET") return json(200, { ready });
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  if (!ready) return json(503, { error: "Not available yet" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Bad request" }); }
  const q = String(body.q || "").trim().slice(0, 300);
  if (q.length < 2) return json(400, { error: "Ask a question" });
  const lang = body.lang === "es" ? "es" : "en";
  const kids = (Array.isArray(body.kids) ? body.kids : []).slice(0, 6)
    .filter((k) => k && SFDATA.SCHOOLS[k.school] && Number.isInteger(k.grade) && k.grade >= 0 && k.grade <= 12)
    .map((k) => ({ school: k.school, grade: k.grade, follows: (Array.isArray(k.follows) ? k.follows : []).slice(0, 12).map((f) => String(f).slice(0, 60)) }));
  if (!kids.length) return json(400, { error: "No students" });
  const history = (Array.isArray(body.history) ? body.history : []).slice(-3)
    .map((h) => ({ q: String(h.q || "").slice(0, 300), a: String(h.a || "").slice(0, 800) })).filter((h) => h.q && h.a);
  if (await overLimit(event, "ask", 150, 60)) return tooMany();
  if (!(await underDailyCap())) return json(429, { error: "The assistant is busy today. Search still works." });

  const context = await familyContext(kids, lang);
  if (fake()) return json(200, { answer: `Stand-in answer (${context.length} characters of context) for: ${q}`, links: [{ label: "Report an absence", go: "absence" }, { label: "Lunch", go: "lunch" }] });
  const messages = [];
  // The family context is the same for every question in a visit; cache it.
  messages.push({ role: "user", content: [{ type: "text", text: `Family context:\n${context}`, cache_control: { type: "ephemeral" } }, { type: "text", text: history.length ? `Question: ${history[0].q}` : `Question: ${q}` }] });
  for (const [i, h] of history.entries()) {
    messages.push({ role: "assistant", content: JSON.stringify({ answer: h.a, links: [] }) });
    messages.push({ role: "user", content: `Question: ${i + 1 < history.length ? history[i + 1].q : q}` });
  }
  try {
    const res = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              answer: { type: "string" },
              links: { type: "array", items: { type: "object", properties: { label: { type: "string" }, go: { type: "string", enum: GO } }, required: ["label", "go"], additionalProperties: false } },
            },
            required: ["answer", "links"],
            additionalProperties: false,
          },
        },
      },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages,
    });
    if (res.stop_reason === "refusal") return json(200, { answer: lang === "es" ? "No puedo ayudar con eso. Pregúnteme sobre la escuela de su estudiante." : "I can't help with that. Ask me about your student's school.", links: [] });
    if (res.stop_reason === "max_tokens") return json(502, { error: "No answer" });
    const out = JSON.parse(res.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
    return json(200, { answer: String(out.answer || "").slice(0, 1200), links: (out.links || []).filter((l) => GO.includes(l.go)).slice(0, 3) });
  } catch (err) {
    console.error("ask failed:", err && err.status, err && err.name, String(err && err.message || err).slice(0, 300));
    const Anthropic = require("@anthropic-ai/sdk");
    const A = Anthropic.default || Anthropic;
    if (err instanceof A.RateLimitError) return json(429, { error: "Busy right now. Try again in a minute." });
    // The owner (admin key) sees why, to diagnose; parents never do.
    const owner = process.env.ADMIN_KEY && (event.headers || {})["x-admin-key"] === process.env.ADMIN_KEY;
    return json(502, owner ? { error: "No answer right now", status: err && err.status, name: err && err.name, detail: String(err && err.message || err).slice(0, 300) } : { error: "No answer right now" });
  }
};

exports._internals = { familyContext, SYSTEM };
