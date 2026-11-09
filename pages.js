/* The live parts of a school page: this week's lunch and the next events,
 * from the same functions the app uses. */
(() => {
  const school = document.body.dataset.school;
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
    if (!days.length) { box.innerHTML = `<p class="muted">No menu posted for this week yet.</p>`; return; }
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
    if (!list.length) { box.innerHTML = `<p class="muted">Nothing on the calendar in the next three weeks.</p>`; return; }
    box.innerHTML = list.map((x) => `<div class="menu-row"><b>${esc(fmt(x.d))}</b><span>${esc(x.title)}${x.level ? ` (${esc(x.level)})` : ""}${x.home === true ? ", home" : x.home === false ? ", away" : ""}<span class="fine">${[time(x.t), x.venue].filter(Boolean).map(esc).join(", ")}</span></span></div>`).join("");
  }).catch(() => { document.getElementById("events").innerHTML = `<p class="muted">The calendar isn't available right now.</p>`; });
})();
