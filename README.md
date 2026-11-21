# Foster Farm Weather Station

Live weather from the Ambient Weather station at Cal Poly Humboldt's Foster Farm, 2000 Foster Ave in Arcata, California.

**Dashboard:** https://lucaszukrow.github.io/CalPolyHumboldt-Foster-Farm-Weather-Station/

The dashboard shows current conditions, a radar loop, the National Weather Service forecast, and charts going back to November 12, 2026, when the station came online. The station is read every minute for the live numbers and stored every 5 minutes for history. Any time range can be downloaded as CSV or JSON from the Data section of the page.

## Using the data

The full record lives in `data/history/`, one CSV per month (months split in UTC). It's updated every 3 hours.

- `dateutc` is milliseconds since January 1, 1970 (UTC). `time_utc` is the same moment written out.
- Units are what the station reports: °F, mph, inHg, inches of rain, W/m² for sunlight.
- `dailyrainin` is the station's running total for the day. This station resets it at 10 AM Pacific instead of midnight because its time zone setting is off. To get rain for any period, add up the increases between rows (a drop means the counter reset). The dashboard does this already.
- The station's rain counters all read 0.45 in at its first upload (Nov 12, 7:59 AM), so that rain isn't in the 5-minute records. The station's own monthly and yearly totals include it; totals added up from the archive don't.
- `baromrelin` (relative pressure) reads about 0.19 inHg low compared to the Arcata airport. `baromabsin` (absolute pressure) agrees with the airport to within about 0.02 inHg, so use that until the station's pressure calibration is fixed.

## How it works

The station uploads to Ambient Weather. A small Cloudflare Worker fetches the latest readings for the dashboard, and a scheduled GitHub Action saves the history into this repo. The dashboard itself is a static page on GitHub Pages.

The Ambient Weather keys are stored as encrypted secrets in Cloudflare and GitHub. They are not in this repo or on the site, and the data that gets published leaves out the station's hardware ID and account details.

Setup and maintenance notes are in [docs/MAINTAINING.md](docs/MAINTAINING.md).

## Credits

- Forecast: [National Weather Service, Eureka](https://www.weather.gov/eka/), with [Open-Meteo](https://open-meteo.com/) (CC BY 4.0) as a backup
- Radar: [RainViewer](https://www.rainviewer.com/)
- Map: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
- Charts: [uPlot](https://github.com/leeoniya/uPlot). Map: [Leaflet](https://leafletjs.com/)

Maintained by Lucas Zukrow.
