/* The support page: shows the Chip in card once the owner has set a payment
 * link, and sends a sponsorship question to the owner's inbox. */
(() => {
  fetch("/.netlify/functions/status").then((r) => r.json()).then((s) => {
    if (!s || !s.donate) return;
    document.getElementById("donateBtn").href = s.donate;
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
        body: JSON.stringify({ action: "sponsor-lead", business: val("lfBusiness"), name: val("lfName"), contact, note: val("lfNote"), website: val("lfWebsite") }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(j.error || "failed"), { status: res.status });
      form.querySelectorAll("input, textarea, label, button").forEach((el) => { el.hidden = true; });
      msg.textContent = "Thank you. Your question is in, and you will hear back within two business days.";
    } catch (err) {
      btn.disabled = false;
      msg.textContent = err && err.status === 429 ? "Too many tries from this network. Try again in an hour." : err && err.status === 400 ? err.message : "That did not send. Check your connection and try again.";
    }
  });
})();
