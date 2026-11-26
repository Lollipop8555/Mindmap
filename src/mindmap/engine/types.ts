/**
 * 我们对引擎的能力契约。
 *
 * 这里的类型是 fork 后 `packages/markmap` 公共类型的结构子集：结构兼容，
 * 因此可以先把 app 层写完，等 vendor 落地后把 controller 里的 `NullEngine`
 * 换成真实 `Markmap` 实例即可（见 plans/99 的 TODO(engine)）。
 */

export type Point = { x: number; y: number }
export interface Size {
  width: number
  height: number
}
export interface Rect extends Point, Size {}
export type Matrix = [number, number, number, number, number, number]

export type Paint = string

export interface FontStyle {
  family: string
  size: number
  weight: number
  style: 'normal' | 'italic'
  lineHeight: number
}

export interface TextStyle {
  font: FontStyle
  fill: Paint
}

export interface Decoration {
  background?: Paint
  radius?: number
  padding?: number
  strike?: Paint
  /** fork 补丁 P4：上游只有 background/radius/padding/strike/href */
  underline?: Paint
  href?: string
}

export interface StyleResult {
  font?: Partial<FontStyle>
  fill?: Paint
  decoration?: Decoration
}

export interface TextRun extends TextStyle {
  text: string
  x: number
  y: number
}

export type Primitive =
  | { kind: 'text'; x: number; y: number; runs: TextRun[] }
  | {
      kind: 'rect'
      x: number
      y: number
      w: number
      h: number
      r?: number
      fill?: Paint
      stroke?: Paint
      strokeWidth?: number
    }
  | { kind: 'path'; d: string; fill?: Paint; stroke?: Paint; strokeWidth?: number }
  | { kind: 'group'; transform: Matrix; children: Primitive[] }
  | { kind: 'custom'; backends: ('svg' | 'canvas')[]; svg: () => string }
  | { kind: 'hit'; action: string; rect: Rect }

export interface Measurer {
  measure(text: string, font: FontStyle): number
}

export interface AtomSize extends Size {
  /** 顶部到文本基线的距离 */
  baseline: number
}

export interface InlineContext {
  theme: { codeFontFamily: string; [key: string]: unknown }
  measurer: Measurer
  node: MarkmapNode
  wrapWidth?: number
  defer?(task: Promise<unknown>): void
}

export interface AtomRenderer<T> {
  measure(inline: T, style: TextStyle, ctx: InlineContext): AtomSize
  render(inline: T, box: Rect, style: TextStyle, ctx: InlineContext): Primitive[]
}

export interface InlineStyler<T> {
  (inline: T, style: TextStyle, ctx: InlineContext): StyleResult
}

export interface ContentPlugin {
  name: string
  transform?(content: unknown[], node: MarkmapNode): unknown[]
  styles?: Record<string, InlineStyler<any>>
  atoms?: Record<string, AtomRenderer<any>>
}

export interface MarkmapNode {
  id: string
  type: 'listItem' | 'heading' | string
  content: unknown[]
  notes: unknown[]
  data: Record<string, unknown>
  children: MarkmapNode[]
}

export interface NodeState {
  selected?: boolean
  editing?: boolean
  dragging?: boolean
  dimmed?: boolean
}

export type Side = 'left' | 'right'

/**
 * 按侧折叠状态，键是节点 id。
 *
 * 只有双侧布局的根节点会同时向左右生长、因而有两个折叠点；其余节点最多整体折叠。
 */
export type FoldedSides = Readonly<Record<string, { left?: boolean; right?: boolean }>>

export interface HitResult {
  type: 'node' | 'toggle' | 'link' | 'blank'
  id?: string
  /** `toggle` 命中根节点某一侧的圆点时，指明是哪一侧 */
  side?: Side
}

export interface ExportOptions {
  scale?: number
  padding?: number
  /** `true` 用当前配色的纸色；`'paper'` 同上但会按 colorScheme 解析成真实色值；字符串即填充色 */
  background?: boolean | Paint
  /** 导出配色：与视图不同时会用该 scheme 的主题重新渲染一遍 */
  colorScheme?: 'light' | 'dark'
  foldAll?: boolean
}

/** 引擎唯一耦合面：controller.ts 是唯一实现。 */
export interface Engine {
  mount(
    el: HTMLElement,
    opts: {
      tree: MarkmapNode
      folded: string[]
      foldedSides?: FoldedSides
      layout: 'two-sided' | 'tree'
    },
  ): void
  /** `animate: false` 用于换文档：不要从上一份图的节点位置补间过来 */
  setTree(root: MarkmapNode, opts?: { animate?: boolean }): void
  setFoldedIds(ids: string[], opts?: { animate?: boolean }): void
  /** 按侧折叠（双侧布局的根节点）；与 `setFoldedIds` 一起决定最终折叠状态 */
  setFoldedSides(sides: FoldedSides, opts?: { animate?: boolean }): void
  setLayout(layout: 'two-sided' | 'tree'): void
  setTheme(theme: unknown): void
  /** `settle`：打开文档时在动画结束后再校一次，防止量尺寸早于布局稳定 */
  fit(opts?: { animate?: boolean; settle?: boolean }): void
  center(): void
  zoomBy(factor: number): void
  zoomTo(k: number): void
  getZoom(): number
  screenRect(id: string): Rect | null
  /** 布局坐标下的节点矩形（拖拽冻结几何用；viewport 变了也不用重算） */
  layoutRects(): Record<string, Rect>
  layoutPoint(clientX: number, clientY: number): Point | null
  /** 布局坐标 → 视口（client）坐标；`layoutPoint` 的逆运算 */
  screenPoint(x: number, y: number): Point | null
  hitAt(x: number, y: number): HitResult | null
  setNodeStates(states: Record<string, NodeState>): void
  setOverlay(primitives: Primitive[]): void
  clearOverlay(): void
  measureNode(text: string, opts: { depth: number; branch: number }): Size
  toSVG(opts?: ExportOptions): string
  toPNG(opts?: ExportOptions): Promise<Blob>
  on(event: string, cb: (payload?: any) => void): () => void
  destroy(): void
}
