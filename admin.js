/* Admin page: the pinned announcement, reported mistakes, searches that
 * found nothing, usage counts and a backup download. */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const keyEl = document.getElementById("key");
try { keyEl.value = sessionStorage.getItem("sfp-admin") || ""; } catch {}
document.getElementById("keyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try { sessionStorage.setItem("sfp-admin", keyEl.value); } catch {}
  const res = await fetch("/.netlify/functions/report?days=60", { headers: { "x-admin-key": keyEl.value } });
  const out = document.getElementById("out");
  if (!res.ok) { out.innerHTML = `<p class="empty-note">${res.status === 401 ? "That key isn't right." : "Couldn't load."}</p>`; return; }
  const data = await res.json();
  const { reports, usage, misses = [], pin, answers = [], drift, overrides = [], sponsors = {}, leads = [] } = data;
  const give = data.donate || {};
  const giveShowing = !!(((give.monthly || []).length + (give.once || []).length) && give.recipient && give.fee !== null && give.fee !== undefined);
  window.__sponsors = sponsors;
  const SP_TABS = [["today", "Today"], ["lunch", "Lunch"], ["calendar", "Calendar"], ["guide", "Guide"], ["school", "School"]];
  const spTab = window.__spTab || "today";
  const sponsor = sponsors[spTab] || null;
  const donRow = (kind, i) => { const l = (give[kind] || [])[i] || {}; return `<div class="don-row"><input class="text-input" id="don-${kind}-amt${i}" type="number" min="1" max="1000" step="1" inputmode="numeric" placeholder="${[5, 10, 25][i]}" aria-label="${kind} amount ${i + 1} in dollars" value="${l.amount ? esc(l.amount) : ""}"><input class="text-input" id="don-${kind}-url${i}" type="url" placeholder="https://" aria-label="${kind} payment link ${i + 1}" value="${esc(l.url || "")}"></div>`; };
  window.__overrides = overrides;
  out.innerHTML = `
    <p class="section-label">Announcement on every screen</p>
    <form class="card field" id="pinForm">
      <label class="field-label" for="pinText">Message (English)</label>
      <textarea class="text-input" id="pinText" rows="3" maxlength="400">${esc(pin ? pin.text : "")}</textarea>
      <label class="field-label" for="pinEs">Message in Spanish (optional; leave empty to show the English)</label>
      <textarea class="text-input" id="pinEs" rows="3" maxlength="400">${esc(pin ? pin.es : "")}</textarea>
      <label class="field-label" for="pinUntil">Show through (optional)</label>
      <input class="text-input" id="pinUntil" type="date" value="${esc(pin ? pin.until : "")}">
      <button class="btn primary block" style="margin-top:10px">${pin ? "Update the announcement" : "Post the announcement"}</button>
      ${pin ? '<button class="btn block" type="button" id="pinClear" style="margin-top:8px">Take it down</button>' : ""}
      <p class="fine" id="pinNote">Parents see it within a few minutes.</p>
    </form>
    <p class="section-label">Sponsors, one per screen</p>
    <form class="card field" id="sponsorForm">
      <div class="filter-chips" role="group" aria-label="Screen">${SP_TABS.map(([k, label]) => `<button type="button" class="level-chip" data-sp-tab="${k}" aria-pressed="${k === spTab}">${label}${sponsors[k] ? `: ${esc(sponsors[k].name)}` : ": open"}</button>`).join("")}</div>
      <label class="field-label" for="spName">Business name</label>
      <input class="text-input" id="spName" maxlength="60" value="${esc(sponsor ? sponsor.name : "")}">
      <label class="field-label" for="spLine">One short line under the name (optional)</label>
      <input class="text-input" id="spLine" maxlength="90" value="${esc(sponsor ? sponsor.line : "")}">
      <label class="field-label" for="spUrl">Link when tapped</label>
      <input class="text-input" id="spUrl" type="url" placeholder="https://" value="${esc(sponsor ? sponsor.url : "")}">
      <label class="field-label" for="spLogo">Logo image address (optional, square works best)</label>
      <input class="text-input" id="spLogo" type="url" placeholder="https://" value="${esc(sponsor ? sponsor.logo : "")}">
      <label class="field-label" for="spUntil">Show through (optional)</label>
      <input class="text-input" id="spUntil" type="date" value="${esc(sponsor ? sponsor.until : "")}">
      <button class="btn primary block" style="margin-top:10px">${sponsor ? "Update this sponsor" : "Show this sponsor"}</button>
      ${sponsor ? '<button class="btn block" type="button" id="sponsorClear" style="margin-top:8px">Remove this sponsor</button>' : ""}
      <p class="fine" id="sponsorNote">${sponsor ? "Showing now on this screen in the app and on each school page." : "This screen is open."}</p>
    </form>
    <p class="section-label">Chip in for student lunches</p>
    <form class="card field" id="donateForm">
      <p class="fine">Up to three amounts each. Every amount needs its own payment link from your processor. Monthly shows first when it has links.</p>
      <p class="field-label">Monthly: dollars, then the subscription link</p>
      ${[0, 1, 2].map((i) => donRow("monthly", i)).join("")}
      <p class="field-label">One time: dollars, then the payment link</p>
      ${[0, 1, 2].map((i) => donRow("once", i)).join("")}
      <p class="field-label">Card processing fee: percent, then cents per gift</p>
      <div class="don-row"><input class="text-input" id="donProcPct" type="number" min="0" max="10" step="0.01" inputmode="decimal" aria-label="Processing percent" value="${esc(give.procPct ?? 2.9)}"><input class="text-input" id="donProcFixed" type="number" min="0" max="200" step="1" inputmode="numeric" aria-label="Processing cents per gift" value="${esc(Math.round((give.procFixed ?? 0.3) * 100))}"></div>
      <label class="field-label" for="donRecipient">Who gets the money (shown as "What you give goes to ...")</label>
      <input class="text-input" id="donRecipient" maxlength="160" placeholder="Brandon Valley Child Nutrition, toward unpaid student lunch balances" value="${esc(give.recipient || "")}">
      <label class="field-label" for="donFee">Administrative fee kept to run the app, in percent</label>
      <input class="text-input" id="donFee" type="number" min="0" max="30" step="0.5" inputmode="decimal" value="${give.fee === null || give.fee === undefined ? "" : esc(give.fee)}">
      <label class="field-label" for="donSent">Passed on so far, in dollars</label>
      <input class="text-input" id="donSent" type="number" min="0" step="0.01" inputmode="decimal" value="${give.sent ? esc(give.sent) : ""}">
      <label class="field-label" for="donGoal">Goal, in dollars (optional; shows a progress bar)</label>
      <input class="text-input" id="donGoal" type="number" min="0" step="1" inputmode="numeric" value="${give.goal ? esc(give.goal) : ""}">
      <label class="field-label" for="donSentAsOf">As of</label>
      <input class="text-input" id="donSentAsOf" type="date" value="${esc(give.sentAsOf || "")}">
      <button class="btn primary block" style="margin-top:10px">Save</button>
      <p class="fine" id="donateNote">${giveShowing ? "The Chip in card is showing on the support page." : "The card stays hidden until there is at least one amount with its link, a named recipient and a fee (0 is allowed)."}</p>
    </form>
    <p class="section-label">Sponsor inquiries (${leads.length})</p>
    <article class="card">${leads.map((l) => `<div class="report"><p><b>${esc(l.business)}</b> ${esc(l.name)}${l.screen ? ` · ${esc(l.screen)} screen` : ""}</p><p>${esc(l.contact)}</p>${l.note ? `<p>${esc(l.note)}</p>` : ""}<p class="fine">${esc(new Date(l.at).toLocaleString())} <button class="small-btn" type="button" data-lead-done="${esc(l.key)}">Done</button></p></div>`).join("") || '<p class="empty-note">None yet. They arrive from the support page.</p>'}</article>
    <p class="section-label">Searches that found nothing (last 60 days)</p>
    <article class="card"><p class="fine">What parents looked for and the app couldn't answer. Each one is a gap to fill.</p>
      <table><tr><th>Search</th><th>Times</th><th></th></tr>${misses.map((m) => `<tr><td>${esc(m.q)}</td><td>${m.n}</td><td><button class="small-btn" type="button" data-answer-q="${esc(m.q)}">Answer this</button></td></tr>`).join("") || "<tr><td colspan=3>None yet</td></tr>"}</table></article>
    <p class="section-label">Answers parents see in search (${answers.length})</p>
    <form class="card field" id="answerForm">
      <p class="fine">Write the question the way parents type it. The answer shows at the top of search for any of its words.</p>
      <label class="field-label" for="ansQ">Question</label>
      <input class="text-input" id="ansQ" maxlength="120" placeholder="Where do I park for prom?">
      <label class="field-label" for="ansA">Answer</label>
      <textarea class="text-input" id="ansA" rows="3" maxlength="800"></textarea>
      <label class="field-label" for="ansLink">Link (optional, https://...)</label>
      <input class="text-input" id="ansLink" maxlength="300">
      <label class="field-label" for="ansQEs">Question in Spanish (optional)</label>
      <input class="text-input" id="ansQEs" maxlength="120">
      <label class="field-label" for="ansAEs">Answer in Spanish (optional)</label>
      <textarea class="text-input" id="ansAEs" rows="3" maxlength="800"></textarea>
      <button class="btn primary block" style="margin-top:10px">Save the answer</button>
      <p class="fine" id="ansNote"></p>
    </form>
    <article class="card">${answers.map((x) => `<div class="report"><p><b>${esc(x.q)}</b></p><p>${esc(x.a)}</p>${x.link ? `<p class="fine">${esc(x.link)}</p>` : ""}<button class="small-btn" type="button" data-answer-remove="${esc(x.id)}">Remove</button></div>`).join("") || "<p class='empty-note'>None yet.</p>"}</article>
    <p class="section-label">Nightly source check</p>
    <article class="card">${drift ? `<p class="fine">Last run ${esc(new Date(drift.at).toLocaleString())}.</p>${(drift.list || []).length ? `<ul>${drift.list.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "<p>Everything the app shows matched its source.</p>"}` : "<p class='empty-note'>First run tonight.</p>"}</article>
    <p class="section-label">Phones using the app, by day</p>
    <article class="card"><table><tr><th>Day</th><th>Phones</th><th>Installed</th><th>Sponsor taps</th><th>Schools</th></tr>
      ${usage.map((u) => `<tr><td>${esc(u.day)}</td><td>${u.phones}</td><td>${u.installed}</td><td>${esc(typeof u.sponsorClicks === "object" && u.sponsorClicks ? Object.entries(u.sponsorClicks).map(([k, v]) => `${k} ${v}`).join(", ") : "")}</td><td>${esc(Object.entries(u.bySchool).map(([k, v]) => `${k} ${v}`).join(", "))}</td></tr>`).join("") || "<tr><td colspan=5>No data yet</td></tr>"}
    </table></article>
    <p class="section-label">Backup</p>
    <article class="card"><p>Family codes and notification sign-ups are backed up nightly (14 days kept).</p><button class="btn block" id="backupBtn" style="margin-top:10px">Download the latest backup</button></article>
    <p class="section-label">Corrections to events (${overrides.length})</p>
    <article class="card"><p class="fine">Hide an event, retitle it, or limit it to certain grades. Applied everywhere within a minute: the app, the calendar feeds and the Google calendars.</p>
      ${overrides.map((o, i) => `<div class="report"><p><b>${esc(o.id)}</b> ${esc(o.date || "")} ${o.hide ? "hidden" : ""} ${o.title ? `title: ${esc(o.title)}` : ""} ${o.grades ? `grades: ${o.grades.length ? esc(o.grades.join(", ")) : "everyone"}` : ""}${o.why ? `<br><span class="fine">${esc(o.why)}</span>` : ""}</p><button class="small-btn" type="button" data-override-remove="${i}">Remove</button></div>`).join("") || "<p class='empty-note'>None.</p>"}
      <form class="field" id="overrideForm" style="margin-top:10px">
        <label class="field-label" for="ovId">Event id (from a report, or the Details link in the app)</label>
        <input class="text-input" id="ovId" maxlength="12" placeholder="uaizdd">
        <label class="field-label" for="ovDate">Date (optional, YYYY-MM-DD)</label>
        <input class="text-input" id="ovDate" maxlength="10">
        <label class="field-label" for="ovTitle">New title (optional)</label>
        <input class="text-input" id="ovTitle" maxlength="120">
        <label class="field-label" for="ovGrades">Grades, comma separated (optional; blank keeps the event's own)</label>
        <input class="text-input" id="ovGrades" maxlength="60" placeholder="9, 10">
        <label class="field-label"><input type="checkbox" id="ovHide"> Hide this event</label>
        <button class="btn primary block" style="margin-top:10px">Save the correction</button>
        <p class="fine" id="ovNote"></p>
      </form></article>
    <p class="section-label">Reported mistakes (${reports.length})</p>
    <article class="card">${reports.map((r) => `<div class="report"><p><b>${esc(r.context.title || r.context.type || "General")}</b> ${esc(r.context.school)} ${esc(r.context.date)}</p><p>${esc(r.message)}</p><p class="fine">${esc(new Date(r.at).toLocaleString())}</p>${r.context.id ? `<button class="small-btn" type="button" data-hide-event="${esc(r.context.id)}" data-hide-date="${esc(r.context.date || "")}" data-hide-why="${esc(r.message.slice(0, 160))}">Hide this event</button>` : ""}</div>`).join("") || "<p class='empty-note'>None yet.</p>"}</article>`;
});

async function savePin(text) {
  const note = document.getElementById("pinNote");
  const res = await fetch("/.netlify/functions/report", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-key": keyEl.value },
    body: JSON.stringify({ action: "pin", text, es: document.getElementById("pinEs").value, until: document.getElementById("pinUntil").value }),
  });
  note.textContent = res.ok ? (text ? "Posted. Parents see it within a few minutes." : "Taken down.") : "Couldn't save. Check the key and try again.";
}
async function ownerPost(body) {
  const res = await fetch("/.netlify/functions/report", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-key": keyEl.value }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, error: j.error || "" };
}
async function saveOverrides(list) {
  const res = await fetch("/.netlify/functions/report", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-key": keyEl.value }, body: JSON.stringify({ action: "overrides", list }) });
  if (res.ok) document.getElementById("keyForm").requestSubmit();
  return res.ok;
}
async function saveAnswer(body) {
  const res = await fetch("/.netlify/functions/report", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-key": keyEl.value }, body: JSON.stringify({ action: "answer", ...body }) });
  return res.ok;
}
document.addEventListener("submit", async (e) => {
  if (e.target.id === "overrideForm") {
    e.preventDefault();
    const v = (id) => document.getElementById(id).value.trim();
    const o = { id: v("ovId"), date: v("ovDate") || undefined, title: v("ovTitle") || undefined, hide: document.getElementById("ovHide").checked || undefined, grades: v("ovGrades") ? v("ovGrades").split(",").map((x) => Number(x.trim())).filter((x) => !isNaN(x)) : undefined };
    if (!o.id) { document.getElementById("ovNote").textContent = "An event id is needed."; return; }
    const list = (window.__overrides || []).filter((x) => !(x.id === o.id && (x.date || "") === (o.date || "")));
    list.push(o);
    document.getElementById("ovNote").textContent = (await saveOverrides(list)) ? "Saved." : "Couldn't save.";
    return;
  }
  if (e.target.id === "sponsorForm") {
    e.preventDefault();
    const v = (id) => document.getElementById(id).value.trim();
    if (!v("spName")) { document.getElementById("sponsorNote").textContent = "A business name is needed. To take a sponsor down, use Remove this sponsor."; return; }
    const r = await ownerPost({ action: "sponsor", tab: window.__spTab || "today", name: v("spName"), line: v("spLine"), url: v("spUrl"), logo: v("spLogo"), until: v("spUntil") });
    if (r.ok) { document.getElementById("keyForm").requestSubmit(); return; }
    document.getElementById("sponsorNote").textContent = r.error || "Couldn't save. Check the key and try again.";
    return;
  }
  if (e.target.id === "donateForm") {
    e.preventDefault();
    const gv = (id) => document.getElementById(id).value.trim();
    const rows = (kind) => [0, 1, 2].map((i) => ({ amount: gv(`don-${kind}-amt${i}`), url: gv(`don-${kind}-url${i}`) })).filter((l) => l.url && l.amount);
    const r = await ownerPost({ action: "donate", monthly: rows("monthly"), once: rows("once"), procPct: gv("donProcPct"), procFixed: gv("donProcFixed") === "" ? "" : String(Number(gv("donProcFixed")) / 100), recipient: gv("donRecipient"), fee: gv("donFee"), sent: gv("donSent"), sentAsOf: gv("donSentAsOf"), goal: gv("donGoal") });
    if (r.ok) { document.getElementById("keyForm").requestSubmit(); return; }
    document.getElementById("donateNote").textContent = r.error || "Couldn't save. Check the key and try again.";
    return;
  }
  if (e.target.id === "answerForm") {
    e.preventDefault();
    const v = (id) => document.getElementById(id).value.trim();
    const ok = await saveAnswer({ q: v("ansQ"), a: v("ansA"), link: v("ansLink"), qEs: v("ansQEs"), aEs: v("ansAEs") });
    document.getElementById("ansNote").textContent = ok ? "Saved. Parents see it in search within a few minutes." : "Couldn't save. A question and an answer are both needed.";
    if (ok) document.getElementById("keyForm").requestSubmit();
    return;
  }
  if (e.target.id !== "pinForm") return;
  e.preventDefault();
  savePin(document.getElementById("pinText").value.trim());
});

document.addEventListener("click", async (e) => {
  if (e.target.dataset.answerQ) { const q = document.getElementById("ansQ"); q.value = e.target.dataset.answerQ; q.scrollIntoView({ block: "center" }); document.getElementById("ansA").focus(); return; }
  if (e.target.dataset.overrideRemove !== undefined) { const list = (window.__overrides || []).filter((_, i) => i !== Number(e.target.dataset.overrideRemove)); return saveOverrides(list); }
  if (e.target.dataset.hideEvent) { const list = (window.__overrides || []).filter((o) => o.id !== e.target.dataset.hideEvent); list.push({ id: e.target.dataset.hideEvent, date: e.target.dataset.hideDate || undefined, hide: true, why: e.target.dataset.hideWhy }); return saveOverrides(list); }
  if (e.target.dataset.answerRemove) { if (await saveAnswer({ id: e.target.dataset.answerRemove, remove: true })) document.getElementById("keyForm").requestSubmit(); return; }
  if (e.target.dataset.spTab) { window.__spTab = e.target.dataset.spTab; document.getElementById("keyForm").requestSubmit(); return; }
  if (e.target.id === "sponsorClear") { const r = await ownerPost({ action: "sponsor", tab: window.__spTab || "today", name: "" }); if (r.ok) document.getElementById("keyForm").requestSubmit(); return; }
  if (e.target.dataset.leadDone) { const r = await ownerPost({ action: "lead-done", key: e.target.dataset.leadDone }); if (r.ok) document.getElementById("keyForm").requestSubmit(); return; }
  if (e.target.id === "pinClear") { document.getElementById("pinText").value = ""; return savePin(""); }
  if (e.target.id !== "backupBtn") return;
  const res = await fetch("/.netlify/functions/report?backup=1", { headers: { "x-admin-key": keyEl.value } });
  if (!res.ok) { e.target.textContent = res.status === 404 ? "No backup yet (the first runs tonight)" : "Couldn't download"; return; }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = (res.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/)?.[1] || "sfp-backup.json";
  a.click();
  URL.revokeObjectURL(url);
});
