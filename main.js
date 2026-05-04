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

// City data is pre-built by scripts/build-cities.cjs and served as a static asset
const CITY_JSON_URL = () => import.meta.env.BASE_URL + 'cities.json'

const OWM_BASE = 'https://api.openweathermap.org/data/2.5/weather'

// Altitude thresholds for layer switching
const ZOOM_STATE_THRESHOLD = 1.5
const ZOOM_CITY_THRESHOLD  = 0.6   // cities overlay appears on top of state polygons

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
const drillPanel   = document.getElementById('drill-panel')
const drillCards   = document.getElementById('drill-cards')
const drillTitle   = document.getElementById('drill-title')
const drillBack    = document.getElementById('drill-back')
const drillClose   = document.getElementById('drill-close')

// ── State ──────────────────────────────────────────────────────────────────────

const countryWeatherMap = new Map()  // ISO_A2    → weather
const stateWeatherMap   = new Map()  // adm1_code → weather
const cityWeatherMap    = new Map()  // city key  → weather

let countryGeoData  = null
let stateGeoData    = null  // loaded lazily on first zoom-in to state level
let cityGeoData     = null  // loaded lazily on first zoom-in to city level
let stateGeoLoading = false
let cityGeoLoading  = false

let currentMode     = 'country'  // 'country' | 'state'
let citiesShowing   = false      // city dots overlay (independent of polygon mode)
let hoveredPolygon  = null
let hoveredCity     = null
let globe           = null
let centroids       = {}
let pendingDebounce = null
let tooltipX = 0, tooltipY = 0
let unit            = 'C'        // 'C' | 'F'
let lastPanelWeather = null
let lastPanelFlagCode = null

let selectedState        = null  // GeoJSON feature currently expanded, or null
let stateExpansionCities = []    // in-memory city list for selected state
let expansionFetching    = false // guard against concurrent expand calls

let drillLevel          = null  // null | 'states' | 'cities'
let drillCountryFeature = null  // GeoJSON feature of the currently drilled country

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

async function loadCityData() {
  if (cityGeoData) return cityGeoData
  if (cityGeoLoading) return null
  cityGeoLoading = true

  zoomBadge.textContent = 'Loading cities...'

  try {
    const res = await fetch(CITY_JSON_URL())
    if (!res.ok) throw new Error('Failed to load cities.json')
    cityGeoData = await res.json()

    return cityGeoData
  } catch (err) {
    console.warn('City GeoJSON load failed:', err)
    return null
  } finally {
    cityGeoLoading = false
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

function cityKey(city) {
  return `city:${city.name}:${city.lat.toFixed(2)}:${city.lon.toFixed(2)}`
}

async function fetchCityWeather(city) {
  const key = cityKey(city)
  return fetchWeatherByLatLon(city.lat, city.lon, key, `${city.name}, ${city.country}`)
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
    // Polygon (country / state) layer
    .polygonsData(countryGeoData.features)
    .polygonAltitude(d => d === hoveredPolygon ? 0.03 : 0.01)
    .polygonCapColor(d => d === selectedState ? getBrightCapColor(d) : getPolygonColor(d))
    .polygonSideColor(d => getPolygonSideColor(d))
    .polygonStrokeColor(d =>
      d === selectedState ? 'rgba(255,230,100,1.0)' : 'rgba(255,180,60,0.15)'
    )
    .polygonLabel(() => '')
    .onPolygonHover(handleHover)
    .onPolygonClick(handleClick)
    // City points layer (initially empty)
    .pointsData([])
    .pointLat(d => d.lat)
    .pointLng(d => d.lon)
    .pointColor(d => {
      const w = cityWeatherMap.get(cityKey(d))
      return tempToColor(w ? w.temp : null)
    })
    .pointRadius(d => selectedState !== null
      ? 0.04 + Math.log10(Math.max(1, d.pop / 1000000)) * 0.02
      : 0.06 + Math.log10(Math.max(1, d.pop / 300000)) * 0.03
    )
    .pointAltitude(0.02)
    .pointLabel(() => '')
    .onPointHover(handleCityHover)
    .onPointClick(handleCityClick)
    // Temperature badge labels (HTML elements layer)
    .htmlElementsData([])
    .htmlLat(d => d.lat)
    .htmlLng(d => d.lon)
    .htmlAltitude(0.025)
    .htmlTransitionDuration(300)
    .htmlElement(d => {
      const key = cityKey(d)
      const w = cityWeatherMap.get(key)
      const el = document.createElement('div')
      el.className = 'city-temp-badge'
      el.textContent = w ? displayTemp(w.temp) : ''
      el.style.display = w ? '' : 'none'
      return el
    })
    (globeEl)

  globe.controls().autoRotate = true
  globe.controls().autoRotateSpeed = 0.5
  globe.controls().enableDamping = true

  globeEl.addEventListener('mousedown', () => {
    globe.controls().autoRotate = false
  })

  globeEl.addEventListener('mouseleave', () => {
    tooltip.classList.add('hidden')
    if (pendingDebounce) clearTimeout(pendingDebounce)
    hoveredPolygon = null
    hoveredCity = null
  })

  // Watch zoom level to switch between country / state / city views
  globe.controls().addEventListener('change', onCameraChange)

  setTimeout(preWarmCache, 1000)
}

// ── Point-in-polygon ───────────────────────────────────────────────────────────

function isPointInRing(lat, lon, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersects = ((yi > lat) !== (yj > lat)) &&
      (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)
    if (intersects) inside = !inside
  }
  return inside
}

function isPointInPolygonCoords(lat, lon, polygonCoords) {
  if (!isPointInRing(lat, lon, polygonCoords[0])) return false
  for (let h = 1; h < polygonCoords.length; h++) {
    if (isPointInRing(lat, lon, polygonCoords[h])) return false
  }
  return true
}

function isPointInGeoJSONFeature(lat, lon, feature) {
  const geom = feature.geometry
  if (!geom) return false
  if (geom.type === 'Polygon') return isPointInPolygonCoords(lat, lon, geom.coordinates)
  if (geom.type === 'MultiPolygon') return geom.coordinates.some(p => isPointInPolygonCoords(lat, lon, p))
  return false
}

// ── State expansion ────────────────────────────────────────────────────────────

function syncPointsData() {
  if (!globe) return
  if (selectedState !== null) {
    globe.pointsData(stateExpansionCities)
  } else if (citiesShowing && cityGeoData) {
    globe.pointsData(cityGeoData)
  } else {
    globe.pointsData([])
  }
}

function syncHtmlLabels() {
  if (!globe) return
  if (selectedState !== null) {
    globe.htmlElementsData(stateExpansionCities)
  } else if (citiesShowing && cityGeoData) {
    globe.htmlElementsData(cityGeoData)
  } else {
    globe.htmlElementsData([])
  }
}

async function expandState(feature) {
  if (expansionFetching) return
  expansionFetching = true
  selectedState = feature
  stateExpansionCities = []
  refreshGlobeColors()

  const cities = await loadCityData()
  expansionFetching = false
  if (!cities || selectedState !== feature) return

  const allInState = cities.filter(c => isPointInGeoJSONFeature(c.lat, c.lon, feature))
  stateExpansionCities = allInState
    .sort((a, b) => b.pop - a.pop)
    .slice(0, 10)

  // Fetch weather for each; only add dot to globe once its weather arrives
  const weathered = []
  await Promise.all(stateExpansionCities.map(async city => {
    if (selectedState !== feature) return
    const key = cityKey(city)
    const weather = cityWeatherMap.get(key) || await fetchCityWeather(city)
    if (!weather || selectedState !== feature) return
    cityWeatherMap.set(key, weather)
    weathered.push(city)
    globe.pointsData([...weathered])
    globe.htmlElementsData([...weathered])
  }))
}

function collapseState() {
  if (selectedState === null) return
  selectedState = null
  stateExpansionCities = []
  refreshGlobeColors()
  syncPointsData()
  syncHtmlLabels()
}

// ── Zoom / layer switching ─────────────────────────────────────────────────────

let zoomSwitchTimer = null
let cityDotTimer    = null

function onCameraChange() {
  const altitude = globe.pointOfView().altitude

  // Polygon layer: countries ↔ states
  if (altitude < ZOOM_STATE_THRESHOLD && currentMode !== 'state') {
    clearTimeout(zoomSwitchTimer)
    zoomSwitchTimer = setTimeout(() => switchToStates(), 300)
  } else if (altitude >= ZOOM_STATE_THRESHOLD && currentMode !== 'country') {
    clearTimeout(zoomSwitchTimer)
    zoomSwitchTimer = setTimeout(() => {
      collapseState()
      switchToCountries()
    }, 300)
  }

  // City dots overlay: independent of polygon mode
  if (altitude < ZOOM_CITY_THRESHOLD && !citiesShowing) {
    clearTimeout(cityDotTimer)
    cityDotTimer = setTimeout(() => showCityDots(), 300)
  } else if (altitude >= ZOOM_CITY_THRESHOLD && citiesShowing) {
    clearTimeout(cityDotTimer)
    cityDotTimer = setTimeout(() => hideCityDots(), 300)
  }
}

async function showCityDots() {
  if (citiesShowing) return
  citiesShowing = true
  updateZoomBadge()

  const cities = await loadCityData()
  if (!cities) { citiesShowing = false; updateZoomBadge(); return }

  syncPointsData()
  syncHtmlLabels()
  updateZoomBadge()
}

function hideCityDots() {
  if (!citiesShowing) return
  citiesShowing = false
  hoveredCity = null
  syncPointsData()
  syncHtmlLabels()
  updateZoomBadge()
}

async function switchToStates() {
  if (currentMode === 'state') return
  currentMode = 'state'
  hoveredPolygon = null
  tooltip.classList.add('hidden')
  updateZoomBadge()

  const data = await loadStateData()
  if (!data) {
    currentMode = 'country'
    updateZoomBadge()
    return
  }

  globe.polygonsData(data.features)
  updateZoomBadge()
}

function switchToCountries() {
  if (currentMode === 'country') return
  currentMode = 'country'
  hoveredPolygon = null
  tooltip.classList.add('hidden')
  globe.polygonsData(countryGeoData.features)
  updateZoomBadge()
}

function updateZoomBadge() {
  if (currentMode === 'country' && !citiesShowing) {
    zoomBadge.classList.add('hidden')
    return
  }
  zoomBadge.classList.remove('hidden')
  if (currentMode === 'state' && citiesShowing) {
    zoomBadge.textContent = 'States + Cities'
  } else if (currentMode === 'state') {
    zoomBadge.textContent = 'State / Province view'
  } else {
    zoomBadge.textContent = 'Loading cities...'
  }
}

// ── Color accessors ────────────────────────────────────────────────────────────

function getBrightCapColor(d) {
  const base = getPolygonColor(d)
  const m = base.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return base
  const r = Math.min(255, parseInt(m[1]) + 80)
  const g = Math.min(255, parseInt(m[2]) + 70)
  const b = Math.min(255, parseInt(m[3]) + 50)
  return `rgba(${r},${g},${b},0.95)`
}

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
  // If currently hovering a city point, polygon hover is secondary — skip it
  if (hoveredCity) return

  const prev = hoveredPolygon
  hoveredPolygon = polygon

  if (!polygon) {
    tooltip.classList.add('hidden')
    if (pendingDebounce) clearTimeout(pendingDebounce)
    return
  }

  // Hide tooltip when switching between different polygons
  if (prev && prev !== polygon) {
    tooltip.classList.add('hidden')
    if (pendingDebounce) clearTimeout(pendingDebounce)
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
  tooltipTemp.textContent = cached ? displayTemp(cached.temp) : '...'
  tooltipDesc.textContent = cached ? cached.description : ''
  tooltip.classList.remove('hidden')
  positionTooltip()

  if (pendingDebounce) clearTimeout(pendingDebounce)
  pendingDebounce = setTimeout(async () => {
    const weather = await fetchCountryWeather(iso)
    if (!weather || hoveredPolygon !== polygon) return
    tooltipTemp.textContent = displayTemp(weather.temp)
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
  tooltipTemp.textContent = cached ? displayTemp(cached.temp) : '...'
  tooltipDesc.textContent = cached ? cached.description : ''
  tooltip.classList.remove('hidden')
  positionTooltip()

  if (pendingDebounce) clearTimeout(pendingDebounce)
  pendingDebounce = setTimeout(async () => {
    const weather = await fetchStateWeather(polygon)
    if (!weather || hoveredPolygon !== polygon) return
    tooltipTemp.textContent = displayTemp(weather.temp)
    tooltipDesc.textContent = weather.description
    stateWeatherMap.set(key, weather)
    refreshGlobeColors()
  }, 150)
}

async function handleCityHover(city) {
  hoveredCity = city

  if (!city) {
    tooltip.classList.add('hidden')
    if (pendingDebounce) clearTimeout(pendingDebounce)
    return
  }

  const key = cityKey(city)
  const cached = cityWeatherMap.get(key)

  tooltipName.textContent = `${city.name}, ${city.country}`
  tooltipTemp.textContent = cached ? displayTemp(cached.temp) : '...'
  tooltipDesc.textContent = cached ? cached.description : ''
  tooltip.classList.remove('hidden')
  positionTooltip()

  if (pendingDebounce) clearTimeout(pendingDebounce)
  pendingDebounce = setTimeout(async () => {
    const weather = await fetchCityWeather(city)
    if (!weather || hoveredCity !== city) return
    tooltipTemp.textContent = displayTemp(weather.temp)
    tooltipDesc.textContent = weather.description
    cityWeatherMap.set(key, weather)
    refreshCityColors()
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

// ── Drill-down panel ───────────────────────────────────────────────────────────

const DRILL_HEIGHT = '42vh'

function openDrillPanel() {
  globeEl.style.height = `calc(100vh - ${DRILL_HEIGHT})`
  drillPanel.classList.add('open')
  setTimeout(() => window.dispatchEvent(new Event('resize')), 420)
}

function closeDrillPanel() {
  globeEl.style.height = '100vh'
  drillPanel.classList.remove('open')
  drillLevel = null
  drillCountryFeature = null
  setTimeout(() => window.dispatchEvent(new Event('resize')), 420)
}

function createCard(name, weather, onClick) {
  const card = document.createElement('div')
  card.className = 'drill-card'
  if (weather) card.style.borderTopColor = tempToColor(weather.temp)
  card.innerHTML = `
    <div class="card-name">${name}</div>
    <div class="card-temp ${weather ? '' : 'loading'}">${weather ? displayTemp(weather.temp) : '…'}</div>
    <div class="card-desc">${weather ? capitalize(weather.description) : ''}</div>
  `
  card.addEventListener('click', onClick)
  return card
}

function updateCard(card, weather) {
  card.style.borderTopColor = tempToColor(weather.temp)
  card.querySelector('.card-temp').textContent = displayTemp(weather.temp)
  card.querySelector('.card-temp').classList.remove('loading')
  card.querySelector('.card-desc').textContent = capitalize(weather.description)
}

async function drillToStates(countryFeature) {
  drillLevel = 'states'
  drillCountryFeature = countryFeature

  const iso = countryFeature.properties.ISO_A2
  const name = countryFeature.properties.NAME_EN || countryFeature.properties.ADMIN || 'Country'

  drillTitle.textContent = name
  drillBack.classList.add('hidden')
  drillCards.innerHTML = ''
  openDrillPanel()

  const data = await loadStateData()
  if (!data) {
    drillCards.innerHTML = '<p class="drill-empty">Could not load state data.</p>'
    return
  }

  const countryStates = data.features.filter(f =>
    (f.properties.iso_a2 || '').toUpperCase() === iso.toUpperCase()
  )

  if (countryStates.length === 0) {
    drillCards.innerHTML = '<p class="drill-empty">No state data available.</p>'
    return
  }

  const cardMap = new Map()
  countryStates.forEach(feature => {
    const key = feature.properties.adm1_code
    const cached = stateWeatherMap.get(key)
    const card = createCard(feature.properties.name, cached || null, () => drillToCities(feature))
    card.dataset.key = key
    drillCards.appendChild(card)
    cardMap.set(key, card)
  })

  countryStates.forEach(async feature => {
    const key = feature.properties.adm1_code
    if (stateWeatherMap.get(key)) return
    const weather = await fetchStateWeather(feature)
    if (!weather) return
    stateWeatherMap.set(key, weather)
    const card = cardMap.get(key)
    if (card) updateCard(card, weather)
  })
}

async function drillToCities(stateFeature) {
  drillLevel = 'cities'

  drillTitle.textContent = stateFeature.properties.name
  drillBack.classList.remove('hidden')
  drillCards.innerHTML = '<p class="drill-empty">Loading cities…</p>'

  const cities = await loadCityData()
  if (!cities) {
    drillCards.innerHTML = '<p class="drill-empty">Could not load city data.</p>'
    return
  }

  const stateCities = cities
    .filter(c => isPointInGeoJSONFeature(c.lat, c.lon, stateFeature))
    .sort((a, b) => b.pop - a.pop)
    .slice(0, 15)

  drillCards.innerHTML = ''

  if (stateCities.length === 0) {
    drillCards.innerHTML = '<p class="drill-empty">No city data for this state.</p>'
    return
  }

  const cardMap = new Map()
  stateCities.forEach(city => {
    const key = cityKey(city)
    const cached = cityWeatherMap.get(key)
    const card = createCard(city.name, cached || null, () => {
      const w = cityWeatherMap.get(cityKey(city))
      if (w) showPanel(w, '')
    })
    card.dataset.key = key
    drillCards.appendChild(card)
    cardMap.set(key, card)
  })

  stateCities.forEach(async city => {
    const key = cityKey(city)
    if (cityWeatherMap.get(key)) return
    const weather = await fetchCityWeather(city)
    if (!weather) return
    cityWeatherMap.set(key, weather)
    const card = cardMap.get(key)
    if (card) updateCard(card, weather)
  })
}

async function handleCountryClick(polygon) {
  const iso = polygon.properties.ISO_A2
  if (!iso || iso === '-99') return

  let weather = countryWeatherMap.get(iso) || await fetchCountryWeather(iso)
  if (!weather) return

  countryWeatherMap.set(iso, weather)
  refreshGlobeColors()
  showPanel(weather, iso.toLowerCase())
  drillToStates(polygon)
}

async function handleStateClick(polygon) {
  const props = polygon.properties
  const key = props.adm1_code
  if (!key) return

  if (selectedState === polygon) {
    collapseState()
    panel.classList.add('hidden')
    return
  }

  expandState(polygon)
  let weather = stateWeatherMap.get(key) || await fetchStateWeather(polygon)
  if (!weather) return

  stateWeatherMap.set(key, weather)
  refreshGlobeColors()

  const flagCode = (props.iso_a2 || '').toLowerCase()
  showPanel(weather, flagCode)

  if (globe && props.latitude != null && props.longitude != null) {
    globe.pointOfView({ lat: props.latitude, lng: props.longitude, altitude: 0.4 }, 800)
  }
}

async function handleCityClick(city) {
  if (!city) return

  const key = cityKey(city)
  let weather = cityWeatherMap.get(key) || await fetchCityWeather(city)
  if (!weather) return

  cityWeatherMap.set(key, weather)
  refreshCityColors()
  showPanel(weather, null)

  if (globe) {
    globe.pointOfView({ lat: city.lat, lng: city.lon, altitude: 0.15 }, 800)
  }
}

function showPanel(weather, flagCode) {
  lastPanelWeather  = weather
  lastPanelFlagCode = flagCode
  document.getElementById('panel-country').textContent  = weather.country
  document.getElementById('panel-temp').textContent     = displayTemp(weather.temp)
  document.getElementById('panel-feels').textContent    = displayTemp(weather.feelsLike)
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

panelClose.addEventListener('click', () => {
  panel.classList.add('hidden')
  lastPanelWeather = null
  lastPanelFlagCode = null
})

// ── Globe color refresh ────────────────────────────────────────────────────────

function refreshGlobeColors() {
  if (!globe) return
  globe.polygonsData([...globe.polygonsData()])
}

function refreshCityColors() {
  if (!globe) return
  const data = globe.pointsData()
  if (data && data.length > 0) globe.pointsData([...data])
}

function refreshHtmlLabels() {
  if (!globe) return
  const data = globe.htmlElementsData()
  if (data && data.length > 0) globe.htmlElementsData([...data])
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

// ── Unit toggle ────────────────────────────────────────────────────────────────

function displayTemp(celsius) {
  if (unit === 'F') return `${Math.round(celsius * 9 / 5 + 32)}°F`
  return `${celsius}°C`
}

function updateLegendLabels() {
  document.getElementById('legend-min').textContent  = unit === 'F' ? '-22°F' : '-30°C'
  document.getElementById('legend-mid1').textContent = unit === 'F' ?  '14°F' : '-10°C'
  document.getElementById('legend-mid2').textContent = unit === 'F' ?  '68°F' :  '20°C'
  document.getElementById('legend-max').textContent  = unit === 'F' ? '113°F' :  '45°C'
}

document.getElementById('unit-toggle').addEventListener('click', () => {
  unit = unit === 'C' ? 'F' : 'C'
  document.getElementById('unit-toggle').textContent = unit === 'C' ? '°C' : '°F'
  updateLegendLabels()
  // Refresh panel if open
  if (lastPanelWeather) showPanel(lastPanelWeather, lastPanelFlagCode)
  // Refresh tooltip if visible
  if (!tooltip.classList.contains('hidden')) {
    if (hoveredCity) {
      const w = cityWeatherMap.get(cityKey(hoveredCity))
      if (w) tooltipTemp.textContent = displayTemp(w.temp)
    } else if (hoveredPolygon) {
      const key = currentMode === 'state'
        ? hoveredPolygon.properties.adm1_code
        : hoveredPolygon.properties.ISO_A2
      const map  = currentMode === 'state' ? stateWeatherMap : countryWeatherMap
      const w = map.get(key)
      if (w) tooltipTemp.textContent = displayTemp(w.temp)
    }
  }
  refreshHtmlLabels()
})

drillBack.addEventListener('click', () => {
  if (drillCountryFeature) drillToStates(drillCountryFeature)
})

drillClose.addEventListener('click', closeDrillPanel)

// ── Start ──────────────────────────────────────────────────────────────────────

updateLegendLabels()
init()
