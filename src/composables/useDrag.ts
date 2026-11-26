import { reactive } from 'vue'
import type { DropTarget, MindDoc } from '@/mindmap/model'
import { canMove } from '@/mindmap/model'
import { dropGuide, ghostPlacement, resolveDrop, type DropGuide, type Geometry } from '@/mindmap/engine/drag'
import type { MindmapController } from '@/mindmap/engine/controller'
import type { Primitive } from '@/mindmap/engine/types'
import { withAlpha } from '@/mindmap/theme/palette'
import { useDocumentStore } from '@/stores/document'
import { useViewStore } from '@/stores/view'

export interface DragGhost {
  x: number
  y: number
  width: number
  height: number
  text: string
  invalid: boolean
  side: -1 | 0 | 1
}

export interface DragState {
  active: boolean
  pending: boolean
  sourceId: string | null
  target: DropTarget | null
  ghost: DragGhost | null
  /** 落点导线（布局坐标，由引擎 overlay 画在画布上，不占布局位置） */
  guide: DropGuide | null
  /** 指针的屏幕坐标：被拖动的节点要跟着它走 */
  pointer: { x: number; y: number } | null
}

const THRESHOLD = 4
const LONG_PRESS = 250
/** 导线半透明度：够清楚，又不至于盖住节点 */
const GUIDE_ALPHA = 0.55

export function useDrag(controller: () => MindmapController | null) {
  const docs = useDocumentStore()
  const view = useViewStore()

  const state = reactive<DragState>({
    active: false,
    pending: false,
    sourceId: null,
    target: null,
    ghost: null,
    guide: null,
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
    state.ghost = null
    state.guide = null
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
    const plan = target ? planDrop(target, geometry, docs.doc, engine) : null
    state.ghost = plan?.ghost ?? null
    state.guide = plan?.guide ?? null
    paintGuide()
  }

  /**
   * 一次算出两样东西：跟随指针的落点框（屏幕坐标）和画在导图上的落点导线（布局坐标）。
   * 导线交给引擎 overlay，所以既不会挤动别的节点，也不受画布缩放影响。
   */
  function planDrop(
    target: DropTarget,
    geo: Geometry,
    doc: MindDoc,
    engine: MindmapController | null,
  ): { ghost: DragGhost; guide: DropGuide | null } | null {
    const source = state.sourceId ? doc.nodes[state.sourceId] : null
    if (!source || !engine) return null
    const text = source.text || '（空）'
    const zoom = Math.max(0.1, view.zoom)
    const layoutWidth = Math.min(240, Math.max(48, text.length * 8.5 + 28))
    const layoutHeight = 30
    const placement = ghostPlacement(geo, target, { width: layoutWidth, height: layoutHeight })
    if (!placement) return null
    const origin = engine.screenPoint(placement.x, placement.y)
    if (!origin) return null
    // 占位框用视口坐标（Stage 再减去画布自身的偏移），跟编辑框、节点工具条同一套换算
    const x = origin.x
    const y = origin.y
    const valid = state.sourceId ? canMove(doc, state.sourceId, target) : false
    const guide = dropGuide(geo, target, { ...placement, width: layoutWidth, height: layoutHeight })
    return {
      ghost: {
        x,
        y,
        width: layoutWidth * zoom,
        height: layoutHeight * zoom,
        text,
        invalid: !valid,
        side: placement.side,
      },
      guide,
    }
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
    const color = state.ghost?.invalid
      ? (theme?.chrome.danger ?? '#c9603f')
      : (theme?.chrome.accent ?? '#3f8095')
    const stroke = withAlpha(color, GUIDE_ALPHA)
    const primitives: Primitive[] = [
      { kind: 'path', d: guide.path, stroke, strokeWidth: 2 },
      {
        kind: 'rect',
        x: guide.dot.x - 4,
        y: guide.dot.y - 4,
        w: 8,
        h: 8,
        r: 4,
        fill: withAlpha(color, 0.8),
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
    state.ghost = null
    state.guide = null
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
