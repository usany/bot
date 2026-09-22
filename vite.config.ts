import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  server: {
    proxy: {
      '/opencode': {
        target: 'http://127.0.0.1:4096',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/opencode/, ''),
      },
    },
  },
})
