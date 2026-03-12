#!/usr/bin/env node
// Fetches Natural Earth populated places and writes public/cities.json
// Run: node scripts/build-cities.js

const https = require('https')
const fs    = require('fs')
const path  = require('path')

const URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson'
const OUT  = path.join(__dirname, '..', 'public', 'cities.json')

process.stdout.write('Fetching city data... ')

https.get(URL, res => {
  const chunks = []
  res.on('data', c => chunks.push(c))
  res.on('end', () => {
    const raw = JSON.parse(Buffer.concat(chunks))
    const cities = raw.features
      .filter(f => (f.properties.POP_MAX || f.properties.pop_max || 0) > 300000)
      .map(f => ({
        name:    f.properties.NAME    || f.properties.name,
        country: f.properties.ADM0NAME || f.properties.adm0name,
        lat:     parseFloat(f.geometry.coordinates[1].toFixed(4)),
        lon:     parseFloat(f.geometry.coordinates[0].toFixed(4)),
        pop:     f.properties.POP_MAX || f.properties.pop_max,
      }))
      .filter(c => c.name && c.lat != null && c.lon != null)

    fs.writeFileSync(OUT, JSON.stringify(cities))
    const kb = Math.round(fs.statSync(OUT).size / 1024)
    console.log(`done. ${cities.length} cities, ${kb} KB → ${OUT}`)
  })
}).on('error', err => {
  console.error('Fetch failed:', err.message)
  process.exit(1)
})
