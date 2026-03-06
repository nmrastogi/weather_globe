// Temperature range: -30°C (deep blue) → 0°C (cyan) → 20°C (green) → 30°C (orange) → 45°C (red)
const STOPS = [
  { t: -30, r: 0,   g: 0,   b: 200 },
  { t: -10, r: 0,   g: 150, b: 255 },
  { t:   0, r: 0,   g: 220, b: 220 },
  { t:  10, r: 80,  g: 200, b: 80  },
  { t:  20, r: 230, g: 220, b: 0   },
  { t:  30, r: 255, g: 120, b: 0   },
  { t:  45, r: 220, g: 0,   b: 0   },
]

export function tempToColor(celsius, alpha = 0.85) {
  if (celsius == null) return `rgba(100,100,150,0.6)`
  const clamped = Math.max(-30, Math.min(45, celsius))
  let lo = STOPS[0], hi = STOPS[STOPS.length - 1]
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (clamped >= STOPS[i].t && clamped <= STOPS[i + 1].t) {
      lo = STOPS[i]; hi = STOPS[i + 1]; break
    }
  }
  const ratio = (clamped - lo.t) / (hi.t - lo.t)
  const r = Math.round(lo.r + ratio * (hi.r - lo.r))
  const g = Math.round(lo.g + ratio * (hi.g - lo.g))
  const b = Math.round(lo.b + ratio * (hi.b - lo.b))
  return `rgba(${r},${g},${b},${alpha})`
}

export function tempToSideColor(celsius) {
  return tempToColor(celsius, 0.4)
}
