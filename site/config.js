// Public settings for the dashboard. Nothing secret goes in this file.
window.WEATHER_CONFIG = {
  workerUrl: "https://foster-farm-weather.lucaszukrow.workers.dev",

  // Approximate location, used only for the forecast and radar map.
  // Foster Avenue area on the Arcata Bottom. Adjust if you want it exact.
  lat: 40.8795,
  lon: -124.0985,

  timezone: "America/Los_Angeles",
  liveRefreshSeconds: 60,    // current conditions
  recentRefreshSeconds: 300, // last-24h series
  staleAfterMinutes: 15,     // show a warning if the station goes quiet this long
  offlineAfterMinutes: 60,
};
