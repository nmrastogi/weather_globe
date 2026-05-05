# Weather Globe — Claude Context

## What this project is
A single-page 3D weather globe (Globe.gl / Three.js) with real-time OpenWeatherMap data.
Vanilla JS (ES modules), Vite build, deployed to GitHub Pages.

## Key files

| File | Purpose |
|---|---|
| `main.js` | All app logic — globe setup, data loading, event handlers, drill panel |
| `colorScale.js` | `tempToColor(celsius)` and `tempToSideColor(celsius)` — 7-stop RGB interpolation |
| `weatherCache.js` | Simple in-memory cache with TTL for weather API responses |
| `index.html` | Globe container, legend, drill panel, weather panel, tooltip |
| `style.css` | All styles; uses CSS custom properties defined in `:root` |
| `public/cities.json` | Pre-built city list (pop > 300k). Rebuild: `node scripts/build-cities.cjs` |
| `public/states.json` | Pre-built ne_10m states (~4,500 features, simplified to 2dp). Rebuild: `node scripts/build-states.cjs` |
| `scripts/build-cities.cjs` | Fetches ne_10m populated places, filters and writes public/cities.json |
| `scripts/build-states.cjs` | Fetches ne_10m admin_1, simplifies geometry, writes public/states.json |

## Architecture

### Layers (Globe.gl)
1. **Polygon layer** — country or state polygons colored by temperature
2. **Points layer** — city dots (small, population-scaled radius)
3. **HTML elements layer** — temperature badge labels above each city dot

### Key state variables (main.js)
- `currentMode` — `'country'` | `'state'`
- `citiesShowing` — boolean, city dots overlay visible
- `selectedState` — GeoJSON feature of expanded state (or null)
- `stateExpansionCities` — cities shown when a state is selected on the globe
- `drillLevel` — `null` | `'states'` | `'cities'` (drill panel level)
- `drillCountryFeature` — country feature currently drilled into
- `countryWeatherMap` / `stateWeatherMap` / `cityWeatherMap` — Maps of cached weather by key

### Data flow
1. `launchGlobe()` — initialises Globe.gl, loads country GeoJSON, pre-warms weather cache
2. Zoom changes trigger `onCameraChange()` → `switchToStates()` / `switchToCountries()` / `showCityDots()` / `hideCityDots()`
3. Click country → `handleCountryClick()` → fetch weather, show left panel, open drill panel via `drillToStates()`
4. Drill panel state card click → `drillToCities()` — loads cities.json, point-in-polygon filter, fetch weather
5. Zoom into state → `expandState()` — loads cities.json, top-10 by pop, fetch weather progressively

### GeoJSON sources
- **Countries (globe polygons):** `ne_110m_admin_0_countries` (remote, small)
- **States (globe polygons):** `ne_50m_admin_1_states_provinces` (remote, 9 large countries only)
- **States (drill panel):** `public/states.json` (local, ne_10m simplified, 241 countries)
- **Cities:** `public/cities.json` (local, static asset)

## Known gotchas

### ISO_A2 = -99 for some countries
France, Norway, and Kosovo have `ISO_A2: -99` in ne_110m. Always use the `countryISO(props)` helper which falls back to `ISO_A2_EH`. Never read `properties.ISO_A2` directly for country lookups.

### Globe.gl HTML elements layer is not reactive
`globe.htmlElement()` factory runs once per item when `htmlElementsData()` is reassigned. To refresh temperature badges after weather loads or unit toggle, call `refreshHtmlLabels()` which reassigns a shallow copy of the data array to re-invoke the factory.

### Globe.gl resize after container height change
When the drill panel opens/closes, `globeEl.style.height` is changed. After the CSS transition (~420ms), dispatch `window.dispatchEvent(new Event('resize'))` so Globe.gl recalculates its canvas size. Currently done with `setTimeout(..., 420)` in `openDrillPanel()` / `closeDrillPanel()`.

### ne_50m vs ne_10m state data
`ne_50m` (used for globe polygon coloring) only has states for 9 countries (AU, BR, CA, CN, ID, IN, RU, US, ZA). The drill panel uses `public/states.json` (ne_10m simplified) which covers 241 countries. Do not conflate the two.

### Weather fetch helpers
- `fetchCountryWeather(isoCode)` — uses centroid from `countryCentroids.json`
- `fetchStateWeather(feature)` — uses `feature.properties.latitude/longitude`
- `fetchCityWeather(city)` — uses `city.lat / city.lon`
- All route through `fetchWeatherByLatLon()` which checks `weatherCache.js` first

## CSS design tokens (`:root` in style.css)
```
--bg        #07070a   page background
--surface   #0e0e14   panels / cards
--border    #2a2a38
--accent    #f5a623   orange — titles, highlights
--text      #d4cfc4
--text-dim  #5a5650
--mono      SF Mono / Fira Mono / Consolas
```

## Dev commands
```bash
npm run dev        # Vite dev server at http://localhost:3000/weather_globe/
npm run build      # Production build → dist/
npm run preview    # Preview production build locally
node scripts/build-cities.cjs   # Regenerate public/cities.json
node scripts/build-states.cjs   # Regenerate public/states.json (takes ~1 min)
```
