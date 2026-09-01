# Inspiration Lunch

Installable web app (PWA) showing the lunch menu for **Inspiration Elementary**
(Brandon Valley School District, Brandon, SD) as a clickable Mon–Fri calendar.

- Live data from the LINQ Connect public API, fetched month-by-month straight
  from the browser (the API sends `Access-Control-Allow-Origin: *`, and the AWS
  WAF only blocks non-browser clients — so **no proxy is needed**).
- Last successful fetch for each month is cached in `localStorage`, so the app
  works offline / during API hiccups, with a "last updated" note.
- Service worker caches the app shell for offline launches; manifest + iOS meta
  tags make it install cleanly on iPhone and Android home screens.
- Branding matches the district: Brandon Valley cardinal red `#A8181A`.

Official menu: https://linqconnect.com/public/menu/L36JZQ

## Deploy (GitHub Pages — free, stable URL)

```
cd ~/Downloads/inspiration-lunch
gh repo create inspiration-lunch --public --source=. --push
gh api repos/ianrinken/inspiration-lunch/pages -X POST \
  -f "source[branch]=main" -f "source[path]=/"
```

Wait ~1 minute, then the stable URL is:

**https://ianrinken.github.io/inspiration-lunch/**

To update later: commit and `git push` — Pages redeploys automatically.

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
