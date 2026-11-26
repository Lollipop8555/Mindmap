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

export interface HitResult {
  type: 'node' | 'toggle' | 'link' | 'blank'
  id?: string
}

export interface ExportOptions {
  scale?: number
  padding?: number
  background?: boolean | Paint
  colorScheme?: 'light' | 'dark'
  foldAll?: boolean
}

/** 引擎唯一耦合面：controller.ts 是唯一实现。 */
export interface Engine {
  mount(el: HTMLElement, opts: { tree: MarkmapNode; folded: string[]; layout: 'two-sided' | 'tree' }): void
  /** `animate: false` 用于换文档：不要从上一份图的节点位置补间过来 */
  setTree(root: MarkmapNode, opts?: { animate?: boolean }): void
  setFoldedIds(ids: string[], opts?: { animate?: boolean }): void
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
