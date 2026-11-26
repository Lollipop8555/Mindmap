import { BRANCH_COLORS, CHROME, DARK_CHROME } from './palette'

/**
 * 莫奈主题的**纯数据描述**。不依赖 fork 的类型：
 * controller 在搭桥时把它翻译成上游 `Theme`（node/edge 的 render 回调）。
 * 这样主题可以单测，也能同时服务 SVG / canvas 导出。
 */

export interface NodeVisual {
  fill: string
  stroke: string
  strokeWidth: number
  textFill: string
  fontSize: number
  fontWeight: number
  radius: number
  paddingX: number
  paddingY: number
  /** 二级以下不画卡片，只画左侧圆点 */
  card: boolean
  dot?: { size: number; color: string }
}

export interface EdgeVisual {
  stroke: string
  strokeWidth: number
  opacity: number
  dashed: boolean
}

export interface MonetTheme {
  name: 'monet'
  scheme: 'light' | 'dark'
  branch: readonly string[]
  chrome: typeof CHROME
  fonts: { family: string; size: number; lineHeight: number; codeFamily: string }
  node(depth: number, branchIndex: number, opts?: { root?: boolean; hasChildren?: boolean }): NodeVisual
  edge(depth: number, branchIndex: number, folded?: boolean): EdgeVisual
  toggle(branchIndex: number, folded: boolean): { stroke: string; fill: string; radius: number }
}

const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif'

const CODE_FAMILY =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

function mix(hex: string, other: string, ratio: number): string {
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

export function createMonetTheme(scheme: 'light' | 'dark' = 'light'): MonetTheme {
  const chrome = scheme === 'dark' ? (DARK_CHROME as unknown as typeof CHROME) : CHROME
  const paper = chrome.paper
  const branchAt = (index: number) => BRANCH_COLORS[((index % BRANCH_COLORS.length) + BRANCH_COLORS.length) % BRANCH_COLORS.length]

  return {
    name: 'monet',
    scheme,
    branch: BRANCH_COLORS,
    chrome,
    fonts: { family: FONT_FAMILY, size: 15, lineHeight: 1.5, codeFamily: CODE_FAMILY },

    node(depth, branchIndex, opts = {}) {
      const color = branchAt(branchIndex)
      if (opts.root || depth === 0) {
        // 暗色下用更深的同色相底色，白字才有对比；直接用亮色 accent 会发灰
        const rootFill = scheme === 'dark' ? '#2d5f71' : chrome.accent
        return {
          fill: rootFill,
          stroke: rootFill,
          strokeWidth: 0,
          textFill: '#ffffff',
          fontSize: 17,
          fontWeight: 600,
          // 不用胶囊：多行时 rx 会被撑成椭圆，圆角反而把首尾字挤出形状
          radius: 14,
          paddingX: 20,
          paddingY: 10,
          card: true,
        }
      }
      if (depth === 1) {
        return {
          fill: mix(paper, color, 0.2),
          stroke: mix(paper, color, 0.85),
          strokeWidth: 1.5,
          textFill: mix(chrome.text, color, 0.55),
          fontSize: 15,
          fontWeight: 500,
          radius: 12,
          paddingX: 14,
          paddingY: 8,
          card: true,
        }
      }
      return {
        fill: 'transparent',
        stroke: 'none',
        strokeWidth: 0,
        textFill: mix(chrome.text, color, 0.4),
        fontSize: 14,
        fontWeight: 400,
        radius: 8,
        paddingX: 8,
        paddingY: 4,
        card: false,
        dot: { size: 5, color },
      }
    },

    edge(depth, branchIndex, folded = false) {
      const color = branchAt(branchIndex)
      return {
        stroke: color,
        strokeWidth: Math.max(1, 1 + 3 / 2 ** Math.max(0, depth)),
        opacity: 0.75,
        dashed: folded,
      }
    },

    toggle(branchIndex, folded) {
      return {
        stroke: branchAt(branchIndex),
        fill: folded ? branchAt(branchIndex) : paper,
        radius: 7,
      }
    },
  }
}
