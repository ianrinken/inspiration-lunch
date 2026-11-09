/* The live parts of a school page: this week's lunch and the next events,
 * from the same functions the app uses. */
(() => {
  const school = document.body.dataset.school;
  // Tabs, like the app: one section on screen at a time, the address bar's
  // #hash says which, so a link to #lunch opens on the menu.
  const TABS = ["today", "lunch", "calendar", "guide", "school"];
  const show = () => {
    const tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "today";
    for (const t of TABS) { const v = document.getElementById(`view-${t}`); if (v) v.hidden = t !== tab; }
    for (const a of document.querySelectorAll(".tab-bar .tab")) { if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }
    window.scrollTo(0, 0);
  };
  window.addEventListener("hashchange", show);
  show();
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const add = (s, n) => { const [y, m, d] = s.split("-").map(Number); return ymd(new Date(y, m - 1, d + n, 12)); };
  const fmt = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const time = (t) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? "PM" : "AM"}`; };
  const today = ymd(new Date());
  const dow = new Date().getDay();
  // This school week, or next week from Saturday on.
  const monday = add(today, dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow);
  fetch(`/.netlify/functions/menu?school=${school}&start=${monday}&end=${add(monday, 4)}`).then((r) => r.json()).then((m) => {
    const box = document.getElementById("menu");
    const days = (m.days || []).filter((d) => d.lines && d.lines.Lunch);
    const nextBox = document.getElementById("menu-next");
    if (!days.length) { box.innerHTML = `<p class="muted">No menu posted for this week yet.</p>`; if (nextBox) nextBox.innerHTML = box.innerHTML; return; }
    const first = days.find((d) => d.d >= today) || days[0];
    if (nextBox) { const items = first.lines.Lunch; const mains = items.filter((i) => i.t === "ENTREES").map((i) => i.n); const sides = items.filter((i) => i.t === "SIDES" || i.t === "VEGETABLES" || i.t === "FRUIT").map((i) => i.n).slice(0, 4); nextBox.innerHTML = `<div class="menu-row"><b>${esc(fmt(first.d))}</b><span>${esc(mains.join(" or "))}${sides.length ? `<span class="fine">${esc(sides.join(", "))}</span>` : ""}</span></div>`; }
    box.innerHTML = days.map((d) => {
      const items = d.lines.Lunch;
      const mains = items.filter((i) => i.t === "ENTREES").map((i) => i.n);
      const sides = items.filter((i) => i.t === "SIDES" || i.t === "VEGETABLES" || i.t === "FRUIT").map((i) => i.n).slice(0, 4);
      return `<div class="menu-row"><b>${esc(fmt(d.d))}</b><span>${esc(mains.join(" or "))}${sides.length ? `<span class="fine">${esc(sides.join(", "))}</span>` : ""}</span></div>`;
    }).join("");
  }).catch(() => { document.getElementById("menu").innerHTML = `<p class="muted">The menu isn't available right now.</p>`; });
  fetch(`/.netlify/functions/events?school=${school}&start=${today}&end=${add(today, 21)}`).then((r) => r.json()).then((e) => {
    const box = document.getElementById("events");
    const list = (e.events || []).filter((x) => x.cat !== "practice" && !/\bmeals?\b/i.test(x.title)).slice(0, 10);
    const nextBox = document.getElementById("events-next");
    if (!list.length) { box.innerHTML = `<p class="muted">Nothing on the calendar in the next three weeks.</p>`; if (nextBox) nextBox.innerHTML = box.innerHTML; return; }
    const row = (x) => `<div class="menu-row"><b>${esc(fmt(x.d))}</b><span>${esc(x.title)}${x.level ? ` (${esc(x.level)})` : ""}${x.home === true ? ", home" : x.home === false ? ", away" : ""}<span class="fine">${[time(x.t), x.venue].filter(Boolean).map(esc).join(", ")}</span></span></div>`;
    if (nextBox) nextBox.innerHTML = list.slice(0, 3).map(row).join("");
    box.innerHTML = list.map((x) => `<div class="menu-row"><b>${esc(fmt(x.d))}</b><span>${esc(x.title)}${x.level ? ` (${esc(x.level)})` : ""}${x.home === true ? ", home" : x.home === false ? ", away" : ""}<span class="fine">${[time(x.t), x.venue].filter(Boolean).map(esc).join(", ")}</span></span></div>`).join("");
  }).catch(() => { document.getElementById("events").innerHTML = `<p class="muted">The calendar isn't available right now.</p>`; });
})();
