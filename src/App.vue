<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getLatestTelemetry, getTelemetryHistory, getBatteryHistory, getWaypoints, getActiveMission } from './lib/api.js'
import MapView     from './components/MapView.vue'
import StatusCard  from './components/StatusCard.vue'
import TimeSeries  from './components/TimeSeries.vue'
import Attribution from './components/Attribution.vue'

const latest    = ref(null)
const history   = ref([])
const battery   = ref([])
const waypoints = ref([])
const mission   = ref(null)
const error     = ref(null)
const hoverTime = ref(null)   // epoch ms shared across all charts + map; null when no hover

const STALE_MS = 15 * 60_000

const staleness = computed(() => {
  if (!latest.value) return 'unknown'
  const age = Date.now() - new Date(latest.value.glider_timestamp).getTime()
  if (age > 3 * STALE_MS) return 'critical'
  if (age > STALE_MS)     return 'stale'
  return 'fresh'
})

async function load() {
  try {
    // Fetch mission first — its started_at gates the history window
    const m = await getActiveMission()
    mission.value = m
    const since = m?.started_at ?? undefined   // undefined → api falls back to 7-day window

    const [lat, hist, bat, wps] = await Promise.all([
      getLatestTelemetry(),
      getTelemetryHistory(since),
      getBatteryHistory(since),
      getWaypoints()
    ])
    latest.value    = lat
    history.value   = hist ?? []
    battery.value   = bat  ?? []
    waypoints.value = wps  ?? []
    error.value   = null
  } catch (e) {
    error.value = e.message
  }
}

let timer = null
onMounted(() => { load(); timer = setInterval(load, 60_000) })
onUnmounted(() => clearInterval(timer))

// ── Chart datasets ──────────────────────────────────────────────────────

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
</script>

<template>
  <div class="app">
    <header class="header">
      <span class="header-title">Wave Glider</span>
      <span v-if="mission" class="header-mission">{{ mission.name }}</span>
      <span v-if="latest"  class="header-vehicle">{{ latest.vehicle_name }}</span>
      <span class="staleness-dot" :class="staleness" />
    </header>

    <div v-if="error" class="error-banner" role="alert">
      Data error: {{ error }}
    </div>

    <main class="main-layout">
      <section class="map-section">
        <MapView :history="history" :waypoints="waypoints" :latest="latest"
                 :hover-time="hoverTime" />
      </section>

      <section class="panel-section">
        <StatusCard :latest="latest" :staleness="staleness" :waypoints="waypoints" />

        <TimeSeries title="Battery"           unit="Wh"  :datasets="batteryDs"
                    :hover-time="hoverTime" @hover="hoverTime = $event" />
        <TimeSeries title="Power flow"        unit="W"   :datasets="powerDs"   :showLegend="true"
                    :hover-time="hoverTime" @hover="hoverTime = $event" />
        <TimeSeries title="Speed over ground" unit="kts" :datasets="speedDs"   :yMin="0"
                    :hover-time="hoverTime" @hover="hoverTime = $event" />
        <TimeSeries title="Surface temp"      unit="°C"  :datasets="tempDs"
                    :hover-time="hoverTime" @hover="hoverTime = $event" />
      </section>
    </main>

    <Attribution />
  </div>
</template>
