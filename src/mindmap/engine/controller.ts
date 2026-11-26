import type {
  Engine,
  ExportOptions,
  FoldedSides,
  HitResult,
  NodeState,
  Point,
  Rect,
  Side,
} from './types'
import type { Geometry, GeoNode } from './drag'
import { branchIndexMap, foldedIds, toMarkmapTree } from '@/mindmap/convert'
import { hasSideFolds, visibleIds, type LayoutMode, type MindDoc } from '@/mindmap/model'
import type { MonetTheme } from '@/mindmap/theme/monet'

/**
 * 引擎桥。Vue 只与这里交互；引擎实例不进入响应式系统。
 * TODO(engine): vendor 落地后把 `createEngine` 换成真实 Markmap 工厂（见 plans/99）。
 */

export interface EngineCallbacks {
  onFold?: (id: string, folded: boolean) => void
  /** 双侧布局的根节点收起/展开某一侧 */
  onFoldSide?: (id: string, side: Side, folded: boolean) => void
  onZoom?: (k: number) => void
  onSelect?: (id: string | null) => void
  onBlankClick?: () => void
  onLink?: (href: string) => void
  onRender?: () => void
}

/** 占位引擎：vendor 未落地时让 UI 可用（画布显示提示，不炸） */
export function createNullEngine(): Engine & { placeholder: true } {
  let zoom = 1
  return {
    placeholder: true,
    mount() {},
    setTree() {},
    setFoldedIds() {},
    setFoldedSides() {},
    setLayout() {},
    setTheme() {},
    fit() {},
    center() {},
    zoomBy(factor: number) {
      zoom = Math.max(0.1, Math.min(8, zoom * factor))
    },
    zoomTo(k: number) {
      zoom = k
    },
    getZoom() {
      return zoom
    },
    screenRect(): Rect | null {
      return null
    },
    layoutRects() {
      return {}
    },
    layoutPoint(): Point | null {
      return null
    },
    screenPoint(): Point | null {
      return null
    },
    hitAt(): HitResult | null {
      return null
    },
    setNodeStates() {},
    setOverlay() {},
    clearOverlay() {},
    measureNode(text: string) {
      return { width: Math.min(320, Math.max(40, text.length * 8)), height: 24 }
    },
    toSVG() {
      return ''
    },
    async toPNG() {
      return new Blob()
    },
    on() {
      return () => {}
    },
    destroy() {},
  }
}

export class MindmapController {
  private engine: Engine
  private doc: MindDoc | null = null
  private theme: MonetTheme | null = null
  private syncing = false
  private states: Record<string, NodeState> = {}
  /** 引擎当前的按侧折叠状态，用来把整张表 diff 成单侧事件 */
  private sides: FoldedSides = {}
  private unsubs: (() => void)[] = []
  /** 已经「适应画布」过的文档 id；换文档才需要重新适应一次 */
  private fittedDocId: string | null = null

  constructor(engine: Engine, private callbacks: EngineCallbacks = {}) {
    this.engine = engine
  }

  get ready(): boolean {
    return !('placeholder' in this.engine)
  }

  mount(el: HTMLElement, opts: { layout: LayoutMode; theme: MonetTheme }) {
    this.theme = opts.theme
    this.engine.mount(el, {
      tree: { id: 'root', type: 'heading', content: [], notes: [], data: {}, children: [] },
      folded: [],
      foldedSides: {},
      layout: opts.layout,
    })
    this.engine.setTheme(opts.theme)
    this.unsubs.push(
      this.engine.on('fold', (payload: { id: string; folded: boolean }) => {
        if (this.syncing) return
        this.callbacks.onFold?.(payload.id, payload.folded)
      }),
      this.engine.on('foldSides', (payload: FoldedSides) => {
        const next = payload ?? {}
        const prev = this.sides
        this.sides = next
        if (this.syncing) return
        for (const id of new Set([...Object.keys(prev), ...Object.keys(next)])) {
          for (const side of ['left', 'right'] as const) {
            const before = Boolean(prev[id]?.[side])
            const after = Boolean(next[id]?.[side])
            if (before !== after) this.callbacks.onFoldSide?.(id, side, after)
          }
        }
      }),
      this.engine.on('zoom', (payload: { k: number }) => this.callbacks.onZoom?.(payload.k)),
      this.engine.on('render', () => this.callbacks.onRender?.()),
      this.engine.on('select', (payload: { id: string | null }) => this.callbacks.onSelect?.(payload.id)),
    )
  }

  setTheme(theme: MonetTheme) {
    this.theme = theme
    this.engine.setTheme(theme)
  }

  /** 全量同步：结构变化时调用（唯一会重排的入口） */
  applyDocument(doc: MindDoc, opts: { animate?: boolean } = {}) {
    this.doc = doc
    const tree = toMarkmapTree(doc)
    if (!tree) return
    const isNewDoc = this.fittedDocId !== doc.id
    this.syncing = true
    try {
      this.engine.setTree(tree, { animate: !isNewDoc })
      this.engine.setFoldedIds(foldedIds(doc), { animate: !isNewDoc })
      this.engine.setFoldedSides(sideFoldsOf(doc), { animate: !isNewDoc })
      this.engine.setLayout(doc.layout)
    } finally {
      this.syncing = false
    }
    this.applyStates()
    // 树、折叠状态、布局都落地之后再适应画布：反过来的话 fit 量的是「折叠/换布局
    // 之前」的包围盒，等布局一移，内容就缩到一边、不再居中。
    if (isNewDoc) {
      this.fittedDocId = doc.id
      this.engine.fit({ animate: false, settle: true })
    }
    void opts
  }

  setSelection(selected: string | null, editing: string | null) {
    this.states = {}
    if (selected) this.states[selected] = { ...(this.states[selected] ?? {}), selected: true }
    if (editing) this.states[editing] = { ...(this.states[editing] ?? {}), editing: true }
    this.applyStates()
  }

  setDragState(source: string | null, dimmed: string[] = []) {
    const states: Record<string, NodeState> = { ...this.states }
    if (source) states[source] = { ...(states[source] ?? {}), dragging: true }
    for (const id of dimmed) states[id] = { ...(states[id] ?? {}), dimmed: true }
    this.engine.setNodeStates(states)
  }

  clearDragState() {
    this.applyStates()
  }

  private applyStates() {
    this.engine.setNodeStates(this.states)
  }

  rect(id: string): Rect | null {
    return this.engine.screenRect(id)
  }

  /**
   * 节点朝向：-1 在父节点左边、1 在右边、0 居中或单侧布局。
   * 行内输入框要靠它决定往哪边生长（左侧分支向右长会压住到父节点的连线）。
   */
  nodeSide(id: string): -1 | 0 | 1 {
    if (!this.doc) return 0
    return sideOf(this.doc, id, this.engine.layoutRects())
  }

  /** 上一次渲染实际画出来的节点（按侧折叠会把整块藏起来，模型不知道） */
  renderedIds(): string[] {
    return Object.keys(this.engine.layoutRects())
  }

  /** 冻结几何快照（拖拽开始时调用一次） */
  snapshotGeometry(doc: MindDoc): Geometry {
    const rects = this.engine.layoutRects()
    const nodes: Record<string, GeoNode> = {}
    const colorMap = branchIndexMap(doc)
    for (const id of visibleIds(doc)) {
      const node = doc.nodes[id]
      if (!node) continue
      nodes[id] = {
        id,
        parentId: node.parentId,
        children: node.children,
        depth: depthIn(doc, id),
        side: sideOf(doc, id, rects),
      }
      void colorMap
    }
    return { rects, nodes, rootId: doc.rootId, layout: doc.layout }
  }

  zoomBy(factor: number) {
    this.engine.zoomBy(factor)
  }

  zoomTo(k: number) {
    this.engine.zoomTo(k)
  }

  getZoom(): number {
    return this.engine.getZoom()
  }

  fit() {
    this.engine.fit()
  }

  layoutPoint(clientX: number, clientY: number): Point | null {
    return this.engine.layoutPoint(clientX, clientY)
  }

  /** 布局坐标 → 视口坐标，落点占位框要用它换算 */
  screenPoint(x: number, y: number): Point | null {
    return this.engine.screenPoint(x, y)
  }

  /** 视口坐标 → 命中结果（节点/折叠点/链接/空白），由引擎的几何索引决定 */
  hitAt(clientX: number, clientY: number): HitResult | null {
    const point = this.engine.layoutPoint(clientX, clientY)
    if (!point) return null
    return this.engine.hitAt(point.x, point.y)
  }

  setOverlay(primitives: Parameters<Engine['setOverlay']>[0]) {
    this.engine.setOverlay(primitives)
  }

  clearOverlay() {
    this.engine.clearOverlay()
  }

  toSVG(opts?: ExportOptions): string {
    return this.engine.toSVG(opts)
  }

  toPNG(opts?: ExportOptions): Promise<Blob> {
    return this.engine.toPNG(opts)
  }

  get currentTheme(): MonetTheme | null {
    return this.theme
  }

  destroy() {
    for (const off of this.unsubs) off()
    this.unsubs = []
    this.engine.destroy()
  }
}

function depthIn(doc: MindDoc, id: string): number {
  let depth = 0
  let cur = doc.nodes[id]
  const seen = new Set<string>()
  while (cur?.parentId && !seen.has(cur.id)) {
    seen.add(cur.id)
    depth += 1
    cur = doc.nodes[cur.parentId]
  }
  return depth
}

function sideOf(doc: MindDoc, id: string, rects: Record<string, Rect>): -1 | 0 | 1 {
  const node = doc.nodes[id]
  if (!node?.parentId || doc.layout === 'tree') return 0
  const self = rects[id]
  const parent = rects[node.parentId]
  if (!self || !parent) return 1
  const selfCenter = self.x + self.width / 2
  const parentCenter = parent.x + parent.width / 2
  if (Math.abs(selfCenter - parentCenter) < 1) return 0
  return selfCenter < parentCenter ? -1 : 1
}

/** 文档的按侧折叠 → 引擎的「节点 id → 收起哪侧」表（只有根节点可能带） */
function sideFoldsOf(doc: MindDoc): FoldedSides {
  if (doc.layout !== 'two-sided' || !hasSideFolds(doc)) return {}
  return { [doc.rootId]: doc.foldedSides ?? {} }
}
