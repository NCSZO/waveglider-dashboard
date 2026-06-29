<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getLatestTelemetry, getTelemetryHistory, getBatteryHistory, getWaypoints, getSiteWaypoints, getActiveMission } from './lib/api.js'
import { haversineMeters } from './lib/geo.js'
import MapView     from './components/MapView.vue'
import StatusCard  from './components/StatusCard.vue'
import TimeSeries  from './components/TimeSeries.vue'
import RosePlot    from './components/RosePlot.vue'
import Attribution from './components/Attribution.vue'

const latest       = ref(null)
const history      = ref([])
const battery      = ref([])
const waypoints    = ref([])   // stable: WP 1 + 110-173
const siteWaypoints = ref([])  // all site_waypoints rows, all stations
const mission      = ref(null)
const error        = ref(null)
const hoverTime    = ref(null)   // epoch ms shared across all charts + map; null when no hover
const tailHours    = ref(24)     // fading tail length in hours; Infinity = whole mission

const STALE_MS = 15 * 60_000

const staleness = computed(() => {
  if (!latest.value) return 'unknown'
  const age = Date.now() - new Date(latest.value.glider_timestamp).getTime()
  if (age > 3 * STALE_MS) return 'critical'
  if (age > STALE_MS)     return 'stale'
  return 'fresh'
})

// ── Site detection ──────────────────────────────────────────────────────────
// Centroids are the GNSSA-XX rows (WP 110, 120, …, 170) in the waypoints table.
// We pick whichever is nearest to the latest glider position.
const CENTROID_RE = /^GNSSA-0\d$/

const currentSite = computed(() => {
  if (!latest.value || !waypoints.value.length) return null
  const centroids = waypoints.value.filter(w => CENTROID_RE.test(w.name))
  if (!centroids.length) return null
  let best = null, bestDist = Infinity
  for (const c of centroids) {
    const d = haversineMeters(latest.value, c)
    if (d < bestDist) { bestDist = d; best = c.name }
  }
  return best  // e.g. 'GNSSA-07'
})

// Merge stable waypoints with the active site's survey slots.
// The rest of the app (StatusCard, MapView) sees a single flat array and needs
// no changes — survey slots are still wp_number 180+ as before, just from the
// right station.
const effectiveWaypoints = computed(() => {
  const site = currentSite.value
  const surveyRows = site
    ? siteWaypoints.value
        .filter(r => r.site === site)
        .map(r => ({
          wp_number: r.slot,
          name:      r.name,
          latitude:  r.latitude,
          longitude: r.longitude
        }))
    : []
  return [...waypoints.value, ...surveyRows]
})

async function load() {
  try {
    // Fetch mission first — its started_at gates the history window
    const m = await getActiveMission()
    mission.value = m
    const since = m?.started_at ?? undefined   // undefined → api falls back to 7-day window

    const [lat, hist, bat, wps, swps] = await Promise.all([
      getLatestTelemetry(),
      getTelemetryHistory(since),
      getBatteryHistory(since),
      getWaypoints(),
      getSiteWaypoints()
    ])
    latest.value        = lat
    history.value       = hist  ?? []
    battery.value       = bat   ?? []
    waypoints.value     = wps   ?? []
    siteWaypoints.value = swps  ?? []
    error.value = null
  } catch (e) {
    error.value = e.message
  }
}

let timer = null
onMounted(() => { load(); timer = setInterval(load, 60_000) })
onUnmounted(() => clearInterval(timer))

// ── Chart datasets ──────────────────────────────────────────────────────────

function lineDs(label, data, color, fill = false) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: fill ? color.replace(')', ', 0.08)').replace('rgb', 'rgba') : 'transparent',
    fill,
    tension: 0.3,
    pointRadius: 0,
    borderWidth: 1.5,
    spanGaps: false
  }
}

// Latest battery_status row for the status card (history is ascending → last = newest)
const latestBattery = computed(() => battery.value.at(-1) ?? null)

// Rose plot data: all history points with valid speed, preserving both heading fields
const roseData = computed(() =>
  history.value
    .filter(r => r.speed_over_ground_kts != null)
    .map(r => ({
      heading:        r.heading,
      desiredBearing: r.desired_bearing,
      speed:          Number(r.speed_over_ground_kts),
      time:           new Date(r.glider_timestamp).getTime()
    }))
)

const batteryDs = computed(() => [
  lineDs('Battery (Wh)',
    battery.value.map(r => ({ x: new Date(r.timestamp), y: r.battery_wh != null ? Number(r.battery_wh) : null })),
    '#ff9800', true)
])

// Power values in DB are mW — display as W
const powerDs = computed(() => [
  lineDs('Solar',  battery.value.map(r => ({ x: new Date(r.timestamp), y: r.solar_mw  != null ? Number(r.solar_mw)  / 1000 : null })), '#fdd835'),
  lineDs('Output', battery.value.map(r => ({ x: new Date(r.timestamp), y: r.output_mw != null ? Number(r.output_mw) / 1000 : null })), '#ef5350'),
  lineDs('Charge', battery.value.map(r => ({ x: new Date(r.timestamp), y: r.charge_mw != null ? Number(r.charge_mw) / 1000 : null })), '#66bb6a')
])

const speedDs = computed(() => [
  lineDs('Speed over ground (kts)',
    history.value.map(r => ({ x: new Date(r.glider_timestamp), y: r.speed_over_ground_kts != null ? Number(r.speed_over_ground_kts) : null })),
    '#4fc3f7', true)
])

const tempDs = computed(() => [
  lineDs('Surface temp (°C)',
    history.value.map(r => ({ x: new Date(r.glider_timestamp), y: r.surface_temp_c != null ? Number(r.surface_temp_c) : null })),
    '#ab47bc', true)
])

// ── Tail selector options ───────────────────────────────────────────────────
const TAIL_OPTIONS = [
  { label: '6 h',          value: 6 },
  { label: '12 h',         value: 12 },
  { label: '24 h',         value: 24 },
  { label: '48 h',         value: 48 },
  { label: 'Whole mission', value: Infinity }
]
</script>

<template>
  <div class="app">
    <header class="header">
      <span class="header-title">Wave Glider</span>
      <span v-if="mission"      class="header-mission">{{ mission.name }}</span>
      <span v-if="currentSite"  class="header-site">{{ currentSite }}</span>
      <span v-if="latest"       class="header-vehicle">{{ latest.vehicle_name }}</span>
      <span class="staleness-dot" :class="staleness" />
    </header>

    <div v-if="error" class="error-banner" role="alert">
      Data error: {{ error }}
    </div>

    <main class="main-layout">
      <section class="map-section">
        <MapView :history="history" :waypoints="effectiveWaypoints" :latest="latest"
                 :hover-time="hoverTime" :tail-hours="tailHours" />

        <!-- Tail-length control — overlaid on the map bottom-left -->
        <div class="tail-control">
          <label class="tail-label" for="tail-select">Track tail</label>
          <select id="tail-select" v-model="tailHours" class="tail-select">
            <option v-for="opt in TAIL_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
      </section>

      <section class="panel-section">
        <StatusCard :latest="latest" :staleness="staleness" :waypoints="effectiveWaypoints"
                    :battery="latestBattery" />

        <TimeSeries title="Battery"           unit="Wh"  :datasets="batteryDs"
                    :hover-time="hoverTime" @hover="hoverTime = $event" />
        <TimeSeries title="Power flow"        unit="W"   :datasets="powerDs"   :showLegend="true"
                    :hover-time="hoverTime" @hover="hoverTime = $event" />
        <TimeSeries title="Speed over ground" unit="kts" :datasets="speedDs"   :yMin="0"
                    :hover-time="hoverTime" @hover="hoverTime = $event" />
        <RosePlot :points="roseData" :tail-hours="tailHours" />
        <TimeSeries title="Surface temp"      unit="°C"  :datasets="tempDs"
                    :hover-time="hoverTime" @hover="hoverTime = $event" />
      </section>
    </main>

    <Attribution />
  </div>
</template>

<style scoped>
/* ── New additions only — layout lives in style.css ───────────────────────── */

/* Station label in the header — e.g. "GNSSA-07" */
.header-site {
  font-size: 0.78rem;
  color: var(--ok);
  font-weight: 600;
  letter-spacing: 0.03em;
}

/* ── Tail selector — overlaid on the map ──────────────────────────────────── */
.tail-control {
  position: absolute;
  bottom: 0.55rem;
  left: 0.55rem;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  background: rgba(13, 17, 23, 0.82);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 0.25rem 0.45rem;
  backdrop-filter: blur(4px);
  z-index: 10;
}
.tail-label {
  font-size: 0.6rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}
.tail-select {
  font-size: 0.7rem;
  background: transparent;
  color: var(--text);
  border: none;
  outline: none;
  cursor: pointer;
  padding: 0;
  -webkit-appearance: none;
  appearance: none;
}
.tail-select option {
  background: #1a1f2b;
  color: var(--text);
}
</style>
