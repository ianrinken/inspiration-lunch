/* Owner page: reads report.mjs and status.mjs with the owner key. */
(() => {
  const $ = (id) => document.getElementById(id);
  const API = "/.netlify/functions/report";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let key = "";
  let data = null;
  try { key = sessionStorage.getItem("bvl-admin-key") || ""; } catch {}
  if (key) $("key").value = key;

  const post = async (body) => {
    const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, key }) });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  };
  const when = (ms) => new Date(ms).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  async function load() {
    key = $("key").value.trim();
    try { sessionStorage.setItem("bvl-admin-key", key); } catch {}
    $("status").textContent = "Loading…";
    try {
      const [r, s] = await Promise.all([fetch(`${API}?key=${encodeURIComponent(key)}`), fetch("/.netlify/functions/status")]);
      if (r.status === 403) { $("status").textContent = "That key isn't right."; return; }
      data = await r.json();
      const status = s.ok ? await s.json() : {};
      $("status").textContent = "";
      $("app").hidden = false;
      paintNow(status);
      paintReports();
      paintUsage();
      paintOverrides();
    } catch (err) { $("status").textContent = "Couldn't load: " + err.message; }
  }

  function paintNow(st) {
    const m = st.mirror || {};
    const sup = st.supplies || {};
    const supLines = Object.entries(sup).map(([name, v]) => `${esc(name)}: ${v && v.hash ? `list seen ${v.at ? when(v.at) : ""}` : "no list"}`);
    $("now").innerHTML =
      `<div class="stat"><span class="muted">Google Calendar mirror</span><b class="${m.calendars === 110 ? "ok" : ""}">${m.calendars || 0} / 110</b>` +
      `<span class="muted">${m.filled || 0} filled · reported ${m.reported ? when(Date.parse(m.reported)) : "never"}</span></div>` +
      `<div class="stat"><span class="muted">Open reports</span><b>${(data.reports || []).length}</b></div>` +
      `<div class="stat"><span class="muted">Corrections</span><b>${(data.overrides || []).length}</b></div>` +
      `<p class="muted" style="margin:8px 0 0">${supLines.join(" · ") || "Supply-list watch: nothing seen yet"}</p>`;
  }

  function paintReports() {
    const list = data.reports || [];
    $("reports").innerHTML = list.length ? "" : `<div class="card muted">No open reports.</div>`;
    for (const r of list) {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML =
        `<div><span class="tag">${esc(r.date || "")}</span><b>${esc(r.title || "(no title)")}</b> <span class="muted">id ${esc(r.id)}</span></div>` +
        (r.note ? `<p class="note">${esc(r.note)}</p>` : "") +
        `<p class="muted">${when(r.at)}${r.school ? ` · ${esc(r.school)}` : ""}</p>` +
        `<div class="row"><button data-act="hide">Hide this event</button><button class="quiet" data-act="retitle">Retitle</button>` +
        `<button class="quiet" data-act="grades">Set grades</button><button class="quiet" data-act="resolve">Dismiss</button></div>`;
      card.addEventListener("click", async (e) => {
        const act = e.target.dataset.act;
        if (!act) return;
        try {
          if (act === "hide") await addOverride({ id: r.id, date: r.date, hide: true, why: r.note });
          if (act === "retitle") { const t = prompt("New title:", r.title); if (t) await addOverride({ id: r.id, date: r.date, title: t, why: r.note }); else return; }
          if (act === "grades") { const g = prompt("Grades this is for, comma separated (blank = everyone):", ""); if (g === null) return; await addOverride({ id: r.id, date: r.date, grades: g.split(",").map((x) => x.trim()).filter(Boolean).map(Number), why: r.note }); }
          await post({ kind: "resolve", id: r.key });
          await load();
        } catch (err) { alert("Didn't save: " + err.message); }
      });
      $("reports").appendChild(card);
    }
  }

  async function addOverride(o) {
    const list = (data.overrides || []).filter((x) => !(x.id === o.id && (x.date || "") === (o.date || "")));
    list.push(o);
    await post({ kind: "overrides", list });
  }

  function paintUsage() {
    const days = Object.keys(data.usage || {}).sort().reverse();
    const feats = ["open", "kids", "subscribe", "apple", "google", "supplies", "school", "viewer", "family", "share", "push", "student", "report"];
    const label = { open: "Opened the app", kids: "Saved a child", subscribe: "Opened Subscribe", apple: "Added to iPhone/Apple", google: "Added to Google", supplies: "Opened a supply list", school: "Opened the School tab", viewer: "Opened a document", family: "Family code", share: "Shared setup", push: "Turned on notifications", student: "Student mode", report: "Reported a mistake" };
    let html = `<table><tr><th>Feature</th>${days.map((d) => `<th>${esc(d.slice(5))}</th>`).join("")}</tr>`;
    for (const f of feats) {
      html += `<tr><td>${label[f]}</td>${days.map((d) => `<td>${(data.usage[d] || {})[f] || ""}</td>`).join("")}</tr>`;
    }
    $("usage").innerHTML = html + "</table>";
  }

  function paintOverrides() {
    const list = data.overrides || [];
    $("overrides").innerHTML = list.length ? "" : `<div class="card muted">None.</div>`;
    list.forEach((o, i) => {
      const card = document.createElement("div");
      card.className = "card row";
      const what = [o.hide ? "hidden" : "", o.title ? `title → “${esc(o.title)}”` : "", o.grades ? `grades → ${o.grades.length ? o.grades.join(", ") : "everyone"}` : "", o.act !== undefined ? `activity → ${esc(o.act) || "none"}` : ""].filter(Boolean).join(" · ");
      card.innerHTML = `<span><span class="tag">${esc(o.id)}</span>${o.date ? `<span class="tag">${esc(o.date)}</span>` : ""}${what}${o.why ? ` <span class="muted">(${esc(o.why)})</span>` : ""}</span><button class="quiet">Remove</button>`;
      card.querySelector("button").addEventListener("click", async () => {
        const next = list.filter((_, j) => j !== i);
        try { await post({ kind: "overrides", list: next }); await load(); } catch (err) { alert("Didn't save: " + err.message); }
      });
      $("overrides").appendChild(card);
    });
  }

  $("load").addEventListener("click", load);
  $("key").addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
  $("oAdd").addEventListener("click", async () => {
    const id = $("oId").value.trim();
    if (!id) return;
    const o = { id };
    if ($("oDate").value.trim()) o.date = $("oDate").value.trim();
    if ($("oTitle").value.trim()) o.title = $("oTitle").value.trim();
    if ($("oGrades").value.trim()) o.grades = $("oGrades").value.split(",").map((x) => x.trim()).filter(Boolean).map(Number);
    if ($("oHide").checked) o.hide = true;
    try { await addOverride(o); await load(); } catch (err) { alert("Didn't save: " + err.message); }
  });
  if (key) load();
})();
