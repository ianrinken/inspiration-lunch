/* Email to the app's owner (never to parents) through Resend. Quietly does
 * nothing until RESEND_API_KEY, ALERT_EMAIL and ALERT_FROM are set. */
async function sendOwnerEmail(subject, text) {
  const key = process.env.RESEND_API_KEY, to = process.env.ALERT_EMAIL, from = process.env.ALERT_FROM;
  if (!key || !to || !from) return { skipped: "email not configured" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: to.split(",").map((s) => s.trim()), subject: `[Brandon Valley Lunch] ${subject}`, text }),
  });
  return { status: res.status };
}
module.exports = { sendOwnerEmail };
