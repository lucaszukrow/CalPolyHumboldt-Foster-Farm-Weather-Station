"""Tests the history script with a fake Ambient API. python3 tests/test_fetch_history.py"""
import csv
import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import fetch_history as fh  # noqa: E402

STEP = 300_000  # 5 min
NOW = 1_795_000_000_000
ALL = [{"dateutc": NOW - i * STEP, "tempf": 50 + i % 7, "humidity": 80,
        "tempinf": 70, "macAddress": "AA:BB"} for i in range(700)]  # newest first, ~58 h

calls = []


def fake_page(api_key, app_key, mac, end_ms=None):
    calls.append(end_ms)
    recs = [r for r in ALL if end_ms is None or r["dateutc"] <= end_ms]
    return recs[:fh.PAGE_LIMIT]


tmp = Path(tempfile.mkdtemp())
fh.HISTORY_DIR = tmp / "history"
fh.MANIFEST = tmp / "manifest.json"
fh.HISTORY_DIR.mkdir()
fh.fetch_page = fake_page
fh.REQUEST_GAP_S = 0

# First run backfills everything
recs = fh.collect_new("k", "a", "m", fh.last_saved_ms())
assert len(recs) == 700, len(recs)
fh.append_rows(recs)
fh.write_manifest()
m = json.loads(fh.MANIFEST.read_text())
assert m["records"] == 700, m
rows = [r for f in sorted(fh.HISTORY_DIR.glob("*.csv")) for r in csv.DictReader(f.open())]
assert "tempinf" not in rows[0] and "macAddress" not in rows[0]
assert [int(r["dateutc"]) for r in rows] == sorted(int(r["dateutc"]) for r in rows)

# New data arrives, second run only grabs the new records and stops paging early
ALL[:0] = [{"dateutc": NOW + i * STEP, "tempf": 60} for i in range(12, 0, -1)]
calls.clear()
recs = fh.collect_new("k", "a", "m", fh.last_saved_ms())
assert len(recs) == 12, len(recs)
assert len(calls) == 1, calls
fh.append_rows(recs)
fh.write_manifest()
assert json.loads(fh.MANIFEST.read_text())["records"] == 712

# Re-running with nothing new adds nothing, and duplicates are not written twice
fh.append_rows(ALL[:50])
fh.write_manifest()
assert json.loads(fh.MANIFEST.read_text())["records"] == 712

# API that ignores endDate does not loop forever
calls.clear()
fh.fetch_page = lambda *a, end_ms=None: (calls.append(1), ALL[:288])[1]
fh.collect_new("k", "a", "m", None)
assert len(calls) <= 3, len(calls)

# HTTP errors never expose the URL
import urllib.error, urllib.request  # noqa: E401,E402
import importlib
real = importlib.reload(fh)


def boom(req, timeout=None):
    raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {}, None)


urllib.request.urlopen = boom
try:
    real.fetch_page("APIKEY_SECRET", "APPKEY_SECRET", "AA:BB")
    raise AssertionError("should fail")
except real.AmbientError as e:
    assert "SECRET" not in str(e) and "401" in str(e), str(e)
    assert e.__cause__ is None and e.__suppress_context__

shutil.rmtree(tmp)
print("fetch_history: all tests passed")
