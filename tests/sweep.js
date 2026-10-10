/* Screen sweep: clicks every control on every tab (and one level inside
 * each sheet) for a family covering all four schools, every grade, diet
 * lines, allergies and a graduate, and checks every screen for sideways
 * overflow, overlapping text, small tap targets, words split across lines,
 * empty or failed sheets, accessibility (axe) and console errors.
 *
 *   node tests/sweep.js                      English + Spanish at 375 and 320 (before every deploy)
 *   WIDTHS=320,375,820,1280 node tests/sweep.js   the full audit
 * Runs its own local server on a scratch cache. Exit 1 on any finding;
 * screenshots in .cache/sweep for anything to look at.
 */
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const PORT = 8498;
const BASE = process.env.BASE || `http://localhost:${PORT}`;
const OUT = path.join(ROOT, ".cache", "sweep");
const WIDTHS = (process.env.WIDTHS || "375,320").split(",").map(Number);
const LANGS = (process.env.LANGS || "en,es").split(",");
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const FAMILIES = {
  four: [
    { id: "k1", name: "Maya", school: "bvhs", classOf: 2028, diet: "", follows: [{ act: "Volleyball", level: "" }], allergies: ["Milk", "Peanuts"] },
    { id: "k2", name: "Jordan", school: "bvms", classOf: 2030, diet: "", follows: [{ act: "Football", level: "" }], allergies: [] },
    { id: "k3", name: "Ava", school: "bvis", classOf: 2033, diet: "", follows: [], allergies: [] },
    { id: "k4", name: "Sam", school: "bvhs", classOf: 2029, diet: "", follows: [{ act: "Boys Soccer", level: "" }], allergies: ["Wheat"] },
  ],
  // Junior kindergarten, kindergarten, 3rd, a 4th grader now in 5th who
  // hasn't picked the Intermediate School yet, 7th and 8th.
  younger: [
    { id: "y0", name: "Mia", school: "bes", classOf: 2040, diet: "", follows: [], allergies: [] },
    { id: "y1", name: "Leo", school: "ies", classOf: 2039, diet: "", follows: [], allergies: ["Peanuts"] },
    { id: "y2", name: "Nora", school: "rbe", classOf: 2036, diet: "", follows: [], allergies: [] },
    { id: "y3", name: "Eli", school: "fae", classOf: 2034, diet: "", follows: [], allergies: [] },
    { id: "y4", name: "Jordan", school: "bvms", classOf: 2032, diet: "", follows: [{ act: "Football", level: "" }], allergies: [] },
    { id: "y5", name: "Ava", school: "bvms", classOf: 2031, diet: "", follows: [{ act: "Volleyball", level: "" }], allergies: [] },
  ],
  graduate: [
    { id: "g1", name: "Chris", school: "bvhs", classOf: 2026, diet: "", follows: [], allergies: [] },
    { id: "g2", name: "", school: "bvhs", classOf: 2027, diet: "", follows: [], allergies: [] },
  ],
};

const findings = [];
const seenFinding = new Set();
const add = (where, kind, detail) => { const k = `${kind}|${detail}`; if (seenFinding.has(k + where.split(" ")[0])) return; seenFinding.add(k + where.split(" ")[0]); findings.push({ where, kind, detail }); };

async function checks(page, where) {
  const r = await page.evaluate(() => {
    const W = document.documentElement.clientWidth, H = window.innerHeight;
    const sheet = document.querySelector("#sheet:not([hidden])");
    const scope = sheet || document.body;
    const hiddenUp = (el) => !!el.closest("[hidden]") || (el.closest("details:not([open])") && !el.closest("summary"));
    const vis = (el) => { if (hiddenUp(el)) return false; const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return b.width > 0 && b.height > 0 && s.visibility !== "hidden" && s.display !== "none" && +s.opacity !== 0; };
    // Fixed/sticky things that content legitimately scrolls under.
    const covers = [...document.querySelectorAll("*")].filter((el) => { const p = getComputedStyle(el).position; return (p === "fixed" || p === "sticky") && vis(el); }).map((el) => el.getBoundingClientRect());
    const underCover = (b) => covers.some((c) => b.top < c.bottom && b.bottom > c.top && b.left < c.right && b.right > c.left);
    const out = { overflow: [], overlap: [], small: [], breaks: [] };
    for (const el of scope.querySelectorAll("*")) {
      if (!vis(el)) continue;
      const b = el.getBoundingClientRect();
      if (b.right > W + 0.5 || b.left < -0.5) out.overflow.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} "${(el.innerText || "").trim().slice(0, 30)}"`);
    }
    // Overlap between visible text runs, ignoring anything under a fixed/sticky bar.
    const runs = [];
    const tw = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!n.nodeValue.trim() || !n.parentElement || !vis(n.parentElement)) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const rc of rg.getClientRects()) if (rc.width > 2 && rc.bottom > 0 && rc.top < H && !underCover(rc) || (sheet && rc.width > 2 && sheet.contains(n.parentElement) && !underCover(rc))) runs.push({ rc, el: n.parentElement, txt: n.nodeValue.trim().slice(0, 25) });
    }
    for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
      const a = runs[i], c = runs[j];
      if (a.el === c.el) continue;
      const ox = Math.min(a.rc.right, c.rc.right) - Math.max(a.rc.left, c.rc.left), oy = Math.min(a.rc.bottom, c.rc.bottom) - Math.max(a.rc.top, c.rc.top);
      if (ox > 3 && oy > 3) out.overlap.push(`"${a.txt}" / "${c.txt}"`);
    }
    // Tap targets (an ::after hit area counts).
    for (const el of scope.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], label.check")) {
      if (!vis(el)) continue;
      const b = el.getBoundingClientRect();
      const a = getComputedStyle(el, "::after");
      const extra = a.content !== "none" && a.position === "absolute" ? -parseFloat(a.top || 0) - parseFloat(a.bottom || 0) : 0;
      const h = b.height + (extra > 0 ? extra : 0);
      const lbl = el.closest("label");
      const lh = lbl ? lbl.getBoundingClientRect().height : 0;
      if (el.type === "checkbox" && el.id && document.querySelector(`label[for="${el.id}"]`)) continue;
      if (Math.max(h, lh) < 43.5) out.small.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute("aria-label") || el.value || "").trim().slice(0, 28)}" ${Math.round(b.width)}x${Math.round(Math.max(h, lh))}`);
    }
    // Mid-word breaks: any word whose letters land on two lines.
    for (const el of scope.querySelectorAll("h1,h2,h3,b,button,a,summary,.row-k,.tag,.level-chip,.kid-name,.school-brand-name,.view-title,p")) {
      if (!vis(el) || el.children.length > 3) continue;
      const tw2 = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = tw2.nextNode(); n; n = tw2.nextNode()) {
        const re = /[\p{L}\p{N}][\p{L}\p{N}'’.-]*[\p{L}\p{N}]/gu; let m;
        while ((m = re.exec(n.nodeValue))) {
          const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
          const tops = new Set([...rg.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top)));
          if (tops.size > 1) out.breaks.push(`"${m[0]}" in "${n.nodeValue.trim().slice(0, 40)}"`);
        }
      }
    }
    const dedupe = (a, n) => [...new Set(a)].slice(0, n);
    return { overflow: dedupe(out.overflow, 5), overlap: dedupe(out.overlap, 6), small: dedupe(out.small, 8), breaks: dedupe(out.breaks, 6) };
  });
  for (const [k, list] of Object.entries(r)) for (const d of list) add(where, k, d);
}

// Every distinct control that opens or changes something.
const CONTROL_SEL = "[data-action],[data-page],[data-news],[data-post],[data-menu],[data-ev],[data-goto],[data-sched],[data-calfilter],[data-calmode],[data-guide-grade],[data-grade-tab],[data-month],[data-week],[data-doc],[data-hit],[data-kid],summary";
async function controls(page, scopeSel) {
  return page.evaluate(([sel, scopeSel]) => {
    const scope = document.querySelector(scopeSel);
    if (!scope) return [];
    const out = [], seen = new Set();
    for (const el of scope.querySelectorAll(sel)) {
      if (el.closest("[hidden]") || !el.getBoundingClientRect().width) continue;
      if (el.closest(".tab-bar")) continue;
      const attrs = [...el.attributes].filter((a) => a.name.startsWith("data-") && a.name !== "data-sweep" && a.name !== "data-pick").map((a) => `${a.name}=${a.name === "data-ev" || a.name === "data-news" || a.name === "data-post" || a.name === "data-hit" || a.name === "data-menu" ? "*" : a.value}`).join("&") || `summary:${el.textContent.trim().slice(0, 30)}`;
      if (seen.has(attrs)) continue;
      seen.add(attrs);
      el.setAttribute("data-sweep", String(out.length));
      out.push({ i: out.length, sig: attrs, label: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 40), tag: el.tagName });
    }
    return out;
  }, [CONTROL_SEL, scopeSel]);
}

const SKIP = /data-action=(lang|remove-kid|push-on|push-off|push-test|push-save|send-report|restore-go|save-kid|save-follow|log-absence|unlog-absence|share-native|share-week|copy|tip-done|season-hide|accept-setup)|data-doc=/;

(async () => {
  const server = process.env.BASE ? null : spawn(process.execPath, [path.join(ROOT, "dev-server.js"), ROOT, String(PORT)], { env: { ...process.env, SFP_CACHE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "sfp-sweep-")) }, stdio: "ignore" });
  if (server) await new Promise((r) => setTimeout(r, 900));
  // A server left running on this port would serve some other copy of the
  // app; refuse to test it.
  if (server) {
    const served = await fetch(`http://localhost:${PORT}/app.js`).then((r) => r.text()).catch(() => "");
    if (served !== fs.readFileSync(path.join(ROOT, "app.js"), "utf8")) { console.error(`Port ${PORT} is serving a different copy of the app. Stop that server first.`); server.kill(); process.exit(1); }
  }
  const b = await chromium.launch();
  const stats = { states: 0, controls: 0, sheets: 0, backOk: 0, backFail: [] };
  const combos = [];
  for (const lang of LANGS) for (const width of WIDTHS) for (const [famName, fam] of Object.entries(FAMILIES)) {
    if (famName === "graduate" && (width !== 375 || lang !== "en")) continue;
    combos.push({ lang, width, famName, fam });
  }
  // Four at a time: a full pass in minutes, not an hour.
  const queue = [...combos];
  await Promise.all([...Array(Math.min(4, queue.length))].map(async () => { for (let c = queue.shift(); c; c = queue.shift()) await runCombo(c); }));
  async function runCombo({ lang, width, famName, fam }) {
    const ctx = await b.newContext({ viewport: { width, height: 820 }, hasTouch: width < 800, locale: lang === "es" ? "es-US" : "en-US" });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(m.text()); });
    page.on("popup", (p) => p.close().catch(() => {}));
    await page.goto(BASE);
    await page.evaluate(([fam, lang]) => { localStorage.clear(); localStorage.setItem("sfp-kids", JSON.stringify(fam)); localStorage.setItem("sfp-lang", JSON.stringify(lang)); localStorage.setItem("sfp-install", '"done"'); }, [fam, lang]);
    const tag = `${lang}-${width}-${famName}`;
    for (const tab of ["today", "lunch", "calendar", "guide", "school"]) {
      const kidsToVisit = tab === "today" ? [null] : fam.map((k) => k.id);
      for (const kidId of kidsToVisit) {
        await page.goto(`${BASE}/#${tab}`);
        if (kidId) await page.evaluate((id) => localStorage.setItem("sfp-kid", JSON.stringify(id)), kidId);
        await page.reload();
        if (kidId) await page.locator(`.kid-chip[data-kid="${kidId}"]`).click({ timeout: 3000 }).catch(() => {});
        await page.locator(`.tab[data-tab="${tab}"]`).click({ timeout: 3000 }).catch(() => {});
        await page.waitForFunction((t) => !document.querySelector(`#view-${t} .loading`), tab, { timeout: 12000 }).catch(() => add(`${tag} ${tab} ${kidId || ""}`, "stuck-loading", "spinner after 12s"));
        await page.waitForTimeout(400);
        const where = `${tag} ${tab} ${kidId || ""}`;
        stats.states++;
        await checks(page, where);
        await page.screenshot({ path: `${OUT}/${tag}-${tab}-${kidId || "all"}.png`, fullPage: true });
        // Only sweep every control once per family/lang/width for the first kid at a school.
        if (kidId && fam.findIndex((k) => k.id === kidId) > 0 && width !== 375) continue;
        const list = await controls(page, `#view-${tab}`);
        for (const c of list) {
          if (SKIP.test(c.sig)) continue;
          stats.controls++;
          const before = page.url();
          // The app redraws after every action; find this control again.
          if ((await page.evaluate(() => location.hash.slice(1))) !== tab) { await page.locator(`.tab[data-tab="${tab}"]`).click().catch(() => {}); await page.waitForTimeout(600); }
          let fresh = (await controls(page, `#view-${tab}`)).find((x) => x.sig === c.sig);
          if (!fresh) {
            // An earlier click changed the view (another month, "All of school");
            // start this screen over and look again before calling it missing.
            await page.goto(`${BASE}/#${tab}`);
            await page.evaluate(() => localStorage.removeItem("sfp-calmode")); // the calendar remembers "All of school"
            await page.reload();
            if (kidId) await page.locator(`.kid-chip[data-kid="${kidId}"]`).click({ timeout: 3000 }).catch(() => {});
            await page.waitForFunction((t) => !document.querySelector(`#view-${t} .loading`), tab, { timeout: 12000 }).catch(() => {});
            fresh = (await controls(page, `#view-${tab}`)).find((x) => x.sig === c.sig);
          }
          if (!fresh) { add(where, "control-vanished", `${c.sig} "${c.label}"`); continue; }
          const el = page.locator(`#view-${tab} [data-sweep="${fresh.i}"]`);
          await el.scrollIntoViewIfNeeded().catch(() => {});
          const ok = await el.click({ timeout: 2500 }).then(() => true, () => el.evaluate((n) => n.click()).then(() => true, () => false));
          if (!ok) { add(where, "unclickable", `${c.sig} "${c.label}"`); continue; }
          await page.waitForTimeout(700);
          await page.locator("#sheetBody .loading").waitFor({ state: "detached", timeout: 10000 }).catch(() => add(where, "stuck-loading", `sheet from ${c.sig}`));
          const sheetOpen = await page.locator("#sheet").isVisible();
          if (sheetOpen) {
            stats.sheets++;
            const title = (await page.locator("#sheetTitle").innerText().catch(() => "")).trim();
            const sw = `${where} > ${c.sig} [${title}]`;
            const body = (await page.locator("#sheetBody").innerText().catch(() => "")).trim();
            if (body.length < 15) add(sw, "empty-sheet", body);
            if (/Couldn't load|No se pudo/.test(body)) add(sw, "load-error", body.slice(0, 80));
            await checks(page, sw);
            await page.screenshot({ path: `${OUT}/${tag}-${tab}-${kidId || "all"}-sheet-${c.i}.png` });
            if (width === 375) {
              await page.evaluate(AXE + ";0").catch(() => {});
              const v = await page.evaluate(async () => (await window.axe.run(document.querySelector("#sheet"), { resultTypes: ["violations"] })).violations.map((x) => `${x.id}: ${x.nodes[0].target}`)).catch((e) => [`axe failed ${e.message.slice(0, 40)}`]);
              for (const x of v) add(sw, "a11y", x);
              // One level inside the sheet.
              const inner = await controls(page, "#sheetBody");
              for (const ic0 of inner.slice(0, 12)) {
                const ic = (await controls(page, "#sheetBody")).find((x) => x.sig === ic0.sig) || ic0;
                if (SKIP.test(ic.sig) || /summary:/.test(ic.sig) === false && /data-action=(add-kid|edit-kid|follow|restore|notifications|share-setup|subscribe|report|all-posts|all-scholarships|supplies-sheet|counselors)/.test(ic.sig) === false) continue;
                const ok2 = await page.locator(`#sheetBody [data-sweep="${ic.i}"]`).click({ timeout: 2500 }).then(() => true, () => false);
                if (!ok2) { add(sw, "unclickable", `${ic.sig} "${ic.label}"`); continue; }
                await page.waitForTimeout(800);
                await page.locator("#sheetBody .loading").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
                await checks(page, `${sw} > ${ic.sig}`);
                await page.screenshot({ path: `${OUT}/${tag}-${tab}-${kidId || "all"}-sheet-${c.i}-${ic.i}.png` });
                if (!/summary:/.test(ic.sig)) break; // a new sheet replaced this one
              }
            }
            // Close: back button half the time, the close button otherwise.
            if (stats.sheets % 2) {
              // A sheet opened from inside another steps back one level per back press.
              for (let n = 0; n < 4 && await page.locator("#sheetBack").isVisible(); n++) {
                await page.goBack().catch(() => {});
                await page.waitForTimeout(500);
              }
              await page.goBack().catch(() => {});
              await page.waitForTimeout(500);
              if (await page.locator("#sheet").isVisible()) { stats.backFail.push(sw); await page.locator("#sheetClose").click().catch(() => {}); } else stats.backOk++;
              if (!page.url().startsWith(BASE)) await page.goto(before);
            } else await page.locator("#sheetClose").click().catch(() => {});
            await page.waitForTimeout(300);
          } else {
            // In-place change (chip, filter, fold, tab jump): check the result.
            await checks(page, `${where} after ${c.sig}`);
            if (!page.url().startsWith(BASE)) await page.goto(before);
            if ((await page.evaluate(() => location.hash.slice(1))) !== tab) { await page.locator(`.tab[data-tab="${tab}"]`).click().catch(() => {}); await page.waitForTimeout(500); }
          }
        }
      }
    }
    // Header controls: Students and Search.
    await page.goto(`${BASE}/#today`); await page.waitForTimeout(1500);
    for (const id of ["studentsBtn", "searchBtn"]) {
      await page.locator(`#${id}`).click().catch(() => {}); await page.waitForTimeout(1500);
      if (id === "searchBtn") { await page.locator("#searchInput").fill(lang === "es" ? "enfermera" : "nurse"); await page.waitForTimeout(3000); }
      await checks(page, `${tag} ${id}`);
      await page.screenshot({ path: `${OUT}/${tag}-${id}.png` });
      if (id === "studentsBtn") {
        const inner = await controls(page, "#sheetBody");
        for (const ic of inner) {
          if (SKIP.test(ic.sig)) continue;
          await page.locator("#studentsBtn").click().catch(() => {}); await page.waitForTimeout(600);
          await page.evaluate(([sel, i]) => { const all = [...document.querySelectorAll(sel.split(",").map((x) => "#sheetBody " + x).join(","))].filter((e) => !e.closest("[hidden]") && e.getBoundingClientRect().width); const seen = new Set(); let k = 0; for (const el of all) { const sig = [...el.attributes].filter((a) => a.name.startsWith("data-") && a.name !== "data-sweep" && a.name !== "data-pick").map((a) => a.name + a.value).join() || el.textContent.slice(0, 30); if (seen.has(sig)) continue; seen.add(sig); if (k++ === i) { el.setAttribute("data-pick", "1"); return; } } }, [CONTROL_SEL, ic.i]);
          const ok = await page.locator('#sheetBody [data-pick="1"]').first().click({ timeout: 2500 }).then(() => true, () => false);
          if (!ok) { add(`${tag} students`, "unclickable", ic.sig); continue; }
          await page.waitForTimeout(1200);
          await checks(page, `${tag} students > ${ic.sig}`);
          await page.screenshot({ path: `${OUT}/${tag}-students-${ic.i}.png` });
          await page.locator("#sheetClose").click().catch(() => {}); await page.waitForTimeout(300);
        }
      }
      await page.locator("#sheetClose").click().catch(() => {}); await page.waitForTimeout(300);
    }
    for (const e of [...new Set(errs)]) add(tag, "console-error", e.slice(0, 160));
    await ctx.close();
    console.log(`done ${tag}: ${stats.states} states, ${stats.controls} controls, ${stats.sheets} sheets so far`);
  }
  await b.close();
  if (server) server.kill();
  fs.writeFileSync(path.join(OUT, "findings.json"), JSON.stringify({ stats, findings }, null, 1));
  console.log(JSON.stringify({ ...stats, backFail: stats.backFail.length }));
  const byKind = {};
  for (const f of findings) (byKind[f.kind] ||= []).push(f);
  for (const [k, list] of Object.entries(byKind)) { console.log(`\n== ${k} (${list.length})`); for (const f of list.slice(0, 25)) console.log(`  ${f.where.slice(0, 90)} :: ${f.detail}`); }
  const failed = findings.length + stats.backFail.length;
  console.log(failed ? `\n${failed} findings; screenshots in .cache/sweep` : "\nScreen sweep clean.");
  process.exit(failed ? 1 : 0);
})();
