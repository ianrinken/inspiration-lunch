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
    // The lunch fund shows only when the owner has said who gets the money
    // and what share is kept, so the page never promises what isn't set up.
    const give = s && s.donate;
    if (!give || !(give.links || []).length) return;
    const links = give.links;
    const money = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
    const rest = Math.max(0, Math.round((100 - 3 - give.fee) * 10) / 10);
    document.getElementById("giveWhere").textContent = `What you give goes to ${give.recipient}`.replace(/\.?$/, ".");
    document.getElementById("giveSplit").innerHTML = [
      `<li>About 3% is the card processing fee</li>`,
      give.fee > 0 ? `<li>${give.fee}% is an administrative fee that keeps this app running</li>` : "",
      `<li>The rest, about ${rest}%, goes to student lunches</li>`,
    ].join("");
    if (give.goal > 0) {
      document.getElementById("giveGoalFill").style.width = `${Math.min(100, Math.round((give.sent / give.goal) * 100))}%`;
      document.getElementById("giveGoal").hidden = false;
      const el = document.getElementById("giveSent");
      const asOf = give.sentAsOf ? ` as of ${new Date(`${give.sentAsOf}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : "";
      el.textContent = `${money(give.sent)} of ${money(give.goal)} passed on so far${asOf}.`;
      el.hidden = false;
    } else if (give.sent > 0) {
      const asOf = give.sentAsOf ? ` as of ${new Date(`${give.sentAsOf}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : "";
      const el = document.getElementById("giveSent");
      el.textContent = `Passed on so far: ${money(give.sent)}${asOf}.`;
      el.hidden = false;
    }
    const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    document.getElementById("donateBtns").innerHTML = links.map((l, i) => `<a class="btn ${i === 0 ? "primary" : ""} block" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || "Chip in")}</a>`).join("");
    document.getElementById("donateCard").hidden = false;
  }).catch(() => {});

  // Sharing the fund is how it reaches the next family.
  document.getElementById("giveShare").addEventListener("click", (e) => {
    const text = "Chip in for a Brandon Valley student's lunch";
    const url = "https://brandonvalleylunch.com/support.html";
    if (navigator.share) navigator.share({ text, url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(`${text}\n${url}`).then(() => { e.target.textContent = "Copied. Paste it into a text or post."; }, () => {});
  });

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
