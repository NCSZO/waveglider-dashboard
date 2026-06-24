<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { Chart } from 'chart.js'

const props = defineProps({
  title:      { type: String,  required: true },
  unit:       { type: String,  default: '' },
  datasets:   { type: Array,   default: () => [] },
  yMin:       { type: Number,  default: undefined },
  showLegend: { type: Boolean, default: false },
  hoverTime:  { type: Number,  default: null }   // epoch ms from parent, or null
})

const emit = defineEmits(['hover'])

const legendItems = computed(() =>
  props.showLegend
    ? props.datasets.map(ds => ({ label: ds.label, color: ds.borderColor }))
    : []
)

// ── Nearest-by-time helper ───────────────────────────────────────────────
// data: [{x: Date, y: number|null}] sorted ascending.
// Returns the nearest point within tolerance, or null.
const TOLERANCE_MS = 20 * 60_000   // 20 min — ~4 report intervals

function nearestByTime(data, t) {
  if (!data || data.length === 0) return null
  let lo = 0, hi = data.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (+data[mid].x < t) lo = mid + 1
    else hi = mid
  }
  // lo is the first index >= t; also check lo-1
  const candidates = [lo > 0 ? lo - 1 : null, lo < data.length ? lo : null]
  let best = null, bestDist = Infinity
  for (const idx of candidates) {
    if (idx == null) continue
    const d = Math.abs(+data[idx].x - t)
    if (d < bestDist) { bestDist = d; best = data[idx] }
  }
  return bestDist <= TOLERANCE_MS ? best : null
}

// ── Synced value readout (displayed in the chart header) ────────────────
const hoverReadout = computed(() => {
  if (props.hoverTime == null) return null
  return props.datasets.map(ds => {
    const pt = nearestByTime(ds.data, props.hoverTime)
    const y  = pt?.y
    return {
      label: ds.label,
      color: ds.borderColor,
      text:  y != null ? `${y.toFixed(2)} ${props.unit}` : '—'
    }
  })
})

// ── Chart.js plugins ─────────────────────────────────────────────────────
// 1. Hover emitter — fires on pointer move/out over this chart's canvas
const hoverEmitPlugin = {
  id: 'hoverEmit',
  afterEvent(chart, args) {
    const e = args.event
    if (e.type === 'mousemove' || e.type === 'pointermove') {
      const t = chart.scales.x?.getValueForPixel(e.x)
      if (t != null) emit('hover', t)
    } else if (e.type === 'mouseout' || e.type === 'pointerout') {
      emit('hover', null)
    }
  }
}

// 2. Guide-line painter — reacts to the incoming hoverTime prop
const guideLinePlugin = {
  id: 'guideLine',
  afterDatasetsDraw(chart) {
    const t = props.hoverTime
    if (t == null) return
    const { ctx, chartArea, scales } = chart
    const x = scales.x?.getPixelForValue(t)
    if (x == null || x < chartArea.left || x > chartArea.right) return

    ctx.save()

    // Vertical dashed guide line
    ctx.beginPath()
    ctx.setLineDash([3, 4])
    ctx.lineWidth   = 1
    ctx.strokeStyle = '#7d8590'
    ctx.moveTo(x, chartArea.top)
    ctx.lineTo(x, chartArea.bottom)
    ctx.stroke()

    // Dot on each dataset's nearest point
    for (const ds of chart.data.datasets) {
      const pt = nearestByTime(ds.data, t)
      if (pt == null || pt.y == null) continue
      const py = scales.y?.getPixelForValue(pt.y)
      if (py == null || py < chartArea.top || py > chartArea.bottom) continue
      ctx.beginPath()
      ctx.setLineDash([])
      ctx.arc(x, py, 3.5, 0, Math.PI * 2)
      ctx.fillStyle   = ds.borderColor ?? '#4fc3f7'
      ctx.strokeStyle = '#0d1117'
      ctx.lineWidth   = 1.5
      ctx.fill()
      ctx.stroke()
    }

    ctx.restore()
  }
}

const canvas = ref(null)
let chart = null

function makeOpts() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      x: {
        type: 'time',
        time: { displayFormats: { hour: 'MMM d HH:mm', day: 'MMM d' } },
        ticks: { color: '#7d8590', maxTicksLimit: 5 },
        grid: { color: '#1a1f2b' }
      },
      y: {
        ...(props.yMin !== undefined ? { min: props.yMin } : {}),
        ticks: {
          color: '#7d8590',
          callback: v => `${v} ${props.unit}`
        },
        grid: { color: '#1a1f2b' }
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        // Native tooltip still shows on the hovered chart; suppress it when
        // we have an incoming hover from another chart so only our guide draws.
        enabled: true,
        mode: 'index',
        intersect: false,
        backgroundColor: '#1a1f2b',
        borderColor: '#21262d',
        borderWidth: 1,
        titleColor: '#e6edf3',
        bodyColor: '#a0aab8',
        callbacks: {
          label: ctx => {
            const y = ctx.parsed.y
            return ` ${ctx.dataset.label}: ${y != null ? y.toFixed(2) : '—'} ${props.unit}`
          }
        }
      }
    }
  }
}

onMounted(() => {
  chart = new Chart(canvas.value, {
    type: 'line',
    data: { datasets: props.datasets },
    options: makeOpts(),
    plugins: [hoverEmitPlugin, guideLinePlugin]
  })
})

watch(() => props.datasets, ds => {
  if (!chart) return
  chart.data.datasets = ds
  chart.update('none')
})

// Redraw when the incoming hover changes (other charts broadcasting)
watch(() => props.hoverTime, () => {
  chart?.update('none')
})

onUnmounted(() => chart?.destroy())
</script>

<template>
  <div class="chart-block">
    <div class="chart-header">
      <span class="chart-title">{{ title }}</span>

      <!-- Hover readout: per-dataset value at hovered time -->
      <span v-if="hoverReadout" class="chart-readout">
        <span v-for="item in hoverReadout" :key="item.label" class="readout-item">
          <span class="readout-swatch" :style="{ background: item.color }" />
          {{ item.text }}
        </span>
      </span>

      <!-- Normal legend (when not hovering) -->
      <span v-else-if="legendItems.length" class="chart-legend">
        <span v-for="item in legendItems" :key="item.label" class="legend-item">
          <span class="legend-swatch" :style="{ background: item.color }" />
          {{ item.label }}
        </span>
      </span>
    </div>
    <div class="chart-area">
      <canvas ref="canvas" />
    </div>
  </div>
</template>

<style scoped>
.chart-block { display: flex; flex-direction: column; gap: 0.2rem; }
.chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.chart-title {
  font-size: 0.65rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  flex-shrink: 0;
}
.chart-legend {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.6rem;
  color: var(--text-muted);
}
.legend-swatch {
  width: 16px;
  height: 2px;
  border-radius: 1px;
  flex-shrink: 0;
}

/* Hover readout — same layout as legend but more prominent */
.chart-readout {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.readout-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.65rem;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.readout-swatch {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.chart-area { height: 110px; position: relative; }
</style>
