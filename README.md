# Weather Globe

An interactive 3D globe showing real-time weather for every country. Spin the globe, zoom into states and cities, and drill down through regions to compare temperatures at a glance.

**Live demo:** https://nmrastogi.github.io/weather_globe/

![Weather Globe](https://nmrastogi.github.io/weather_globe/preview.png)

## Features

- Interactive 3D globe with auto-rotation
- Real-time weather data from OpenWeatherMap
- Countries color-coded by temperature (blue → green → orange → red)
- Temperature legend with scale labels
- Hover tooltip with temperature and conditions
- Click any country for a detailed weather panel (temperature, feels like, humidity, wind, pressure, conditions)
- **Drill-down panel** — click a country to see all its states/provinces with live temperatures; click a state to see its top cities
- Zoom into states — globe switches to state-level polygons, each colored by temperature
- Zoom into cities — temperature badge labels float above each city dot
- Fahrenheit / Celsius toggle
- Covers 241 countries and 4,500+ states/provinces

## Getting Started

### 1. Get a free API key

Sign up at [openweathermap.org](https://openweathermap.org/api) and copy your API key.
New keys take up to 2 hours to activate.

### 2. Install and run locally

```bash
git clone https://github.com/nmrastogi/weather_globe.git
cd weather_globe
npm install

# Create your .env file
cp .env.example .env
# Edit .env and paste your API key: VITE_OWM_API_KEY=your_key_here

npm run dev
```

Open http://localhost:3000

### 3. Without a .env file

Just run `npm run dev` — a prompt will appear in the browser asking for your API key. The key is stored only for the current browser session.

### 4. Rebuild static assets (optional)

The repo includes pre-built `public/cities.json` and `public/states.json`. To regenerate them:

```bash
node scripts/build-cities.cjs   # ~300 cities with population > 300k
node scripts/build-states.cjs   # ~4,500 states/provinces worldwide
```

## How It Works

| Zoom level | What you see |
|---|---|
| Far out | Countries colored by temperature |
| Zoom in (altitude < 1.5) | State/province polygons |
| Zoom in further (altitude < 0.6) | City dots with temperature badges |
| Click a country | Bottom panel slides up with all states and their temperatures |
| Click a state in the panel | Panel switches to top cities in that state |

## Deployment (GitHub Pages)

The site auto-deploys via GitHub Actions on every push to `main`.

To set up your own deployment:

1. Fork this repo
2. Go to **Settings → Secrets → Actions** and add:
   - `VITE_OWM_API_KEY` = your OpenWeatherMap API key
3. Go to **Settings → Pages** and set source to **Deploy from a branch → `gh-pages`**
4. Push any change to `main` to trigger a deploy

## Tech Stack

| | |
|---|---|
| Globe | [Globe.gl](https://globe.gl) (Three.js) |
| Weather API | [OpenWeatherMap](https://openweathermap.org/api) |
| Geo data | [Natural Earth](https://www.naturalearthdata.com) |
| Build tool | [Vite](https://vitejs.dev) |
| Language | Vanilla JS (ES modules) |
| Hosting | GitHub Pages |