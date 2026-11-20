"""Pull new records from the Ambient Weather API and append them to monthly CSVs.

Runs in GitHub Actions. Reads keys from environment variables that the workflow
fills from repository secrets:
    AMBIENT_API_KEY, AMBIENT_APP_KEY, AMBIENT_MAC

Because Ambient returns past records (not just the latest one), a delayed or
skipped run loses nothing. The next run pages back until it reaches data that
is already saved.

No third-party packages needed.
"""

import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://rt.ambientweather.net/v1"
ROOT = Path(__file__).resolve().parent.parent
HISTORY_DIR = ROOT / "data" / "history"
MANIFEST = ROOT / "data" / "manifest.json"

PAGE_LIMIT = 288          # max records Ambient returns per call
MAX_PAGES = 60            # safety cap per run (about 60 days at 5 min spacing)
REQUEST_GAP_S = 1.1       # Ambient allows 1 request/second per apiKey

# Same public whitelist as the Worker. Everything else is dropped.
FIELDS = [
    "tempf", "feelsLike", "dewPoint", "humidity",
    "windspeedmph", "windgustmph", "maxdailygust", "winddir",
    "windspdmph_avg10m", "winddir_avg10m",
    "baromrelin", "baromabsin",
    "hourlyrainin", "eventrainin", "dailyrainin", "24hourrainin",
    "weeklyrainin", "monthlyrainin", "yearlyrainin",
    "uv", "solarradiation",
]
COLUMNS = ["dateutc", "time_utc"] + FIELDS


class AmbientError(Exception):
    """Error whose message never contains the request URL (it holds the keys)."""


def get_env():
    missing = [k for k in ("AMBIENT_API_KEY", "AMBIENT_APP_KEY", "AMBIENT_MAC") if not os.environ.get(k)]
    if missing:
        sys.exit(f"Missing environment variables: {', '.join(missing)}")
    return os.environ["AMBIENT_API_KEY"], os.environ["AMBIENT_APP_KEY"], os.environ["AMBIENT_MAC"]


def fetch_page(api_key, app_key, mac, end_ms=None):
    params = {"apiKey": api_key, "applicationKey": app_key, "limit": PAGE_LIMIT}
    if end_ms is not None:
        params["endDate"] = str(end_ms)
    url = f"{API}/devices/{urllib.parse.quote(mac)}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.load(resp)
            if not isinstance(data, list):
                raise AmbientError("Unexpected response shape from Ambient Weather")
            return data
        except urllib.error.HTTPError as e:
            code = e.code
            if code == 429 and attempt < 2:
                time.sleep(2)
                continue
            raise AmbientError(f"Ambient Weather returned HTTP {code}") from None
        except urllib.error.URLError:
            if attempt < 2:
                time.sleep(3)
                continue
            raise AmbientError("Could not reach Ambient Weather") from None
    raise AmbientError("Gave up after retries")


def last_saved_ms():
    files = sorted(HISTORY_DIR.glob("*.csv"))
    for f in reversed(files):
        with f.open(newline="") as fh:
            rows = list(csv.DictReader(fh))
        if rows:
            return max(int(r["dateutc"]) for r in rows)
    return None


def to_row(rec):
    ms = int(rec["dateutc"])
    row = {
        "dateutc": ms,
        "time_utc": datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    for f in FIELDS:
        v = rec.get(f)
        row[f] = "" if v is None else v
    return row


def collect_new(api_key, app_key, mac, since_ms):
    """Page backwards from now until we hit since_ms, run out of data, or hit MAX_PAGES."""
    found = {}
    end_ms = None
    for page in range(MAX_PAGES):
        if page:
            time.sleep(REQUEST_GAP_S)
        records = fetch_page(api_key, app_key, mac, end_ms)
        if not records:
            break
        stamps = []
        for rec in records:
            if "dateutc" not in rec:
                continue
            ms = int(rec["dateutc"])
            stamps.append(ms)
            if since_ms is None or ms > since_ms:
                found[ms] = rec
        if not stamps:
            break
        oldest = min(stamps)
        if since_ms is not None and oldest <= since_ms:
            break
        if end_ms is not None and oldest >= end_ms:
            break  # API ignored endDate; stop instead of looping
        end_ms = oldest - 1
    else:
        print(f"Hit MAX_PAGES={MAX_PAGES}; older data will be picked up next run")
    return [found[k] for k in sorted(found)]


def append_rows(records):
    by_month = {}
    for rec in records:
        row = to_row(rec)
        month = row["time_utc"][:7]  # YYYY-MM, UTC
        by_month.setdefault(month, []).append(row)

    for month, rows in by_month.items():
        path = HISTORY_DIR / f"{month}.csv"
        existing = {}
        if path.exists():
            with path.open(newline="") as fh:
                for r in csv.DictReader(fh):
                    existing[int(r["dateutc"])] = r
        for r in rows:
            existing[r["dateutc"]] = r
        with path.open("w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=COLUMNS, extrasaction="ignore")
            w.writeheader()
            for k in sorted(existing):
                w.writerow(existing[k])


def write_manifest():
    files = sorted(HISTORY_DIR.glob("*.csv"))
    first = last = None
    total = 0
    for f in files:
        with f.open(newline="") as fh:
            stamps = [int(r["dateutc"]) for r in csv.DictReader(fh)]
        if stamps:
            total += len(stamps)
            first = min(stamps) if first is None else min(first, min(stamps))
            last = max(stamps) if last is None else max(last, max(stamps))
    iso = lambda ms: None if ms is None else datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    MANIFEST.write_text(json.dumps({
        "files": [f"history/{f.name}" for f in files],
        "columns": COLUMNS,
        "records": total,
        "first": iso(first),
        "last": iso(last),
    }, indent=2) + "\n")


def main():
    api_key, app_key, mac = get_env()
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    since = last_saved_ms()
    print(f"Last saved record: {since if since is not None else 'none (first run)'}")
    try:
        records = collect_new(api_key, app_key, mac, since)
    except AmbientError as e:
        sys.exit(f"Fetch failed: {e}")
    print(f"New records: {len(records)}")
    if records:
        append_rows(records)
    write_manifest()


if __name__ == "__main__":
    main()
