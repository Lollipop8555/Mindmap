/**
 * 分支色板：与 tokens.css 的 --mm-b0..9 保持一致（canvas 需要真实色值，不能只靠 CSS 变量）。
 *
 * 顺序与 {@link TONES} 一一对应：同一索引既是分支色，也是徽标色，
 * 这样「绿叶」「琥珀」之类的语义名和画布上的颜色不会各说各话。
 * 色相拉开、饱和度略高，相邻分支一眼能分；纯色仍留一点灰度，避免霓虹感。
 */
export const BRANCH_COLORS = [
  '#6b8ca3', // slate 石板蓝
  '#4a8fd4', // blue 湖蓝
  '#4f9f7d', // sage 鼠尾草绿
  '#c99a3a', // amber 琥珀
  '#d2698c', // rose 玫红
  '#8a76cf', // violet 紫罗兰
  '#c9724c', // clay 陶土橙
  '#5c9a4f', // moss 苔绿
  '#4ba3b8', // mist 雾青
  '#a877c9', // wisteria 藤紫
] as const

export const TONES = ['slate', 'blue', 'sage', 'amber', 'rose', 'violet', 'clay', 'moss', 'mist', 'wisteria'] as const
export type Tone = (typeof TONES)[number]

export function isTone(value: unknown): value is Tone {
  return typeof value === 'string' && (TONES as readonly string[]).includes(value)
}

function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
  const [ar, ag, ab] = parse(a)
  const [br, bg, bb] = parse(b)
  const to = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0')
  return `#${to(ar, br)}${to(ag, bg)}${to(ab, bb)}`
}

const toneAt = (index: number) => BRANCH_COLORS[index % BRANCH_COLORS.length]

/**
 * 半透明色值。SVG 图元（拖拽导线）不吃 CSS 变量，也不支持图元级 opacity，
 * 只能把透明度直接烘进颜色里。
 */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
  return `rgba(${r},${g},${b},${Math.round(alpha * 100) / 100})`
}

/** 徽标墨色：分支色压暗，保证浅底上可读 */
export const TONE_INK: Record<Tone, string> = Object.fromEntries(
  TONES.map((tone, index) => [tone, mixHex(toneAt(index), '#26303a', 0.3)]),
) as Record<Tone, string>

/** 徽标底色：分支色调到接近白，做低饱和淡底 */
export const TONE_BG: Record<Tone, string> = Object.fromEntries(
  TONES.map((tone, index) => [tone, mixHex('#ffffff', toneAt(index), 0.16)]),
) as Record<Tone, string>

export const CHROME = {
  paper: '#faf8f3',
  panel: '#ffffff',
  text: '#33404a',
  textSoft: '#7c8a93',
  line: '#e6e1d7',
  accent: '#3f8095',
  danger: '#c9603f',
  codeBg: '#eee9df',
  codeText: '#8a6f4e',
  link: '#3f7fa0',
} as const

export const DARK_CHROME = {
  paper: '#15171c',
  panel: '#1d2027',
  text: '#e4e6e9',
  textSoft: '#8e979f',
  line: '#2b2f37',
  accent: '#5fa8bd',
  danger: '#d98d7c',
  codeBg: '#262a32',
  codeText: '#d3b58a',
  link: '#5fa8bd',
} as const

/**
 * 暗色下的徽标/进度条：淡底换成暗底 + 同色相微光，墨色提亮。
 * 由亮色板推导，避免两套手写色值漂移。
 */
export const DARK_TONE_BG: Record<Tone, string> = Object.fromEntries(
  TONES.map((tone, index) => [tone, mixHex(DARK_CHROME.panel, toneAt(index), 0.22)]),
) as Record<Tone, string>

export const DARK_TONE_INK: Record<Tone, string> = Object.fromEntries(
  TONES.map((tone, index) => [tone, mixHex(DARK_CHROME.text, toneAt(index), 0.62)]),
) as Record<Tone, string>

/** 文本颜色名 → 色值（`:color[文字]{c="rose"}` 用） */
export const NAMED_COLORS: Record<string, string> = Object.fromEntries(
  TONES.map((tone, index) => [tone, toneAt(index)]),
)
