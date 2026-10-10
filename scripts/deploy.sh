#!/bin/bash
# The only way this app ships: every check passes, then deploy, then the
# browser journeys run again against the live site.
#   ./scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
SITE=1ed98586-a3c0-4291-aca3-2fec925dff9b   # bvlunch / brandonvalleylunch.com (never the ~/Downloads link)
npm test                       # lint, unit tests, browser journeys
node tests/sweep.js            # every screen and control, English and Spanish
netlify deploy --build --prod --site "$SITE" --skip-functions-cache
BASE=https://brandonvalleylunch.com node tests/journeys.js
