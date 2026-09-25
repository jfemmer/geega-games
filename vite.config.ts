import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react()],
  build: {
    // The SSR build (src/prerender.tsx -> dist-ssr/) is only used by
    // scripts/prerender.ts at build time; it doesn't need /public copied in.
    copyPublicDir: !isSsrBuild,
  },
}))
