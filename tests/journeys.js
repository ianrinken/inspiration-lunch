/* Browser journeys: a real (headless) browser uses the app the way a parent
 * does, against the local dev server and live public data.
 *   node tests/journeys.js
 * Checks: setup from scratch, every tab, the main sheets, the back button,
 * Spanish, no console errors, no sideways scroll at 320/375/820/1280,
 * and no accessibility violations (axe-core).
 */
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = 8499;
// BASE=https://... runs the same journeys against a deployed site.
const LIVE = process.env.BASE;
const BASE = LIVE || `http://localhost:${PORT}`;
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const TABS = ["today", "lunch", "calendar", "guide", "school"];

// Saved copies of the activities calendars, so a Bound outage can't fail the run.
const cache = fs.mkdtempSync(path.join(os.tmpdir(), "sfp-journeys-"));
for (const [key, file] of [["bound-brandonvalley", "bound-brandonvalley.ics"], ["gcal-bvhs", "gcal-bvhs.ics"]]) {
  const f = path.join(__dirname, "fixtures", file);
  if (fs.existsSync(f)) fs.writeFileSync(path.join(cache, `${key}.json`), JSON.stringify({ at: 0, hash: "fixture", body: fs.readFileSync(f, "utf8") }));
}

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `\n       ${detail}`}`); };

async function overflow(page) {
  return page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const bad = [];
    for (const el of document.querySelectorAll(".app-header, .app-header *, main *, .kid-bar *, .tab-bar, .tab-bar *")) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > W + 0.5 || r.left < -0.5)) bad.push(`${el.tagName}.${String(el.className).slice(0, 30)}`);
    }
    return bad.slice(0, 5);
  });
}

(async () => {
  const server = LIVE ? null : spawn(process.execPath, [path.join(ROOT, "dev-server.js"), ROOT, String(PORT)], { env: { ...process.env, SFP_CACHE_DIR: cache }, stdio: "ignore" });
  if (server) await new Promise((r) => setTimeout(r, 800));
  // A server left running on this port would serve some other copy of the
  // app; refuse to test it.
  if (server) {
    const served = await fetch(`http://localhost:${PORT}/app.js`).then((r) => r.text()).catch(() => "");
    if (served !== fs.readFileSync(path.join(ROOT, "app.js"), "utf8")) { console.error(`Port ${PORT} is serving a different copy of the app. Stop that server first.`); server.kill(); process.exit(1); }
  }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, locale: "en-US" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  try {
    /* 1. A new parent sets up a student. */
    await page.goto(BASE);
    await page.getByRole("button", { name: "New to Brandon Valley schools? Start here" }).click();
    check("new-family guide opens", await page.locator("#sheet .steps li").count() === 5);
    await page.locator("#sheetClose").click();
    await page.locator('#view-today [data-action="add-kid"]').first().click();
    await page.locator("#kidName").fill("Maya");
    // Grade first: it decides which schools are listed.
    await page.locator('.choice[data-grade="11"]').click();
    await page.locator('.choice[data-school="bvhs"]').click();
    await page.locator('[data-action="save-kid"]').click();
    await page.locator(".follow-toggle", { hasText: /^Volleyball$/ }).waitFor({ timeout: 15000 });
    await page.locator(".follow-toggle", { hasText: /^Volleyball$/ }).click();
    await page.locator('[data-action="save-follow"]').click();
    // Right after setup: the offer of the 7 PM heads-up and the calendar.
    await page.locator('#sheet [data-action="close-sheet"]').waitFor({ timeout: 5000 }).catch(() => {});
    check("after setup, the app offers the heads-up and the calendar", /Stay in the loop/.test(await page.locator("#sheetTitle").innerText().catch(() => "")));
    await page.locator('#sheet [data-action="close-sheet"]').click();
    await page.locator(".kid-sum .day-status-line").first().waitFor({ timeout: 15000 });
    check("Today answers the day in one sentence", /school day|No school|late start|closed|Summer/i.test(await page.locator("#answerLine").innerText()));
    check("Today has the four task buttons", (await page.locator(".tasks .task").count()) === 4);
    check("Today shows the new student", (await page.locator(".kid-sum .kid-name").first().textContent()) === "Maya");

    /* 2. Every tab renders; sheets open and close; back closes a sheet. */
    for (const tab of TABS) {
      await page.locator(`.tab[data-tab="${tab}"]`).click();
      await page.waitForFunction((t) => !document.querySelector(`#view-${t} .loading`), tab, { timeout: 10000 }).catch(() => {});
      const loading = await page.locator(`#view-${tab} .loading`).count();
      check(`${tab} tab finishes loading`, loading === 0, `${loading} spinners left`);
    }
    await page.locator('.tab[data-tab="lunch"]').click();
    await page.waitForTimeout(800);
    if (await page.locator("[data-menu]").count()) {
      await page.locator("[data-menu]").first().click();
      check("full menu opens", await page.locator("#sheet .menu-item").count() > 0);
      await page.goBack();
      await page.waitForTimeout(300);
      check("back button closes the sheet", await page.locator("#sheet").isHidden());
    }
    await page.locator('.tab[data-tab="school"]').click();
    await page.waitForTimeout(1500);
    for (const action of ["absence", "handbook", "clubs", "forms"]) {
      await page.locator(`[data-action="${action}"]`).first().click();
      await page.locator("#sheetBody .loading").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
      const text = (await page.locator("#sheetBody").innerText()).trim();
      check(`School: ${action} sheet has content`, text.length > 40 && !/Couldn't load/.test(text), text.slice(0, 80));
      await page.locator("#sheetClose").click();
    }
    await page.locator("#searchBtn").click();
    await page.locator("#searchInput").fill("handbook");
    await page.waitForTimeout(4000);
    await page.locator("#searchInput").fill("handbook ");
    check("search finds the handbook", /handbook/i.test(await page.locator("#searchResults").innerText()));
    await page.locator("#sheetClose").click();

    /* 3. No sideways scroll and no accessibility violations. */
    for (const width of [320, 375, 820, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const tab of TABS) {
        await page.locator(`.tab[data-tab="${tab}"]`).click();
        await page.waitForTimeout(600);
        const bad = await overflow(page);
        check(`no sideways scroll: ${tab} at ${width}`, bad.length === 0, bad.join(", "));
      }
    }
    await page.setViewportSize({ width: 375, height: 812 });
    // Evaluated from the test harness, so the site's security policy (which
    // correctly blocks injected scripts) doesn't block the checker.
    await page.evaluate(AXE + ";0");
    for (const tab of TABS) {
      await page.locator(`.tab[data-tab="${tab}"]`).click();
      await page.waitForTimeout(1200);
      const v = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.map((x) => `${x.id} x${x.nodes.length}`));
      check(`accessibility: ${tab}`, v.length === 0, v.join(", "));
    }

    /* 3b. A phone restored by family code asks for names, lunch lines and allergies. */
    const code = await page.evaluate(() => JSON.parse(localStorage.getItem("sfp-family") || "null"));
    if (code) {
      const fresh = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
      await fresh.goto(BASE);
      await fresh.locator('[data-action="restore"]').first().click();
      await fresh.locator("#restoreCode").fill(` ${code.code} `);
      await fresh.locator('[data-action="restore-go"]').click();
      await fresh.locator(".finish-setup").waitFor({ timeout: 10000 }).catch(() => {});
      check("restored phone asks for names, lunch lines and allergies", await fresh.locator(".finish-setup").isVisible());
      await fresh.close();
    }

    /* 3b. A kindergartner: grade first, then that level's schools. */
    {
      const young = await (await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true })).newPage();
      young.on("pageerror", (e) => errors.push(e.message));
      await young.goto(BASE);
      await young.locator('#view-today [data-action="add-kid"]').first().click();
      await young.locator("#kidName").fill("Leo");
      check("school list waits for a grade", await young.locator("#schoolField .choice").count() === 0);
      await young.locator('.choice[data-grade="0"]').click();
      check("kindergarten lists the 5 elementary schools", await young.locator("#schoolField .choice").count() === 5);
      await young.locator('.choice[data-school="ies"]').click();
      await young.locator('[data-action="save-kid"]').click();
      await young.locator('#sheet [data-action="save-follow"], #sheet [data-action="close-sheet"]').first().waitFor({ timeout: 15000 }).catch(() => {});
      await young.locator("#sheetClose").click().catch(() => {});
      await young.waitForTimeout(500);
      if (await young.locator("#sheet").isVisible()) await young.locator("#sheetClose").click().catch(() => {});
      await young.locator(".kid-sum .day-status-line").first().waitFor({ timeout: 15000 });
      check("Today shows the kindergartner at Inspiration", /Inspiration, Kindergarten/.test(await young.locator(".kid-sum .kid-meta").first().innerText()));
      { const st = await young.locator(".kid-sum .day-status-line").first().innerText(); check("elementary hours on Today", /8:10\sAM\sto\s3:00\sPM|No school|Summer|late start|closed/i.test(st), st); }
      await young.locator('.tab[data-tab="guide"]').click();
      await young.waitForTimeout(800);
      check("kindergarten guide", /Kindergarten, day one to May/.test(await young.locator("#view-guide").innerText()));
      await young.locator('.tab[data-tab="school"]').click();
      await young.waitForTimeout(1200);
      const sch = await young.locator("#view-school").innerText();
      check("elementary School tab: handbook and supply list, no high school rows", /Student handbook/.test(sch) && /Supply list/.test(sch) && !/Clubs and organizations/.test(sch));
      await young.locator('#view-school [data-action="supplies-sheet"]').first().click();
      await young.locator("#sheetBody .loading").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
      const sup = (await young.locator("#sheetBody").innerText()).trim();
      check("supply list reads in the app", sup.length > 60 && !/Couldn't load/.test(sup), sup.slice(0, 80));
      await young.locator("#sheetClose").click();
      check("no sideways scroll for an elementary family", (await overflow(young)).length === 0, (await overflow(young)).join(", "));
      await young.close();
    }

    /* 4. Spanish. */
    await page.locator("#studentsBtn").click();
    await page.locator('[data-action="lang"], .lang-toggle').first().click();
    await page.waitForTimeout(1200);
    check("Spanish switches the page language", (await page.getAttribute("html", "lang")) === "es");
    check("Spanish tab labels", /Hoy/.test(await page.locator(".tab-bar").innerText()));
    await page.locator('.tab[data-tab="school"]').click();
    await page.waitForTimeout(1500);
    const school = await page.locator("#view-school").innerText();
    check("Spanish handbook: bell schedule and rules", /Día regular/.test(school) && /Periodo 1/.test(school) && !/Regular day|Period 1\b/.test(school));
  } catch (err) {
    check("journey ran to the end", false, err.message.split("\n")[0]);
  }

  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  if (server) server.kill();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} journey checks passed`);
  process.exit(failed ? 1 : 0);
})();
