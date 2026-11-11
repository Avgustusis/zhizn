import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base './' — сайт работает из любой папки, в том числе на GitHub Pages (/Zhizn/).
export default defineConfig({
  base: './',
  plugins: [react()],
  // Все карты лежат в одном файле: это нормально, предупреждение о размере выключено до ~2 МБ.
  build: { chunkSizeWarningLimit: 2000 },
})
