#!/usr/bin/env node
// Fetches ne_10m admin_1 states and writes public/states.json
// Strips unnecessary properties and reduces coordinate precision to cut file size ~90%
// Run: node scripts/build-states.cjs

const https = require('https')
const fs    = require('fs')
const path  = require('path')

const URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson'
const OUT  = path.join(__dirname, '..', 'public', 'states.json')

function simplifyCoords(coords, precision) {
  if (typeof coords[0] === 'number') {
    return coords.map(n => parseFloat(n.toFixed(precision)))
  }
  return coords.map(c => simplifyCoords(c, precision))
}

function simplifyGeometry(geometry, precision) {
  if (!geometry) return null
  return {
    type: geometry.type,
    coordinates: simplifyCoords(geometry.coordinates, precision)
  }
}

process.stdout.write('Fetching state data (this may take a minute)... ')

https.get(URL, res => {
  const chunks = []
  res.on('data', c => chunks.push(c))
  res.on('end', () => {
    process.stdout.write('parsing... ')
    const raw = JSON.parse(Buffer.concat(chunks))

    const features = raw.features
      .filter(f => {
        const p = f.properties
        return p.iso_a2 && p.iso_a2 !== '-1' && p.iso_a2 !== '-99' && p.adm1_code
      })
      .map(f => {
        const p = f.properties
        return {
          type: 'Feature',
          properties: {
            name:      p.name,
            iso_a2:    p.iso_a2,
            adm1_code: p.adm1_code,
            latitude:  p.latitude  != null ? parseFloat(p.latitude.toFixed(4))  : null,
            longitude: p.longitude != null ? parseFloat(p.longitude.toFixed(4)) : null,
            admin:     p.admin,
          },
          geometry: simplifyGeometry(f.geometry, 2)  // 2 decimal places ≈ 1km precision
        }
      })

    const out = JSON.stringify({ type: 'FeatureCollection', features })
    fs.writeFileSync(OUT, out)
    const kb = Math.round(fs.statSync(OUT).size / 1024)
    console.log(`done. ${features.length} states, ${kb} KB → ${OUT}`)
  })
}).on('error', err => {
  console.error('Fetch failed:', err.message)
  process.exit(1)
})
