import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/tokens.css'
import './styles/base.css'

createApp(App).use(createPinia()).mount('#app')

// 离线优先：生产构建注册 Service Worker（脚本由 scripts/build-sw.mjs 生成）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL || '/'
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch((error) => {
      console.warn('[mindmap] Service Worker 注册失败', error)
    })
  })
}
