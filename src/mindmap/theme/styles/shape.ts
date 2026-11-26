import type { Anchor, Paint, Primitive } from '@markmap/core'
import type { StylePalette } from './types'

/** 图元坐标保留两位小数：SVG 里没必要写一长串浮点 */
export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** djb2，够用的稳定短哈希，用来给 `<defs>` 里的渐变/遮罩起不会撞车的 id */
export function hashOf(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i += 1) hash = ((hash * 33) ^ input.charCodeAt(i)) >>> 0
  return hash.toString(36)
}

/** 两个 `#rrggbb` 按比例混色，`ratio` 是后者占的比重 */
export function mix(hex: string, other: string, ratio: number): string {
  const parse = (value: string) => {
    const clean = value.replace('#', '')
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
    return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16))
  }
  const [r1, g1, b1] = parse(hex)
  const [r2, g2, b2] = parse(other)
  const to = (a: number, b: number) => Math.round(a * (1 - ratio) + b * ratio)
  return `#${[to(r1, r2), to(g1, g2), to(b1, b2)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')}`
}

/** 半透明色值：图元级 opacity 会被组选中态等复用，能烘进颜色就烘进去 */
export function fade(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
  return `rgba(${r},${g},${b},${Math.round(alpha * 100) / 100})`
}

/** 水平 S 形曲线；竖向布局退化成竖直曲线。两端切线都是水平的，接线段时不用改角度。 */
export function sCurve(from: Anchor, to: Anchor): string {
  if (from.side === 'top' || from.side === 'bottom') {
    const midY = (from.y + to.y) / 2
    return `M${from.x},${from.y}C${from.x},${midY} ${to.x},${midY} ${to.x},${to.y}`
  }
  const midX = (from.x + to.x) / 2
  return `M${from.x},${from.y}C${midX},${from.y} ${midX},${to.y} ${to.x},${to.y}`
}

/** 把锚点沿它所在的一侧再往外推 `gap`（左侧向左、右侧向右，上下同理） */
export function outset(anchor: Anchor, gap: number): Anchor {
  if (anchor.side === 'left') return { ...anchor, x: anchor.x - gap }
  if (anchor.side === 'right') return { ...anchor, x: anchor.x + gap }
  if (anchor.side === 'top') return { ...anchor, y: anchor.y - gap }
  return { ...anchor, y: anchor.y + gap }
}

/** 导线：单条纯色路径。 */
export function strokePath(d: string, stroke: Paint, strokeWidth: number): Primitive {
  return { kind: 'path', d, stroke, strokeWidth }
}

/** 单侧色标上限：根节点只有一两百像素宽，色档再多就成条纹了 */
const MAX_WASH_STOPS = 4

/**
 * 一侧的晕染色标：按该侧一级分支的文档顺序去重后取色。
 *
 * 分支本来就被「用得最少的颜色优先」分配，顺序即视觉顺序（两侧都是自上而下），
 * 所以直接按顺序铺；分支太多时等距抽样（保留首尾），避免小卡片上出现细密条纹。
 */
export function washStops(
  palette: StylePalette,
  branches: readonly number[],
  tone: (branch: number) => string,
): string[] {
  const seen = new Set<string>()
  const picked: number[] = []
  for (const raw of branches) {
    const color = palette.branch(raw)
    if (seen.has(color)) continue
    seen.add(color)
    picked.push(raw)
  }
  if (picked.length <= MAX_WASH_STOPS) return picked.map(tone)
  const last = picked.length - 1
  return Array.from({ length: MAX_WASH_STOPS }, (_, i) =>
    tone(picked[Math.round((i * last) / (MAX_WASH_STOPS - 1))]),
  )
}

/** token 化的渐变定义，几个样式共用 */
export interface GradientStop {
  offset: number
  color: string
}

/**
 * 一条 `userSpaceOnUse` 的线性渐变。
 *
 * 用绝对坐标而不是 `objectBoundingBox`：水平直线的包围盒高度是 0，
 * 按包围盒取渐变会直接不渲染。
 */
export function linearGradient(
  id: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  stops: GradientStop[],
): string {
  return (
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
    `x1="${round2(from.x)}" y1="${round2(from.y)}" x2="${round2(to.x)}" y2="${round2(to.y)}">` +
    stops
      .map(
        (stop) =>
          `<stop offset="${round2(stop.offset * 100)}%" stop-color="${stop.color}"/>`,
      )
      .join('') +
    `</linearGradient>`
  )
}
