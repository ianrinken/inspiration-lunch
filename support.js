/* The support page: shows the Chip in card once the owner has set a payment
 * link, and sends a sponsorship question to the owner's inbox. */
(() => {
  fetch("/.netlify/functions/status").then((r) => r.json()).then((s) => {
    // The sponsor form shows only once sponsorships are open.
    if (s && s.sponsorInquiries) {
      document.getElementById("sponsorCard").hidden = false;
      document.getElementById("sponsorNote").hidden = false;
      document.getElementById("supportLede").textContent = "This holiday season, help feed Brandon families. Local businesses can also sponsor the app.";
    }
    // Which screens are still open, worked out from what is showing now.
    const names = { today: "Today", lunch: "Lunch", calendar: "Calendar", guide: "Guide", school: "School" };
    const taken = (s && s.sponsors) || {};
    const open = Object.keys(names).filter((k) => !taken[k]);
    document.getElementById("openNow").textContent = open.length ? `Open now: ${open.map((k) => names[k]).join(", ")}.` : "Every screen has a sponsor right now. Ask to be next.";
    for (const o of document.querySelectorAll("#lfScreen option")) if (o.value && taken[o.value]) o.textContent = `${names[o.value]} (taken for now)`;
    // The lunch fund shows only when the owner has said who gets the money
    // and what share is kept, so the page never promises what isn't set up.
    const give = s && s.donate;
    if (!give || !(give.page || (give.monthly || []).length + (give.once || []).length)) return;
    const money = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
    const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    // What actually reaches lunches from a gift, after the card fee and the
    // app's share. Shown on every button so nobody has to do the math.
    const reaches = (amt) => Math.max(0, Math.floor((amt - (amt * give.procPct / 100 + give.procFixed) - amt * give.fee / 100) * 100) / 100);
    document.getElementById("giveWhere").textContent = `What you give goes to ${give.recipient}`.replace(/\.?$/, ".");
    const cents = Math.round(give.procFixed * 100);
    // With one giving page the split is two plain shares; any transaction
    // cost comes out of the app's share, never out of the lunch share.
    if (give.page) {
      // The split sits behind a small "i": hover or tap it to see the
      // bubble, tap anywhere else or press Escape to put it away.
      const bubble = document.getElementById("giveBubble");
      const info = document.getElementById("giveInfo");
      // With no share kept, the only thing that can come out of a gift is the
      // giving page's own processing fee, which the giver can choose to cover.
      bubble.innerHTML = give.fee > 0
        ? `<p><b>${100 - give.fee}%</b> goes to student lunches</p><p><b>${give.fee}%</b> runs this app</p>`
        : `<p><b>This app keeps none of your gift.</b></p><p>Processing fees come out unless you cover them at checkout.</p><p>${esc(give.plan || "The rest goes to student lunches.")}</p>`;
      info.hidden = false;
      const setOpen = (open) => { bubble.classList.toggle("open", open); info.setAttribute("aria-expanded", String(open)); };
      info.addEventListener("click", (e) => { e.stopPropagation(); setOpen(!bubble.classList.contains("open")); });
      document.addEventListener("click", (e) => { if (!bubble.contains(e.target)) setOpen(false); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
      document.getElementById("giveSplitLabel").hidden = true;
      document.getElementById("giveSplit").hidden = true;
      document.getElementById("donateBtns").innerHTML = `<a class="btn primary block give-btn" href="${esc(give.page)}" target="_blank" rel="noopener"><b>Give</b></a>`;
      document.getElementById("givePageNote").hidden = false;
      // The giving service's own form and live total, right here on our page,
      // so nobody leaves to give. If its script can't load (a content
      // blocker, no signal), the Give button above stays as it was.
      const w = give.widgets;
      if (w && w.acct && w.form && /^[\w-]+$/.test(w.acct + w.form + (w.goal || ""))) {
        const lib = document.createElement("script");
        lib.async = true;
        lib.src = `https://widgets.givebutter.com/latest.umd.cjs?acct=${w.acct}&p=other`;
        lib.onload = () => {
          if (!window.customElements || !customElements.get("givebutter-widget")) return;
          if (w.goal) { const g = document.getElementById("giveGoalLive"); g.innerHTML = `<givebutter-widget id="${w.goal}"></givebutter-widget>`; g.hidden = false; }
          const f = document.getElementById("giveForm");
          f.innerHTML = `<givebutter-widget id="${w.form}"></givebutter-widget>`;
          f.hidden = false;
          document.getElementById("donateBtns").hidden = true;
          document.getElementById("givePageNote").hidden = true;
          document.getElementById("giveFormLink").href = give.page;
          document.getElementById("giveFormHelp").hidden = false;
        };
        document.head.appendChild(lib);
      }
    } else document.getElementById("giveSplit").innerHTML = [
      `<li>Card processing takes ${give.procPct}%${cents ? ` plus ${cents} cents` : ""} of each gift</li>`,
      give.fee > 0 ? `<li>${give.fee}% is an administrative fee that keeps this app running</li>` : "",
      `<li>The rest goes to student lunches</li>`,
    ].join("");
    // Monthly is the default when it is offered; one time is one tap away.
    let mode = (give.monthly || []).length ? "monthly" : "once";
    const both = (give.monthly || []).length && (give.once || []).length;
    const seg = document.getElementById("giveMode");
    const draw = () => {
      const list = mode === "monthly" ? give.monthly : give.once;
      document.getElementById("donateBtns").innerHTML = list.map((l, i) => `<a class="btn ${i === 0 ? "primary" : ""} block give-btn" href="${esc(l.url)}" target="_blank" rel="noopener"><b>${money(l.amount)}${mode === "monthly" ? " a month" : ""}</b><span>${money(reaches(l.amount))} reaches lunches</span></a>`).join("");
      for (const b of seg.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
      document.getElementById("giveCancel").hidden = mode !== "monthly";
    };
    seg.hidden = !both || !!give.page;
    seg.addEventListener("click", (e) => { const m = e.target.dataset.mode; if (m) { mode = m; draw(); } });
    if (!give.page) draw();
    // Progress toward the check: what parents have given so far, when the
    // check is handed over, and what the district has already received.
    const day = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const show = (id, text) => { const el = document.getElementById(id); el.textContent = text; el.hidden = false; };
    const asOf = give.sentAsOf ? `, as of ${day(give.sentAsOf)}` : "";
    if (give.goal > 0) {
      document.getElementById("giveGoalFill").style.width = `${Math.min(100, Math.round((give.raised / give.goal) * 100))}%`;
      document.getElementById("giveGoal").hidden = false;
      show("giveSent", `${money(give.raised)} of ${money(give.goal)} raised so far${asOf}.`);
    } else if (give.raised > 0) {
      show("giveSent", `${money(give.raised)} raised so far${asOf}.`);
    }
    if (give.checkDate) show("giveCheck", `The check goes to the district on ${day(give.checkDate)}.`);
    if (give.sent > 0) show("giveGiven", `Given to the district so far: ${money(give.sent)}.`);
    document.getElementById("donateCard").hidden = false;
  }).catch(() => {});

  // Sharing the fund is how it reaches the next family.
  document.getElementById("giveShare").addEventListener("click", (e) => {
    const text = "Help feed Brandon families this holiday season. Every gift goes to the Brandon Area Food Pantry.";
    const url = "https://brandonvalleylunch.com/give";
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
