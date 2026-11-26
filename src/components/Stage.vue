<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Maximize, Minus, Plus, SlidersHorizontal } from 'lucide-vue-next'
import type { MindmapController } from '@/mindmap/engine/controller'
import type { Rect } from '@/mindmap/engine/types'
import { useDrag } from '@/composables/useDrag'
import { useDocumentStore } from '@/stores/document'
import { useSettingsStore } from '@/stores/settings'
import { useViewStore } from '@/stores/view'
import NodeToolbar from './NodeToolbar.vue'
import InlineEditor from './InlineEditor.vue'

const props = defineProps<{
  controller: MindmapController | null
  mountEngine: (el: HTMLElement) => void
}>()

const docs = useDocumentStore()
const settings = useSettingsStore()
const view = useViewStore()

const canvasEl = ref<HTMLElement | null>(null)
const mountEl = ref<HTMLElement | null>(null)
const toolbarRect = ref<Rect | null>(null)
const editorRect = ref<Rect | null>(null)
/** 编辑中节点的朝向（-1 左 / 1 右 / 0 居中），输入框据此镜像 */
const editorSide = ref<-1 | 0 | 1>(0)
let sideFor: string | null = null

const { state: drag, begin } = useDrag(() => props.controller)

let frame = 0

function localRect(id: string | null): Rect | null {
  if (!id) return null
  const engine = props.controller
  const canvas = canvasEl.value
  if (!engine || !canvas) return null
  const rect = engine.rect(id)
  if (!rect) return null
  const box = canvas.getBoundingClientRect()
  return {
    x: rect.x - box.left,
    y: rect.y - box.top,
    width: rect.width,
    height: rect.height,
  }
}

function updateOverlay() {
  toolbarRect.value =
    docs.selectedId && !docs.editingId && !drag.active ? localRect(docs.selectedId) : null
  editorRect.value = docs.editingId ? localRect(docs.editingId) : null
  // 朝向只在编辑对象（或引擎就绪）变化时算一次：布局几何每次重建太浪费
  const editing = editorRect.value ? docs.editingId : null
  if (editing !== sideFor) {
    sideFor = editing
    editorSide.value = editing && props.controller ? props.controller.nodeSide(editing) : 0
  }
  frame = window.requestAnimationFrame(updateOverlay)
}

onMounted(() => {
  if (mountEl.value) props.mountEngine(mountEl.value)
  frame = window.requestAnimationFrame(updateOverlay)
})

onBeforeUnmount(() => window.cancelAnimationFrame(frame))

const editingNode = computed(() => (docs.editingId ? docs.doc?.nodes[docs.editingId] : null))

const editorFontSize = computed(() => {
  const node = editingNode.value
  if (!node) return 15 * view.zoom
  const depth = node.parentId ? 1 : 0
  const base = depth === 0 ? 17 : 15
  return Math.max(11, Math.min(34, base * view.zoom))
})

/**
 * 用引擎的几何索引做命中测试：SVG 文字是 `pointer-events: none`，
 * 靠 `event.target` 拿不到节点，只能按坐标问引擎。
 */
function nodeIdFrom(event: MouseEvent | PointerEvent): string | null {
  const hit = props.controller?.hitAt(event.clientX, event.clientY)
  if (!hit) return null
  return hit.type === 'node' || hit.type === 'toggle' ? hit.id ?? null : null
}

function onPointerDown(event: PointerEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('.mm-toolbar, .mm-inline-editor, .mm-zoombar')) return
  if (docs.editingId) {
    if (!target?.closest('.mm-inline-editor')) docs.stopEditing()
  }
  const id = nodeIdFrom(event)
  if (id) {
    if (docs.selectedId !== id) docs.select(id)
    begin(event, id)
  } else {
    docs.select(null)
  }
}

function onDoubleClick(event: MouseEvent) {
  const id = nodeIdFrom(event)
  if (id) docs.startEditing(id)
}

function syncZoom() {
  const engine = props.controller
  if (engine) view.zoom = engine.getZoom()
}

function zoomBy(factor: number) {
  props.controller?.zoomBy(factor)
  syncZoom()
}

function zoomTo(k: number) {
  props.controller?.zoomTo(k)
  syncZoom()
}

function fit() {
  props.controller?.fit()
  syncZoom()
}

/** 被拖动的节点副本：跟着指针走，给「东西在我手上」的即时反馈 */
const dragCard = computed(() => {
  if (!drag.active || !drag.pointer || !canvasEl.value || !drag.sourceId) return null
  const node = docs.doc?.nodes[drag.sourceId]
  if (!node) return null
  const box = canvasEl.value.getBoundingClientRect()
  return {
    text: node.text || '（空）',
    style: {
      left: `${drag.pointer.x - box.left}px`,
      top: `${drag.pointer.y - box.top}px`,
      fontSize: `${Math.max(10, 15 * view.zoom)}px`,
    },
    invalid: drag.invalid,
  }
})
</script>

<template>
  <div
    ref="canvasEl"
    class="mm-canvas"
    :data-dragging="String(drag.active)"
    :data-pending="String(drag.pending)"
    role="application"
    aria-label="思维导图画布"
    @pointerdown="onPointerDown"
    @dblclick="onDoubleClick"
  >
    <div ref="mountEl" class="stage-engine" />

    <div v-if="!docs.doc" class="mm-empty">
      <h2>还没有打开导图</h2>
      <p>从左侧选择一份，或新建一份开始。</p>
    </div>
    <div v-else-if="controller && !controller.ready" class="stage-notice">
      <SlidersHorizontal :size="18" />
      <div>
        <strong>渲染引擎尚未接入</strong>
        <p>
          模型、存储、Markdown 往返与拖拽判定都已完成；画布层等待
          <code>vendor/markmap</code> 落地后即可点亮。当前文档共
          {{ Object.keys(docs.doc.nodes).length }} 个节点。
        </p>
      </div>
    </div>

    <NodeToolbar
      v-if="toolbarRect && docs.doc"
      :rect="toolbarRect"
      :zoom="view.zoom"
      :can-fold="(docs.doc.nodes[docs.selectedId ?? '']?.children.length ?? 0) > 0"
      :is-root="!docs.doc.nodes[docs.selectedId ?? '']?.parentId"
      @edit="docs.selectedId && docs.startEditing(docs.selectedId)"
      @add-child="docs.addChild(docs.selectedId)"
      @add-sibling="docs.addSibling(docs.selectedId)"
      @fold="docs.selectedId && docs.toggleFold(docs.selectedId)"
      @remove="docs.remove(docs.selectedId)"
    />

    <InlineEditor
      v-if="editorRect && editingNode && docs.editingId"
      :key="docs.editingId"
      :rect="editorRect"
      :text="editingNode.text"
      :font-size="editorFontSize"
      :side="editorSide"
      @commit="(text) => docs.commitText(docs.editingId!, text)"
      @cancel="docs.stopEditing()"
    />

    <!-- 落点提示只画在画布上（导线 + 圆点），这里只有跟随指针的节点副本 -->
    <div
      v-if="dragCard"
      class="stage-drag"
      :class="{ 'stage-drag--invalid': dragCard.invalid }"
      :style="dragCard.style"
    >
      {{ dragCard.text }}
    </div>

    <div class="mm-zoombar" role="group" aria-label="缩放">
      <button class="mm-icon-btn" type="button" title="缩小 (-)" @click="zoomBy(1 / 1.2)">
        <Minus :size="15" />
      </button>
      <button class="zoom-value" type="button" title="重置为 100%" @click="zoomTo(1)">
        {{ Math.round(view.zoom * 100) }}%
      </button>
      <button class="mm-icon-btn" type="button" title="放大 (+)" @click="zoomBy(1.2)">
        <Plus :size="15" />
      </button>
      <span class="zoom-sep" aria-hidden="true"></span>
      <button class="mm-icon-btn" type="button" title="适应画布 (0)" @click="fit()">
        <Maximize :size="15" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.stage-engine {
  position: absolute;
  inset: 0;
}

.stage-notice {
  position: absolute;
  top: 16px;
  left: 16px;
  display: flex;
  gap: 10px;
  max-width: 360px;
  padding: 12px 14px;
  border: 1px dashed var(--mm-line-strong);
  border-radius: var(--mm-r-md);
  background: color-mix(in srgb, var(--mm-panel) 88%, transparent);
  color: var(--mm-text-soft);
  font-size: 12px;
  line-height: 1.6;
  backdrop-filter: blur(6px);
}

.stage-notice strong {
  display: block;
  margin-bottom: 2px;
  color: var(--mm-text);
  font-size: 13px;
}

.stage-notice p {
  margin: 0;
}

.stage-notice code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--mm-code-bg);
  color: var(--mm-code-text);
}

.stage-drag {
  position: absolute;
  z-index: 19;
  max-width: 280px;
  padding: 6px 12px;
  overflow: hidden;
  transform: translate(14px, -50%);
  border: 1px dashed var(--mm-line-strong);
  border-radius: 10px;
  background: color-mix(in srgb, var(--mm-panel) 88%, transparent);
  box-shadow: var(--mm-shadow);
  color: var(--mm-text-soft);
  pointer-events: none;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.95;
}

.stage-drag--invalid {
  border-color: var(--mm-danger);
  color: var(--mm-danger);
}

.mm-canvas[data-dragging='true'] {
  cursor: grabbing;
}

.zoom-value {
  min-width: 48px;
  padding: 0 4px;
  color: var(--mm-text-soft);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.zoom-sep {
  width: 1px;
  height: 16px;
  margin: 0 2px;
  background: var(--mm-line);
}
</style>
