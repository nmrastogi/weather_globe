const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

const cache = new Map()

export function getCached(isoCode) {
  const entry = cache.get(isoCode)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(isoCode)
    return null
  }
  return entry.data
}

export function setCache(isoCode, data) {
  cache.set(isoCode, { data, timestamp: Date.now() })
}
