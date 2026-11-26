import { BRANCH_COLORS, CHROME, DARK_CHROME } from './palette'
import { getStyle } from './styles'
import type { NodeStyleId, StylePalette, StyleSpec } from './styles'

/**
 * 莫奈主题：只负责**配色**，形状与几何全部交给 `styles/` 里的样式协议。
 *
 * 这样加一套节点样式不用碰这个文件；换配色也不用碰样式。
 * 仍然保持「纯数据」：不依赖 fork 的类型，controller 搭桥时再翻译成上游 `Theme`。
 */

/** 根节点某一侧（只取引擎 `Side` 里的水平方向，不依赖 fork 的类型） */
export type WashSide = 'left' | 'right'

export type MonetScheme = 'light' | 'dark'

export interface MonetTheme {
  name: 'monet'
  scheme: MonetScheme
  /** 当前节点样式 */
  style: NodeStyleId
  branch: readonly string[]
  chrome: typeof CHROME
  fonts: { family: string; size: number; lineHeight: number; codeFamily: string }
  /** 注入给样式的配色能力 */
  palette: StylePalette
  /** 已按配色实例化的样式：盒子、装饰、锚点、折叠点、导线都由它决定 */
  spec: StyleSpec
}

const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif'

const CODE_FAMILY =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

/** 分支色按索引取，越界回绕 */
export function branchAt(index: number): string {
  const count = BRANCH_COLORS.length
  return BRANCH_COLORS[((Math.trunc(index) % count) + count) % count]
}

export function createMonetTheme(
  scheme: MonetScheme = 'light',
  style: NodeStyleId = 'card',
): MonetTheme {
  const chrome = scheme === 'dark' ? (DARK_CHROME as unknown as typeof CHROME) : CHROME
  const palette: StylePalette = {
    scheme,
    paper: chrome.paper,
    panel: chrome.panel,
    text: chrome.text,
    accent: chrome.accent,
    branch: branchAt,
  }
  return {
    name: 'monet',
    scheme,
    style,
    branch: BRANCH_COLORS,
    chrome,
    fonts: { family: FONT_FAMILY, size: 15, lineHeight: 1.5, codeFamily: CODE_FAMILY },
    palette,
    spec: getStyle(style).create(palette),
  }
}
