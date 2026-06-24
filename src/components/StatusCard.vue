<script setup>
import { computed } from 'vue'
import { haversineMeters, etaSeconds, formatDuration } from '../lib/geo.js'

const props = defineProps({
  latest:    { type: Object, default: null },
  staleness: { type: String, default: 'unknown' },
  waypoints: { type: Array,  default: () => [] }
})

const ALARM_LABELS = [
  ['sub_leak_alarm',           'Sub Leak'],
  ['float_leak_alarm',         'Float Leak'],
  ['float_battery_low_alarm',  'Battery Low'],
  ['umbilical_fault_alarm',    'Umbilical Fault'],
  ['sub_pressure_alarm',       'Sub Pressure'],
  ['gps_fault',                'GPS Fault'],
  ['internal_comms_error',     'Internal Comms'],
  ['sub_reboot_alarm',         'Sub Reboot'],
  ['float_comms_error',        'Float Comms'],
  ['over_current_error',       'Over Current'],
  ['float_temp_alarm',         'Float Temp'],
  ['float_pressure_alarm',     'Float Pressure'],
  ['sub_temp_alarm',           'Sub Temp'],
  ['float_reboot_alarm',       'Float Reboot'],
  ['payload_error_alarm',      'Payload Error'],
  ['sub_to_float_comms_alarm', 'Sub↔Float Comms'],
]

const activeAlarms = computed(() => {
  if (!props.latest) return []
  return ALARM_LABELS.filter(([key]) => props.latest[key])
})

const targetWp = computed(() => {
  const wpNum = props.latest?.target_waypoint
  if (wpNum == null || !props.waypoints.length) return null
  return props.waypoints.find(w => w.wp_number === wpNum) ?? null
})

const distToWp = computed(() =>
  props.latest && targetWp.value
    ? haversineMeters(props.latest, targetWp.value)
    : null
)

const eta = computed(() =>
  distToWp.value != null
    ? etaSeconds(distToWp.value, props.latest?.speed_over_ground_kts)
    : null
)

function ageLabel(row) {
  if (!row) return '—'
  const m = Math.floor((Date.now() - new Date(row.glider_timestamp).getTime()) / 60_000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m ago`
}

function fmtLat(v) {
  if (v == null) return '—'
  const n = Number(v)
  return `${Math.abs(n).toFixed(5)}° ${n >= 0 ? 'N' : 'S'}`
}
function fmtLng(v) {
  if (v == null) return '—'
  const n = Number(v)
  return `${Math.abs(n).toFixed(5)}° ${n >= 0 ? 'E' : 'W'}`
}
function fmtNum(v, dp = 2) {
  return v != null ? Number(v).toFixed(dp) : '—'
}
</script>

<template>
  <div class="card">
    <!-- last update + staleness -->
    <div class="row-between">
      <span class="label">Last update</span>
      <span class="freshness" :class="staleness">{{ ageLabel(latest) }}</span>
    </div>

    <template v-if="latest">
      <!-- position + navigation grid -->
      <div class="grid2">
        <div><div class="label">Lat</div><div class="val">{{ fmtLat(latest.latitude) }}</div></div>
        <div><div class="label">Lng</div><div class="val">{{ fmtLng(latest.longitude) }}</div></div>
        <div><div class="label">Heading</div><div class="val">{{ latest.heading ?? '—' }}°</div></div>
        <div><div class="label">Speed (SOG)</div><div class="val">{{ fmtNum(latest.speed_over_ground_kts) }} kts</div></div>
      </div>

      <!-- distance + ETA -->
      <div v-if="targetWp" class="wp-row">
        <span class="label">→ WP {{ targetWp.wp_number }} <em>{{ targetWp.name }}</em></span>
        <span class="val">
          {{ distToWp != null ? (distToWp / 1000).toFixed(1) + ' km' : '—' }}
          <span v-if="eta != null" class="muted"> · {{ formatDuration(eta) }}</span>
        </span>
      </div>

      <!-- alarms -->
      <div v-if="activeAlarms.length" class="alarms">
        <span v-for="[, label] in activeAlarms" :key="label" class="alarm-chip">{{ label }}</span>
      </div>
      <div v-else class="all-clear">✓ No alarms</div>
    </template>

    <div v-else class="loading">Loading…</div>
  </div>
</template>

<style scoped>
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 0.65rem 0.8rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.row-between { display: flex; justify-content: space-between; align-items: center; }
.label { font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.val   { font-size: 0.88rem; font-variant-numeric: tabular-nums; }
.muted { color: var(--text-muted); }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem 0.9rem; }
.wp-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.82rem;
  flex-wrap: wrap;
}
.wp-row em { font-style: normal; color: var(--text-muted); }

.freshness { font-size: 0.82rem; font-variant-numeric: tabular-nums; }
.freshness.fresh    { color: var(--ok); }
.freshness.stale    { color: var(--warn); }
.freshness.critical { color: var(--danger); }
.freshness.unknown  { color: var(--text-muted); }

.alarms { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.alarm-chip {
  background: var(--danger);
  color: #fff;
  font-size: 0.65rem;
  font-weight: 700;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  letter-spacing: 0.03em;
}
.all-clear { font-size: 0.78rem; color: var(--ok); }
.loading   { font-size: 0.8rem; color: var(--text-muted); }
</style>
