/* The support page: shows the Chip in card once the owner has set a payment
 * link, and sends a sponsorship question to the owner's inbox. */
(() => {
  fetch("/.netlify/functions/status").then((r) => r.json()).then((s) => {
    // Which screens are still open, worked out from what is showing now.
    const names = { today: "Today", lunch: "Lunch", calendar: "Calendar", guide: "Guide", school: "School" };
    const taken = (s && s.sponsors) || {};
    const open = Object.keys(names).filter((k) => !taken[k]);
    document.getElementById("openNow").textContent = open.length ? `Open now: ${open.map((k) => names[k]).join(", ")}.` : "Every screen has a sponsor right now. Ask to be next.";
    for (const o of document.querySelectorAll("#lfScreen option")) if (o.value && taken[o.value]) o.textContent = `${names[o.value]} (taken for now)`;
    const links = (s && s.donate) || [];
    if (!links.length) return;
    const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    document.getElementById("donateBtns").innerHTML = links.map((l, i) => `<a class="btn ${i === 0 ? "primary" : ""} block" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || "Chip in")}</a>`).join("");
    document.getElementById("donateCard").hidden = false;
  }).catch(() => {});

  const form = document.getElementById("leadForm");
  const msg = document.getElementById("lfMsg");
  const val = (id) => document.getElementById(id).value.trim();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("lfSend");
    const contact = val("lfContact");
    if (!val("lfBusiness") || !(/@/.test(contact) || (contact.match(/\d/g) || []).length >= 7)) {
      msg.textContent = "A business name and an email or phone number are needed.";
      return;
    }
    btn.disabled = true;
    msg.textContent = "Sending.";
    try {
      const res = await fetch("/.netlify/functions/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sponsor-lead", business: val("lfBusiness"), name: val("lfName"), contact, note: val("lfNote"), screen: document.getElementById("lfScreen").value, website: val("lfWebsite") }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(j.error || "failed"), { status: res.status });
      form.querySelectorAll("input, textarea, select, label, button").forEach((el) => { el.hidden = true; });
      msg.textContent = "Thank you. Your question is in, and you will hear back within two business days.";
    } catch (err) {
      btn.disabled = false;
      msg.textContent = err && err.status === 429 ? "Too many tries from this network. Try again in an hour." : err && err.status === 400 ? err.message : "That did not send. Check your connection and try again.";
    }
  });
})();
