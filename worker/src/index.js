// Foster Farm weather proxy
// Holds the Ambient Weather keys server-side and returns only public weather fields.
// Secrets (set in Cloudflare dashboard, never in code): AMBIENT_API_KEY, AMBIENT_APP_KEY, AMBIENT_MAC

const API = "https://rt.ambientweather.net/v1";

const STATION_NAME = "Cal Poly Humboldt Foster Farm";

// Browsers on other sites can't read responses unless their origin is listed here.
// Note: this stops other websites from embedding the data, it does not stop curl.
const ALLOWED_ORIGINS = [
  "https://lucaszukrow.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

// Only these fields ever leave the Worker. Drops MAC address, location info,
// indoor console readings, and battery flags.
export const PUBLIC_FIELDS = [
  "dateutc",
  "tempf",
  "feelsLike",
  "dewPoint",
  "humidity",
  "windspeedmph",
  "windgustmph",
  "maxdailygust",
  "winddir",
  "windspdmph_avg10m",
  "winddir_avg10m",
  "baromrelin",
  "baromabsin",
  "hourlyrainin",
  "eventrainin",
  "dailyrainin",
  "24hourrainin",
  "weeklyrainin",
  "monthlyrainin",
  "yearlyrainin",
  "lastRain",
  "uv",
  "solarradiation",
];

const ROUTES = {
  "/current": { ttlSeconds: 60 },
  "/recent": { ttlSeconds: 300 }, // last 288 records (about 24 h at 5 min spacing)
};

// In-memory cache, per Worker instance. The Cache API is a no-op on workers.dev,
// so this is what keeps Ambient from being hit on every page load.
const memo = new Map(); // path -> { body, expires, inflight }

export function pick(record) {
  const out = {};
  for (const f of PUBLIC_FIELDS) {
    if (record[f] !== undefined && record[f] !== null) out[f] = record[f];
  }
  return out;
}

// Error messages here must never include the request URL, since it carries the keys.
async function ambientGet(path, env) {
  const url = `${API}${path}${path.includes("?") ? "&" : "?"}` +
    `applicationKey=${encodeURIComponent(env.AMBIENT_APP_KEY)}` +
    `&apiKey=${encodeURIComponent(env.AMBIENT_API_KEY)}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { Accept: "application/json" } });
    } catch {
      throw new Error("Could not reach Ambient Weather");
    }
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1100)); // rate limit resets each second
      continue;
    }
    if (!res.ok) throw new Error(`Ambient Weather returned HTTP ${res.status}`);
    return res.json();
  }
  throw new Error("Ambient Weather rate limit");
}

async function buildBody(path, env) {
  const mac = env.AMBIENT_MAC;
  if (path === "/current") {
    const devices = await ambientGet("/devices", env);
    const device = Array.isArray(devices)
      ? devices.find((d) => (d.macAddress || "").toUpperCase() === mac.toUpperCase())
      : null;
    if (!device || !device.lastData) throw new Error("Station not found on this account");
    return { station: STATION_NAME, data: pick(device.lastData) };
  }
  if (path === "/recent") {
    const records = await ambientGet(`/devices/${encodeURIComponent(mac)}?limit=288`, env);
    if (!Array.isArray(records)) throw new Error("Unexpected response from Ambient Weather");
    const rows = records.map(pick).sort((a, b) => a.dateutc - b.dateutc);
    return { station: STATION_NAME, count: rows.length, records: rows };
  }
  throw new Error("unknown route");
}

async function getCached(path, env) {
  const now = Date.now();
  const entry = memo.get(path) || {};
  if (entry.body && entry.expires > now) return { body: entry.body, stale: false };
  if (entry.inflight) return entry.inflight; // collapse simultaneous requests into one upstream call

  const p = (async () => {
    try {
      const body = { ...(await buildBody(path, env)), fetchedAt: new Date().toISOString() };
      memo.set(path, { body, expires: Date.now() + ROUTES[path].ttlSeconds * 1000 });
      return { body, stale: false };
    } catch (err) {
      // Serve the last good copy if Ambient hiccups
      if (entry.body) {
        memo.set(path, { body: entry.body, expires: Date.now() + 15000 });
        return { body: entry.body, stale: true };
      }
      memo.delete(path); // nothing cached, let the next request retry
      throw err;
    }
  })();
  memo.set(path, { ...entry, inflight: p });
  return p;
}

function corsHeaders(origin) {
  const h = { Vary: "Origin" };
  if (ALLOWED_ORIGINS.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "GET, OPTIONS";
  }
  return h;
}

function json(obj, status, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request.headers.get("Origin") || "");

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, cors);

    if (url.pathname === "/" || url.pathname === "") {
      return json({ station: STATION_NAME, endpoints: Object.keys(ROUTES) }, 200, cors);
    }
    const route = ROUTES[url.pathname];
    if (!route) return json({ error: "Not found" }, 404, cors);

    if (!env.AMBIENT_API_KEY || !env.AMBIENT_APP_KEY || !env.AMBIENT_MAC) {
      return json({ error: "Worker is missing its secrets" }, 500, cors);
    }

    try {
      const { body, stale } = await getCached(url.pathname, env);
      return json({ ...body, stale }, 200, {
        ...cors,
        "Cache-Control": `public, max-age=${route.ttlSeconds}`,
      });
    } catch (err) {
      return json({ error: err.message }, 502, cors);
    }
  },
};
