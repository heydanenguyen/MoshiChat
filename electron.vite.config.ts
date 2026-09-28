import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    // A GIF library key baked into the build (CI secret MOSHI_GIF_KEY), so GIFs work without setup.
    // Users can still paste their own key in Settings; that one wins.
    define: {
      __MOSHI_GIF_KEY__: JSON.stringify(process.env.MOSHI_GIF_KEY ?? ''),
      __MOSHI_GIF_PROVIDER__: JSON.stringify(process.env.MOSHI_GIF_PROVIDER === 'giphy' ? 'giphy' : 'klipy')
    },
    build: {
      rollupOptions: {
        // The on-device AI runs in its own utility process (src/main/ai/worker.ts -> out/main/ai-worker.js).
        input: { index: resolve('src/main/index.ts'), 'ai-worker': resolve('src/main/ai/worker.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: { '@shared': resolve('src/shared'), '@': resolve('src/renderer/src') } }
  }
})
