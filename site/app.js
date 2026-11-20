// Foster Farm Weather Station dashboard
// Live data: Cloudflare Worker (/current, /recent). History: data/history/*.csv built by GitHub Actions.
// No keys ever reach this file.

const cfg = window.WEATHER_CONFIG;
const TZ = cfg.timezone;
const $ = (id) => document.getElementById(id);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/* ---------------- Formatting ---------------- */

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const fmt = (v, d = 0) => (isNum(v) ? v.toFixed(d) : "--");
const dtf = (opts) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...opts });
const fTime = dtf({ hour: "numeric", minute: "2-digit" });
const fDateTime = dtf({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const fDate = dtf({ month: "short", day: "numeric" });
const fDateHour = dtf({ month: "short", day: "numeric", hour: "numeric" });
const fKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const dayKey = (ms) => fKey.format(ms); // YYYY-MM-DD in Pacific time

function localMidnight(ms) {
  const p = Object.fromEntries(
    dtf({ hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" })
      .formatToParts(ms).map((x) => [x.type, x.value])
  );
  return ms - ((+p.hour * 60 + +p.minute) * 60 + +p.second) * 1000 - (ms % 1000);
}

function ago(ms) {
  const m = Math.round((Date.now() - ms) / MIN);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const POINT_NAMES = ["north", "north-northeast", "northeast", "east-northeast", "east", "east-southeast",
  "southeast", "south-southeast", "south", "south-southwest", "southwest", "west-southwest",
  "west", "west-northwest", "northwest", "north-northwest"];
const pointIndex = (deg) => Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;

function uvCategory(uv) {
  if (!isNum(uv)) return "";
  if (uv < 3) return "low";
  if (uv < 6) return "moderate";
  if (uv < 8) return "high";
  if (uv < 11) return "very high";
  return "extreme";
}

/* ---------------- Fetch helpers ---------------- */

async function getJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

async function getText(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/* ---------------- State ---------------- */

const state = {
  current: null,     // latest reading from /current
  recent: [],        // last ~24 h from /recent, ascending
  manifest: null,
  files: new Map(),  // history file -> records
  range: "1",
  rows: [],          // records for the selected range
};

/* ---------------- Live conditions ---------------- */

function buildCompassTicks() {
  const g = $("compass-ticks");
  const ns = "http://www.w3.org/2000/svg";
  for (let d = 0; d < 360; d += 10) {
    const major = d % 45 === 0;
    if (d % 90 === 0) continue; // cardinal letters sit there
    const r1 = 86, r2 = major ? 76 : 80;
    const a = (d - 90) * Math.PI / 180;
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", 100 + r1 * Math.cos(a));
    line.setAttribute("y1", 100 + r1 * Math.sin(a));
    line.setAttribute("x2", 100 + r2 * Math.cos(a));
    line.setAttribute("y2", 100 + r2 * Math.sin(a));
    line.setAttribute("class", major ? "tick major" : "tick");
    g.appendChild(line);
  }
}

function summarize(d) {
  let sky;
  const rate = d.hourlyrainin;
  if (isNum(rate) && rate > 0) {
    sky = rate >= 0.3 ? "Heavy rain" : rate >= 0.1 ? "Steady rain" : "Light rain";
  } else if ((rainSinceMidnight(d) ?? 0) > 0) {
    sky = "Dry now after rain earlier today";
  } else {
    sky = "Dry";
  }

  const s = d.windspeedmph;
  const dir = isNum(d.winddir) ? POINT_NAMES[pointIndex(d.winddir)] : null;
  let wind = "";
  if (isNum(s)) {
    if (s < 1) wind = "calm air";
    else if (s < 8) wind = `a light breeze${dir ? ` from the ${dir}` : ""}`;
    else if (s < 19) wind = `a steady breeze${dir ? ` from the ${dir}` : ""}`;
    else wind = `strong wind${dir ? ` from the ${dir}` : ""}`;
  }
  if (!wind) return `${sky}.`;
  return `${sky}${sky.includes("after") ? ", with " : " with "}${wind}.`;
}

// The station's own daily counters (dailyrainin, maxdailygust) reset at the station's
// midnight, which is not Pacific midnight on this unit. Compute "today" ourselves.
function todayRecords(d) {
  const start = localMidnight(Date.now());
  const recs = state.recent.filter((r) => r.dateutc >= start - 6 * MIN);
  if (d && isNum(d.dateutc) && (!recs.length || d.dateutc > recs[recs.length - 1].dateutc)) recs.push(d);
  return recs;
}

function rainSinceMidnight(d) {
  const start = localMidnight(Date.now());
  let prev = null, total = 0, seen = false;
  for (const r of todayRecords(d)) {
    if (!isNum(r.dailyrainin)) continue;
    if (prev !== null && r.dateutc >= start) {
      let inc = r.dailyrainin - prev;
      if (inc < 0) inc = r.dailyrainin;
      total += inc;
      seen = true;
    }
    prev = r.dailyrainin;
  }
  return seen ? Math.round(total * 100) / 100 : null;
}

function peakGustToday(d) {
  const start = localMidnight(Date.now());
  const g = todayRecords(d).filter((r) => r.dateutc >= start).map((r) => r.windgustmph).filter(isNum);
  return g.length ? Math.max(...g) : null;
}

function todaysRange(d) {
  const today = dayKey(Date.now());
  const temps = state.recent
    .filter((r) => dayKey(r.dateutc) === today && isNum(r.tempf))
    .map((r) => r.tempf);
  if (isNum(d.tempf)) temps.push(d.tempf);
  if (!temps.length) return null;
  return [Math.min(...temps), Math.max(...temps)];
}

function nearest(records, targetMs, maxDiffMs) {
  let best = null, bestDiff = Infinity;
  for (const r of records) {
    const diff = Math.abs(r.dateutc - targetMs);
    if (diff < bestDiff) { best = r; bestDiff = diff; }
  }
  return bestDiff <= maxDiffMs ? best : null;
}

function renderCurrent() {
  const d = state.current;
  if (!d) return;

  $("now-temp").textContent = fmt(d.tempf, 1);
  $("now-feels").textContent = isNum(d.feelsLike) ? `${fmt(d.feelsLike, 0)}°F` : "--";
  $("now-dew").textContent = isNum(d.dewPoint) ? `${fmt(d.dewPoint, 0)}°F` : "--";
  const hl = todaysRange(d);
  $("now-hilo").textContent = hl ? `${fmt(hl[1], 0)}° / ${fmt(hl[0], 0)}°` : "--";
  $("now-summary").textContent = summarize(d);

  // Compass
  const calm = !isNum(d.windspeedmph) || d.windspeedmph < 1;
  $("c-speed").textContent = fmt(d.windspeedmph, d.windspeedmph < 10 ? 1 : 0);
  const needle = $("compass-needle");
  needle.style.visibility = calm || !isNum(d.winddir) ? "hidden" : "visible";
  if (isNum(d.winddir)) needle.setAttribute("transform", `rotate(${d.winddir} 100 100)`);
  $("c-from").textContent = calm ? "calm" : isNum(d.winddir) ? `from ${POINTS[pointIndex(d.winddir)]}` : "--";

  // Tiles
  $("t-wind").textContent = fmt(d.windspeedmph, 1);
  $("t-wind-sub").textContent =
    `Gusts ${fmt(d.windgustmph, 1)}, today's peak ${fmt(peakGustToday(d), 1)}`;

  $("t-hum").textContent = fmt(d.humidity, 0);
  const hums = state.recent.map((r) => r.humidity).filter(isNum);
  $("t-hum-sub").textContent = hums.length
    ? `24 h range ${Math.min(...hums)} to ${Math.max(...hums)}%`
    : " ";

  $("t-pres").textContent = fmt(d.baromrelin, 2);
  const past = nearest(state.recent, d.dateutc - 3 * HOUR, 30 * MIN);
  if (past && isNum(past.baromrelin) && isNum(d.baromrelin)) {
    const delta = Math.round((d.baromrelin - past.baromrelin) * 100) / 100;
    const word = Math.abs(delta) < 0.02 ? "Steady" : delta > 0 ? "Rising" : "Falling";
    const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
    $("t-pres-sub").textContent = `${word}, ${sign}${Math.abs(delta).toFixed(2)} in over 3 h`;
  } else {
    $("t-pres-sub").textContent = " ";
  }

  $("t-rain").textContent = fmt(rainSinceMidnight(d), 2);
  let rainSub;
  if (isNum(d.hourlyrainin) && d.hourlyrainin > 0) rainSub = `Falling at ${fmt(d.hourlyrainin, 2)} in/hr`;
  else if (d.lastRain) rainSub = `Last rain ${ago(Date.parse(d.lastRain))}`;
  else rainSub = "No rain recorded yet";
  const first = state.manifest?.first ? Date.parse(state.manifest.first) : null;
  if (isNum(d.yearlyrainin) && first) {
    const sameYear = new Date(first).getUTCFullYear() === new Date().getUTCFullYear();
    rainSub += sameYear
      ? `. ${fmt(d.yearlyrainin, 2)} in since ${fDate.format(first)}`
      : `. ${fmt(d.yearlyrainin, 2)} in this year`;
  }
  $("t-rain-sub").textContent = rainSub;

  $("t-solar").textContent = fmt(d.solarradiation, 0);
  $("t-solar-sub").textContent = isNum(d.uv) ? `UV index ${d.uv}, ${uvCategory(d.uv)}` : " ";

  renderStatus();
}

function renderStatus(errorMsg) {
  const el = $("status");
  const text = $("status-text");
  const d = state.current;
  if (!d) {
    el.dataset.state = errorMsg ? "bad" : "loading";
    text.textContent = errorMsg
      ? "Can't reach the live data service. Retrying every minute."
      : "Connecting to the station";
    return;
  }
  const ageMin = (Date.now() - d.dateutc) / MIN;
  const when = fTime.format(d.dateutc);
  if (errorMsg) {
    el.dataset.state = "warn";
    text.textContent = `Lost connection to the live data service. Showing the reading from ${when}.`;
  } else if (ageMin >= cfg.offlineAfterMinutes) {
    el.dataset.state = "bad";
    text.textContent = `The station has not reported since ${fDateTime.format(d.dateutc)}. It may be offline.`;
  } else if (ageMin >= cfg.staleAfterMinutes) {
    el.dataset.state = "warn";
    text.textContent = `No new reading for ${Math.round(ageMin)} minutes. Showing the reading from ${when}.`;
  } else {
    el.dataset.state = "ok";
    text.textContent = `Live. Reading from ${when}, ${ago(d.dateutc)}.`;
  }
}

async function loadCurrent() {
  try {
    const body = await getJSON(`${cfg.workerUrl}/current`);
    state.current = body.data;
    renderCurrent();
  } catch (err) {
    renderStatus(err.message);
  }
}

async function loadRecent() {
  try {
    const body = await getJSON(`${cfg.workerUrl}/recent`);
    state.recent = (body.records || []).filter((r) => isNum(r.dateutc));
    renderCurrent();
    if (state.booted && state.range === "1") await selectRange("1", { quiet: true });
  } catch {
    // Live series unavailable; the 24 h view falls back to the history archive.
  }
}

/* ---------------- History archive ---------------- */

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const cols = lines[0].split(",");
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    const rec = {};
    cols.forEach((c, j) => {
      const v = cells[j];
      if (c === "time_utc") return;
      if (v !== undefined && v !== "") {
        const n = Number(v);
        rec[c] = Number.isFinite(n) ? n : v;
      }
    });
    if (isNum(rec.dateutc)) out.push(rec);
  }
  return out;
}

async function loadManifest() {
  if (state.manifest) return state.manifest;
  state.manifest = await getJSON("data/manifest.json").catch(() => ({ files: [] }));
  return state.manifest;
}

async function historySince(startMs) {
  const m = await loadManifest();
  const startMonth = startMs ? new Date(startMs).toISOString().slice(0, 7) : "";
  const wanted = m.files.filter((f) => f.slice(-11, -4) >= startMonth);
  await Promise.all(wanted.map(async (f) => {
    if (state.files.has(f)) return;
    state.files.set(f, parseCSV(await getText(`data/${f}`)));
  }));
  return wanted.flatMap((f) => state.files.get(f));
}

async function recordsFor(range) {
  const now = Date.now();
  const start = range === "all" ? 0 : now - Number(range) * DAY;

  if (range === "1" && state.recent.length) {
    return state.recent.filter((r) => r.dateutc >= start);
  }
  const hist = await historySince(start);
  const lastHist = hist.length ? hist[hist.length - 1].dateutc : 0;
  const merged = hist.concat(state.recent.filter((r) => r.dateutc > lastHist));
  merged.sort((a, b) => a.dateutc - b.dateutc);
  return merged.filter((r) => r.dateutc >= start);
}

/* ---------------- Charts ---------------- */

const css = getComputedStyle(document.documentElement);
const C = {
  accent: css.getPropertyValue("--sea").trim(),
  muted: css.getPropertyValue("--muted-series").trim(),
  grid: css.getPropertyValue("--line").trim(),
  axis: css.getPropertyValue("--ink-3").trim(),
};
const GAP_BREAK = 16 * MIN;
const charts = {};
const tooltip = $("tooltip");

// Insert nulls where the station went quiet so lines break instead of bridging the gap.
function series(rows, fields) {
  const xs = [], ys = fields.map(() => []);
  let prev = null;
  for (const r of rows) {
    if (prev !== null && r.dateutc - prev > GAP_BREAK) {
      xs.push((prev + 5 * MIN) / 1000);
      ys.forEach((y) => y.push(null));
    }
    xs.push(r.dateutc / 1000);
    fields.forEach((f, i) => ys[i].push(isNum(r[f]) ? r[f] : null));
    prev = r.dateutc;
  }
  return [xs, ...ys];
}

// Rain per hour (short ranges) or per day, from the running daily total.
function rainBuckets(rows, daily) {
  const sums = new Map();
  let prev = null;
  for (const r of rows) {
    const v = r.dailyrainin;
    if (!isNum(v)) continue;
    let inc = 0;
    if (prev !== null) {
      inc = v - prev.v;
      if (inc < 0) inc = v; // the daily total reset (station midnight)
    }
    prev = { v, t: r.dateutc };
    const key = daily ? localMidnight(r.dateutc) : Math.floor(r.dateutc / HOUR) * HOUR;
    sums.set(key, (sums.get(key) || 0) + inc);
  }
  const keys = [...sums.keys()].sort((a, b) => a - b);
  return [keys.map((k) => k / 1000), keys.map((k) => Math.round(sums.get(k) * 100) / 100)];
}

const CHARTS = {
  "ch-temp": { fields: ["dewPoint", "tempf"], names: ["Dew point", "Air temperature"], accent: 1, unit: "°F", dec: 1 },
  "ch-hum": { fields: ["humidity"], names: ["Humidity"], unit: "%", dec: 0 },
  "ch-wind": { fields: ["windgustmph", "windspeedmph"], names: ["Gust", "Speed"], accent: 1, unit: "mph", dec: 1, zero: true },
  "ch-rain": { bars: true, names: ["Rain"], unit: "in", dec: 2, zero: true },
  "ch-pres": { fields: ["baromrelin"], names: ["Pressure"], unit: "inHg", dec: 2 },
  "ch-solar": { fields: ["solarradiation"], names: ["Solar radiation"], unit: "W/m²", dec: 0, zero: true, fill: true },
};

function tooltipPlugin(spec, rainDaily) {
  return {
    hooks: {
      setCursor: (u) => {
        const idx = u.cursor.idx;
        if (idx == null || u.cursor.left < 0) { tooltip.hidden = true; return; }
        const t = u.data[0][idx] * 1000;
        tooltip.replaceChildren();
        const head = document.createElement("div");
        head.className = "tt-time";
        head.textContent = spec.bars
          ? (rainDaily ? fDate.format(t) : fDateHour.format(t))
          : fDateTime.format(t);
        tooltip.appendChild(head);
        let any = false;
        const acc = (spec.accent ?? 0) + 1;
        const order = [acc, ...Array.from({ length: u.data.length - 1 }, (_, k) => k + 1).filter((k) => k !== acc)];
        for (const i of order) {
          const v = u.data[i][idx];
          if (v == null) continue;
          any = true;
          const row = document.createElement("div");
          row.className = "tt-row";
          const key = document.createElement("i");
          key.className = `k ${i === acc ? "k-accent" : "k-muted"}`;
          const val = document.createElement("strong");
          val.textContent = `${v.toFixed(spec.dec)} ${spec.unit}`;
          const lbl = document.createElement("span");
          lbl.className = "lbl";
          lbl.textContent = spec.names[i - 1];
          row.append(key, val, lbl);
          tooltip.appendChild(row);
        }
        if (!any) { tooltip.hidden = true; return; }
        tooltip.hidden = false;
        const box = u.over.getBoundingClientRect();
        const x = box.left + u.cursor.left;
        const y = box.top + u.cursor.top;
        const w = tooltip.offsetWidth, h = tooltip.offsetHeight;
        let left = x + 14;
        if (left + w > window.innerWidth - 8) left = x - w - 14;
        let top = y - h - 12;
        if (top < 8) top = y + 16;
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
      },
    },
  };
}

function makeChart(id, data, spec, rainDaily) {
  const host = document.querySelector(`#${id} .plot`);
  const width = Math.max(280, host.clientWidth);
  const axisFont = "12px Poppins, system-ui, sans-serif";
  const ser = [{}];
  spec.names.forEach((name, i) => {
    const s = {
      label: name,
      stroke: i === (spec.accent ?? 0) ? C.accent : C.muted,
      width: 2,
      spanGaps: false,
      points: { show: false },
    };
    if (spec.fill && i === (spec.accent ?? 0)) s.fill = "rgba(0, 133, 106, 0.10)";
    if (spec.bars) {
      s.fill = C.accent;
      s.width = 0;
      s.paths = uPlot.paths.bars({ size: [0.7, 24], radius: 0.2 });
    }
    ser.push(s);
  });

  const opts = {
    width,
    height: 250,
    tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), TZ),
    legend: { show: false },
    cursor: {
      drag: { x: false, y: false },
      points: { size: 8, width: 2, stroke: "#fff", fill: (u, i) => (i - 1 === (spec.accent ?? 0) ? C.accent : C.muted) },
    },
    scales: {
      x: { time: true },
      y: spec.zero
        ? { range: (u, min, max) => [0, max > 0 ? max * 1.15 : 1] }
        : { range: (u, min, max) => { const pad = Math.max((max - min) * 0.12, spec.dec >= 2 ? 0.02 : 1); return [min - pad, max + pad]; } },
    },
    axes: [
      {
        stroke: C.axis, font: axisFont, grid: { stroke: C.grid, width: 1 }, ticks: { show: false }, gap: 6,
        values: [
          [86400 * 28, "{MMM}", "\n{YYYY}", null, null, null, null, null, 1],
          [86400, "{MMM} {D}", null, null, null, null, null, null, 1],
          [3600, "{h} {aa}", "\n{MMM} {D}", null, "\n{MMM} {D}", null, null, null, 1],
          [60, "{h}:{mm} {aa}", "\n{MMM} {D}", null, "\n{MMM} {D}", null, null, null, 1],
        ],
      },
      {
        stroke: C.axis, font: axisFont, grid: { stroke: C.grid, width: 1 }, ticks: { show: false }, size: 52, gap: 6,
        values: (u, vals) => vals.map((v) => v.toFixed(spec.dec >= 2 && Math.abs(v) < 100 ? 2 : spec.dec > 0 && v % 1 ? 1 : 0)),
      },
    ],
    series: ser,
    plugins: [tooltipPlugin(spec, rainDaily)],
  };
  host.querySelector(".empty")?.remove();
  const u = new uPlot(opts, data, host);
  u.over.addEventListener("mouseleave", () => { tooltip.hidden = true; });
  return u;
}

function renderCharts(rows, range) {
  const daily = range !== "1" && range !== "3";
  $("rain-unit").textContent = daily ? "in per day" : "in per hour";
  for (const [id, spec] of Object.entries(CHARTS)) {
    const data = spec.bars ? rainBuckets(rows, daily) : series(rows, spec.fields);
    const hasData = data[0].length > 0 && data.slice(1).some((s) => s.some((v) => v != null));
    const host = document.querySelector(`#${id} .plot`);
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    if (!hasData) {
      if (!host.querySelector(".empty")) {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "No readings in this range";
        host.appendChild(p);
      }
      continue;
    }
    charts[id] = makeChart(id, data, spec, daily);
  }
}

new ResizeObserver(() => {
  for (const [id, u] of Object.entries(charts)) {
    const w = document.querySelector(`#${id} .plot`).clientWidth;
    if (Math.abs(w - u.width) > 2) u.setSize({ width: Math.max(280, w), height: 250 });
  }
}).observe($("charts"));

/* ---------------- Range selection, summary, table ---------------- */

function rainTotal(rows) {
  const [, vals] = rainBuckets(rows, true);
  return vals.reduce((a, b) => a + b, 0);
}

function renderSummary(rows) {
  const dl = $("summary");
  dl.replaceChildren();
  const add = (label, value) => {
    const wrap = document.createElement("div");
    const dt = document.createElement("dt"); dt.textContent = label;
    const dd = document.createElement("dd"); dd.textContent = value;
    wrap.append(dt, dd); dl.appendChild(wrap);
  };
  const temps = rows.map((r) => r.tempf).filter(isNum);
  const gusts = rows.map((r) => r.windgustmph).filter(isNum);
  add("Records", rows.length.toLocaleString());
  add("Temperature range", temps.length ? `${fmt(Math.min(...temps), 1)} to ${fmt(Math.max(...temps), 1)}°F` : "--");
  add("Peak gust", gusts.length ? `${fmt(Math.max(...gusts), 1)} mph` : "--");
  add("Total rain", rows.length ? `${rainTotal(rows).toFixed(2)} in` : "--");

  $("range-meta").textContent = rows.length
    ? `${fDateTime.format(rows[0].dateutc)} to ${fDateTime.format(rows[rows.length - 1].dateutc)}`
    : "No readings in this range";
}

const TABLE_COLS = [
  ["Time (Pacific)", (r) => fDateTime.format(r.dateutc)],
  ["Temp °F", (r) => fmt(r.tempf, 1)],
  ["Dew point °F", (r) => fmt(r.dewPoint, 1)],
  ["Humidity %", (r) => fmt(r.humidity, 0)],
  ["Wind mph", (r) => fmt(r.windspeedmph, 1)],
  ["Gust mph", (r) => fmt(r.windgustmph, 1)],
  ["Direction", (r) => (isNum(r.winddir) ? `${POINTS[pointIndex(r.winddir)]} (${r.winddir}°)` : "--")],
  ["Pressure inHg", (r) => fmt(r.baromrelin, 2)],
  ["Rain rate in/hr", (r) => fmt(r.hourlyrainin, 2)],
  ["Solar W/m²", (r) => fmt(r.solarradiation, 0)],
  ["UV", (r) => fmt(r.uv, 0)],
];
const TABLE_LIMIT = 300;

function renderTable(rows) {
  if ($("table-wrap").hidden) return;
  const thead = $("data-table").tHead;
  if (!thead.rows.length) {
    const tr = thead.insertRow();
    for (const [name] of TABLE_COLS) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = name;
      tr.appendChild(th);
    }
  }
  const tbody = $("data-table").tBodies[0];
  const frag = document.createDocumentFragment();
  const newest = rows.slice(-TABLE_LIMIT).reverse();
  for (const r of newest) {
    const tr = document.createElement("tr");
    for (const [, get] of TABLE_COLS) {
      const td = document.createElement("td");
      td.textContent = get(r);
      tr.appendChild(td);
    }
    frag.appendChild(tr);
  }
  tbody.replaceChildren(frag);
  $("table-note").textContent = rows.length > TABLE_LIMIT
    ? `Showing the newest ${TABLE_LIMIT} of ${rows.length.toLocaleString()} records. Download the CSV for all of them.`
    : `${rows.length.toLocaleString()} records.`;
}

async function selectRange(range, { quiet = false } = {}) {
  state.range = range;
  document.querySelectorAll(".chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === range)));
  const box = $("charts");
  if (!quiet) box.classList.add("loading");
  try {
    const rows = await recordsFor(range);
    if (state.range !== range) return; // a newer click won
    state.rows = rows;
    renderCharts(rows, range);
    renderSummary(rows);
    renderTable(rows);
  } catch (err) {
    $("range-meta").textContent = `Could not load history: ${err.message}`;
  } finally {
    box.classList.remove("loading");
  }
}

/* ---------------- Downloads ---------------- */

const EXPORT_COLS = ["dateutc", "time_pacific", "tempf", "feelsLike", "dewPoint", "humidity",
  "windspeedmph", "windgustmph", "maxdailygust", "winddir", "baromrelin", "baromabsin",
  "hourlyrainin", "eventrainin", "dailyrainin", "weeklyrainin", "monthlyrainin", "yearlyrainin",
  "uv", "solarradiation"];
const fIso = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

function download(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportName(ext) {
  const rows = state.rows;
  if (!rows.length) return `foster-farm-weather.${ext}`;
  return `foster-farm-weather_${dayKey(rows[0].dateutc)}_to_${dayKey(rows[rows.length - 1].dateutc)}.${ext}`;
}

$("dl-csv").addEventListener("click", () => {
  const lines = [EXPORT_COLS.join(",")];
  for (const r of state.rows) {
    lines.push(EXPORT_COLS.map((c) => (c === "time_pacific" ? fIso.format(r.dateutc) : (r[c] ?? ""))).join(","));
  }
  download(exportName("csv"), "text/csv", lines.join("\n") + "\n");
});

$("dl-json").addEventListener("click", () => {
  const out = state.rows.map((r) => {
    const o = { time_pacific: fIso.format(r.dateutc) };
    for (const c of EXPORT_COLS) if (c !== "time_pacific" && r[c] !== undefined) o[c] = r[c];
    return o;
  });
  download(exportName("json"), "application/json", JSON.stringify(out, null, 1));
});

$("toggle-table").addEventListener("click", (e) => {
  const wrap = $("table-wrap");
  wrap.hidden = !wrap.hidden;
  e.currentTarget.setAttribute("aria-expanded", String(!wrap.hidden));
  e.currentTarget.textContent = wrap.hidden ? "Show table" : "Hide table";
  renderTable(state.rows);
});

document.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => selectRange(b.dataset.range)));

/* ---------------- Forecast (Open-Meteo) ---------------- */

const ICONS = {
  sun: '<svg viewBox="0 0 32 32" fill="none" stroke="#E0A100" stroke-width="2" stroke-linecap="round"><circle cx="16" cy="16" r="6"/><path d="M16 3v3M16 26v3M3 16h3M26 16h3M6.8 6.8l2.1 2.1M23.1 23.1l2.1 2.1M6.8 25.2l2.1-2.1M23.1 8.9l2.1-2.1"/></svg>',
  partly: '<svg viewBox="0 0 32 32" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><g stroke="#E0A100"><circle cx="12" cy="12" r="4.5"/><path d="M12 3v2M3 12h2M5.6 5.6l1.4 1.4M18.4 5.6 17 7"/></g><path stroke="#004C46" fill="#fff" d="M11 26h13a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.4 1.6A3.8 3.8 0 0 0 11 26z"/></svg>',
  cloud: '<svg viewBox="0 0 32 32" fill="none" stroke="#004C46" stroke-width="2" stroke-linejoin="round"><path d="M9 25h15a5 5 0 0 0 0-10 7 7 0 0 0-13.3 1.8A4.3 4.3 0 0 0 9 25z"/></svg>',
  fog: '<svg viewBox="0 0 32 32" fill="none" stroke="#4D5E59" stroke-width="2" stroke-linecap="round"><path d="M5 11h22M8 16h18M5 21h22M10 26h14"/></svg>',
  rain: '<svg viewBox="0 0 32 32" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="#004C46" d="M9 20h15a5 5 0 0 0 0-10 7 7 0 0 0-13.3 1.8A4.3 4.3 0 0 0 9 20z"/><path stroke="#00856A" d="M11 24l-1.5 4M17 24l-1.5 4M23 24l-1.5 4"/></svg>',
  snow: '<svg viewBox="0 0 32 32" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="#004C46" d="M9 20h15a5 5 0 0 0 0-10 7 7 0 0 0-13.3 1.8A4.3 4.3 0 0 0 9 20z"/><g stroke="#00856A"><path d="M11 24v4M9 26h4M21 24v4M19 26h4"/></g></svg>',
  storm: '<svg viewBox="0 0 32 32" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="#004C46" d="M9 19h15a5 5 0 0 0 0-10 7 7 0 0 0-13.3 1.8A4.3 4.3 0 0 0 9 19z"/><path stroke="#E0A100" d="M17 21l-3 5h4l-2 4"/></svg>',
};

function wmo(code) {
  if (code === 0) return ["Clear", "sun"];
  if (code === 1) return ["Mostly clear", "sun"];
  if (code === 2) return ["Partly cloudy", "partly"];
  if (code === 3) return ["Overcast", "cloud"];
  if (code === 45 || code === 48) return ["Fog", "fog"];
  if (code >= 51 && code <= 57) return ["Drizzle", "rain"];
  if (code >= 61 && code <= 67) return [code >= 65 ? "Heavy rain" : "Rain", "rain"];
  if (code >= 71 && code <= 77) return ["Snow", "snow"];
  if (code >= 80 && code <= 82) return ["Rain showers", "rain"];
  if (code === 85 || code === 86) return ["Snow showers", "snow"];
  if (code >= 95) return ["Thunderstorms", "storm"];
  return ["Mixed", "cloud"];
}

async function loadForecast() {
  const list = $("forecast");
  const params = new URLSearchParams({
    latitude: cfg.lat, longitude: cfg.lon, timezone: TZ, forecast_days: 7,
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max",
    temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch",
  });
  try {
    const f = await getJSON(`https://api.open-meteo.com/v1/forecast?${params}`);
    const d = f.daily;
    const lo = Math.min(...d.temperature_2m_min), hi = Math.max(...d.temperature_2m_max);
    const span = Math.max(hi - lo, 1);
    const wd = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
    list.replaceChildren();
    d.time.forEach((day, i) => {
      const [y, m, dd] = day.split("-").map(Number);
      const [desc, icon] = wmo(d.weather_code[i]);
      const li = document.createElement("li");

      const name = document.createElement("span");
      name.className = "fc-day";
      name.textContent = i === 0 ? "Today" : wd.format(Date.UTC(y, m - 1, dd, 12));

      const ic = document.createElement("span");
      ic.className = "fc-icon";
      ic.innerHTML = ICONS[icon]; // static, trusted markup
      ic.setAttribute("aria-hidden", "true");

      const tlo = document.createElement("span");
      tlo.className = "fc-lo";
      tlo.textContent = `${Math.round(d.temperature_2m_min[i])}°`;

      const bar = document.createElement("span");
      bar.className = "fc-bar";
      bar.setAttribute("aria-hidden", "true");
      const fill = document.createElement("span");
      fill.style.left = `${((d.temperature_2m_min[i] - lo) / span) * 100}%`;
      fill.style.right = `${((hi - d.temperature_2m_max[i]) / span) * 100}%`;
      bar.appendChild(fill);

      const thi = document.createElement("span");
      thi.className = "fc-hi";
      thi.textContent = `${Math.round(d.temperature_2m_max[i])}°`;

      const detail = document.createElement("span");
      detail.className = "fc-detail";
      const pop = d.precipitation_probability_max[i];
      const amt = d.precipitation_sum[i];
      let txt = desc;
      if (isNum(pop) && pop > 0) txt += `, ${pop}% chance of rain`;
      if (isNum(amt) && amt >= 0.01) txt += `, ${amt.toFixed(2)} in`;
      detail.textContent = txt;

      li.setAttribute("aria-label",
        `${name.textContent}: ${txt}. Low ${tlo.textContent}, high ${thi.textContent}.`);
      li.append(name, ic, tlo, bar, thi, detail);
      list.appendChild(li);
    });
  } catch {
    list.replaceChildren();
    const li = document.createElement("li");
    li.className = "fc-empty";
    li.textContent = "Forecast unavailable right now. It will retry in 30 minutes.";
    list.appendChild(li);
  }
}

/* ---------------- Radar (RainViewer + Leaflet) ---------------- */

const radar = { map: null, layers: [], frames: [], idx: 0, timer: null, playing: true };
const RADAR_FRAMES = 7; // about the past hour, keeps tile requests well under RainViewer's limit

function initMap() {
  const map = L.map("radar-map", {
    center: [cfg.lat, cfg.lon], zoom: 8, minZoom: 5, maxZoom: 11,
    scrollWheelZoom: false, zoomControl: true,
  });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    className: "basemap",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  L.marker([cfg.lat, cfg.lon], {
    icon: L.divIcon({ className: "", html: '<div class="station-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
    keyboard: false, title: "Foster Farm weather station",
  }).addTo(map);
  map.attributionControl.addAttribution('Radar <a href="https://www.rainviewer.com/">RainViewer</a>');
  radar.map = map;
}

function showFrame(i) {
  radar.layers.forEach((l, j) => l.setOpacity(j === i ? 0.75 : 0));
  radar.idx = i;
  const f = radar.frames[i];
  if (f) $("radar-time").textContent = `${fTime.format(f.time * 1000)}${i === radar.frames.length - 1 ? ", latest" : ""}`;
}

function step() {
  if (!radar.frames.length) return;
  const last = radar.frames.length - 1;
  const next = radar.idx >= last ? 0 : radar.idx + 1;
  showFrame(next);
  clearTimeout(radar.timer);
  if (radar.playing) radar.timer = setTimeout(step, next === last ? 2200 : 650);
}

async function loadRadar() {
  try {
    const meta = await getJSON("https://api.rainviewer.com/public/weather-maps.json");
    const frames = (meta.radar?.past || []).slice(-RADAR_FRAMES);
    if (!frames.length) throw new Error("no frames");
    radar.layers.forEach((l) => radar.map.removeLayer(l));
    radar.frames = frames;
    radar.layers = frames.map((f) =>
      L.tileLayer(`${meta.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, {
        opacity: 0, maxNativeZoom: 7, maxZoom: 11, zIndex: 5,
      }).addTo(radar.map)
    );
    showFrame(frames.length - 1);
    clearTimeout(radar.timer);
    if (radar.playing) radar.timer = setTimeout(step, 1500);
  } catch {
    $("radar-time").textContent = "Radar unavailable right now";
  }
}

$("radar-play").addEventListener("click", (e) => {
  radar.playing = !radar.playing;
  e.currentTarget.setAttribute("aria-pressed", String(radar.playing));
  e.currentTarget.textContent = radar.playing ? "Pause" : "Play";
  clearTimeout(radar.timer);
  if (radar.playing) step();
});

/* ---------------- Boot ---------------- */

async function boot() {
  buildCompassTicks();

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    radar.playing = false;
    $("radar-play").setAttribute("aria-pressed", "false");
    $("radar-play").textContent = "Play";
  }

  loadManifest().then(renderCurrent);
  await Promise.all([loadCurrent(), loadRecent()]);
  await selectRange("1");
  state.booted = true;

  if (window.L) { initMap(); loadRadar(); }
  loadForecast();

  setInterval(loadCurrent, cfg.liveRefreshSeconds * 1000);
  setInterval(loadRecent, cfg.recentRefreshSeconds * 1000);
  setInterval(() => renderStatus(), 30_000);
  setInterval(loadRadar, 10 * MIN);
  setInterval(loadForecast, 30 * MIN);
}

boot();
