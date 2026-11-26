import { BRANCH_COLORS, CHROME, DARK_CHROME } from './palette'

/**
 * 莫奈主题的**纯数据描述**。不依赖 fork 的类型：
 * controller 在搭桥时把它翻译成上游 `Theme`（node/edge 的 render 回调）。
 * 这样主题可以单测，也能同时服务 SVG / canvas 导出。
 */

/**
 * 根节点卡片：中性底色 + 按侧晕染。
 *
 * 底色跟主题一致（浅色主题浅底深字、深色主题深底浅字），描边取反色保证形状清楚；
 * 每侧的分支色按文档顺序（自上而下）淡染成一条竖向推移，从卡片那一侧边缘向中间淡出。
 * 只用「这一侧有哪些颜色、大概什么顺序」表达归属，不求跟连线位置逐一对齐。
 */
export interface RootCard {
  /** 卡片底色，跟画布同族但高一层，浅底/深底都靠它和纸面区分 */
  base: string
  /** 反色描边：浅底给深线、深底给浅线 */
  stroke: string
  /** 每侧的分支色标（已混到接近底色），没有分支的一侧缺省 */
  washes: { left?: string[]; right?: string[] }
}

/** 根节点的某一侧（只取引擎 `Side` 里的水平方向，不依赖 fork 的类型） */
export type WashSide = 'left' | 'right'

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
  /** 根节点专用 */
  root?: RootCard
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
  node(
    depth: number,
    branchIndex: number,
    opts?: {
      root?: boolean
      hasChildren?: boolean
      childBranches?: readonly number[]
      /** 一级子节点各自的侧，与 {@link childBranches} 一一对应（缺省视为右侧） */
      childSides?: readonly WashSide[]
    },
  ): NodeVisual
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

/** 单侧色标上限：根节点只有一两百像素宽，色档再多就成条纹了 */
const MAX_WASH_STOPS = 4

/**
 * 一侧的晕染色标：按该侧一级分支的文档顺序去重后取色。
 *
 * 分支本来就被「用得最少的颜色优先」分配，顺序即视觉顺序（两侧都是自上而下），
 * 所以直接按顺序铺；分支太多时等距抽样（保留首尾），避免小卡片上出现细密条纹。
 */
function washStops(branches: readonly number[], tone: (branch: number) => string): string[] {
  const seen = new Set<number>()
  const picked: number[] = []
  for (const raw of branches) {
    const key = ((Math.trunc(raw) % BRANCH_COLORS.length) + BRANCH_COLORS.length) % BRANCH_COLORS.length
    if (seen.has(key)) continue
    seen.add(key)
    picked.push(key)
  }
  if (picked.length <= MAX_WASH_STOPS) return picked.map(tone)
  const last = picked.length - 1
  return Array.from({ length: MAX_WASH_STOPS }, (_, i) =>
    tone(picked[Math.round((i * last) / (MAX_WASH_STOPS - 1))]),
  )
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
        // 根节点不再是「多色色带」：底色跟主题同族（浅底深字 / 深底浅字），
        // 两侧各自按该侧分支色自上而下淡染，只用色调和顺序表达「这边这些分支从我这出去」。
        const base = chrome.panel
        const ratio = scheme === 'dark' ? 0.46 : 0.3
        const tone = (branch: number) => mix(base, branchAt(branch), ratio)
        const branches = opts.childBranches ?? []
        const sides = opts.childSides ?? []
        const perSide: Record<WashSide, number[]> = { left: [], right: [] }
        branches.forEach((branch, index) => perSide[sides[index] === 'left' ? 'left' : 'right'].push(branch))
        const left = washStops(perSide.left, tone)
        const right = washStops(perSide.right, tone)
        return {
          fill: base,
          stroke: base,
          strokeWidth: 0,
          textFill: chrome.text,
          fontSize: 17,
          fontWeight: 600,
          // 不用胶囊：多行时 rx 会被撑成椭圆，圆角反而把首尾字挤出形状
          radius: 14,
          paddingX: 20,
          paddingY: 10,
          card: true,
          root: {
            base,
            // 反色描边：浅底压深、深底提亮，形状永远看得出来
            stroke: mix(base, chrome.text, scheme === 'dark' ? 0.28 : 0.22),
            washes: { ...(left.length ? { left } : {}), ...(right.length ? { right } : {}) },
          },
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
