import type { Anchor, Point, Primitive, Size } from '@markmap/core'
import { hashOf, mix, round2 } from './shape'
import type { BoxMetrics, StyleDefinition, StyleSpec } from './types'

/**
 * 藤蔓：没有卡片，只有一条横跨内容宽度的下划线，节点像枝头的叶子。
 *
 * - 粗细表达层级：根最粗，往下递减，到第 3 级后不再变细。
 * - 颜色：根取主题主色（一色），一级子节点各自取一个分支色（多色），
 *   视觉上就是**一色分出多色**。
 * - 每一条导线都是「父节点的宽度与颜色 → 本级的宽度与颜色」的连续过渡，
 *   所以接头处既没有宽度台阶，也没有色阶。
 * - 更深的层同色相、逐级向纸色淡出，到底为止。
 * - 折叠点默认隐去，鼠标悬浮到节点上才显形（触摸设备常显）。
 */

/** 根主干的线宽 */
const ROOT_WIDTH = 5
/** 收细系数：一级 3.6、二级 2.6、三级 1.9…… */
const SHRINK = 0.72
/** 最细不再变细 */
const MIN_WIDTH = 1.8
/** 每深一级向纸色淡出的比例，以及淡出的下限 */
const TONE_FADE = 0.12
const TONE_FLOOR = 0.55

const TOGGLE_RADIUS = 6
/** 折叠点离盒子边缘的间隙 */
const TOGGLE_GAP = 2

/** 水平内边距：下划线要贴着文字，留一点呼吸即可 */
const PADDING_X = 6

/**
 * 层级线宽。`depth=0` 是根主干，之后按 {@link SHRINK} 收敛并在 {@link MIN_WIDTH} 处封底。
 */
export function vineWidth(depth: number): number {
  const raw = ROOT_WIDTH * SHRINK ** Math.max(0, depth)
  return round2(Math.max(MIN_WIDTH, raw))
}

/** 某个深度的枝条色：一级是纯分支色，之后逐级混向纸色 */
export function vineTone(paper: string, color: string, depth: number): string {
  if (depth <= 1) return color
  const alpha = Math.max(TONE_FLOOR, 1 - TONE_FADE * (depth - 1))
  return mix(paper, color, alpha)
}

export const vineStyle: StyleDefinition = {
  id: 'vine',
  label: '藤蔓',
  create(palette): StyleSpec {
    /** 节点自身的枝条色：根用主题主色，其余用分支色淡出 */
    const ownColor = (look: { isRoot: boolean; branch: number; depth: number }) =>
      look.isRoot ? palette.accent : vineTone(palette.paper, palette.branch(look.branch), look.depth)

    /** 父节点的枝条色：根的上一层不存在，`depth - 1` 就是父 */
    const parentColor = (depth: number, branch: number) =>
      depth <= 1 ? palette.accent : vineTone(palette.paper, palette.branch(branch), depth - 1)

    const metrics = (look: Parameters<StyleSpec['metrics']>[0]): BoxMetrics => {
      const width = vineWidth(look.depth)
      // 底部多留一条线的厚度：下划线画在盒子内，命中区才算得到它
      const bottom = (look.isRoot ? 10 : look.depth === 1 ? 8 : 4) + width
      const font =
        look.isRoot
          ? { size: 17, weight: 600 }
          : look.depth === 1
            ? { size: 15, weight: 500 }
            : { size: 14, weight: 400 }
      return {
        padding: [bottom - width, PADDING_X, bottom, PADDING_X],
        minHeight: 20,
        font,
        textFill: look.isRoot
          ? palette.text
          : mix(palette.text, palette.branch(look.branch), look.depth === 1 ? 0.55 : 0.4),
      }
    }

    return {
      id: 'vine',
      label: '藤蔓',
      metrics,

      chrome(look, box): Primitive[] {
        const width = vineWidth(look.depth)
        const y = round2(box.height - width / 2)
        const color = ownColor(look)
        return [
          {
            kind: 'custom',
            // 圆头线段用 custom：图元层的 path 只能给 fill/stroke/宽度，没法给 linecap
            svg: () =>
              `<path d="M0,${y}H${round2(box.width)}" ` +
              `style="fill:none;stroke:${color};stroke-width:${width};stroke-linecap:round"/>`,
          },
          // 整块透明命中区：藤蔓没有背景，不然按在文字旁边会被当成空白
          { kind: 'rect', x: 0, y: 0, w: box.width, h: box.height, fill: 'transparent' },
        ]
      },

      anchor(rect, side, look): Anchor {
        const width = vineWidth(look.depth)
        // 出入点都落在下划线基线上：曲线从主干里钻出来，切线水平，接得干净
        const y = round2(rect.y + rect.height - width / 2)
        if (side === 'left') return { x: rect.x, y, side }
        if (side === 'right') return { x: rect.x + rect.width, y, side }
        const x = rect.x + rect.width / 2
        return { x, y: side === 'top' ? rect.y : rect.y + rect.height, side }
      },

      toggle(look) {
        if (!look.hasChildren) return null
        const center = toggleSpot(look.box, look.side, look.depth)
        const color = ownColor(look)
        const r = TOGGLE_RADIUS
        // 展开时是一个空心「节」，收起时填实色；默认隐形，悬浮节点才淡入
        const fill = look.folded ? color : palette.paper
        const cls = look.folded ? 'mm-fold is-folded' : 'mm-fold'
        return {
          center,
          primitives: [
            {
              kind: 'custom',
              svg: () =>
                `<g class="${cls}">` +
                `<rect x="${round2(center.x - r)}" y="${round2(center.y - r)}" ` +
                `width="${r * 2}" height="${r * 2}" rx="${r}" ` +
                `style="fill:${fill};stroke:${color};stroke-width:1.5"/>` +
                `</g>`,
            },
          ],
        }
      },

      edge(from, to, look): Primitive[] {
        // 起笔就在父下划线的末端，不做卡片样式的「外推留白」：
        // 藤蔓是一根连着的枝，中间断开一像素都会看出来。
        // 线宽和颜色都得两头接着：从父下划线的宽度与颜色，收到本级的宽度与颜色。
        return [
          bandEdge(
            from,
            to,
            parentColor(look.depth, look.branch),
            vineTone(palette.paper, palette.branch(look.branch), look.depth),
            vineWidth(look.depth - 1),
            vineWidth(look.depth),
          ),
        ]
      },
    }
  },
}

/** 折叠点圆心（节点局部坐标）：贴在下划线基线、盒子外侧 */
function toggleSpot(box: Size, side: 'left' | 'right' | 'top' | 'bottom', depth: number): Point {
  const gap = TOGGLE_RADIUS + TOGGLE_GAP
  const y = round2(box.height - vineWidth(depth) / 2)
  if (side === 'left') return { x: -gap, y }
  if (side === 'right') return { x: round2(box.width + gap), y }
  return { x: round2(box.width / 2), y: side === 'top' ? -gap : round2(box.height + gap) }
}

/**
 * 一条沿贝塞尔曲线由 `fromWidth` 连续收到 `toWidth` 的实心枝条。
 *
 * SVG 的描边不能沿路径改变粗细，所以按曲线采样、沿切线法向把两侧轮廓连成闭合填充路径。
 * 采样密度跟着曲线长度走：太稀会看出折角，太密只是白白拉长 `d`。
 */
function bandPath(from: Point, to: Point, fromWidth: number, toWidth: number): string {
  const midX = (from.x + to.x) / 2
  const deltaY = to.y - from.y
  const steps = Math.min(28, Math.max(8, Math.round(Math.hypot(to.x - from.x, deltaY) / 5)))
  const up: string[] = []
  const down: string[] = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const u = 1 - t
    const a = u * u * u
    const b = 3 * u * u * t
    const c = 3 * u * t * t
    const e = t * t * t
    // 控制点是 (midX, from.y) 和 (midX, to.y)，所以 x 只在两端取值、y 只在上下两档取值
    const x = a * from.x + (b + c) * midX + e * to.x
    const y = (a + b) * from.y + (c + e) * to.y
    // 导数 → 法向：两端切线水平，法向竖直，正好对齐上下划线的截面
    const dx = 3 * u * u * (midX - from.x) + 3 * t * t * (to.x - midX)
    const dy = 6 * u * t * deltaY
    const len = Math.hypot(dx, dy) || 1
    const half = (fromWidth + (toWidth - fromWidth) * t) / 2
    const nx = (-dy / len) * half
    const ny = (dx / len) * half
    up.push(`${round2(x + nx)},${round2(y + ny)}`)
    down.push(`${round2(x - nx)},${round2(y - ny)}`)
  }
  return `M${up.join('L')}L${down.reverse().join('L')}Z`
}

/**
 * 渐变该沿哪根轴、从哪一头起笔。
 *
 * 按孩子落在父的哪一侧判断，而不是比较两端坐标：动画途中节点会互相穿插，
 * 用坐标判断会让颜色顺序逐帧翻转，渐变的 `<defs>` 跟着变，就地改路径的快路径就失效了。
 */
function axisOf(from: Anchor, to: Anchor): { horizontal: boolean; forward: boolean } {
  // 孩子接线的边就是它的朝向：接左边说明孩子在右，接右边说明孩子在左
  if (to.side === 'left') return { horizontal: true, forward: true }
  if (to.side === 'right') return { horizontal: true, forward: false }
  if (to.side === 'bottom') return { horizontal: false, forward: true }
  if (to.side === 'top') return { horizontal: false, forward: false }
  const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
  return { horizontal, forward: horizontal ? to.x >= from.x : to.y >= from.y }
}

/**
 * 一条「由粗到细、由甲色到乙色」的枝条。
 *
 * 宽度靠几何锥形（见 {@link bandPath}），颜色靠对象包围盒坐标系里的线性渐变：
 * 渐变不写画布坐标，所以动画期间变的只有 `d`，`<defs>` 始终是同一段字符串，
 * 渲染层可以就地改路径而不重建节点。
 */
function bandEdge(
  from: Anchor,
  to: Anchor,
  fromColor: string,
  toColor: string,
  fromWidth: number,
  toWidth: number,
): Primitive {
  const d = bandPath(from, to, fromWidth, toWidth)
  const id = `mm-vine-${hashOf(`${fromColor}|${toColor}`)}`
  // 包围盒的左/上端不一定就是父端：向左或向上生长时两个颜色要换个位置
  const { horizontal, forward } = axisOf(from, to)
  const [start, end] = forward ? [fromColor, toColor] : [toColor, fromColor]
  const coords = horizontal ? 'x1="0" y1="0" x2="1" y2="0"' : 'x1="0" y1="0" x2="0" y2="1"'
  const defs =
    `<linearGradient id="${id}" gradientUnits="objectBoundingBox" ${coords}>` +
    `<stop offset="0" stop-color="${start}"/>` +
    `<stop offset="1" stop-color="${end}"/>` +
    `</linearGradient>`
  return {
    kind: 'custom',
    svg: () => `<defs>${defs}</defs><path d="${d}" style="fill:url(#${id})"/>`,
  }
}
