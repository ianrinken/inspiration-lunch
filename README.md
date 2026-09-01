# Brandon Valley Lunch

Installable web app (PWA) showing daily school lunch menus for the
**Brandon Valley School District** (Brandon, SD): a Today card with the current
hot entrée, plus a clickable Mon–Fri calendar. A school picker covers all 8
buildings (default: Inspiration Elementary — most elementaries share a menu,
but Brandon Elementary's rotation can differ, so menus stay per-school).

- Live data from the LINQ Connect public API, fetched month-by-month straight
  from the browser (the API sends `Access-Control-Allow-Origin: *`, and the AWS
  WAF only blocks non-browser clients — so **no proxy is needed**).
- Last successful fetch for each month is cached in `localStorage`, so the app
  works offline / during API hiccups, with a "last updated" note.
- Service worker caches the app shell for offline launches; manifest + iOS meta
  tags make it install cleanly on iPhone and Android home screens.
- Branding matches the district: Brandon Valley cardinal red `#A8181A`.

Official menu: https://linqconnect.com/public/menu/L36JZQ

## Hosting

Live at **https://bvlunch.netlify.app** — a Netlify site connected to
this repo (github.com/ianrinken/inspiration-lunch). Every push to `main`
auto-deploys; there is no build step (Netlify publishes the repo root as-is).

To update: edit, commit, `git push`. Netlify redeploys in ~30 seconds.

## Add to home screen

- **iPhone:** open the URL in Safari → Share → *Add to Home Screen*.
- **Android:** open in Chrome → ⋮ menu → *Add to Home screen* (or the install prompt).

## Notes

- Future months return empty data until the district publishes them; the app
  shows "Menu not posted yet" and rechecks automatically.
- Menu data refreshes in the background whenever it's older than 12 hours.
- If LINQ Connect ever starts blocking cross-origin browser requests, add a
  tiny Cloudflare Worker that forwards requests with browser-like headers and
  point `API_BASE` in `app.js` at it.
