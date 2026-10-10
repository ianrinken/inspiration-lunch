# Brandon Valley Lunch

One place for a Brandon Valley School District family's school day: lunch,
days off, games and what each grade needs, for every building from junior
kindergarten to 12th grade. Live at https://brandonvalleylunch.com.

Built on the district template that also runs Sioux Falls Parent (the app
this replaced in October 2026 is the git tag `old-app`). The two
sites deploy separately but share the same shape, so improvements move
between them by copying files, and a new district starts from either.

## What a district is, in this codebase

- `data.js`: the district file. Schools (id, level, grades, contact, bell
  times, source ids), the district calendar, school years, the grade guide,
  level facts, test dates, state events, costs.
- Three source readers in `netlify/functions/`: `menu.js` (here: LINQ
  Connect), `events.js` (here: each school's Google Calendar plus the
  district's Bound calendar, with `grades.js` for grade rules), `school.js`
  (here: the district's plain-HTML site, its handbook and supply-list PDFs,
  KELOLAND's closings list). Each emits the same JSON the template app reads.
- `handbooks.js`: bell schedules, attendance steps and key rules per level.
- Everything else (app.js, shared.js, i18n.js, the other functions, tests)
  is the template and should stay close to Sioux Falls Parent.

## Brandon Valley specifics

- `mirror.mjs` + `tools/google-mirror.gs`: public Google Calendars kept by a
  script in the owner's Google account, so phones can add a child's calendar
  in one tap. Calendar keys use the LINQ building id so existing calendars
  survive.
- Family codes and notification records saved by the app before October
  2026 (by LINQ id, grade and activity names) are read in today's shape on
  the fly (`family.js normalizeRecord`); the app migrates its own
  localStorage once (`migrateOldApp` in app.js).
- Legacy calendar feed paths (`/feed/<school>/<grade>/<activities>/calendar.ics`)
  keep working for iPhones that subscribed earlier.

## Run, test, deploy

- `node dev-server.js . 8431` serves the app with the functions in-process.
- `npm test`: lint, unit tests (template + menu + school + events), browser journeys.
- `npm run sweep`: taps every control at 375 and 320 px, English and Spanish.
- `npm run deploy`: tests, sweep, deploy to the bvlunch site, live journeys.

Environment on the Netlify site: `VAPID_PRIVATE_KEY`, `ADMIN_KEY`,
`MIRROR_SECRET`, `ANTHROPIC_API_KEY` (Ask and live Spanish), and for owner
email `RESEND_API_KEY`, `ALERT_EMAIL`, `ALERT_FROM`.
