import type { Anchor, Primitive } from '@markmap/core'
import { toggleCenter } from './card'
import { rootCard, rootCardPaint } from './root-card'
import { fade, mix, outset, sCurve, washStops } from './shape'
import type { BoxMetrics, StyleDefinition, StyleSpec } from './types'

/**
 * 逐层弱化：始终是卡片，只是一层比一层「退后」。
 *
 * 弱化是多维度的，按顺序发生：先收边框（第 4 级彻底消失），再收内边距和圆角，
 * 字号微收敛，**底色永远保留**。到第 4 级后所有参数冻结，深层不会再继续退化，
 * 喜欢卡片观感的人不会在某一层「掉出」卡片范式。
 */

/** 折叠点半径：比卡片样式小一点，深色卡片上不那么抢眼 */
const TOGGLE_RADIUS = 6

/** 冻结层数：`k` 到这里就不再增长 */
const MAX_STEP = 3

const FILL_RATIO = [0.2, 0.16, 0.12, 0.09]
const STROKE_ALPHA = [1, 0.55, 0.25, 0]
const STROKE_WIDTH = [1.5, 1.2, 1, 1]
const PADDING_X = [14, 11, 9, 8]
const PADDING_Y = [8, 6, 5, 4]
const RADIUS = [12, 10, 9, 8]
const FONT_SIZE = [15, 14, 14, 13]
const TEXT_RATIO = [0.55, 0.5, 0.45, 0.42]

const stepOf = (depth: number) => Math.min(Math.max(depth - 1, 0), MAX_STEP)

export const fadeStyle: StyleDefinition = {
  id: 'fade',
  label: '逐层弱化',
  create(palette): StyleSpec {
    const colorOf = (branch: number) => palette.branch(branch)

    const metrics = (look: Parameters<StyleSpec['metrics']>[0]): BoxMetrics => {
      if (look.isRoot) {
        return {
          padding: [10, 20, 10, 20],
          minHeight: 24,
          font: { size: 17, weight: 600 },
          textFill: palette.text,
        }
      }
      const k = stepOf(look.depth)
      return {
        padding: [PADDING_Y[k], PADDING_X[k], PADDING_Y[k], PADDING_X[k]],
        minHeight: 22,
        font: { size: FONT_SIZE[k], weight: look.depth === 1 ? 500 : 400 },
        textFill: mix(palette.text, colorOf(look.branch), TEXT_RATIO[k]),
      }
    }

    return {
      id: 'fade',
      label: '逐层弱化',
      metrics,

      chrome(look, box) {
        const color = colorOf(look.branch)
        if (look.isRoot) {
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

        const k = stepOf(look.depth)
        const alpha = STROKE_ALPHA[k]
        const rect: Primitive = {
          kind: 'rect',
          x: 0,
          y: 0,
          w: box.width,
          h: box.height,
          r: RADIUS[k],
          fill: mix(palette.paper, color, FILL_RATIO[k]),
          ...(alpha > 0
            ? { stroke: fade(mix(palette.paper, color, 0.85), alpha), strokeWidth: STROKE_WIDTH[k] }
            : {}),
        }
        return [rect]
      },

      anchor(rect, side): Anchor {
        const y = rect.y + rect.height / 2
        if (side === 'left') return { x: rect.x, y, side }
        if (side === 'right') return { x: rect.x + rect.width, y, side }
        const x = rect.x + rect.width / 2
        return { x, y: side === 'top' ? rect.y : rect.y + rect.height, side }
      },

      toggle(look) {
        if (!look.hasChildren) return null
        const center = toggleCenter(look.box, look.side, TOGGLE_RADIUS)
        const color = colorOf(look.branch)
        // 越深颜色越淡：折叠点跟着一起退后，但它本身是不透明的小实体，所以只淡描边
        const ring = fade(mix(palette.paper, color, 0.85), STROKE_ALPHA[stepOf(look.depth)] || 0.5)
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
              stroke: ring,
              strokeWidth: 1.5,
            },
          ],
        }
      },

      edge(from, to, look) {
        return [
          {
            kind: 'group',
            opacity: 0.7,
            children: [
              {
                kind: 'path',
                d: sCurve(outset(from, 2), to),
                stroke: mix(palette.paper, colorOf(look.branch), Math.max(0.5, 1 - 0.1 * look.depth)),
                strokeWidth: Math.max(1, 1.2 + 2.4 / 2 ** Math.max(0, look.depth)),
              },
            ],
          },
        ]
      },
    }
  },
}
