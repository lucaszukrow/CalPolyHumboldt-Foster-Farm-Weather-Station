# Maintaining the dashboard

Notes for whoever runs this after me.

## What's where

| Folder | What it is |
|---|---|
| `site/` | The dashboard. Plain HTML, CSS and JavaScript, no build step. |
| `worker/` | Cloudflare Worker that serves live readings at `/current` and `/recent`. |
| `scripts/fetch_history.py` | Pulls new records from Ambient and appends them to `data/history/`. |
| `.github/workflows/update-and-deploy.yml` | Runs the history script every 3 hours and redeploys the site. |
| `tests/` | Tests for the Worker and the history script, run against fake data. |

## Secrets

Three values are needed, stored in two places:

- **GitHub:** Settings > Secrets and variables > Actions > Secrets tab. Used by the history workflow.
- **Cloudflare:** Workers & Pages > `foster-farm-weather` > Settings > Variables and Secrets, with type set to Secret. Used by the Worker.

The names are `AMBIENT_API_KEY`, `AMBIENT_APP_KEY` and `AMBIENT_MAC`. Never put the values in code, commits, issues or chat. If a key leaks, generate a new one on ambientweather.net and update it in both places.

## Updating the Worker

Either paste `worker/src/index.js` into the Cloudflare editor (Edit code, then Deploy), or from the `worker` folder run `npx wrangler login` and `npx wrangler deploy`. Both keep the existing secrets.

The Worker caches readings in memory (60 seconds for current, 5 minutes for recent) so page traffic doesn't hit Ambient's rate limit. It only returns the weather fields listed in `PUBLIC_FIELDS`, and its error messages never include the request URL, because Ambient puts the keys in the URL.

## Updating the site

Push changes under `site/` to `main`. The workflow redeploys in about a minute and adds a version number to the CSS and JS links so browsers pick up the new files right away.

Settings people are likely to change are in `site/config.js`: the Worker URL, the station location used for the forecast and map, and how often the page refreshes.

## Running things locally

```
node tests/worker.test.mjs
python3 tests/test_fetch_history.py
cd site && python3 -m http.server 8000
```

The Worker allows requests from `localhost:8000`, so the local page can use live data.

## Things to know

- **Rain counter.** The station's daily rain resets at 10 AM Pacific, which points to a wrong time zone on the station. The dashboard works out rain and peak gust since midnight on its own, so it's correct either way. Fixing the time zone on the station would make the raw data match too.
- **Pressure.** Relative pressure reads about 0.19 inHg below the Arcata airport. Absolute pressure is fine. It needs to be recalibrated in the station settings.
- **Forecast.** It comes from the NWS point forecast for the station's coordinates. If NWS is down, the page switches to Open-Meteo and says so under the forecast.
- **Radar.** RainViewer's free tier only offers the past couple of hours and zooms in only to a regional level. The page shows the last hour.
- **Scheduled runs.** GitHub can delay scheduled runs, especially near the top of the hour. That's fine, because each run catches up on anything it missed. GitHub can also turn off schedules on public repos that go 60 days without activity. If the history stops updating, check the Actions tab and re-enable the workflow.
