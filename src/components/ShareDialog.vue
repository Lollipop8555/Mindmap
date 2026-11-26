<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Copy, Download, Image, Share2, X } from 'lucide-vue-next'
import type { MindmapController } from '@/mindmap/engine/controller'
import { createMonetTheme } from '@/mindmap/theme/monet'
import { useDocumentStore } from '@/stores/document'
import { useSettingsStore } from '@/stores/settings'
import { useViewStore } from '@/stores/view'

const props = defineProps<{ controller: MindmapController | null }>()

const docs = useDocumentStore()
const settings = useSettingsStore()
const view = useViewStore()

const format = ref<'png' | 'svg'>('png')
const scale = ref(settings.exportScale)
const background = ref(settings.exportBackground)
/** 导出配色是显式选择，默认跟当前视图一致，改过之后记住 */
const scheme = ref<'light' | 'dark'>(settings.exportTheme ?? settings.resolvedTheme)
const expandAll = ref(false)
const busy = ref(false)
const result = ref<string | null>(null)

const ready = computed(() => Boolean(props.controller?.ready))
const title = computed(() => docs.doc?.title || '未命名导图')

const PAPER = {
  light: createMonetTheme('light').chrome.paper,
  dark: createMonetTheme('dark').chrome.paper,
} as const
const paperOf = (value: 'light' | 'dark') => PAPER[value]
/** 「纸色」在不同配色下是两个颜色，按钮上给个色点预览 */
const paperFill = computed(() => paperOf(scheme.value))

watch(scheme, (value) => {
  settings.exportTheme = value
  result.value = null
})

/** 背景选择 → 引擎要的真实填充色（'paper' 由引擎按配色解析，这里给色值更直白） */
function backgroundPaint(): boolean | string {
  if (background.value === 'transparent') return false
  if (background.value === 'white') return '#ffffff'
  return paperFill.value
}

function filename(ext: string): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `${title.value}-${stamp}.${ext}`
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

async function shareOrDownload(blob: Blob, name: string) {
  const file = new File([blob], name, { type: blob.type })
  const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean }
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: title.value })
      return
    } catch {
      /* 用户取消 → 回退到下载 */
    }
  }
  download(blob, name)
}

async function exportImage() {
  if (!props.controller || !ready.value) return
  busy.value = true
  result.value = null
  try {
    await docs.flush()
    const opts = {
      scale: scale.value,
      background: backgroundPaint(),
      colorScheme: scheme.value,
      foldAll: !expandAll.value,
    } as const
    if (format.value === 'svg') {
      const svg = props.controller.toSVG(opts)
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
      await shareOrDownload(blob, filename('svg'))
      result.value = 'SVG 已生成'
    } else {
      await (document as unknown as { fonts?: FontFaceSet }).fonts?.ready
      const blob = await props.controller.toPNG(opts)
      await shareOrDownload(blob, filename('png'))
      result.value = 'PNG 已生成'
    }
  } catch (error) {
    console.error(error)
    view.toast('导出失败，请重试')
  } finally {
    busy.value = false
  }
}

async function copyImage() {
  if (!props.controller || !ready.value) return
  busy.value = true
  try {
    const blob = await props.controller.toPNG({
      scale: scale.value,
      background: backgroundPaint(),
      colorScheme: scheme.value,
      foldAll: !expandAll.value,
    })
    const item = new ClipboardItem({ 'image/png': blob })
    await navigator.clipboard.write([item])
    view.toast('已复制到剪贴板')
  } catch {
    view.toast('当前浏览器不支持复制图片')
  } finally {
    busy.value = false
  }
}

function close() {
  view.shareOpen = false
}
</script>

<template>
  <div class="mm-scrim" @click.self="close">
    <div class="mm-dialog" role="dialog" aria-modal="true" aria-label="分享导图">
      <header class="dlg-head">
        <h2>分享</h2>
        <button class="mm-icon-btn" type="button" title="关闭" @click="close">
          <X :size="17" />
        </button>
      </header>

      <p v-if="!ready" class="dlg-note">
        渲染引擎尚未接入，导出能力会在 <code>vendor/markmap</code> 落地后启用。
      </p>

      <div class="dlg-field">
        <span class="dlg-label">格式</span>
        <div class="seg">
          <button type="button" :data-active="String(format === 'png')" @click="format = 'png'">
            <Image :size="14" /> PNG
          </button>
          <button type="button" :data-active="String(format === 'svg')" @click="format = 'svg'">
            SVG
          </button>
        </div>
      </div>

      <div class="dlg-field">
        <span class="dlg-label">清晰度</span>
        <div class="seg">
          <button
            v-for="value in [1, 2, 3]"
            :key="value"
            type="button"
            :data-active="String(scale === value)"
            @click="scale = value"
          >
            {{ value }}x
          </button>
        </div>
      </div>

      <div class="dlg-field">
        <span class="dlg-label">配色</span>
        <div class="seg">
          <button
            v-for="item in [
              { key: 'light', label: '浅色' },
              { key: 'dark', label: '深色' },
            ]"
            :key="item.key"
            type="button"
            :data-active="String(scheme === item.key)"
            @click="scheme = item.key as 'light' | 'dark'"
          >
            <span class="swatch" :style="{ background: paperOf(item.key as 'light' | 'dark') }" />
            {{ item.label }}
          </button>
        </div>
      </div>

      <div class="dlg-field">
        <span class="dlg-label">背景</span>
        <div class="seg">
          <button
            v-for="item in [
              { key: 'paper', label: '纸色' },
              { key: 'white', label: '纯白' },
              { key: 'transparent', label: '透明' },
            ]"
            :key="item.key"
            type="button"
            :data-active="String(background === item.key)"
            @click="background = item.key as typeof background"
          >
            <span
              v-if="item.key === 'paper'"
              class="swatch"
              :style="{ background: paperFill }"
            />
            {{ item.label }}
          </button>
        </div>
      </div>

      <label class="dlg-check">
        <input v-model="expandAll" type="checkbox" />
        <span>导出时展开全部节点</span>
      </label>

      <p class="dlg-hint">文件名：{{ filename(format) }}</p>

      <footer class="dlg-foot">
        <button
          v-if="format === 'png'"
          class="mm-btn"
          type="button"
          :disabled="!ready || busy"
          @click="copyImage"
        >
          <Copy :size="15" /> 复制图片
        </button>
        <button
          class="mm-btn mm-btn--primary"
          type="button"
          :disabled="!ready || busy"
          @click="exportImage"
        >
          <Share2 v-if="busy" :size="15" />
          <Download v-else :size="15" />
          {{ busy ? '生成中…' : '导出并分享' }}
        </button>
      </footer>

      <p v-if="result" class="dlg-ok">{{ result }}</p>
    </div>
  </div>
</template>

<style scoped>
.dlg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.dlg-head h2 {
  margin: 0;
  font-size: 16px;
}

.dlg-field {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 10px 0;
}

.dlg-label {
  width: 56px;
  color: var(--mm-text-soft);
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
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: 6px;
  color: var(--mm-text-soft);
  font-size: 13px;
}

.seg button[data-active='true'] {
  background: var(--mm-panel);
  color: var(--mm-text);
  box-shadow: var(--mm-shadow);
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mm-text) 26%, transparent);
}

.dlg-check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px 0 6px;
  color: var(--mm-text-soft);
  font-size: 13px;
}

.dlg-hint {
  color: var(--mm-text-faint);
  font-size: 12px;
}

.dlg-note {
  padding: 10px 12px;
  border-radius: var(--mm-r-sm);
  background: color-mix(in srgb, var(--mm-warn) 14%, transparent);
  color: var(--mm-text-soft);
  font-size: 12px;
  line-height: 1.6;
}

.dlg-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.dlg-ok {
  margin: 10px 0 0;
  color: var(--mm-ok);
  font-size: 12px;
  text-align: right;
}
</style>
