<script setup lang="ts">
import { computed, ref } from 'vue'
import { Download, FileDown, Info, Trash2, Upload, X } from 'lucide-vue-next'
import { docStore } from '@/db/docs'
import { useDocumentStore } from '@/stores/document'
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore } from '@/stores/settings'
import { useViewStore } from '@/stores/view'

const docs = useDocumentStore()
const library = useLibraryStore()
const settings = useSettingsStore()
const view = useViewStore()

const busy = ref(false)

const themeOptions = [
  { key: 'auto', label: '跟随系统' },
  { key: 'light', label: '浅色' },
  { key: 'dark', label: '深色' },
] as const

const layoutOptions = [
  { key: 'two-sided', label: '左右平衡' },
  { key: 'tree', label: '单侧生长' },
] as const

const backgroundOptions = [
  { key: 'paper', label: '纸色' },
  { key: 'white', label: '纯白' },
  { key: 'transparent', label: '透明' },
] as const

const storage = computed(() => {
  const total = library.docs.length
  const nodes = library.docs.reduce((sum, doc) => sum + doc.nodeCount, 0)
  return { total, nodes }
})

function close() {
  view.settingsOpen = false
}

function download(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function exportAll() {
  busy.value = true
  try {
    await docs.flush()
    const text = await library.exportAllText()
    download(text, `mindmap-backup-${new Date().toISOString().slice(0, 10)}.md`)
    view.toast('整库备份已导出', { timeout: 6000 })
  } finally {
    busy.value = false
  }
}

async function clearTrash() {
  if (!library.trash.length) return
  if (!window.confirm(`彻底删除回收站中的 ${library.trash.length} 份导图？`)) return
  await library.purgeAll()
  view.toast('回收站已清空')
}

async function clearAll() {
  const ok = window.confirm('删除本机所有导图？建议先导出整库备份。此操作不可撤销。')
  if (!ok) return
  busy.value = true
  try {
    await docStore.purgeAll()
    docs.close()
    await library.refresh()
    view.toast('已清空本机数据')
    close()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="mm-scrim settings-scrim" @click.self="close">
    <aside class="mm-drawer" role="dialog" aria-modal="true" aria-label="设置">
      <header class="set-head">
        <h2>设置</h2>
        <button class="mm-icon-btn" type="button" title="关闭" @click="close">
          <X :size="17" />
        </button>
      </header>

      <section class="set-group">
        <h3>外观</h3>
        <div class="set-row">
          <span>主题</span>
          <div class="seg">
            <button
              v-for="item in themeOptions"
              :key="item.key"
              type="button"
              :data-active="String(settings.theme === item.key)"
              @click="settings.theme = item.key"
            >
              {{ item.label }}
            </button>
          </div>
        </div>
        <div class="set-row">
          <span>布局</span>
          <div class="seg">
            <button
              v-for="item in layoutOptions"
              :key="item.key"
              type="button"
              :data-active="String(settings.layout === item.key)"
              @click="settings.layout = item.key"
            >
              {{ item.label }}
            </button>
          </div>
        </div>
      </section>

      <section class="set-group">
        <h3>导出默认值</h3>
        <div class="set-row">
          <span>清晰度</span>
          <div class="seg">
            <button
              v-for="value in [1, 2, 3]"
              :key="value"
              type="button"
              :data-active="String(settings.exportScale === value)"
              @click="settings.exportScale = value"
            >
              {{ value }}x
            </button>
          </div>
        </div>
        <div class="set-row">
          <span>背景</span>
          <div class="seg">
            <button
              v-for="item in backgroundOptions"
              :key="item.key"
              type="button"
              :data-active="String(settings.exportBackground === item.key)"
              @click="settings.exportBackground = item.key"
            >
              {{ item.label }}
            </button>
          </div>
        </div>
        <p class="set-hint">PNG 会先等待字体就绪再渲染，中文不会缺字。</p>
      </section>

      <section class="set-group">
        <h3>数据</h3>
        <p class="set-hint">
          本机共 {{ storage.total }} 份导图、{{ storage.nodes }} 个节点。数据只存在这个浏览器里，
          markdown 是交换格式，不是备份格式。
        </p>
        <div class="set-actions">
          <button class="mm-btn" type="button" @click="view.importOpen = true">
            <Upload :size="15" /> 导入 Markdown
          </button>
          <button class="mm-btn" type="button" :disabled="busy" @click="exportAll">
            <FileDown :size="15" /> 导出整库
          </button>
          <button class="mm-btn" type="button" :disabled="!library.trash.length" @click="clearTrash">
            <Trash2 :size="15" /> 清空回收站
          </button>
          <button class="mm-btn mm-btn--danger" type="button" :disabled="busy" @click="clearAll">
            <Download :size="15" /> 清空本机数据
          </button>
        </div>
        <p class="set-hint set-hint--warn">
          iOS 把网页加到主屏后，系统可能在存储紧张时清理站点数据。请在换设备前主动导出整库备份。
        </p>
      </section>

      <section class="set-group">
        <h3>关于</h3>
        <div class="set-row set-about">
          <Info :size="15" />
          <span>Mindmap 0.1.0 · 离线优先 · 纯本地存储</span>
        </div>
        <button class="mm-btn" type="button" @click="view.helpOpen = true">快捷键与富内联语法</button>
      </section>
    </aside>
  </div>
</template>

<style scoped>
.settings-scrim {
  display: block;
  padding: 0;
}

.set-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.set-head h2 {
  margin: 0;
  font-size: 16px;
}

.set-group {
  padding: 14px 0;
  border-top: 1px solid var(--mm-line);
}

.set-group h3 {
  margin: 0 0 10px;
  color: var(--mm-text-soft);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.set-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 8px 0;
  color: var(--mm-text);
  font-size: 13px;
}

.seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--mm-r-sm);
  background: var(--mm-panel-soft);
}

.seg button {
  padding: 5px 10px;
  border-radius: 6px;
  color: var(--mm-text-soft);
  font-size: 12px;
  white-space: nowrap;
}

.seg button[data-active='true'] {
  background: var(--mm-panel);
  color: var(--mm-text);
  box-shadow: var(--mm-shadow);
}

.set-hint {
  margin: 6px 0;
  color: var(--mm-text-faint);
  font-size: 12px;
  line-height: 1.7;
}

.set-hint--warn {
  color: color-mix(in srgb, var(--mm-warn) 65%, var(--mm-text));
}

.set-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0;
}

.set-actions .mm-btn {
  border: 1px solid var(--mm-line);
  font-size: 13px;
}

.set-about {
  justify-content: flex-start;
  color: var(--mm-text-faint);
}
</style>
