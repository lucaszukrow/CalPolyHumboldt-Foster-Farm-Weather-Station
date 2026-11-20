// Public settings for the dashboard. Nothing secret goes in this file.
window.WEATHER_CONFIG = {
  workerUrl: "https://foster-farm-weather.lucaszukrow.workers.dev",

  // Station location (2000 Foster Ave, Arcata). Used for the forecast and radar map.
  lat: 40.881441,
  lon: -124.096187,

  timezone: "America/Los_Angeles",
  liveRefreshSeconds: 60,    // current conditions
  recentRefreshSeconds: 300, // last-24h series
  staleAfterMinutes: 15,     // show a warning if the station goes quiet this long
  offlineAfterMinutes: 60,
};
