import type { Rect } from './types'
import type { DropTarget } from '@/mindmap/model'
import { TOGGLE_GAP } from './theme'

/**
 * 拖拽命中判定（纯函数）。几何在 pointerdown 时冻结，这里只读快照，
 * 不做任何布局计算 —— 目标不会因为"其他节点让位"而跑掉。
 */

export interface GeoNode {
  id: string
  parentId: string | null
  children: string[]
  depth: number
  /** 相对父节点的方向：-1 左 / 1 右 / 0 同一列（单侧布局） */
  side: -1 | 0 | 1
}

export interface Geometry {
  rects: Record<string, Rect>
  nodes: Record<string, GeoNode>
  rootId: string
  layout: 'two-sided' | 'tree'
}

export interface DragOptions {
  /** 按住 Alt 强制"成为子节点"，忽略间隙带 */
  alt?: boolean
  /** 上一次的目标，用于滞回 */
  previous?: DropTarget | null
  /** 进入新目标所需的额外深入距离（屏幕像素） */
  hysteresisPx?: number
  /** 当前缩放，用于把屏幕像素换算成布局像素 */
  zoom?: number
}

const NODE_INFLATE = 6
const GAP_BAND = 14
const HYSTERESIS = 12

export function forbiddenSet(geo: Geometry, draggedId: string): Set<string> {
  const out = new Set<string>()
  const walk = (id: string) => {
    if (out.has(id)) return
    out.add(id)
    geo.nodes[id]?.children.forEach(walk)
  }
  walk(draggedId)
  return out
}

function inside(point: { x: number; y: number }, rect: Rect, inflate: number, inset = 0): boolean {
  return (
    point.x >= rect.x - inflate + inset &&
    point.x <= rect.x + rect.width + inflate - inset &&
    point.y >= rect.y - inflate + inset &&
    point.y <= rect.y + rect.height + inflate - inset
  )
}

function center(rect: Rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

interface Band {
  parentId: string
  index: number
  rect: Rect
}

/** 收集所有"同级间隙带"：由同一父级、同一侧、相邻兄弟之间的空隙构成 */
function collectBands(geo: Geometry): Band[] {
  const bands: Band[] = []
  for (const parent of Object.values(geo.nodes)) {
    if (parent.children.length < 1) continue
    const groups = new Map<string, string[]>()
    for (const cid of parent.children) {
      const child = geo.nodes[cid]
      if (!child) continue
      const key = String(child.side)
      const list = groups.get(key) ?? []
      list.push(cid)
      groups.set(key, list)
    }
    for (const [key, ids] of groups) {
      const sorted = [...ids].sort((a, b) => (geo.rects[a]?.y ?? 0) - (geo.rects[b]?.y ?? 0))
      const side = Number(key) as -1 | 0 | 1
      for (let i = 0; i < sorted.length - 1; i += 1) {
        const a = geo.rects[sorted[i]]
        const b = geo.rects[sorted[i + 1]]
        if (!a || !b) continue
        const top = a.y + a.height
        const bottom = b.y
        if (bottom - top < 2) continue
        const x1 = Math.min(a.x, b.x)
        const x2 = Math.max(a.x + a.width, b.x + b.width)
        bands.push({
          parentId: parent.id,
          index: parent.children.indexOf(sorted[i]) + 1,
          rect: { x: x1, y: top, width: x2 - x1, height: bottom - top },
        })
      }
      // 首尾的空隙带（插到最前 / 最后）
      const firstRect = geo.rects[sorted[0]]
      const lastRect = geo.rects[sorted[sorted.length - 1]]
      if (firstRect) {
        bands.push({
          parentId: parent.id,
          index: parent.children.indexOf(sorted[0]),
          rect: { x: firstRect.x, y: firstRect.y - GAP_BAND * 2, width: firstRect.width, height: GAP_BAND * 2 },
        })
      }
      if (lastRect) {
        bands.push({
          parentId: parent.id,
          index: parent.children.indexOf(sorted[sorted.length - 1]) + 1,
          rect: {
            x: lastRect.x,
            y: lastRect.y + lastRect.height,
            width: lastRect.width,
            height: GAP_BAND * 2,
          },
        })
      }
      void side
    }
  }
  return bands
}

function sameTarget(a: DropTarget | null | undefined, b: DropTarget | null): boolean {
  if (!a || !b) return a === b
  if (a.kind !== b.kind) return false
  if (a.parentId !== b.parentId) return false
  return a.kind === 'sibling' ? a.index === (b as { index: number }).index : true
}

/** 命中判定。point 为布局坐标（由 layoutPoint 换算）。 */
export function resolveDrop(
  geo: Geometry,
  draggedId: string,
  point: { x: number; y: number },
  opts: DragOptions = {},
): DropTarget | null {
  const forbidden = forbiddenSet(geo, draggedId)
  const zoom = Math.max(0.1, opts.zoom ?? 1)
  const hysteresis = (opts.hysteresisPx ?? HYSTERESIS) / zoom
  const inflate = NODE_INFLATE / zoom

  // 1) 节点矩形：成为子节点
  let nodeHit: { id: string; dist: number } | null = null
  for (const [id, rect] of Object.entries(geo.rects)) {
    if (forbidden.has(id)) continue
    if (!inside(point, rect, inflate)) continue
    const dist = distance(point, center(rect))
    if (!nodeHit || dist < nodeHit.dist) nodeHit = { id, dist }
  }

  // 2) 间隙带：同级排序（优先级高于节点矩形，但带很窄）
  let bandHit: { band: Band; dist: number } | null = null
  if (!opts.alt) {
    for (const band of collectBands(geo)) {
      if (forbidden.has(band.parentId)) continue
      if (!inside(point, band.rect, 0)) continue
      const dist = Math.abs(point.y - (band.rect.y + band.rect.height / 2))
      if (!bandHit || dist < bandHit.dist) bandHit = { band, dist }
    }
  }

  const makeBandTarget = (band: Band): DropTarget => ({
    kind: 'sibling',
    parentId: band.parentId,
    index: band.index,
  })

  let result: DropTarget | null = bandHit ? makeBandTarget(bandHit.band) : null
  if (!result && nodeHit) result = { kind: 'child', parentId: nodeHit.id }

  // 3) 滞回：换成新目标需要"深入"一段距离
  if (result && opts.previous && !sameTarget(opts.previous, result)) {
    const deep = deepHit(geo, point, result, hysteresis, forbidden)
    if (!deep) return opts.previous
  }
  return result
}

function deepHit(
  geo: Geometry,
  point: { x: number; y: number },
  target: DropTarget,
  inset: number,
  forbidden: Set<string>,
): boolean {
  if (target.kind === 'child') {
    const rect = geo.rects[target.parentId]
    if (!rect) return false
    if (forbidden.has(target.parentId)) return false
    return inside(point, rect, 0, inset)
  }
  // sibling：要求指针在该父级的任一子节点列范围内，且离带中心不超过带高
  const parent = geo.nodes[target.parentId]
  if (!parent) return false
  const rects = parent.children.map((cid) => geo.rects[cid]).filter(Boolean) as Rect[]
  if (!rects.length) return false
  const x1 = Math.min(...rects.map((r) => r.x))
  const x2 = Math.max(...rects.map((r) => r.x + r.width))
  return point.x >= x1 + inset && point.x <= x2 - inset
}

/** 落点导线：从父节点的连接点连到「将来这个节点接线的地方」 */
export interface DropGuide {
  /** 布局坐标系下的 SVG path */
  path: string
  /** 落点圆点（将来新节点接线的位置） */
  dot: { x: number; y: number }
  /** 走向：-1 向左 / 1 向右 */
  side: -1 | 1
}

/** 落点离相邻节点的距离（布局单位）：只画圆点时，别贴着节点块 */
const EDGE_GAP = 9

/** 同一父级下，ref 这一支是往右还是往左长 */
function growsRight(parentRect: Rect, ref: Rect): boolean {
  return ref.x + ref.width / 2 >= parentRect.x + parentRect.width / 2
}

/** 布局里相邻两列之间的水平间距（取中位数，单侧/双侧布局都适用） */
function levelGapOf(geo: Geometry): number {
  const gaps: number[] = []
  for (const node of Object.values(geo.nodes)) {
    if (!node.parentId) continue
    const self = geo.rects[node.id]
    const parent = geo.rects[node.parentId]
    if (!self || !parent) continue
    const gap =
      self.x >= parent.x + parent.width
        ? self.x - (parent.x + parent.width)
        : parent.x - (self.x + self.width)
    if (gap > 8 && gap < 400) gaps.push(gap)
  }
  if (!gaps.length) return 80
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]
}

/**
 * 落点：将来新节点的「接线位置」（主题里连线和折叠圆点都在这个点的高度）。
 * 只画导线不画节点块，所以它落在两个节点块中间 / 首尾之外，而不是给整块节点让位置。
 */
export function dropAnchor(
  geo: Geometry,
  target: DropTarget,
): { x: number; y: number; side: -1 | 1 } | null {
  const parent = geo.nodes[target.parentId]
  const parentRect = geo.rects[target.parentId]
  if (!parent || !parentRect) return null

  if (target.kind === 'sibling') {
    const ids = parent.children
    const index = Math.max(0, Math.min(target.index, ids.length))
    const before = geo.rects[ids[index - 1]]
    const after = geo.rects[ids[index]]
    const ref = after ?? before
    if (!ref) return null
    const right = growsRight(parentRect, ref)
    // 上下都有节点 → 落在两块正中；只有一侧有 → 落在它外侧一点
    const y =
      before && after
        ? (before.y + before.height + after.y) / 2
        : after
          ? after.y - EDGE_GAP
          : before!.y + before!.height + EDGE_GAP
    return { x: right ? ref.x : ref.x + ref.width, y, side: right ? 1 : -1 }
  }

  // 成为子节点：接在这一列最后一个子节点之后；这一列还空着就长在父节点旁边
  const kids = parent.children
    .map((id) => geo.rects[id])
    .filter((rect): rect is Rect => !!rect)
  const last = kids[kids.length - 1]
  if (last) {
    const right = growsRight(parentRect, last)
    return {
      x: right ? last.x : last.x + last.width,
      y: last.y + last.height + EDGE_GAP,
      side: right ? 1 : -1,
    }
  }
  const right = parent.side !== -1
  const gap = levelGapOf(geo)
  return {
    x: right ? parentRect.x + parentRect.width + gap : parentRect.x - gap,
    y: parentRect.y + parentRect.height / 2,
    side: right ? 1 : -1,
  }
}

/**
 * 父节点的出线点：必须和主题画的真实连线起点逐像素一致，见 theme.ts：
 * 锚点取左右两侧边的「中点」，再沿该侧外推 {@link TOGGLE_GAP}（线头藏进折叠圆点）。
 */
function parentAnchor(rect: Rect, side: -1 | 1): { x: number; y: number } {
  const y = rect.y + rect.height / 2
  return side === -1
    ? { x: rect.x - TOGGLE_GAP, y }
    : { x: rect.x + rect.width + TOGGLE_GAP, y }
}

/** 和真实父子连线同一种 S 曲线：从父节点引出、水平进入落点 */
function sCurvePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const midX = (from.x + to.x) / 2
  return `M${from.x},${from.y}C${midX},${from.y} ${midX},${to.y} ${to.x},${to.y}`
}

/** 由主题提供出线点：不同节点样式的锚点高度不一样（卡片取侧边中点，藤蔓取主干基线） */
export type ParentAnchorOf = (
  rect: Rect,
  side: -1 | 1,
  depth: number,
) => { x: number; y: number }

/**
 * 拖拽落点导线（纯几何，不参与布局）：从父节点的连接点画一条曲线到落点圆点。
 * 不画节点块，所以线本身就能表达「要插在哪儿」，也不会挡住相邻节点。
 *
 * `anchorOf` 缺省时按卡片样式取锚点；传了就必须跟主题当前样式一致，
 * 否则幽灵导线和真实连线会在纵向错开一截。
 */
export function dropGuide(
  geo: Geometry,
  target: DropTarget,
  anchorOf?: ParentAnchorOf,
): DropGuide | null {
  const parentRect = geo.rects[target.parentId]
  const parent = geo.nodes[target.parentId]
  const anchor = dropAnchor(geo, target)
  if (!parentRect || !anchor) return null
  const from = anchorOf
    ? anchorOf(parentRect, anchor.side, parent?.depth ?? 0)
    : parentAnchor(parentRect, anchor.side)
  if (Math.hypot(anchor.x - from.x, anchor.y - from.y) < 6) return null
  return {
    path: sCurvePath(from, anchor),
    dot: { x: anchor.x, y: anchor.y },
    side: anchor.side,
  }
}
