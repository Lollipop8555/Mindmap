import { describe, expect, it } from 'vitest'
import type { Primitive, Size } from '@markmap/core'
import { BRANCH_COLORS, CHROME } from './palette'
import { createMonetTheme } from './monet'
import { washStops } from './styles/shape'
import { vineTone, vineWidth } from './styles/vine'
import type { NodeLook } from './styles'

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const look = (patch: Partial<NodeLook> = {}): NodeLook => ({
  depth: 0,
  branch: 0,
  isRoot: false,
  hasChildren: true,
  folded: false,
  direction: 'right',
  children: [],
  ...patch,
})

const box: Size = { width: 160, height: 28 }

/** 所有 custom 图元拼成的字符串，方便断言里面有没有渐变/遮罩 */
const markupOf = (primitives: Primitive[]): string =>
  primitives
    .map((item) => (item.kind === 'custom' ? (item.svg?.() ?? '') : ''))
    .join('')

const allBranches = BRANCH_COLORS.map((_, i) => i)

describe('monet theme', () => {
  it('tints each side of the root card with that side branch colours', () => {
    const theme = createMonetTheme('light')
    const chrome = theme.spec.chrome(
      look({
        isRoot: true,
        children: [
          { branch: 3, side: 'right' },
          { branch: 8, side: 'right' },
          { branch: 3, side: 'left' },
          { branch: 5, side: 'left' },
        ],
      }),
      box,
    )
    const markup = markupOf(chrome)
    // 两侧各一条竖向色标；重复的分支色（3 出现两次）只留一个色标
    expect(markup.match(/<linearGradient id="[^"]*-tone-left"/g)).toHaveLength(1)
    expect(markup.match(/<linearGradient id="[^"]*-tone-right"/g)).toHaveLength(1)
    expect(markup).toContain(CHROME.panel)
  })

  it('draws a plain card when the root has no children', () => {
    const theme = createMonetTheme('light')
    const markup = markupOf(theme.spec.chrome(look({ isRoot: true }), box))
    expect(markup).not.toContain('tone-')
    expect(markup).toContain(CHROME.panel)
  })

  it('caps the stops of one side so it does not turn into stripes', () => {
    const theme = createMonetTheme('dark')
    const stops = washStops(
      theme.palette,
      allBranches,
      (branch) => theme.palette.branch(branch),
    )
    expect(stops).toHaveLength(4)
  })

  it('keeps root text readable on the tinted base', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const theme = createMonetTheme(scheme)
      const metrics = theme.spec.metrics(
        look({
          isRoot: true,
          children: allBranches.map((branch) => ({ branch, side: 'right' as const })),
        }),
      )
      expect(contrast(metrics.textFill, theme.palette.panel), `${scheme} text`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('leaves the level-1 card alone', () => {
    const theme = createMonetTheme('light')
    const [card] = theme.spec.chrome(look({ depth: 1, branch: 2 }), box)
    expect(card.kind).toBe('rect')
    if (card.kind !== 'rect') throw new Error('expected a rect')
    expect(card.strokeWidth).toBe(1.5)
    expect(card.r).toBe(12)
  })
})

describe('vine style', () => {
  it('uses a single theme accent for the root instead of a rainbow bar', () => {
    const theme = createMonetTheme('light', 'vine')
    const markup = markupOf(theme.spec.chrome(look({ isRoot: true }), box))
    expect(markup).toContain(CHROME.accent)
    expect(markup).not.toContain('linearGradient')
  })

  it('thins out per level and stops at a floor', () => {
    expect(vineWidth(0)).toBe(5)
    expect(vineWidth(0)).toBeGreaterThan(vineWidth(1))
    expect(vineWidth(1)).toBeGreaterThan(vineWidth(2))
    expect(vineWidth(8)).toBe(1.8)
    expect(vineWidth(12)).toBe(1.8)
  })

  it('fades the root into every first-level branch with a gradient taper', () => {
    const theme = createMonetTheme('light', 'vine')
    const [edge] = theme.spec.edge(
      { x: 0, y: 20, side: 'right' },
      { x: 120, y: 60, side: 'left' },
      { depth: 1, branch: 2, folded: false },
    )
    expect(edge.kind).toBe('custom')
    const markup = markupOf([edge])
    expect(markup).toContain('linearGradient')
    // 主色 → 分支色：一色分出多色
    expect(markup).toContain(`stop-color="${CHROME.accent}"`)
    expect(markup).toContain(`stop-color="${theme.palette.branch(2)}"`)
    // 实心锥形一层就够，不再靠遮罩叠两条描边
    expect(markup).not.toContain('<mask')
  })

  it('tapers every deeper branch in width and colour, flush with the parent line', () => {
    const theme = createMonetTheme('light', 'vine')
    const [edge] = theme.spec.edge(
      { x: 100, y: 20, side: 'right' },
      { x: 220, y: 60, side: 'left' },
      { depth: 3, branch: 2, folded: false },
    )
    const markup = markupOf([edge])
    expect(markup).toContain('linearGradient')
    expect(markup).not.toContain('<mask')
    // 父端色 → 子端色：接头处不能只有宽度连续、颜色却跳变
    const tone = (depth: number) => vineTone(theme.palette.paper, theme.palette.branch(2), depth)
    expect(markup).toContain(`stop-color="${tone(2)}"`)
    expect(markup).toContain(`stop-color="${tone(3)}"`)
    // defs 是静态的，动画期间只有 d 变，渲染层就能就地打补丁
    expect(markup).toMatch(/^<defs>.*<\/defs><path d="[^"]*" style="[^"]*"\/>$/)

    const d = /<path d="([^"]*)"/.exec(markup)?.[1] ?? ''
    expect(d.endsWith('Z')).toBe(true)
    const points = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(
      (match) => [Number(match[1]), Number(match[2])] as [number, number],
    )
    const half = points.length / 2
    const span = (a: [number, number], b: [number, number]) =>
      Math.hypot(a[0] - b[0], a[1] - b[1])

    // 轮廓首尾各是一对法向偏移点，间距就是这一端的线宽：
    // 父端必须等于父下划线（depth 2 = 2.6），子端必须等于子下划线（depth 3 = 1.9）
    expect(span(points[0], points[points.length - 1])).toBeCloseTo(2.6, 1)
    expect(span(points[half - 1], points[half])).toBeCloseTo(1.9, 1)
    // 两端都不缩进：v1 的 2px 外推会让枝条和节点下划线之间露出细缝
    expect(points[0][0]).toBe(100)
    expect(points[half - 1][0]).toBe(220)
  })
})

describe('fade style', () => {
  it('still has a background at any depth, and drops the border first', () => {
    const theme = createMonetTheme('light', 'fade')
    const [mid] = theme.spec.chrome(look({ depth: 3, branch: 1 }), box)
    const [deep] = theme.spec.chrome(look({ depth: 6, branch: 1 }), box)
    if (mid.kind !== 'rect' || deep.kind !== 'rect') throw new Error('expected rects')
    expect(deep.fill).toBeTruthy()
    expect(deep.stroke).toBeUndefined()
    expect(mid.stroke).toBeTruthy()
  })

  it('freezes the metrics once it is deep enough', () => {
    const theme = createMonetTheme('light', 'fade')
    const a = theme.spec.metrics(look({ depth: 4 }))
    const b = theme.spec.metrics(look({ depth: 9 }))
    expect(b.padding).toEqual(a.padding)
    expect(b.font).toEqual(a.font)
  })
})
