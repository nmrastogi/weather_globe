import { tempToColor, tempToSideColor } from './colorScale.js'
import { getCached, setCache } from './weatherCache.js'

// ── Configuration ──────────────────────────────────────────────────────────────

let OWM_API_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_OWM_API_KEY) ||
  sessionStorage.getItem('owm_api_key') ||
  null

const GEOJSON_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson'

const OWM_BASE = 'https://api.openweathermap.org/data/2.5/weather'

// ── DOM references ─────────────────────────────────────────────────────────────

const globeEl      = document.getElementById('globe')
const tooltip      = document.getElementById('tooltip')
const tooltipName  = document.getElementById('tooltip-country')
const tooltipTemp  = document.getElementById('tooltip-temp')
const tooltipDesc  = document.getElementById('tooltip-desc')
const panel        = document.getElementById('weather-panel')
const panelClose   = document.getElementById('panel-close')
const loading      = document.getElementById('loading')
const apiOverlay   = document.getElementById('api-key-overlay')
const apiInput     = document.getElementById('api-key-input')
const apiSubmit    = document.getElementById('api-key-submit')
const errorToast   = document.getElementById('error-toast')

// ── State ──────────────────────────────────────────────────────────────────────

const weatherMap = new Map()   // iso → weather object
let hoveredPolygon = null
let globe = null
let centroids = {}
let pendingDebounce = null
let tooltipX = 0, tooltipY = 0

// ── Boot ───────────────────────────────────────────────────────────────────────

function init() {
  if (!OWM_API_KEY) {
    apiOverlay.classList.remove('hidden')
    apiSubmit.addEventListener('click', () => {
      const key = apiInput.value.trim()
      if (!key) return
      OWM_API_KEY = key
      sessionStorage.setItem('owm_api_key', key)
      apiOverlay.classList.add('hidden')
      launchGlobe()
    })
    apiInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') apiSubmit.click()
    })
  } else {
    apiOverlay.classList.add('hidden')
    launchGlobe()
  }
}

// ── Data loading ───────────────────────────────────────────────────────────────

async function loadData() {
  const [geoRes, centroidsRes] = await Promise.all([
    fetch(GEOJSON_URL),
    fetch('/countryCentroids.json')
  ])

  if (!geoRes.ok) throw new Error('Failed to load GeoJSON')
  if (!centroidsRes.ok) throw new Error('Failed to load centroids')

  const [geoData, centroidsData] = await Promise.all([
    geoRes.json(),
    centroidsRes.json()
  ])

  centroids = centroidsData
  return geoData
}

// ── Weather fetch ──────────────────────────────────────────────────────────────

async function fetchWeather(isoCode) {
  if (!isoCode || isoCode === '-99') return null

  const cached = getCached(isoCode)
  if (cached) return cached

  const centroid = centroids[isoCode]
  if (!centroid) return null

  const url = `${OWM_BASE}?lat=${centroid.lat}&lon=${centroid.lon}&appid=${OWM_API_KEY}&units=metric`

  try {
    const res = await fetch(url)

    if (res.status === 401) {
      showError('Invalid or inactive API key. New keys can take up to 2 hours to activate.')
      return null
    }
    if (!res.ok) {
      console.warn(`OWM ${res.status} for ${isoCode}`)
      return null
    }

    const data = await res.json()
    const weather = {
      country:     centroid.name,
      temp:        Math.round(data.main.temp),
      feelsLike:   Math.round(data.main.feels_like),
      humidity:    data.main.humidity,
      pressure:    data.main.pressure,
      windSpeed:   data.wind ? data.wind.speed : null,
      windDeg:     data.wind ? data.wind.deg : null,
      description: data.weather[0].description,
      icon:        data.weather[0].icon,
      dt:          data.dt
    }

    setCache(isoCode, weather)
    return weather
  } catch (err) {
    console.warn(`Weather fetch error for ${isoCode}:`, err)
    return null
  }
}

// ── Globe setup ────────────────────────────────────────────────────────────────

async function launchGlobe() {
  loading.classList.remove('hidden')

  let geoData
  try {
    geoData = await loadData()
  } catch (err) {
    loading.classList.add('hidden')
    showError('Failed to load globe data. Check your internet connection.')
    return
  }

  loading.classList.add('hidden')

  globe = Globe()
    .globeImageUrl('//unpkg.com/three-globe/example/img/earth-night.jpg')
    .backgroundImageUrl('//unpkg.com/three-globe/example/img/night-sky.png')
    .showAtmosphere(true)
    .atmosphereColor('#1a6fa8')
    .atmosphereAltitude(0.15)
    .polygonsData(geoData.features)
    .polygonAltitude(d => d === hoveredPolygon ? 0.05 : 0.01)
    .polygonCapColor(d => {
      const iso = d.properties.ISO_A2
      const w = weatherMap.get(iso)
      return tempToColor(w ? w.temp : null)
    })
    .polygonSideColor(d => {
      const iso = d.properties.ISO_A2
      const w = weatherMap.get(iso)
      return tempToSideColor(w ? w.temp : null)
    })
    .polygonStrokeColor(() => 'rgba(255,255,255,0.12)')
    .polygonLabel(() => '')
    .onPolygonHover(handleHover)
    .onPolygonClick(handleClick)
    (globeEl)

  globe.controls().autoRotate = true
  globe.controls().autoRotateSpeed = 0.5
  globe.controls().enableDamping = true

  globeEl.addEventListener('mousedown', () => {
    globe.controls().autoRotate = false
  })

  // Start background pre-warm after 1 second
  setTimeout(preWarmCache, 1000)
}

// ── Hover handler ──────────────────────────────────────────────────────────────

document.addEventListener('mousemove', e => {
  tooltipX = e.clientX
  tooltipY = e.clientY
  if (!tooltip.classList.contains('hidden')) {
    positionTooltip()
  }
})

async function handleHover(polygon) {
  hoveredPolygon = polygon

  if (!polygon) {
    tooltip.classList.add('hidden')
    if (pendingDebounce) clearTimeout(pendingDebounce)
    return
  }

  const iso = polygon.properties.ISO_A2
  if (!iso || iso === '-99') {
    tooltip.classList.add('hidden')
    return
  }

  const countryName = polygon.properties.NAME_EN || polygon.properties.NAME || iso

  // Show tooltip immediately with country name
  tooltipName.textContent = countryName
  tooltipTemp.textContent = weatherMap.has(iso) ? `${weatherMap.get(iso).temp}°C` : '...'
  tooltipDesc.textContent = weatherMap.has(iso) ? weatherMap.get(iso).description : ''
  tooltip.classList.remove('hidden')
  positionTooltip()

  if (pendingDebounce) clearTimeout(pendingDebounce)

  // Debounce 150ms before fetching
  pendingDebounce = setTimeout(async () => {
    const weather = await fetchWeather(iso)
    // Check that the user is still hovering the same polygon
    if (!weather || hoveredPolygon !== polygon) return

    tooltipTemp.textContent = `${weather.temp}°C`
    tooltipDesc.textContent = weather.description

    weatherMap.set(iso, weather)
    refreshGlobeColors()
  }, 150)
}

function positionTooltip() {
  const offset = 16
  const w = tooltip.offsetWidth || 160
  const h = tooltip.offsetHeight || 80
  let x = tooltipX + offset
  let y = tooltipY + offset
  if (x + w > window.innerWidth)  x = tooltipX - w - offset
  if (y + h > window.innerHeight) y = tooltipY - h - offset
  tooltip.style.left = `${x}px`
  tooltip.style.top  = `${y}px`
}

// ── Click handler ──────────────────────────────────────────────────────────────

async function handleClick(polygon) {
  if (!polygon) return

  const iso = polygon.properties.ISO_A2
  if (!iso || iso === '-99') return

  let weather = weatherMap.get(iso) || await fetchWeather(iso)
  if (!weather) return

  weatherMap.set(iso, weather)
  refreshGlobeColors()

  // Populate panel
  document.getElementById('panel-country').textContent  = weather.country
  document.getElementById('panel-temp').textContent     = `${weather.temp}°C`
  document.getElementById('panel-feels').textContent    = `${weather.feelsLike}°C`
  document.getElementById('panel-humidity').textContent = `${weather.humidity}%`
  document.getElementById('panel-pressure').textContent = `${weather.pressure} hPa`

  if (weather.windSpeed != null) {
    document.getElementById('panel-wind').textContent =
      `${weather.windSpeed} m/s ${weather.windDeg != null ? compassDir(weather.windDeg) : ''}`
  } else {
    document.getElementById('panel-wind').textContent = 'N/A'
  }

  document.getElementById('panel-desc').textContent = capitalize(weather.description)

  document.getElementById('panel-weather-icon').innerHTML =
    `<img src="https://openweathermap.org/img/wn/${weather.icon}@2x.png" alt="${weather.description}" />`

  document.getElementById('panel-flag').innerHTML =
    `<img src="https://flagcdn.com/64x48/${iso.toLowerCase()}.png" alt="${weather.country} flag" onerror="this.style.display='none'" />`

  const updatedAt = new Date(weather.dt * 1000)
  document.getElementById('panel-updated').textContent =
    `Updated: ${updatedAt.toLocaleTimeString()}`

  panel.classList.remove('hidden')

  // Fly globe to country
  const centroid = centroids[iso]
  if (centroid && globe) {
    globe.pointOfView({ lat: centroid.lat, lng: centroid.lon, altitude: 1.8 }, 1000)
  }
}

panelClose.addEventListener('click', () => panel.classList.add('hidden'))

// ── Globe color refresh ────────────────────────────────────────────────────────

function refreshGlobeColors() {
  if (!globe) return
  // Reassigning the same array triggers Globe.gl to re-evaluate color accessors
  globe.polygonsData([...globe.polygonsData()])
}

// ── Pre-warm cache ─────────────────────────────────────────────────────────────

async function preWarmCache() {
  const priority = [
    'US', 'CN', 'IN', 'BR', 'RU', 'GB', 'FR', 'DE', 'JP', 'AU',
    'CA', 'ZA', 'NG', 'MX', 'AR', 'EG', 'SA', 'TR', 'ID', 'PK'
  ]

  for (const iso of priority) {
    if (getCached(iso)) continue
    await new Promise(r => setTimeout(r, 400))
    const weather = await fetchWeather(iso)
    if (weather) {
      weatherMap.set(iso, weather)
    }
  }

  refreshGlobeColors()
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function compassDir(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round(deg / 45) % 8]
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

let errorTimer = null
function showError(msg) {
  errorToast.textContent = msg
  errorToast.classList.remove('hidden')
  if (errorTimer) clearTimeout(errorTimer)
  errorTimer = setTimeout(() => errorToast.classList.add('hidden'), 6000)
}

// ── Start ──────────────────────────────────────────────────────────────────────

init()
