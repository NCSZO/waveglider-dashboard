<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { Chart } from 'chart.js'

const props = defineProps({
  title:      { type: String, required: true },
  unit:       { type: String, default: '' },
  datasets:   { type: Array,  default: () => [] },
  yMin:       { type: Number, default: undefined },
  showLegend: { type: Boolean, default: false }
})

const legendItems = computed(() =>
  props.showLegend
    ? props.datasets.map(ds => ({ label: ds.label, color: ds.borderColor }))
    : []
)

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
    options: makeOpts()
  })
})

watch(() => props.datasets, ds => {
  if (!chart) return
  chart.data.datasets = ds
  chart.update('none')
})

onUnmounted(() => chart?.destroy())
</script>

<template>
  <div class="chart-block">
    <div class="chart-header">
      <span class="chart-title">{{ title }}</span>
      <span v-if="legendItems.length" class="chart-legend">
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
.chart-area { height: 110px; position: relative; }
</style>
