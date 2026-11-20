const cfg = window.WEATHER_CONFIG;

const LABELS = {
  tempf: ["Temperature", "°F"],
  feelsLike: ["Feels like", "°F"],
  dewPoint: ["Dew point", "°F"],
  humidity: ["Humidity", "%"],
  windspeedmph: ["Wind speed", "mph"],
  windgustmph: ["Wind gust", "mph"],
  winddir: ["Wind direction", "°"],
  baromrelin: ["Pressure (rel)", "inHg"],
  hourlyrainin: ["Rain rate", "in/hr"],
  dailyrainin: ["Rain today", "in"],
  uv: ["UV index", ""],
  solarradiation: ["Solar radiation", "W/m²"],
};

async function loadCurrent() {
  const status = document.getElementById("status");
  try {
    const res = await fetch(`${cfg.workerUrl}/current`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);

    const d = body.data;
    const obs = new Date(d.dateutc);
    const ageMin = Math.round((Date.now() - obs) / 60000);
    status.textContent = `Station reading from ${obs.toLocaleString()} (${ageMin} min ago)` +
      (body.stale ? " · showing cached copy" : "");
    status.className = "muted";

    const table = document.getElementById("readings");
    table.innerHTML = "";
    for (const [key, [label, unit]] of Object.entries(LABELS)) {
      if (d[key] === undefined) continue;
      const tr = table.insertRow();
      tr.insertCell().textContent = label;
      tr.insertCell().textContent = `${d[key]} ${unit}`.trim();
    }
  } catch (err) {
    status.textContent = `Could not load live data: ${err.message}`;
    status.className = "err";
  }
}

async function loadHistoryInfo() {
  try {
    const res = await fetch("data/manifest.json", { cache: "no-store" });
    if (!res.ok) return;
    const m = await res.json();
    document.getElementById("history").textContent =
      `History archive: ${m.records} records, ${m.first ?? "?"} to ${m.last ?? "?"} (UTC)`;
  } catch { /* archive not built yet */ }
}

loadCurrent();
loadHistoryInfo();
setInterval(loadCurrent, cfg.refreshSeconds * 1000);
