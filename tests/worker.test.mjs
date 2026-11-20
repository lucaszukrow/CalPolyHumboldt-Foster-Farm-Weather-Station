// Runs the Worker locally with a fake Ambient API. node tests/worker.test.mjs
import assert from "node:assert/strict";

const KEYS = { AMBIENT_API_KEY: "APIKEY_SECRET_123", AMBIENT_APP_KEY: "APPKEY_SECRET_456", AMBIENT_MAC: "AA:BB:CC:DD:EE:FF" };
let calls = 0;
let mode = "ok";

const now = Date.now();
const record = (i) => ({
  dateutc: now - i * 300000, tempf: 52.3, humidity: 88, windspeedmph: 3.1, dailyrainin: 0.12,
  tempinf: 70.1, humidityin: 40, battout: 1, macAddress: KEYS.AMBIENT_MAC,
});

globalThis.fetch = async (url) => {
  calls++;
  if (mode === "down") throw new Error(`connect failed ${url}`);
  if (mode === "500") return new Response("boom", { status: 500 });
  if (url.includes("/devices/")) return Response.json([0, 1, 2].map(record));
  return Response.json([{ macAddress: KEYS.AMBIENT_MAC, info: { name: "Farm", coords: { address: "123 Secret Rd", coords: { lat: 40.9, lon: -124.1 } } }, lastData: record(0) }]);
};

const worker = (await import("../worker/src/index.js")).default;
const req = (path, origin = "https://lucaszukrow.github.io") =>
  worker.fetch(new Request(`https://w.example${path}`, { headers: { Origin: origin } }), KEYS);

// /current returns only public fields
let res = await req("/current");
let text = await res.text();
assert.equal(res.status, 200);
assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://lucaszukrow.github.io");
for (const leak of ["APIKEY_SECRET", "APPKEY_SECRET", "AA:BB:CC", "Secret Rd", "tempinf", "humidityin", "battout", "lat"]) {
  assert.ok(!text.includes(leak), `leaked ${leak}`);
}
assert.equal(JSON.parse(text).data.tempf, 52.3);

// second call is served from memory
const before = calls;
await req("/current");
assert.equal(calls, before, "should be cached");

// /recent sorted ascending, no leaks
res = await req("/recent");
const recent = await res.json();
assert.equal(recent.count, 3);
assert.ok(recent.records[0].dateutc < recent.records[2].dateutc);
assert.ok(!JSON.stringify(recent).includes("AA:BB:CC"));

// unknown origin gets no CORS header
res = await req("/current", "https://evil.example");
assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);

// POST rejected, unknown route 404
assert.equal((await worker.fetch(new Request("https://w.example/current", { method: "POST" }), KEYS)).status, 405);
assert.equal((await req("/nope")).status, 404);

// Upstream down with no cache: error message must not contain the URL/keys
const fresh = await import("../worker/src/index.js?fresh=1");
mode = "down";
res = await fresh.default.fetch(new Request("https://w.example/current"), KEYS);
text = await res.text();
assert.equal(res.status, 502);
assert.ok(!text.includes("SECRET"), "error leaked key");

mode = "500";
res = await fresh.default.fetch(new Request("https://w.example/recent"), KEYS);
text = await res.text();
assert.equal(res.status, 502);
assert.match(text, /HTTP 500/);
assert.ok(!text.includes("SECRET"));

// Missing secrets
res = await fresh.default.fetch(new Request("https://w.example/current"), {});
assert.equal(res.status, 500);

console.log("worker: all tests passed");
