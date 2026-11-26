import { env } from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// base 与 service worker 的 scope 必须一致；HashRouter 保证刷新不 404。
// 部署到 Project Pages 时用 BASE_PATH 覆盖（CI 里按仓库名注入）。
export default defineConfig({
  base: env.BASE_PATH || '/Mindmap/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@markmap/core': fileURLToPath(new URL('./packages/markmap/src/core/index.ts', import.meta.url)),
      '@markmap/render': fileURLToPath(
        new URL('./packages/markmap/src/render/index.ts', import.meta.url),
      ),
      '@markmap/view': fileURLToPath(new URL('./packages/markmap/src/view/index.ts', import.meta.url)),
      '@markmap': fileURLToPath(new URL('./packages/markmap/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('packages/markmap')) return 'engine'
          if (id.includes('@vue') || id.includes('/vue/')) return 'vue'
          if (id.includes('remark') || id.includes('unified') || id.includes('micromark')) return 'markdown'
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
})
