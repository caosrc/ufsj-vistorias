import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) return 'react-vendor'
          if (id.includes('node_modules/three')) return 'three-vendor'
          if (id.includes('node_modules/chart.js') || id.includes('node_modules/react-chartjs-2')) return 'chart-vendor'
          if (id.includes('node_modules/leaflet')) return 'map-vendor'
          if (id.includes('node_modules/@turf')) return 'turf-vendor'
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      }
    }
  }
})
