const R = 6_371_000

export function haversineMeters(a, b) {
  const lat1 = Number(a.latitude) * (Math.PI / 180)
  const lat2 = Number(b.latitude) * (Math.PI / 180)
  const dlat = (Number(b.latitude) - Number(a.latitude)) * (Math.PI / 180)
  const dlng = (Number(b.longitude) - Number(a.longitude)) * (Math.PI / 180)
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function etaSeconds(distMeters, speedKts) {
  if (!speedKts || speedKts <= 0) return null
  return distMeters / (speedKts * 0.514444)
}

export function formatDuration(seconds) {
  if (seconds == null || !isFinite(seconds)) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
