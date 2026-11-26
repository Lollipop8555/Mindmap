import { cardStyle } from './card'
import { fadeStyle } from './fade'
import { vineStyle } from './vine'
import type { NodeStyleId, StyleDefinition } from './types'

export * from './types'
export { TOGGLE_GAP, TOGGLE_RADIUS } from './card'
export { vineWidth, vineTone } from './vine'

/** 切换顺序：卡片 → 藤蔓 → 逐层弱化 */
export const NODE_STYLES: readonly StyleDefinition[] = [cardStyle, vineStyle, fadeStyle]

export const NODE_STYLE_IDS: readonly NodeStyleId[] = NODE_STYLES.map((style) => style.id)

export function getStyle(id: NodeStyleId): StyleDefinition {
  return NODE_STYLES.find((style) => style.id === id) ?? cardStyle
}

/** 按当前样式取下一个（工具栏循环切换用） */
export function nextStyle(id: NodeStyleId): NodeStyleId {
  const index = NODE_STYLE_IDS.indexOf(id)
  return NODE_STYLE_IDS[(index + 1) % NODE_STYLE_IDS.length]
}
