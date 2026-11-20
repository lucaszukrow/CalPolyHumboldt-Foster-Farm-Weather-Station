# Cal Poly Humboldt Foster Farm Weather Station

Public dashboard for the Foster Farm Ambient Weather station.

## How it works

```
Ambient Weather API
   │  (keys stay server-side)
   ├── Cloudflare Worker ──► /current, /recent  ──► live readings on the dashboard
   └── GitHub Actions (every 3 h) ──► data/history/*.csv ──► charts + downloads
                                         │
                                  GitHub Pages serves site/ + data/
```

- **Live data:** `worker/` is a Cloudflare Worker that calls Ambient with the keys, strips the response down to public weather fields, and caches it in memory (60 s for current, 5 min for recent).
- **History:** `scripts/fetch_history.py` runs in Actions, pages back through Ambient's stored records until it reaches data already saved, and appends to monthly CSVs. Late or skipped cron runs lose nothing.
- **Site:** `site/` is plain HTML/JS. It never sees a key.

## Where the keys live

| Place | Names | Used by |
|---|---|---|
| GitHub → Settings → Secrets and variables → Actions | `AMBIENT_API_KEY`, `AMBIENT_APP_KEY`, `AMBIENT_MAC` | history workflow |
| Cloudflare → Worker `foster-farm-weather` → Settings → Variables and Secrets (type Secret) | same three | Worker |

Never put keys in code, `config.js`, commits, issues, or chat. If a key leaks, regenerate it on ambientweather.net and update both places.

## Security notes

- Only whitelisted fields are published (see `PUBLIC_FIELDS` in the Worker and `FIELDS` in the script). The station MAC, location/address info, indoor readings and battery flags are dropped.
- Ambient sends keys in the URL query string, so error messages in both the Worker and the script are written to never include the URL.
- Workflow permissions default to none; each job asks only for what it needs.
- Workflows triggered by pull requests from forks do not receive repository secrets.
- CORS on the Worker limits which websites can read it in a browser. It is not access control: anyone can still call the Worker URL directly. That's fine because it only returns public weather data, and the cache keeps traffic from reaching Ambient's rate limit.

## Deploying the Worker

Option A, dashboard: Cloudflare → Workers & Pages → `foster-farm-weather` → Edit code → paste `worker/src/index.js` → Deploy.

Option B, CLI (needs Node): `cd worker && npx wrangler login && npx wrangler deploy`. Existing secrets are kept.

## Local testing

```
node tests/worker.test.mjs
python3 tests/test_fetch_history.py
cd site && python3 -m http.server 8000   # localhost:8000 is allowed by the Worker's CORS list
```

## Data

- `data/history/YYYY-MM.csv`: one row per station record, months split by UTC. `dateutc` is milliseconds since epoch, `time_utc` is ISO 8601.
- `data/manifest.json`: list of files, record count, first/last timestamps.
- Units are Ambient's: °F, mph, inHg, inches, W/m².
