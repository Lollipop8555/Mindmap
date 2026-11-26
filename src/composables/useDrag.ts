import { reactive } from 'vue'
import type { DropTarget } from '@/mindmap/model'
import { canMove } from '@/mindmap/model'
import { dropGuide, resolveDrop, type DropGuide, type Geometry } from '@/mindmap/engine/drag'
import type { MindmapController } from '@/mindmap/engine/controller'
import type { Primitive } from '@/mindmap/engine/types'
import { withAlpha } from '@/mindmap/theme/palette'
import { useDocumentStore } from '@/stores/document'
import { useViewStore } from '@/stores/view'

export interface DragState {
  active: boolean
  pending: boolean
  sourceId: string | null
  target: DropTarget | null
  /** 落点导线（布局坐标，由引擎 overlay 画在画布上，不占布局位置） */
  guide: DropGuide | null
  /** 当前落点放不进去（拖到自己的子孙里、位置没变）时导线转成警示色 */
  invalid: boolean
  /** 指针的屏幕坐标：被拖动的节点副本跟着它走 */
  pointer: { x: number; y: number } | null
}

const THRESHOLD = 4
const LONG_PRESS = 250
/** 导线半透明度：够清楚，又不至于盖住节点 */
const GUIDE_ALPHA = 0.6

export function useDrag(controller: () => MindmapController | null) {
  const docs = useDocumentStore()
  const view = useViewStore()

  const state = reactive<DragState>({
    active: false,
    pending: false,
    sourceId: null,
    target: null,
    guide: null,
    invalid: false,
    pointer: null,
  })

  let geometry: Geometry | null = null
  let startX = 0
  let startY = 0
  let longPressTimer: number | null = null
  let pointerId: number | null = null
  let altKey = false

  function begin(event: PointerEvent, id: string) {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    const engine = controller()
    if (!engine || !docs.doc) return
    if (!docs.doc.nodes[id]?.parentId) return // 根不可拖

    startX = event.clientX
    startY = event.clientY
    pointerId = event.pointerId
    state.pending = true
    state.sourceId = id
    state.target = null
    state.guide = null
    state.invalid = false
    state.pointer = { x: event.clientX, y: event.clientY }
    altKey = event.altKey

    geometry = engine.snapshotGeometry(docs.doc)

    if (event.pointerType === 'touch') {
      longPressTimer = window.setTimeout(() => {
        activate()
        navigator.vibrate?.(10)
      }, LONG_PRESS)
    }

    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
  }

  function activate() {
    if (!state.pending) return
    state.pending = false
    state.active = true
    if (state.sourceId) controller()?.setDragState(state.sourceId)
  }

  function onMove(event: PointerEvent) {
    if (!state.sourceId) return
    if (pointerId != null && event.pointerId !== pointerId) return
    const moved = Math.hypot(event.clientX - startX, event.clientY - startY)

    if (state.pending) {
      if (event.pointerType !== 'touch' && moved > THRESHOLD) activate()
      else if (event.pointerType === 'touch' && moved > THRESHOLD * 2) {
        // 触摸：未到长按就大幅移动 → 视为平移，放弃拖拽
        cancel()
        return
      } else return
    }

    if (!state.active || !geometry || !docs.doc) return
    event.preventDefault()
    altKey = event.altKey
    state.pointer = { x: event.clientX, y: event.clientY }

    const engine = controller()
    const point = engine?.layoutPoint(event.clientX, event.clientY)
    if (!point) return

    const target = resolveDrop(geometry, state.sourceId, point, {
      alt: altKey,
      previous: state.target,
      zoom: view.zoom,
    })
    state.target = target
    state.invalid = !(target && state.sourceId && canMove(docs.doc, state.sourceId, target))
    state.guide = target ? dropGuide(geometry, target) : null
    paintGuide()
  }

  /** 把导线画到引擎 overlay 上（真实色值 + 半透明，随画布一起缩放平移） */
  function paintGuide() {
    const engine = controller()
    if (!engine) return
    const guide = state.guide
    if (!guide || !state.active) {
      engine.clearOverlay()
      return
    }
    const theme = engine.currentTheme
    const color = state.invalid
      ? (theme?.chrome.danger ?? '#c9603f')
      : (theme?.chrome.accent ?? '#3f8095')
    const stroke = withAlpha(color, GUIDE_ALPHA)
    const primitives: Primitive[] = [
      { kind: 'path', d: guide.path, stroke, strokeWidth: 2 },
      // 只留一个圆点标出「接在这儿」，不加节点框
      {
        kind: 'rect',
        x: guide.dot.x - 3.5,
        y: guide.dot.y - 3.5,
        w: 7,
        h: 7,
        r: 3.5,
        fill: withAlpha(color, 0.9),
      },
    ]
    engine.setOverlay(primitives)
  }

  function onUp() {
    if (state.active && state.target && state.sourceId && docs.doc) {
      if (canMove(docs.doc, state.sourceId, state.target)) {
        docs.move(state.sourceId, state.target)
      }
    }
    cleanup()
  }

  function onCancel() {
    cleanup()
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    }
  }

  function cancel() {
    cleanup()
  }

  function cleanup() {
    if (longPressTimer != null) window.clearTimeout(longPressTimer)
    longPressTimer = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onKey)
    const source = state.sourceId
    state.active = false
    state.pending = false
    state.sourceId = null
    state.target = null
    state.guide = null
    state.invalid = false
    state.pointer = null
    geometry = null
    pointerId = null
    const engine = controller()
    if (engine) {
      engine.clearOverlay()
      if (source) engine.clearDragState()
    }
  }

  return { state, begin, cancel }
}
