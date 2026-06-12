import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api':        'http://localhost:3000',
      '/auth':       'http://localhost:3000',
      '/logos':      'http://localhost:3000',
      '/informes':   'http://localhost:3000',
      '/version':    'http://localhost:3000',
      '/ping':       'http://localhost:3000',
      '/tigo-frame': 'http://localhost:3000',
      '/wom-frame':  'http://localhost:3000',
    }
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true
  }
})
