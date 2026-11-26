import type { Anchor, Primitive, Side, Size } from '@markmap/core'
import { rootCard, rootCardPaint } from './root-card'
import { mix, outset, sCurve, washStops } from './shape'
import type { BoxMetrics, StyleDefinition, StyleSpec } from './types'

/**
 * 卡片：现在的默认观感。
 *
 * 根节点是中性底 + 两侧晕染，一级是淡色卡，二级以下只剩左侧小圆点。
 * 折叠点贴在盒子外侧的中点，始终可见。
 */

/** 折叠圆点到节点盒子边缘的间隙。连线起点也按同样距离外推，线头就藏在圆点下面。 */
export const TOGGLE_GAP = 2
/** 折叠点半径 */
export const TOGGLE_RADIUS = 7
/** 非卡片节点留给小圆点的水平空间（两侧对称，方向切换时盒子宽度不变） */
const DOT_GUTTER = 14
const DOT_SIZE = 5

export const cardStyle: StyleDefinition = {
  id: 'card',
  label: '卡片',
  create(palette): StyleSpec {
    const branchOf = (look: { branch: number }) => palette.branch(look.branch)

    const metrics = (look: Parameters<StyleSpec['metrics']>[0]): BoxMetrics => {
      const color = branchOf(look)
      if (look.isRoot) {
        return {
          padding: [10, 20, 10, 20],
          minHeight: 24,
          font: { size: 17, weight: 600 },
          textFill: palette.text,
        }
      }
      if (look.depth === 1) {
        return {
          padding: [8, 14, 8, 14],
          minHeight: 24,
          font: { size: 15, weight: 500 },
          textFill: mix(palette.text, color, 0.55),
        }
      }
      return {
        padding: [4, DOT_GUTTER, 4, DOT_GUTTER],
        minHeight: 24,
        font: { size: 14, weight: 400 },
        textFill: mix(palette.text, color, 0.4),
      }
    }

    return {
      id: 'card',
      label: '卡片',
      metrics,

      chrome(look, box) {
        const color = branchOf(look)
        if (look.isRoot) {
          // 两侧各自按该侧分支色自上而下淡染，只用色调和顺序表达「这边这些分支从我这出去」
          const ratio = palette.scheme === 'dark' ? 0.46 : 0.3
          const tone = (branch: number) => mix(palette.panel, palette.branch(branch), ratio)
          const perSide: Record<'left' | 'right', number[]> = { left: [], right: [] }
          for (const child of look.children) perSide[child.side === 'left' ? 'left' : 'right'].push(child.branch)
          const left = washStops(palette, perSide.left, tone)
          const right = washStops(palette, perSide.right, tone)
          const paint = rootCardPaint(palette, {
            ...(left.length ? { left } : {}),
            ...(right.length ? { right } : {}),
          })
          return [rootCard(box, 14, paint)]
        }
        if (look.depth === 1) {
          return [
            {
              kind: 'rect',
              x: 0,
              y: 0,
              w: box.width,
              h: box.height,
              r: 12,
              fill: mix(palette.paper, color, 0.2),
              stroke: mix(palette.paper, color, 0.85),
              strokeWidth: 1.5,
            },
          ]
        }
        return [
          {
            // 小圆点永远贴在「父节点来的那一侧」：右侧分支在左缘，左侧分支镜像到右缘
            kind: 'rect',
            x: look.direction === 'left' ? box.width - DOT_SIZE : 0,
            y: box.height / 2 - DOT_SIZE / 2,
            w: DOT_SIZE,
            h: DOT_SIZE,
            r: DOT_SIZE / 2,
            fill: color,
          },
          // 叶子节点没有背景，整块补一个透明矩形当命中区，否则按在文字旁边会被当成空白
          { kind: 'rect', x: 0, y: 0, w: box.width, h: box.height, fill: 'transparent' },
        ]
      },

      anchor(rect, side, look): Anchor {
        const y = rect.y + rect.height / 2
        if (side === 'left') return { x: rect.x, y, side }
        if (side === 'right') return { x: rect.x + rect.width, y, side }
        const x = rect.x + rect.width / 2
        return { x, y: side === 'top' ? rect.y : rect.y + rect.height, side }
      },

      toggle(look) {
        if (!look.hasChildren) return null
        const center = toggleCenter(look.box, look.side, TOGGLE_RADIUS)
        const color = palette.branch(look.branch)
        return {
          center,
          primitives: [
            {
              kind: 'rect',
              x: center.x - TOGGLE_RADIUS,
              y: center.y - TOGGLE_RADIUS,
              w: TOGGLE_RADIUS * 2,
              h: TOGGLE_RADIUS * 2,
              r: TOGGLE_RADIUS,
              fill: look.folded ? color : palette.paper,
              stroke: color,
              strokeWidth: 1.5,
            },
          ],
        }
      },

      edge(from, to, look) {
        return [
          {
            kind: 'group',
            opacity: 0.75,
            children: [
              {
                kind: 'path',
                // 起点跟折叠圆点一起外移，线头藏在圆点下面，不会顶出一根尖尖
                d: sCurve(outset(from, TOGGLE_GAP), to),
                stroke: palette.branch(look.branch),
                strokeWidth: Math.max(1, 1 + 3 / 2 ** Math.max(0, look.depth)),
              },
            ],
          },
        ]
      },
    }
  },
}

/** 折叠点圆心，节点局部坐标：贴着盒子外侧 `radius + gap` 处 */
export function toggleCenter(box: Size, side: Side, radius: number) {
  const gap = radius + TOGGLE_GAP
  if (side === 'top' || side === 'bottom') {
    return { x: box.width / 2, y: side === 'top' ? -gap : box.height + gap }
  }
  return { x: side === 'left' ? -gap : box.width + gap, y: box.height / 2 }
}
