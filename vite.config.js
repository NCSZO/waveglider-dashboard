import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const geojson = {
  name: 'geojson',
  transform(code, id) {
    if (id.endsWith('.geojson')) return { code: `export default ${code}`, map: null }
  }
}

export default defineConfig({
  plugins: [vue(), geojson],
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre:  ['maplibre-gl'],
          chartjs:   ['chart.js', 'chartjs-adapter-date-fns', 'date-fns'],
          supabase:  ['@supabase/supabase-js']
        }
      }
    }
  }
})
