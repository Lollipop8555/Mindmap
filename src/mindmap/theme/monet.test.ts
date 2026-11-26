import { describe, expect, it } from 'vitest'
import { BRANCH_COLORS } from './palette'
import { createMonetTheme, type WashSide } from './monet'

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const allBranches = BRANCH_COLORS.map((_, i) => i)

describe('monet theme', () => {
  it('tints each side of the root with that side branch colours', () => {
    const theme = createMonetTheme('light')
    const root = theme.node(0, 0, {
      root: true,
      childBranches: [3, 8, 3, 5],
      childSides: ['right', 'right', 'left', 'left'],
    })
    expect(root.root?.washes.right).toHaveLength(2)
    expect(root.root?.washes.left).toHaveLength(2)
    // 底色就是主题卡片色，不再是把分支色压暗后的色带
    expect(root.root?.base).toBe(root.fill)
  })

  it('defaults a missing side to the right', () => {
    const theme = createMonetTheme('light')
    const root = theme.node(0, 0, { root: true, childBranches: [1, 2] })
    expect(root.root?.washes.right).toHaveLength(2)
    expect(root.root?.washes.left).toBeUndefined()
  })

  it('caps the stops of one side so it does not turn into stripes', () => {
    const theme = createMonetTheme('dark')
    const sides: WashSide[] = allBranches.map(() => 'right')
    const root = theme.node(0, 0, { root: true, childBranches: allBranches, childSides: sides })
    expect(root.root?.washes.right).toHaveLength(4)
  })

  it('falls back to a plain card without children', () => {
    const theme = createMonetTheme('light')
    const root = theme.node(0, 4, { root: true, childBranches: [] })
    expect(root.root?.washes).toEqual({})
    expect(root.root?.base).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('keeps root text readable on the tinted base', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const theme = createMonetTheme(scheme)
      const root = theme.node(0, 0, {
        root: true,
        childBranches: allBranches,
        childSides: allBranches.map(() => 'right'),
      })
      expect(contrast(root.textFill, root.root!.base), `${scheme} text`).toBeGreaterThanOrEqual(4.5)
      // 反色描边：跟底色必须有区分，否则浅底卡片在浅色画布上看不出形状
      expect(contrast(root.root!.stroke, root.root!.base), `${scheme} stroke`).toBeGreaterThan(1.2)
    }
  })

  it('leaves the level-1 card colours alone', () => {
    const theme = createMonetTheme('light')
    const card = theme.node(1, 2)
    expect(card.card).toBe(true)
    expect(card.root).toBeUndefined()
    expect(card.strokeWidth).toBe(1.5)
  })
})
