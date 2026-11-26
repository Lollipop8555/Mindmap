import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { LayoutMode } from '@/mindmap/model'
import { NODE_STYLE_IDS, type NodeStyleId } from '@/mindmap/theme/styles'

type ThemeMode = 'light' | 'dark' | 'auto'

const KEY = 'mindmap.settings.v1'

interface Persisted {
  theme: ThemeMode
  layout: LayoutMode
  /** 节点样式：卡片 / 藤蔓 / 逐层弱化 */
  nodeStyle: NodeStyleId
  sidebarCollapsed: boolean
  exportScale: number
  exportBackground: 'paper' | 'white' | 'transparent'
  /** 导出配色；null = 跟着当前主题走 */
  exportTheme: 'light' | 'dark' | null
  lastDocId: string | null
}

/** 旧数据没有这个字段；非法值（手改 localStorage）也回退到卡片 */
function readNodeStyle(value: unknown): NodeStyleId {
  return NODE_STYLE_IDS.includes(value as NodeStyleId) ? (value as NodeStyleId) : 'card'
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
  const nodeStyle = ref<NodeStyleId>(readNodeStyle(saved.nodeStyle))
  const sidebarCollapsed = ref(saved.sidebarCollapsed ?? false)
  const exportScale = ref(saved.exportScale ?? 2)
  const exportBackground = ref<Persisted['exportBackground']>(saved.exportBackground ?? 'paper')
  const exportTheme = ref<Persisted['exportTheme']>(saved.exportTheme ?? null)
  const lastDocId = ref<string | null>(saved.lastDocId ?? null)

  function persist() {
    const payload: Persisted = {
      theme: theme.value,
      layout: layout.value,
      nodeStyle: nodeStyle.value,
      sidebarCollapsed: sidebarCollapsed.value,
      exportScale: exportScale.value,
      exportBackground: exportBackground.value,
      exportTheme: exportTheme.value,
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
  watch(
    [layout, nodeStyle, sidebarCollapsed, exportScale, exportBackground, exportTheme, lastDocId],
    persist,
  )

  return {
    theme,
    resolvedTheme,
    layout,
    nodeStyle,
    sidebarCollapsed,
    exportScale,
    exportBackground,
    exportTheme,
    lastDocId,
    applyTheme,
  }
})
