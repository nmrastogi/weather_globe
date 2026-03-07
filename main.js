import { tempToColor, tempToSideColor } from './colorScale.js'
import { getCached, setCache } from './weatherCache.js'

// ── Configuration ──────────────────────────────────────────────────────────────

let OWM_API_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_OWM_API_KEY) ||
  sessionStorage.getItem('owm_api_key') ||
  null

const COUNTRY_GEOJSON_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson'

const STATE_GEOJSON_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson'

const OWM_BASE = 'https://api.openweathermap.org/data/2.5/weather'

// Altitude below which we switch to state/province view
const ZOOM_STATE_THRESHOLD = 1.5

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
const zoomBadge    = document.getElementById('zoom-badge')

// ── State ──────────────────────────────────────────────────────────────────────

const countryWeatherMap = new Map()  // ISO_A2   → weather
const stateWeatherMap   = new Map()  // adm1_code → weather
let countryGeoData  = null
let stateGeoData    = null           // loaded lazily on first zoom-in
let stateGeoLoading = false
let currentMode     = 'country'      // 'country' | 'state'
let hoveredPolygon  = null
let globe           = null
let centroids       = {}
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

async function loadCountryData() {
  const [geoRes, centroidsRes] = await Promise.all([
    fetch(COUNTRY_GEOJSON_URL),
    fetch(import.meta.env.BASE_URL + 'countryCentroids.json')
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

async function loadStateData() {
  if (stateGeoData) return stateGeoData
  if (stateGeoLoading) return null
  stateGeoLoading = true

  zoomBadge.textContent = 'Loading states...'

  try {
    const res = await fetch(STATE_GEOJSON_URL)
    if (!res.ok) throw new Error('Failed to load state GeoJSON')
    stateGeoData = await res.json()
    return stateGeoData
  } catch (err) {
    console.warn('State GeoJSON load failed:', err)
    return null
  } finally {
    stateGeoLoading = false
  }
}

// ── Weather fetch ──────────────────────────────────────────────────────────────

async function fetchWeatherByLatLon(lat, lon, cacheKey, displayName) {
  const cached = getCached(cacheKey)
  if (cached) return cached

  const url = `${OWM_BASE}?lat=${lat}&lon=${lon}&appid=${OWM_API_KEY}&units=metric`

  try {
    const res = await fetch(url)

    if (res.status === 401) {
      showError('Invalid or inactive API key. New keys can take up to 2 hours to activate.')
      return null
    }
    if (!res.ok) return null

    const data = await res.json()
    const weather = {
      country:     displayName,
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

    setCache(cacheKey, weather)
    return weather
  } catch (err) {
    console.warn(`Weather fetch error for ${cacheKey}:`, err)
    return null
  }
}

async function fetchCountryWeather(isoCode) {
  if (!isoCode || isoCode === '-99') return null
  const centroid = centroids[isoCode]
  if (!centroid) return null
  return fetchWeatherByLatLon(centroid.lat, centroid.lon, isoCode, centroid.name)
}

async function fetchStateWeather(feature) {
  const props = feature.properties
  const key = props.adm1_code
  const lat = props.latitude
  const lon = props.longitude
  if (!key || lat == null || lon == null) return null
  const name = `${props.name}, ${props.admin}`
  return fetchWeatherByLatLon(lat, lon, key, name)
}

// ── Globe setup ────────────────────────────────────────────────────────────────

async function launchGlobe() {
  loading.classList.remove('hidden')

  try {
    countryGeoData = await loadCountryData()
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
    .atmosphereColor('#c47a1a')
    .atmosphereAltitude(0.12)
    .polygonsData(countryGeoData.features)
    .polygonAltitude(d => d === hoveredPolygon ? 0.05 : 0.01)
    .polygonCapColor(d => getPolygonColor(d))
    .polygonSideColor(d => getPolygonSideColor(d))
    .polygonStrokeColor(() => 'rgba(255,180,60,0.15)')
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

  // Watch zoom level to switch between country and state views
  globe.controls().addEventListener('change', onCameraChange)

  setTimeout(preWarmCache, 1000)
}

// ── Zoom / layer switching ─────────────────────────────────────────────────────

let zoomSwitchTimer = null

function onCameraChange() {
  const altitude = globe.pointOfView().altitude
  const shouldBeState = altitude < ZOOM_STATE_THRESHOLD

  if (shouldBeState && currentMode === 'country') {
    // Debounce 300ms to avoid thrashing while scrolling
    clearTimeout(zoomSwitchTimer)
    zoomSwitchTimer = setTimeout(() => switchToStates(), 300)
  } else if (!shouldBeState && currentMode === 'state') {
    clearTimeout(zoomSwitchTimer)
    zoomSwitchTimer = setTimeout(() => switchToCountries(), 300)
  }
}

async function switchToStates() {
  if (currentMode === 'state') return
  currentMode = 'state'
  hoveredPolygon = null
  tooltip.classList.add('hidden')
  zoomBadge.textContent = 'State view'
  zoomBadge.classList.remove('hidden')

  const data = await loadStateData()
  if (!data) {
    currentMode = 'country'
    zoomBadge.classList.add('hidden')
    return
  }

  globe.polygonsData(data.features)
  zoomBadge.textContent = 'State / Province view'
}

function switchToCountries() {
  if (currentMode === 'country') return
  currentMode = 'country'
  hoveredPolygon = null
  tooltip.classList.add('hidden')
  zoomBadge.classList.add('hidden')
  globe.polygonsData(countryGeoData.features)
}

// ── Color accessors ────────────────────────────────────────────────────────────

function getPolygonColor(d) {
  if (currentMode === 'state') {
    const w = stateWeatherMap.get(d.properties.adm1_code)
    return tempToColor(w ? w.temp : null)
  }
  const w = countryWeatherMap.get(d.properties.ISO_A2)
  return tempToColor(w ? w.temp : null)
}

function getPolygonSideColor(d) {
  if (currentMode === 'state') {
    const w = stateWeatherMap.get(d.properties.adm1_code)
    return tempToSideColor(w ? w.temp : null)
  }
  const w = countryWeatherMap.get(d.properties.ISO_A2)
  return tempToSideColor(w ? w.temp : null)
}

// ── Hover handler ──────────────────────────────────────────────────────────────

document.addEventListener('mousemove', e => {
  tooltipX = e.clientX
  tooltipY = e.clientY
  if (!tooltip.classList.contains('hidden')) positionTooltip()
})

async function handleHover(polygon) {
  hoveredPolygon = polygon

  if (!polygon) {
    tooltip.classList.add('hidden')
    if (pendingDebounce) clearTimeout(pendingDebounce)
    return
  }

  if (currentMode === 'state') {
    handleStateHover(polygon)
  } else {
    handleCountryHover(polygon)
  }
}

async function handleCountryHover(polygon) {
  const iso = polygon.properties.ISO_A2
  if (!iso || iso === '-99') { tooltip.classList.add('hidden'); return }

  const name = polygon.properties.NAME_EN || polygon.properties.NAME || iso
  const cached = countryWeatherMap.get(iso)

  tooltipName.textContent = name
  tooltipTemp.textContent = cached ? `${cached.temp}°C` : '...'
  tooltipDesc.textContent = cached ? cached.description : ''
  tooltip.classList.remove('hidden')
  positionTooltip()

  if (pendingDebounce) clearTimeout(pendingDebounce)
  pendingDebounce = setTimeout(async () => {
    const weather = await fetchCountryWeather(iso)
    if (!weather || hoveredPolygon !== polygon) return
    tooltipTemp.textContent = `${weather.temp}°C`
    tooltipDesc.textContent = weather.description
    countryWeatherMap.set(iso, weather)
    refreshGlobeColors()
  }, 150)
}

async function handleStateHover(polygon) {
  const props = polygon.properties
  const key = props.adm1_code
  if (!key) { tooltip.classList.add('hidden'); return }

  const name = props.name ? `${props.name}, ${props.admin}` : props.admin
  const cached = stateWeatherMap.get(key)

  tooltipName.textContent = name
  tooltipTemp.textContent = cached ? `${cached.temp}°C` : '...'
  tooltipDesc.textContent = cached ? cached.description : ''
  tooltip.classList.remove('hidden')
  positionTooltip()

  if (pendingDebounce) clearTimeout(pendingDebounce)
  pendingDebounce = setTimeout(async () => {
    const weather = await fetchStateWeather(polygon)
    if (!weather || hoveredPolygon !== polygon) return
    tooltipTemp.textContent = `${weather.temp}°C`
    tooltipDesc.textContent = weather.description
    stateWeatherMap.set(key, weather)
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

  if (currentMode === 'state') {
    await handleStateClick(polygon)
  } else {
    await handleCountryClick(polygon)
  }
}

async function handleCountryClick(polygon) {
  const iso = polygon.properties.ISO_A2
  if (!iso || iso === '-99') return

  let weather = countryWeatherMap.get(iso) || await fetchCountryWeather(iso)
  if (!weather) return

  countryWeatherMap.set(iso, weather)
  refreshGlobeColors()
  showPanel(weather, iso.toLowerCase())

  const centroid = centroids[iso]
  if (centroid && globe) {
    globe.pointOfView({ lat: centroid.lat, lng: centroid.lon, altitude: 1.2 }, 1000)
  }
}

async function handleStateClick(polygon) {
  const props = polygon.properties
  const key = props.adm1_code
  if (!key) return

  let weather = stateWeatherMap.get(key) || await fetchStateWeather(polygon)
  if (!weather) return

  stateWeatherMap.set(key, weather)
  refreshGlobeColors()

  // Use country flag (iso_a2 property)
  const flagCode = (props.iso_a2 || '').toLowerCase()
  showPanel(weather, flagCode)

  if (globe && props.latitude != null && props.longitude != null) {
    globe.pointOfView({ lat: props.latitude, lng: props.longitude, altitude: 0.6 }, 800)
  }
}

function showPanel(weather, flagCode) {
  document.getElementById('panel-country').textContent  = weather.country
  document.getElementById('panel-temp').textContent     = `${weather.temp}°C`
  document.getElementById('panel-feels').textContent    = `${weather.feelsLike}°C`
  document.getElementById('panel-humidity').textContent = `${weather.humidity}%`
  document.getElementById('panel-pressure').textContent = `${weather.pressure} hPa`

  document.getElementById('panel-wind').textContent = weather.windSpeed != null
    ? `${weather.windSpeed} m/s ${weather.windDeg != null ? compassDir(weather.windDeg) : ''}`
    : 'N/A'

  document.getElementById('panel-desc').textContent = capitalize(weather.description)

  document.getElementById('panel-weather-icon').innerHTML =
    `<img src="https://openweathermap.org/img/wn/${weather.icon}@2x.png" alt="${weather.description}" />`

  document.getElementById('panel-flag').innerHTML = flagCode
    ? `<img src="https://flagcdn.com/64x48/${flagCode}.png" alt="flag" onerror="this.style.display='none'" />`
    : ''

  const updatedAt = new Date(weather.dt * 1000)
  document.getElementById('panel-updated').textContent = `Updated: ${updatedAt.toLocaleTimeString()}`

  panel.classList.remove('hidden')
}

panelClose.addEventListener('click', () => panel.classList.add('hidden'))

// ── Globe color refresh ────────────────────────────────────────────────────────

function refreshGlobeColors() {
  if (!globe) return
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
    const weather = await fetchCountryWeather(iso)
    if (weather) countryWeatherMap.set(iso, weather)
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
