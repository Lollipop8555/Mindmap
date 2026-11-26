import {
  CHROME,
  DARK_CHROME,
  DARK_TONE_BG,
  DARK_TONE_INK,
  TONE_BG,
  TONE_INK,
  type Tone,
} from '@/mindmap/theme/palette'

/**
 * 富内联的颜色随主题走。
 *
 * 内容插件是纯函数、按图元出颜色（canvas 导出需要真实色值，不能给 CSS 变量），
 * 所以主题切换时由引擎把当前 scheme 写进这里，渲染时再取。
 */
let dark = false

export function setInlineScheme(scheme: 'light' | 'dark'): void {
  dark = scheme === 'dark'
}

export function inlineChrome() {
  return dark ? DARK_CHROME : CHROME
}

export function toneInk(tone: Tone): string {
  return dark ? DARK_TONE_INK[tone] : TONE_INK[tone]
}

export function toneBg(tone: Tone): string {
  return dark ? DARK_TONE_BG[tone] : TONE_BG[tone]
}
