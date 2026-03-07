# Weather Globe

An interactive 3D globe that shows real-time weather for every country. Spin the globe, hover to preview, click for full details.

**Live demo:** https://nmrastogi.github.io/weather_globe/

![Weather Globe](https://nmrastogi.github.io/weather_globe/preview.png)

## Features

- Interactive 3D globe with auto-rotation
- Real-time weather data from OpenWeatherMap
- Countries color-coded by temperature (blue → green → red)
- Hover tooltip with temperature and conditions
- Click any country for detailed weather panel (humidity, wind, pressure, feels like)
- Country flags and weather icons
- Globe flies to the selected country

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
| Build tool | [Vite](https://vitejs.dev) |
| Language | Vanilla JS (ES modules) |
| Hosting | GitHub Pages |
