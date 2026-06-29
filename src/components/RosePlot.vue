<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { Chart } from 'chart.js'

const props = defineProps({
  // Each point: { heading, desiredBearing, speed (kts), time (epoch ms) }
  points:    { type: Array,  default: () => [] },
  // Matches the map "track tail" selector in App.vue — Infinity = whole mission
  tailHours: { type: Number, default: 24 }
})

const angleMode = ref('heading')  // 'heading' | 'desired'

// ── Color scale: old = red (#ef5350) → new = cyan (#4fc3f7) ─────────────────
function timeToColor(t, tMin, tMax) {
  const frac = tMax === tMin ? 1 : (t - tMin) / (tMax - tMin)
  const r = Math.round(239 + frac * (79  - 239))
  const g = Math.round(83  + frac * (195 - 83))
  const b = Math.round(80  + frac * (247 - 80))
  return `rgb(${r},${g},${b})`
}

// ── Ring interval: at most 4 rings that bracket max speed ───────────────────
function ringInterval(maxR) {
  for (const c of [0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0]) {
    if (maxR / c <= 4) return c
  }
  return 10.0
}

// ── Build two datasets from props + current angleMode ────────────────────────
// Dataset 0 — historical (before the tail window): faint, uniform dim color
// Dataset 1 — recent (within tail window): time-colored, prominent
function buildDatasets() {
  const cutoff = isFinite(props.tailHours)
    ? Date.now() - props.tailHours * 3_600_000
    : -Infinity

  const allPts = props.points.filter(p => {
    const a = angleMode.value === 'heading' ? p.heading : p.desiredBearing
    return a != null && p.speed != null
  })

  const histPts   = allPts.filter(p => p.time <  cutoff)
  const recentPts = allPts.filter(p => p.time >= cutoff)

  const maxSpeed = allPts.length ? Math.max(...allPts.map(p => p.speed)) : 1
  const interval = ringInterval(maxSpeed)
  const maxR     = Math.ceil(maxSpeed / interval) * interval || interval

  function project(p) {
    const angle = angleMode.value === 'heading' ? p.heading : p.desiredBearing
    const rad   = angle * Math.PI / 180
    return { x: p.speed * Math.sin(rad), y: p.speed * Math.cos(rad),
             _speed: p.speed, _angle: angle, _time: p.time }
  }

  const tMin = recentPts.length ? Math.min(...recentPts.map(p => p.time)) : 0
  const tMax = recentPts.length ? Math.max(...recentPts.map(p => p.time)) : 0

  return {
    histData:     histPts.map(project),
    recentData:   recentPts.map(project),
    recentColors: recentPts.map(p => timeToColor(p.time, tMin, tMax)),
    maxR
  }
}

// ── Custom plugin: polar grid drawn behind the scatter points ─────────────────
const polarGridPlugin = {
  id: 'polarGrid',
  beforeDatasetsDraw(chart) {
    const { ctx, scales } = chart
    if (!scales.x || !scales.y) return

    const cx      = scales.x.getPixelForValue(0)
    const cy      = scales.y.getPixelForValue(0)
    const pxPerKt = scales.x.getPixelForValue(1) - scales.x.getPixelForValue(0)
    const maxR    = scales.x.max
    const interval = ringInterval(maxR)

    ctx.save()

    // Concentric speed rings
    for (let r = interval; r <= maxR + 0.0001; r += interval) {
      const pr = r * pxPerKt
      ctx.beginPath()
      ctx.arc(cx, cy, pr, 0, Math.PI * 2)
      ctx.strokeStyle = '#1a1f2b'
      ctx.lineWidth   = 1
      ctx.setLineDash([])
      ctx.stroke()

      // Label at ~20° from N (NNE) to avoid spoke overlap
      const labelRad = 20 * Math.PI / 180
      const lx = cx + pr * Math.sin(labelRad)
      const ly = cy - pr * Math.cos(labelRad)
      ctx.fillStyle    = '#7d8590'
      ctx.font         = '9px sans-serif'
      ctx.textAlign    = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`${parseFloat(r.toPrecision(4))}`, lx + 1, ly - 1)
    }

    // Radial spokes + N/E/S/W labels
    const outerPx = maxR * pxPerKt
    const SPOKES  = [
      [0,   'N'], [45,  '' ], [90,  'E'], [135, '' ],
      [180, 'S'], [225, '' ], [270, 'W'], [315, '' ]
    ]
    for (const [deg, label] of SPOKES) {
      const rad = deg * Math.PI / 180
      const ex  = cx + outerPx * Math.sin(rad)
      const ey  = cy - outerPx * Math.cos(rad)

      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(ex, ey)
      ctx.strokeStyle = '#21262d'
      ctx.lineWidth   = 1
      ctx.setLineDash([2, 4])
      ctx.stroke()

      if (label) {
        const labelDist = outerPx + 14
        ctx.setLineDash([])
        ctx.fillStyle    = '#7d8590'
        ctx.font         = 'bold 10px sans-serif'
        ctx.textAlign    = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(label, cx + labelDist * Math.sin(rad), cy - labelDist * Math.cos(rad))
      }
    }

    ctx.restore()
  }
}

// ── Chart instance ────────────────────────────────────────────────────────────
const canvas = ref(null)
let chart = null

function tooltipLabel(ctx) {
  const pt   = ctx.raw
  const date = new Date(pt._time).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  })
  const modeLabel = angleMode.value === 'heading' ? 'Hdg' : 'Desired'
  return [
    ` SOG: ${pt._speed.toFixed(2)} kts  ${modeLabel}: ${pt._angle}°`,
    ` ${date}`
  ]
}

function makeOpts(maxR) {
  return {
    responsive:          true,
    maintainAspectRatio: true,
    aspectRatio:         1,
    animation:           false,
    layout: { padding: 20 },
    scales: {
      x: { display: false, min: -maxR, max: maxR },
      y: { display: false, min: -maxR, max: maxR }
    },
    plugins: {
      legend:  { display: false },
      tooltip: {
        backgroundColor: '#1a1f2b',
        borderColor:     '#21262d',
        borderWidth:     1,
        titleColor:      '#e6edf3',
        bodyColor:       '#a0aab8',
        callbacks: { title: () => '', label: tooltipLabel }
      }
    }
  }
}

onMounted(() => {
  const { histData, recentData, recentColors, maxR } = buildDatasets()
  chart = new Chart(canvas.value, {
    type: 'scatter',
    data: {
      datasets: [
        {
          // historical background — faint, small
          data:                 histData,
          pointBackgroundColor: 'rgba(120, 130, 148, 0.22)',
          pointBorderColor:     'transparent',
          pointRadius:          2,
          pointHoverRadius:     4
        },
        {
          // recent tail — time-colored, prominent
          data:                 recentData,
          pointBackgroundColor: recentColors,
          pointBorderColor:     'transparent',
          pointRadius:          3.5,
          pointHoverRadius:     5
        }
      ]
    },
    options:  makeOpts(maxR),
    plugins:  [polarGridPlugin]
  })
})

watch([() => props.points, () => props.tailHours, angleMode], () => {
  if (!chart) return
  const { histData, recentData, recentColors, maxR } = buildDatasets()
  chart.data.datasets[0].data                 = histData
  chart.data.datasets[1].data                 = recentData
  chart.data.datasets[1].pointBackgroundColor = recentColors
  chart.options.scales.x.min = -maxR
  chart.options.scales.x.max =  maxR
  chart.options.scales.y.min = -maxR
  chart.options.scales.y.max =  maxR
  chart.update('none')
})

onUnmounted(() => chart?.destroy())
</script>

<template>
  <div class="rose-block">
    <div class="rose-header">
      <span class="rose-title">Speed vs Heading</span>
      <div class="mode-toggle">
        <button :class="['mode-btn', { active: angleMode === 'heading' }]" @click="angleMode = 'heading'">Actual</button>
        <button :class="['mode-btn', { active: angleMode === 'desired' }]" @click="angleMode = 'desired'">Desired</button>
      </div>
    </div>

    <!-- canvas is always in the DOM so Chart.js can initialise on mount;
         "no data" floats as an overlay until points arrive -->
    <div class="rose-area">
      <canvas ref="canvas"></canvas>
      <div v-if="!points.length" class="rose-empty">No data</div>
    </div>

    <div class="time-legend">
      <span class="tl-label">{{ isFinite(tailHours) ? tailHours + ' h ago' : 'mission start' }}</span>
      <div class="tl-bar"></div>
      <span class="tl-label">now</span>
    </div>
  </div>
</template>

<style scoped>
.rose-block {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.rose-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.rose-title {
  font-size: 0.65rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  flex-shrink: 0;
}

/* ── Actual / Desired toggle ─────────────────────────────────── */
.mode-toggle { display: flex; gap: 0.2rem; }
.mode-btn {
  font-size: 0.6rem;
  padding: 0.1rem 0.45rem;
  border-radius: 3px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  letter-spacing: 0.03em;
  line-height: 1.4;
}
.mode-btn.active       { background: var(--border); color: var(--text); }
.mode-btn:hover:not(.active) { border-color: var(--text-muted); }

/* ── Chart area — Chart.js sizes itself at aspectRatio 1:1 ───── */
.rose-area {
  width: 100%;
  max-width: 260px;
  margin: 0 auto;
  position: relative;
}

/* "No data" floats over the canvas (canvas always in DOM) */
.rose-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  color: var(--text-muted);
  pointer-events: none;
}

/* ── Time-color legend ───────────────────────────────────────── */
.time-legend {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  max-width: 260px;
  margin: 0 auto;
  width: 100%;
  padding: 0 2px;
  box-sizing: border-box;
}
.tl-label {
  font-size: 0.58rem;
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}
.tl-bar {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: linear-gradient(to right, rgb(239,83,80), rgb(79,195,247));
  min-width: 20px;
}
</style>
