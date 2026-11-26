<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import type { PhrasingContent } from 'mdast'
import { parseInline } from '@/mindmap/markdown/inline'
import { mathSegments } from '@/mindmap/inline/math'
import type { Rect } from '@/mindmap/engine/types'

const props = defineProps<{
  rect: Rect
  text: string
  fontSize: number
}>()

const emit = defineEmits<{ commit: [text: string]; cancel: [] }>()

const value = ref(props.text)
const textarea = ref<HTMLTextAreaElement | null>(null)
let cancelled = false

const width = computed(() => {
  const min = Math.max(180, props.rect.width + 24)
  const estimated = value.value.length * props.fontSize * 0.62 + 48
  return Math.min(560, Math.max(min, estimated))
})

const style = computed(() => ({
  left: `${props.rect.x}px`,
  top: `${props.rect.y}px`,
  width: `${width.value}px`,
  fontSize: `${props.fontSize}px`,
}))

/* ------------------------- 指令自动补全 ------------------------- */

interface Suggestion {
  key: string
  label: string
  snippet: string
}

const DIRECTIVES: Suggestion[] = [
  { key: 'badge', label: '徽标', snippet: ':badge[文字]{tone="sage"}' },
  { key: 'progress', label: '进度条', snippet: ':progress[60]' },
  { key: 'date', label: '日期', snippet: ':date[2026-12-31]' },
  { key: 'icon', label: '图标', snippet: ':icon[rocket]' },
  { key: 'kbd', label: '键帽', snippet: ':kbd[K]' },
  { key: 'sup', label: '上标', snippet: ':sup[2]' },
  { key: 'sub', label: '下标', snippet: ':sub[2]' },
  { key: 'color', label: '着色', snippet: ':color[文字]{c="rose"}' },
]

const menu = ref<{ start: number; query: string; index: number } | null>(null)

const filtered = computed(() => {
  const query = menu.value?.query ?? ''
  return DIRECTIVES.filter((item) => item.key.startsWith(query))
})

const menuOpen = computed(() => menu.value != null && filtered.value.length > 0)

function syncMenu() {
  const el = textarea.value
  if (!el) return
  const caret = el.selectionStart ?? 0
  const before = value.value.slice(0, caret)
  const match = /(?:^|[\s(（【])[:：]([a-zA-Z]{0,12})$/.exec(before)
  if (!match) {
    menu.value = null
    return
  }
  const query = match[1].toLowerCase()
  const index = Math.min(menu.value?.index ?? 0, Math.max(0, filtered.value.length - 1))
  menu.value = { start: caret - query.length - 1, query, index }
}

function pick(item: Suggestion) {
  const el = textarea.value
  if (!el || !menu.value) return
  const caret = el.selectionStart ?? 0
  const { start } = menu.value
  const snippet = item.snippet
  value.value = value.value.slice(0, start) + snippet + value.value.slice(caret)
  menu.value = null
  const open = start + snippet.indexOf('[') + 1
  const close = start + snippet.indexOf(']')
  void nextTick(() => {
    el.focus()
    el.setSelectionRange(open, Math.max(open, close))
  })
}

onMounted(async () => {
  await nextTick()
  const el = textarea.value
  if (!el) return
  el.focus()
  el.setSelectionRange(el.value.length, el.value.length)
})

function commit() {
  if (cancelled) return
  emit('commit', value.value)
}

function onKeydown(event: KeyboardEvent) {
  const meta = event.metaKey || event.ctrlKey

  if (menuOpen.value) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const size = filtered.value.length
      const current = menu.value?.index ?? 0
      const next = event.key === 'ArrowDown' ? (current + 1) % size : (current - 1 + size) % size
      menu.value = { ...menu.value!, index: next }
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      pick(filtered.value[menu.value?.index ?? 0])
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      menu.value = null
      return
    }
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancelled = true
    emit('cancel')
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    commit()
    return
  }
  if (!meta) return

  const key = event.key.toLowerCase()
  if (key === 'b') wrap('**')
  else if (key === 'i') wrap('*')
  else if (key === 'u') wrap('++')
  else if (key === 'e') wrap('`')
  else if (key === 'k') insert('[链接文本](https://)')
  else if (key === 'h') wrap('==')
}

function wrap(marker: string) {
  const el = textarea.value
  if (!el) return
  const { selectionStart, selectionEnd } = el
  const selected = value.value.slice(selectionStart, selectionEnd)
  const next =
    value.value.slice(0, selectionStart) + marker + selected + marker + value.value.slice(selectionEnd)
  value.value = next
  void nextTick(() => {
    el.focus()
    el.setSelectionRange(selectionStart + marker.length, selectionEnd + marker.length)
    syncMenu()
  })
}

function insert(snippet: string) {
  const el = textarea.value
  if (!el) return
  const { selectionStart, selectionEnd } = el
  value.value =
    value.value.slice(0, selectionStart) + snippet + value.value.slice(selectionEnd)
  void nextTick(() => {
    el.focus()
    const caret = selectionStart + snippet.length
    el.setSelectionRange(caret, caret)
    syncMenu()
  })
}

/* ---------------------------- 轻量预览 ---------------------------- */

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const TONE_COLOR: Record<string, string> = {
  amber: 'var(--mm-b3)',
  rose: 'var(--mm-b4)',
  sage: 'var(--mm-b2)',
  slate: 'var(--mm-b0)',
  blue: 'var(--mm-b1)',
  violet: 'var(--mm-b5)',
  clay: 'var(--mm-b6)',
  moss: 'var(--mm-b7)',
  mist: 'var(--mm-b8)',
  wisteria: 'var(--mm-b9)',
}

function renderNodes(nodes: readonly PhrasingContent[] | undefined): string {
  if (!nodes) return ''
  return nodes
    .map((node) => {
      const anyNode = node as any
      switch (node.type) {
        case 'text':
          return escapeHtml((node as any).value)
        case 'strong':
          return `<b>${renderNodes((node as any).children)}</b>`
        case 'emphasis':
          return `<i>${renderNodes((node as any).children)}</i>`
        case 'delete':
          return `<s>${renderNodes((node as any).children)}</s>`
        case 'inlineCode':
          return `<code>${escapeHtml((node as any).value)}</code>`
        case 'inlineMath':
          return `<span class="pv-math">${escapeHtml(
            mathSegments(String(anyNode.value ?? ''))
              .map((segment) => segment.text)
              .join(''),
          )}</span>`
        case 'link':
          return `<a>${renderNodes(anyNode.children)}</a>`
        case 'mmBadge':
          return `<span class="pv-badge" style="--tone:${TONE_COLOR[anyNode.tone] ?? 'var(--mm-accent)'}">${renderNodes(anyNode.children)}</span>`
        case 'mmKbd':
          return `<kbd>${renderNodes(anyNode.children)}</kbd>`
        case 'mmUnderline':
          return `<u>${renderNodes(anyNode.children)}</u>`
        case 'mmSup':
          return `<sup>${renderNodes(anyNode.children)}</sup>`
        case 'mmSub':
          return `<sub>${renderNodes(anyNode.children)}</sub>`
        case 'mmColor':
          return `<span style="color:${escapeHtml(String(anyNode.color ?? 'inherit'))}">${renderNodes(anyNode.children)}</span>`
        case 'mmIcon':
          return `<span class="pv-icon">◆ ${escapeHtml(String(anyNode.name ?? ''))}</span>`
        case 'mmDate':
          return `<span class="pv-date">${escapeHtml(String(anyNode.value ?? ''))}</span>`
        case 'mmProgress':
          return `<span class="pv-progress"><i style="width:${Number(anyNode.value) || 0}%"></i></span>`
        case 'image':
          return `<span class="pv-icon">🖼 ${escapeHtml(anyNode.alt ?? '')}</span>`
        default:
          return renderNodes(anyNode.children)
      }
    })
    .join('')
}

const preview = computed(() => renderNodes(parseInline(value.value)))
</script>

<template>
  <div class="mm-inline-editor" :style="style" @pointerdown.stop @dblclick.stop>
    <textarea
      ref="textarea"
      v-model="value"
      rows="1"
      spellcheck="false"
      placeholder="输入内容…"
      @keydown="onKeydown"
      @keyup="syncMenu"
      @input="syncMenu"
      @click="syncMenu"
      @blur="commit"
    />

    <div v-if="menuOpen" class="mm-suggest" role="listbox">
      <button
        v-for="(item, index) in filtered"
        :key="item.key"
        type="button"
        class="mm-suggest-item"
        :class="{ 'is-on': index === menu?.index }"
        @mousedown.prevent="pick(item)"
      >
        <span class="mm-suggest-key">:{{ item.key }}</span>
        <span class="mm-suggest-label">{{ item.label }}</span>
      </button>
    </div>

    <div class="mm-preview" v-html="preview" />
  </div>
</template>

<style scoped>
.mm-inline-editor textarea {
  box-sizing: border-box;
}

.mm-suggest {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  min-width: 220px;
  overflow: hidden;
  padding: 4px;
  border: 1px solid var(--mm-line);
  border-radius: var(--mm-r-md);
  background: var(--mm-panel);
  box-shadow: var(--mm-shadow-lg);
}

.mm-suggest-item {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 6px 8px;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--mm-text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.mm-suggest-item.is-on,
.mm-suggest-item:hover {
  background: var(--mm-accent-soft);
}

.mm-suggest-key {
  color: var(--mm-accent);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.mm-suggest-label {
  color: var(--mm-text-soft);
}

.mm-preview :deep(b) {
  color: var(--mm-text);
  font-weight: 600;
}

.mm-preview :deep(code),
.mm-preview :deep(kbd) {
  padding: 0 4px;
  border-radius: 4px;
  background: var(--mm-code-bg);
  color: var(--mm-code-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.92em;
}

.mm-preview :deep(.pv-math) {
  color: var(--mm-text);
  font-family: 'Cambria Math', 'Latin Modern Math', Georgia, serif;
  font-style: italic;
}

.mm-preview :deep(.pv-badge) {
  padding: 0 6px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--tone) 16%, transparent);
  color: var(--tone);
  font-size: 0.9em;
}

.mm-preview :deep(.pv-icon) {
  color: var(--mm-text-soft);
}

.mm-preview :deep(.pv-date) {
  color: var(--mm-text-soft);
  font-variant-numeric: tabular-nums;
}

.mm-preview :deep(.pv-progress) {
  display: inline-block;
  width: 48px;
  height: 5px;
  border-radius: 999px;
  background: var(--mm-line);
  vertical-align: middle;
}

.mm-preview :deep(.pv-progress i) {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--mm-accent);
}

.mm-preview :deep(a) {
  color: var(--mm-accent);
  text-decoration: underline;
}
</style>
