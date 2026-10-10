# Later: open items for Brandon Valley Lunch

## Needs Ian
- [ ] `ANTHROPIC_API_KEY` on the bvlunch Netlify site (workspace-scoped key): turns on Ask and Spanish for live content.
- [ ] `RESEND_API_KEY`, `ALERT_EMAIL`, `ALERT_FROM` for the owner emails (health, drift, Monday summary).
- [ ] Graduation time and venue for May 9, 2027 (data.js SCHOOL_YEARS).
- [ ] Review privacy.html wording.

## Needs a real phone
- [ ] Push notifications end to end after the template switch (the VAPID keys are unchanged, so existing sign-ups should keep working).
- [ ] One-tap Google calendar rows on Android and iPhone.

## Waiting on a real event
- [ ] First KELOLAND closing: check the function log for the raw entry and tighten lib/closings.js findOurs.
- [ ] First supply-list change: confirms the "New supply list" push.

## Not yet ported from the old app
The old app is the git tag `old-app` (commit e78edbb).
- [ ] Student mode (a high schooler's own phone). Old student-role phones now behave as a parent phone with one student.
- [ ] In-app PDF viewer (pdf.js) for forms; forms open as the original files for now. The handbook and supply lists are read into the app.
