import { defineConfig } from 'vite'

export default defineConfig({
  base: '/weather_globe/',
  envPrefix: 'VITE_',
  server: {
    port: 3000,
    open: true
  }
})
