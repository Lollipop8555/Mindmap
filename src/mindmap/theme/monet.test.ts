import { describe, expect, it } from 'vitest'
import { BRANCH_COLORS } from './palette'
import { createMonetTheme } from './monet'

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastOnWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05)
}

describe('monet theme', () => {
  it('builds the root gradient from the first-level branch colours', () => {
    const theme = createMonetTheme('dark')
    const root = theme.node(0, 3, { root: true, childBranches: [3, 8, 3, 5] })
    // 去重后剩 3 档（顺序保持）
    expect(root.gradient).toHaveLength(3)
    expect(root.gradient?.[0]).toBe(root.fill)
    expect(new Set(root.gradient ?? []).size).toBe(3)
  })

  it('caps the root gradient so it does not turn into stripes', () => {
    const theme = createMonetTheme('dark')
    const all = BRANCH_COLORS.map((_, i) => i)
    const root = theme.node(0, 0, { root: true, childBranches: [...all, ...all] })
    expect(root.gradient).toHaveLength(6)
    // 抽样保留首尾
    expect(root.gradient?.[0]).toBe(theme.node(0, 0, { childBranches: [0] }).fill)
  })

  it('falls back to a flat tone without children', () => {
    const theme = createMonetTheme('light')
    const root = theme.node(0, 4, { root: true, childBranches: [] })
    expect(root.gradient).toBeUndefined()
    expect(root.fill).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('keeps white text readable on every gradient stop', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const theme = createMonetTheme(scheme)
      const root = theme.node(0, 0, {
        root: true,
        childBranches: BRANCH_COLORS.map((_, i) => i),
      })
      for (const stop of root.gradient ?? []) {
        expect(contrastOnWhite(stop), `${scheme} ${stop}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('leaves the level-1 card colours alone', () => {
    const theme = createMonetTheme('light')
    const card = theme.node(1, 2)
    expect(card.card).toBe(true)
    expect(card.gradient).toBeUndefined()
    expect(card.strokeWidth).toBe(1.5)
  })
})
