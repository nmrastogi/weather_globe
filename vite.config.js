import { defineConfig } from 'vite'

export default defineConfig({
  envPrefix: 'VITE_',
  server: {
    port: 3000,
    open: true
  }
})
