<script setup>
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import cableRoute from '../assets/cable-route.geojson'

const props = defineProps({
  history:   { type: Array,  default: () => [] },
  waypoints: { type: Array,  default: () => [] },
  latest:    { type: Object, default: null },
  hoverTime: { type: Number, default: null },   // epoch ms, or null
  tailHours: { type: Number, default: 24 }      // fading tail window in hours; Infinity = whole
})

const mapEl = ref(null)
let map    = null
let marker = null
let loaded = false

const HOVER_TOLERANCE_MS = 20 * 60_000   // 20 min
const EMPTY_FC = { type: 'FeatureCollection', features: [] }
const EMPTY_LINE = { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }

const GMRT_TILE =
  'https://www.gmrt.org/services/mapserver/wms_merc?' +
  'SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/png' +
  '&TRANSPARENT=false&LAYERS=topo&CRS=EPSG:3857&STYLES=' +
  '&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}'

// ── Track GeoJSON helpers ─────────────────────────────────────────────────

// Full decimated mission track — used for the faint background line.
const trackBgGeoJSON = computed(() => ({
  type: 'Feature',
  geometry: {
    type: 'LineString',
    coordinates: props.history.map(t => [Number(t.longitude), Number(t.latitude)])
  }
}))

// Recent tail — points within tailHours of the latest report.
// Coordinates are ascending (oldest→newest), so line-progress 0 = oldest = faded,
// line-progress 1 = newest = bright.
const trackTailGeoJSON = computed(() => {
  const hist = props.history
  if (!hist.length) return EMPTY_LINE

  let cutoff
  if (!isFinite(props.tailHours)) {
    cutoff = -Infinity
  } else {
    const latestTs = props.latest
      ? new Date(props.latest.glider_timestamp).getTime()
      : new Date(hist[hist.length - 1].glider_timestamp).getTime()
    cutoff = latestTs - props.tailHours * 3_600_000
  }

  const tail = hist.filter(t => new Date(t.glider_timestamp).getTime() >= cutoff)
  // Always include at least the last 2 points so the tail has a line even at narrow windows
  const pts = tail.length >= 2 ? tail : hist.slice(-2)

  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: pts.map(t => [Number(t.longitude), Number(t.latitude)])
    }
  }
})

const targetWp = computed(() => props.latest?.target_waypoint ?? -1)

const wpGeoJSON = computed(() => ({
  type: 'FeatureCollection',
  features: props.waypoints.map(wp => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [Number(wp.longitude), Number(wp.latitude)] },
    properties: { wp_number: wp.wp_number, name: wp.name }
  }))
}))

function markerEl() {
  const div = document.createElement('div')
  div.style.cssText = 'width:28px;height:28px;filter:drop-shadow(0 0 5px rgba(79,195,247,0.7))'
  div.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28">' +
    '<polygon points="12,2 19,20 12,15 5,20" fill="#4fc3f7" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>' +
    '</svg>'
  return div
}

function syncTrack() {
  if (!loaded) return
  map.getSource('track-bg')?.setData(trackBgGeoJSON.value)
  map.getSource('track-tail')?.setData(trackTailGeoJSON.value)
}

function notTarget(extra) {
  return ['all', ['!=', ['get', 'wp_number'], targetWp.value], ...extra]
}

function syncWaypoints() {
  if (!loaded) return
  map.getSource('waypoints')?.setData(wpGeoJSON.value)
  map.setFilter('wp-nav',    notTarget([['<',  ['get', 'wp_number'], 110]]))
  map.setFilter('wp-infra',  notTarget([['>=', ['get', 'wp_number'], 110], ['<', ['get', 'wp_number'], 180]]))
  map.setFilter('wp-survey', notTarget([['>=', ['get', 'wp_number'], 180]]))
  map.setFilter('wp-target', ['==', ['get', 'wp_number'], targetWp.value])
}

function syncMarker() {
  if (!loaded || !props.latest) return
  const lngLat = [Number(props.latest.longitude), Number(props.latest.latitude)]
  if (!marker) {
    marker = new maplibregl.Marker({ element: markerEl(), rotationAlignment: 'map' })
      .setLngLat(lngLat)
      .addTo(map)
  } else {
    marker.setLngLat(lngLat)
  }
  if (props.latest.heading != null) marker.setRotation(Number(props.latest.heading))
}

function fitTrack() {
  if (!map || props.history.length < 2) return
  const lngs = props.history.map(t => Number(t.longitude))
  const lats  = props.history.map(t => Number(t.latitude))
  map.fitBounds(
    [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
    { padding: 44, maxZoom: 11, animate: false }
  )
}

function syncHover() {
  if (!loaded) return
  const src = map.getSource('hover-point')
  if (!src) return

  const t = props.hoverTime
  if (t == null) { src.setData(EMPTY_FC); return }

  // Binary search for nearest history row by glider_timestamp
  const hist = props.history
  if (hist.length === 0) { src.setData(EMPTY_FC); return }

  let lo = 0, hi = hist.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (new Date(hist[mid].glider_timestamp).getTime() < t) lo = mid + 1
    else hi = mid
  }
  const candidates = [lo > 0 ? lo - 1 : null, lo < hist.length ? lo : null]
  let best = null, bestDist = Infinity
  for (const idx of candidates) {
    if (idx == null) continue
    const d = Math.abs(new Date(hist[idx].glider_timestamp).getTime() - t)
    if (d < bestDist) { bestDist = d; best = hist[idx] }
  }

  if (!best || bestDist > HOVER_TOLERANCE_MS) { src.setData(EMPTY_FC); return }

  src.setData({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [Number(best.longitude), Number(best.latitude)]
      }
    }]
  })
}

watch(() => props.history,   () => { syncTrack(); syncMarker() })
watch(() => props.tailHours, () => syncTrack())
watch(() => props.waypoints, () => syncWaypoints())
watch(() => props.latest,    () => { syncMarker(); syncWaypoints() })
watch(() => props.hoverTime, syncHover)

onMounted(() => {
  map = new maplibregl.Map({
    container: mapEl.value,
    style: {
      version: 8,
      sources: {
        gmrt: {
          type: 'raster',
          tiles: [GMRT_TILE],
          tileSize: 256,
          attribution: '© <a href="https://www.gmrt.org/">GMRT</a>'
        }
      },
      layers: [
        { id: 'bg',   type: 'background', paint: { 'background-color': '#0d1117' } },
        {
          id: 'gmrt', type: 'raster', source: 'gmrt',
          paint: {
            'raster-brightness-max': 0.60,
            'raster-saturation':    -0.25,
            'raster-contrast':       0.10,
            'raster-opacity':        0.90
          }
        }
      ]
    },
    center: [-126.2, 48.5],
    zoom: 7
  })

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

  map.once('load', () => {
    loaded = true

    // ── ONC NEPTUNE cable route ───────────────────────────────────
    map.addSource('cable', { type: 'geojson', data: cableRoute })
    map.addLayer({
      id: 'cable-line',
      type: 'line',
      source: 'cable',
      paint: {
        'line-color': '#ffb74d',
        'line-width': 1.5,
        'line-opacity': 0.55,
        'line-dasharray': [4, 3]
      }
    })

    // ── Glider track — background (full mission, faint) ───────────
    map.addSource('track-bg', { type: 'geojson', data: trackBgGeoJSON.value })
    map.addLayer({
      id: 'track-bg-line',
      type: 'line',
      source: 'track-bg',
      paint: {
        'line-color':   '#4fc3f7',
        'line-width':   1.5,
        'line-opacity': 0.22
      }
    })

    // ── Glider track — fading tail (recent, full-res, gradient) ──
    // lineMetrics: true is required for the line-gradient expression.
    map.addSource('track-tail', {
      type: 'geojson',
      data: trackTailGeoJSON.value,
      lineMetrics: true
    })
    map.addLayer({
      id: 'track-tail-line',
      type: 'line',
      source: 'track-tail',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        // line-progress 0 = oldest end (transparent), 1 = newest/head (bright)
        'line-gradient': [
          'interpolate', ['linear'], ['line-progress'],
          0,   'rgba(79, 195, 247, 0)',
          0.4, 'rgba(79, 195, 247, 0.35)',
          1,   'rgba(79, 195, 247, 1)'
        ],
        'line-width': 3
      }
    })

    // ── Hover position dot ────────────────────────────────────────
    map.addSource('hover-point', { type: 'geojson', data: EMPTY_FC })
    map.addLayer({
      id: 'hover-dot',
      type: 'circle',
      source: 'hover-point',
      paint: {
        'circle-color':        '#4fc3f7',
        'circle-radius':       7,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-opacity':      0.9
      }
    })

    // ── Waypoints ────────────────────────────────────────────────
    map.addSource('waypoints', { type: 'geojson', data: wpGeoJSON.value })

    // WP 1–109: operational/nav waypoints
    map.addLayer({
      id: 'wp-nav',
      type: 'circle',
      source: 'waypoints',
      filter: notTarget([['<', ['get', 'wp_number'], 110]]),
      paint: {
        'circle-color': '#4dd0e1',
        'circle-radius': 4,
        'circle-stroke-color': '#0d1117',
        'circle-stroke-width': 1
      }
    })

    // WP 110–179: key GNSSA infrastructure stations
    map.addLayer({
      id: 'wp-infra',
      type: 'circle',
      source: 'waypoints',
      filter: notTarget([['>=', ['get', 'wp_number'], 110], ['<', ['get', 'wp_number'], 180]]),
      paint: {
        'circle-color': '#ff9800',
        'circle-radius': 6,
        'circle-stroke-color': '#0d1117',
        'circle-stroke-width': 1
      }
    })

    // WP 180+: per-station survey track points (current site only), subtle
    map.addLayer({
      id: 'wp-survey',
      type: 'circle',
      source: 'waypoints',
      filter: notTarget([['>=', ['get', 'wp_number'], 180]]),
      paint: {
        'circle-color': '#546e7a',
        'circle-radius': 3,
        'circle-opacity': 0.6,
        'circle-stroke-color': '#37474f',
        'circle-stroke-width': 0.5
      }
    })

    // Active target WP — highlighted regardless of group
    map.addLayer({
      id: 'wp-target',
      type: 'circle',
      source: 'waypoints',
      filter: ['==', ['get', 'wp_number'], targetWp.value],
      paint: {
        'circle-color': '#fff176',
        'circle-radius': 8,
        'circle-stroke-color': '#fdd835',
        'circle-stroke-width': 2
      }
    })

    syncMarker()
    syncWaypoints()
    fitTrack()
  })
})

onUnmounted(() => {
  marker?.remove()
  map?.remove()
})
</script>

<template>
  <div ref="mapEl" class="map-container" />
</template>

<style scoped>
.map-container {
  width: 100%;
  height: 100%;
  min-height: 340px;
}
</style>
