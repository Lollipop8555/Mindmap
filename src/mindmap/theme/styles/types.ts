import type { Anchor, Point, Primitive, Rect, Side, Size } from '@markmap/core'

/**
 * 节点样式协议。
 *
 * 一套样式只描述「长什么样」：盒子内边距、字体、装饰图元、锚点、折叠点和导线。
 * 颜色、字体族、深浅色由 {@link StylePalette} 注入，布局/折叠/编辑/导出完全不动。
 *
 * 加一套新样式 = 新写一个文件并注册，不需要改其它样式或渲染层。
 */

export type NodeStyleId = 'card' | 'fade' | 'vine'

/** 样式能用的配色能力，由 MonetTheme 按浅色/深色注入。 */
export interface StylePalette {
  scheme: 'light' | 'dark'
  /** 画布纸色：淡出、遮罩、混色都以它为基准 */
  paper: string
  /** 卡片底色（比纸面高一层） */
  panel: string
  /** 正文色 */
  text: string
  /** 主题主色：根节点这类「不属于任何分支」的元素用它 */
  accent: string
  /** 一级分支色，索引自动取模 */
  branch(index: number): string
}

/** 根节点知道的「一级子节点去哪一侧、什么颜色」，用于根卡片晕染与根主干取色。 */
export interface ChildHint {
  branch: number
  side: Side
}

/** 一个节点在样式眼里是什么。 */
export interface NodeLook {
  depth: number
  /** 一级分支下标，整棵子树继承 */
  branch: number
  isRoot: boolean
  hasChildren: boolean
  folded: boolean
  direction: Side
  /** 根节点专有：每个一级子节点的分支与所在侧（文档顺序） */
  children: ChildHint[]
}

export interface EdgeLook {
  /** 子节点深度，父节点就是 `depth - 1` */
  depth: number
  branch: number
  folded: boolean
}

/** 折叠点既要知道节点身份，也要知道盒子多大、贴哪一侧。 */
export interface ToggleLook extends NodeLook {
  box: Size
  /** 折叠点贴的盒子边（双侧根节点左右各一个） */
  side: Side
}

/** 排版参数：内边距决定盒子，字体决定行高，文字色决定可读性。 */
export interface BoxMetrics {
  padding: [number, number, number, number]
  minHeight: number
  font: { size: number; weight: number }
  textFill: string
}

/** 折叠点：圆心（节点局部坐标）+ 画出来的图元。 */
export interface ToggleVisual {
  center: Point
  primitives: Primitive[]
}

/** 已按配色实例化的一套样式。 */
export interface StyleSpec {
  id: NodeStyleId
  label: string
  metrics(look: NodeLook): BoxMetrics
  /** 节点局部坐标（盒子左上角是 0,0）里的装饰：卡片、下划线、圆点…… */
  chrome(look: NodeLook, box: Size): Primitive[]
  /** 导线在盒子上的出入点，布局坐标 */
  anchor(rect: Rect, side: Side, look: NodeLook): Anchor
  /** `null` 表示这套样式不提供折叠点 */
  toggle(look: ToggleLook): ToggleVisual | null
  edge(from: Anchor, to: Anchor, look: EdgeLook): Primitive[]
}

/** 注册表里存的工厂：配色一变就重新实例化。 */
export interface StyleDefinition {
  id: NodeStyleId
  label: string
  create(palette: StylePalette): StyleSpec
}
