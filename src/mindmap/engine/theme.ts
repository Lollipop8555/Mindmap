import type {
  Anchor,
  EdgeContext,
  FontStyle,
  MarkmapNode,
  MeasureContext,
  NodeContext,
  Primitive,
  Rect,
  Side,
  Size,
  Theme,
} from '@markmap/core'
import { CONTENT_TOKENS, DARK_CONTENT_TOKENS } from '@markmap/render'
import type { MonetTheme, NodeVisual, RootCard, WashSide } from '@/mindmap/theme/monet'

/**
 * 把纯数据的 {@link MonetTheme} 翻译成上游引擎的 `Theme`。
 *
 * 上游的 `Theme.node` 只接受全局字体/文字色/内边距，我们先打了三处 fork 补丁
 * （`node.font` / `node.textFill` / `node.boxPadding`），这里按深度与分支色驱动它们。
 */

/** 非卡片节点留给小圆点的空间（两侧对称，方向切换时盒子宽度不变） */
const DOT_GUTTER = 14
/**
 * 折叠圆点到节点盒子边缘的间隙。留一点才不黏在卡片上；连线起点也按同样距离外推
 * （见 {@link outset}），卡片与圆点之间就不会露出一截线头「尖尖」。
 * 拖拽的幽灵导线要跟自己画的连线完全对齐，所以这个常量对外导出。
 */
export const TOGGLE_GAP = 2

const isSide = (side: Side): side is 'left' | 'right' => side === 'left' || side === 'right'

function branchOf(node: MarkmapNode): number {
  const value = node.data?.branch
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function depthOf(ctx: MeasureContext | NodeContext): number {
  return ctx.depth
}

export function createEngineTheme(monet: MonetTheme): Theme {
  const visualOf = (node: MarkmapNode, ctx: MeasureContext | NodeContext): NodeVisual => {
    const depth = depthOf(ctx)
    return monet.node(depth, branchOf(node), {
      root: depth === 0,
      hasChildren: ctx.hasChildren,
      // 根节点的两侧晕染取自一级分支色，子节点的顺序就是建树时的顺序
      childBranches: depth === 0 ? node.children.map(branchOf) : undefined,
      childSides:
        depth === 0
          ? ctx.childSides?.map((side): WashSide => (side === 'left' ? 'left' : 'right'))
          : undefined,
    })
  }

  const fontOf = (visual: NodeVisual): FontStyle => ({
    family: monet.fonts.family,
    size: visual.fontSize,
    weight: visual.fontWeight,
    style: 'normal',
    // 上游的 lineHeight 是像素，MonetTheme 存的是倍数
    lineHeight: Math.round(visual.fontSize * monet.fonts.lineHeight),
  })

  const paddingOf = (visual: NodeVisual): [number, number, number, number] => [
    visual.paddingY,
    visual.card ? visual.paddingX : DOT_GUTTER,
    visual.paddingY,
    visual.card ? visual.paddingX : DOT_GUTTER,
  ]

  const contentTokens = monet.scheme === 'dark' ? DARK_CONTENT_TOKENS : CONTENT_TOKENS

  return {
    name: 'monet',
    tokens: {
      ...contentTokens,
      'mm-bg': monet.chrome.paper,
      'mm-text': monet.chrome.text,
      'mm-edge': monet.chrome.line,
      'mm-code-bg': monet.scheme === 'dark' ? '#2a3038' : '#eceff2',
      'mm-link': monet.chrome.accent,
    },
    font: {
      family: monet.fonts.family,
      size: monet.fonts.size,
      weight: 400,
      style: 'normal',
      lineHeight: Math.round(monet.fonts.size * monet.fonts.lineHeight),
    },
    codeFontFamily: monet.fonts.codeFamily,
    textFill: monet.chrome.text,
    node: {
      padding: [8, 14, 8, 14],
      minHeight: 24,
      font: (node, ctx) => fontOf(visualOf(node, ctx)),
      textFill: (node, ctx) => visualOf(node, ctx).textFill,
      boxPadding: (node, ctx) => paddingOf(visualOf(node, ctx)),
      anchor(rect, side) {
        if (side === 'top') return { x: rect.x + rect.width / 2, y: rect.y, side }
        if (side === 'bottom') return { x: rect.x + rect.width / 2, y: rect.y + rect.height, side }
        return {
          x: side === 'left' ? rect.x : rect.x + rect.width,
          y: rect.y + rect.height / 2,
          side,
        }
      },
      render(node, box, ctx) {
        const visual = visualOf(node, ctx)
        const out: Primitive[] = []
        if (visual.card) {
          const strokeWidth = visual.strokeWidth > 0 ? visual.strokeWidth : undefined
          if (visual.root) {
            out.push(rootCard(box, visual.radius, visual.root))
          } else {
            out.push({
              kind: 'rect',
              x: 0,
              y: 0,
              w: box.width,
              h: box.height,
              r: visual.radius,
              fill: visual.fill,
              ...(strokeWidth ? { stroke: visual.stroke, strokeWidth } : {}),
            })
          }
        } else {
          if (visual.dot) {
            const { size, color } = visual.dot
            out.push({
              kind: 'rect',
              // 小圆点永远贴在「父节点来的那一侧」：右侧分支在左缘，左侧分支镜像到右缘，
              // 否则双侧模式下左半边是从右往左生长的，点会落在远离连线的另一头。
              x: ctx.direction === 'left' ? box.width - size : 0,
              y: box.height / 2 - size / 2,
              w: size,
              h: size,
              r: size / 2,
              fill: color,
            })
          }
          // 叶子节点没有背景，整块补一个透明矩形当成命中区：引擎的平移手势按
          // DOM 命中判断「按在节点上还是空白上」，文字是 pointer-events: none，
          // 小圆点又只有 5px，指针稍微偏一点就被当成空白，画布会跟着一起平移。
          out.push({ kind: 'rect', x: 0, y: 0, w: box.width, h: box.height, fill: 'transparent' })
        }
        if (ctx.hasChildren) {
          // 双侧根节点两侧各有一个折叠点，各自收起自己那一侧；其余节点只有一个
          const dots: { side: Side; folded: boolean }[] = ctx.sides
            ? (['left', 'right'] as const)
                .filter((side) => ctx.sides![side].present)
                .map((side) => ({ side, folded: ctx.sides![side].folded }))
            : [{ side: ctx.direction, folded: ctx.folded }]
          for (const dot of dots) {
            const toggle = monet.toggle(branchOf(node), dot.folded)
            const r = toggle.radius
            const at = toggleCenter(box.width, box.height, dot.side, r)
            out.push({
              kind: 'rect',
              x: at.x - r,
              y: at.y - r,
              w: r * 2,
              h: r * 2,
              r,
              fill: toggle.fill,
              stroke: toggle.stroke,
              strokeWidth: 1.5,
            })
          }
        }
        return out
      },
      toggleAnchor(rect, side, ctx) {
        // 圆点画在盒子外侧，命中中心必须跟视觉圆心重合，否则只有「正中间」才点得中
        const radius = monet.toggle(0, ctx.folded).radius
        const at = toggleCenter(rect.width, rect.height, side, radius)
        return { x: rect.x + at.x, y: rect.y + at.y }
      },
    },
    edge: {
      render(from, to, ctx) {
        const visual = monet.edge(ctx.node.depth, branchOf(ctx.target), ctx.node.folded)
        return [
          {
            kind: 'group',
            opacity: visual.opacity,
            children: [
              {
                kind: 'path',
                // 起点跟折叠圆点一起外移，线头就藏在圆点下面，不会再顶出一根尖尖
                d: edgePath(outset(from, TOGGLE_GAP), to),
                stroke: visual.stroke,
                strokeWidth: visual.strokeWidth,
              },
            ],
          },
        ]
      },
    },
  }
}

/**
 * 晕染从卡片那一侧边缘往中间淡出的距离（占卡片宽度的比例）。
 * 大于 0.5 时两侧会轻微交叠，中间自然融成一片，不会出现一道生硬的分界。
 */
const WASH_FADE = 0.62

/**
 * 根节点卡片：中性底 + 每侧一条竖向色标（按该侧分支顺序）+ 反色描边。
 *
 * 只用一个 `custom` 图元拼出来：
 * - `clipPath` 把底色和晕染裁进圆角；
 * - 每侧一条竖向 `linearGradient`（上→下即文档顺序），再用一张横向的亮度遮罩
 *   （边缘亮、中间黑）让它只在边缘显色、向中心淡出；
 * - 最上层再描一圈反色边。
 *
 * id 由内容算出来，换配色/改子节点颜色都会自动换新 id，不会撞上旧定义。
 */
function rootCard(box: Size, radius: number, card: RootCard): Primitive {
  const width = round(box.width)
  const height = round(box.height)
  const sides = (['left', 'right'] as const).filter((side) => card.washes[side]?.length)
  const id = `mm-root-${hashOf(
    [card.base, card.stroke, width, height, radius, ...sides.map((s) => card.washes[s]!.join(','))].join('|'),
  )}`
  const clip = `${id}-clip`
  const defs = [`<clipPath id="${clip}"><rect x="0" y="0" width="${width}" height="${height}" rx="${radius}"/></clipPath>`]
  const washes: string[] = []
  for (const side of sides) {
    const stops = card.washes[side]!
    const step = Math.max(1, stops.length - 1)
    const toneId = `${id}-tone-${side}`
    const fadeId = `${id}-fade-${side}`
    const maskId = `${id}-mask-${side}`
    defs.push(
      `<linearGradient id="${toneId}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${height}">` +
        stops
          .map(
            (color, i) =>
              `<stop offset="${round((i / step) * 100)}%" stop-color="${color}"/>`,
          )
          .join('') +
        `</linearGradient>`,
    )
    // 亮度遮罩：边缘白（显色）→ 内侧黑（透明），横向淡出
    const near = side === 'left' ? 0 : width
    const far = side === 'left' ? round(width * WASH_FADE) : round(width * (1 - WASH_FADE))
    defs.push(
      `<linearGradient id="${fadeId}" gradientUnits="userSpaceOnUse" x1="${near}" y1="0" x2="${far}" y2="0">` +
        `<stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#000000"/>` +
        `</linearGradient>`,
    )
    defs.push(
      `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">` +
        `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#${fadeId})"/>` +
        `</mask>`,
    )
    washes.push(
      `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#${toneId})" mask="url(#${maskId})"/>`,
    )
  }
  const border = round(Math.max(0, radius - 0.5))
  return {
    kind: 'custom',
    svg: () =>
      `<defs>${defs.join('')}</defs>` +
      `<g clip-path="url(#${clip})">` +
      `<rect x="0" y="0" width="${width}" height="${height}" fill="${card.base}"/>` +
      washes.join('') +
      `</g>` +
      `<rect x="0.5" y="0.5" width="${round(width - 1)}" height="${round(height - 1)}" rx="${border}" ` +
      `fill="none" stroke="${card.stroke}" stroke-width="1"/>`,
  }
}

/** 图元坐标保留两位小数：SVG 里没必要写一长串浮点 */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** djb2，够用的稳定短哈希 */
function hashOf(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i += 1) hash = ((hash * 33) ^ input.charCodeAt(i)) >>> 0
  return hash.toString(36)
}

/** 把锚点沿它所在的一侧再往外推 `gap`（左侧向左，右侧向右，上下同理） */
function outset(anchor: Anchor, gap: number): Anchor {
  if (anchor.side === 'left') return { ...anchor, x: anchor.x - gap }
  if (anchor.side === 'right') return { ...anchor, x: anchor.x + gap }
  if (anchor.side === 'top') return { ...anchor, y: anchor.y - gap }
  return { ...anchor, y: anchor.y + gap }
}

/** 折叠圆点圆心，节点局部坐标：贴着盒子外侧 `radius + TOGGLE_GAP` 处 */
function toggleCenter(width: number, height: number, side: Side, radius: number) {
  const gap = radius + TOGGLE_GAP
  if (!isSide(side)) return { x: width / 2, y: side === 'top' ? -gap : height + gap }
  return { x: side === 'left' ? -gap : width + gap, y: height / 2 }
}

/** 水平 S 形曲线；竖向布局退化成竖直曲线 */
function edgePath(from: Anchor, to: Anchor): string {
  if (from.side === 'top' || from.side === 'bottom') {
    const midY = (from.y + to.y) / 2
    return `M${from.x},${from.y}C${from.x},${midY} ${to.x},${midY} ${to.x},${to.y}`
  }
  const midX = (from.x + to.x) / 2
  return `M${from.x},${from.y}C${midX},${from.y} ${midX},${to.y} ${to.x},${to.y}`
}

export type { EdgeContext }
