import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { LayoutMode } from '@/mindmap/model'

type ThemeMode = 'light' | 'dark' | 'auto'

const KEY = 'mindmap.settings.v1'

interface Persisted {
  theme: ThemeMode
  layout: LayoutMode
  sidebarCollapsed: boolean
  exportScale: number
  exportBackground: 'paper' | 'white' | 'transparent'
  lastDocId: string | null
}

function read(): Partial<Persisted> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Persisted>
  } catch {
    return {}
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const saved = read()

  const theme = ref<ThemeMode>(saved.theme ?? 'auto')
  const layout = ref<LayoutMode>(saved.layout ?? 'two-sided')
  const sidebarCollapsed = ref(saved.sidebarCollapsed ?? false)
  const exportScale = ref(saved.exportScale ?? 2)
  const exportBackground = ref<Persisted['exportBackground']>(saved.exportBackground ?? 'paper')
  const lastDocId = ref<string | null>(saved.lastDocId ?? null)

  function persist() {
    const payload: Persisted = {
      theme: theme.value,
      layout: layout.value,
      sidebarCollapsed: sidebarCollapsed.value,
      exportScale: exportScale.value,
      exportBackground: exportBackground.value,
      lastDocId: lastDocId.value,
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(payload))
    } catch {
      /* 隐私模式下忽略 */
    }
  }

  let media: MediaQueryList | null = null
  const resolvedTheme = ref<'light' | 'dark'>('light')

  function applyTheme() {
    const prefersDark = media?.matches ?? false
    const value = theme.value === 'auto' ? (prefersDark ? 'dark' : 'light') : theme.value
    resolvedTheme.value = value
    document.documentElement.dataset.theme = value
  }

  if (typeof window !== 'undefined') {
    media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', applyTheme)
    applyTheme()
  }

  watch(theme, () => {
    applyTheme()
    persist()
  })
  watch([layout, sidebarCollapsed, exportScale, exportBackground, lastDocId], persist)

  return {
    theme,
    resolvedTheme,
    layout,
    sidebarCollapsed,
    exportScale,
    exportBackground,
    lastDocId,
    applyTheme,
  }
})
