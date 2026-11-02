import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react()],
  build: {
    // The SSR build (src/prerender.tsx -> dist-ssr/) is only used by
    // scripts/prerender.ts at build time; it doesn't need /public copied in.
    copyPublicDir: !isSsrBuild,
    // dist/.vite/manifest.json maps each page's source to its chunk, so
    // scripts/prerender.ts can add a modulepreload for the page's code to its
    // HTML (src/store/lib/lazyPage.tsx). The script deletes it afterwards.
    manifest: !isSsrBuild,
  },
}))
