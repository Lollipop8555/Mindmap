import type { Rect } from './types'
import type { DropTarget } from '@/mindmap/model'

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

/** 幽灵节点应出现的位置与朝向 */
export function ghostPlacement(
  geo: Geometry,
  target: DropTarget,
  size: { width: number; height: number },
): { x: number; y: number; side: -1 | 0 | 1 } | null {
  if (target.kind === 'sibling') {
    const parent = geo.nodes[target.parentId]
    if (!parent) return null
    const ids = parent.children
    const index = Math.max(0, Math.min(target.index, ids.length))
    const before = geo.rects[ids[index - 1]]
    const after = geo.rects[ids[index]]
    const ref = after ?? before
    if (!ref) return null
    const y = after && before ? (before.y + before.height + after.y) / 2 - size.height / 2 : ref.y
    const side = geo.nodes[ids[index]]?.side ?? geo.nodes[ids[index - 1]]?.side ?? 0
    const x = side === -1 ? ref.x + ref.width - size.width : ref.x
    return { x, y, side }
  }

  const parent = geo.nodes[target.parentId]
  const parentRect = geo.rects[target.parentId]
  if (!parent || !parentRect) return null
  const side = parent.id === geo.rootId ? 1 : (parent.side || 1)
  const lastChild = parent.children.length
    ? geo.rects[parent.children[parent.children.length - 1]]
    : undefined

  const GAP = 32
  if (lastChild) {
    return {
      x: side === -1 ? lastChild.x + lastChild.width - size.width : lastChild.x,
      y: lastChild.y + lastChild.height + GAP,
      side,
    }
  }
  return {
    x: side === -1 ? parentRect.x - size.width - GAP : parentRect.x + parentRect.width + GAP,
    y: parentRect.y + parentRect.height + GAP,
    side,
  }
}

/** 落点导线：从父节点连到落点，端点就是「将来接上去的那一点」 */
export interface DropGuide {
  /** 布局坐标系下的 SVG path */
  path: string
  /** 导线端点（落点），用来画一个小圆 */
  dot: { x: number; y: number }
  /** 走向：-1 向左 / 1 向右 / 0 向下（单侧树形布局） */
  side: -1 | 0 | 1
}

/** 父节点朝向子节点的锚点 */
function parentAnchor(rect: Rect, side: -1 | 0 | 1) {
  if (side === -1) return { x: rect.x, y: rect.y + rect.height / 2 }
  if (side === 1) return { x: rect.x + rect.width, y: rect.y + rect.height / 2 }
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height }
}

/** 幽灵节点朝父节点那一侧的锚点 */
function placementAnchor(placement: { x: number; y: number; width: number; height: number }, side: -1 | 0 | 1) {
  if (side === -1) return { x: placement.x + placement.width, y: placement.y + placement.height / 2 }
  if (side === 1) return { x: placement.x, y: placement.y + placement.height / 2 }
  return { x: placement.x + placement.width / 2, y: placement.y }
}

function guidePath(from: { x: number; y: number }, to: { x: number; y: number }, side: -1 | 0 | 1): string {
  if (side === 0) {
    const midY = (from.y + to.y) / 2
    return `M${from.x},${from.y}C${from.x},${midY} ${to.x},${midY} ${to.x},${to.y}`
  }
  const midX = (from.x + to.x) / 2
  return `M${from.x},${from.y}C${midX},${from.y} ${midX},${to.y} ${to.x},${to.y}`
}

/**
 * 拖拽落点导线（纯几何，不参与布局）。用 parent → 落点的一条曲线把「会长在哪里」
 * 直接画出来：线不占位置，两个挨得很紧的节点之间也放得下。
 */
export function dropGuide(
  geo: Geometry,
  target: DropTarget,
  placement: { x: number; y: number; width: number; height: number; side: -1 | 0 | 1 },
): DropGuide | null {
  const parent = geo.rects[target.parentId]
  if (!parent) return null
  const side = placement.side
  const from = parentAnchor(parent, side)
  const to = placementAnchor(placement, side)
  if (Math.hypot(to.x - from.x, to.y - from.y) < 8) return null
  return { path: guidePath(from, to, side), dot: to, side }
}

/** 插入指示线（画在间隙带中央） */
export function insertIndicator(
  geo: Geometry,
  target: DropTarget,
): { x1: number; x2: number; y: number } | null {
  if (target.kind !== 'sibling') return null
  const parent = geo.nodes[target.parentId]
  if (!parent) return null
  const ids = parent.children
  const index = Math.max(0, Math.min(target.index, ids.length))
  const before = geo.rects[ids[index - 1]]
  const after = geo.rects[ids[index]]
  const ref = after ?? before
  if (!ref) return null
  const y = after && before ? (before.y + before.height + after.y) / 2 : after ? after.y : (before!.y + before!.height)
  const x1 = Math.min(ref.x, before ? before.x : ref.x)
  const x2 = Math.max(ref.x + ref.width, before ? before.x + before.width : ref.x + ref.width)
  return { x1, x2, y }
}
