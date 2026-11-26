import type {
  EdgeContext,
  FontStyle,
  MarkmapNode,
  MeasureContext,
  NodeContext,
  Side,
  Theme,
} from '@markmap/core'
import { CONTENT_TOKENS, DARK_CONTENT_TOKENS } from '@markmap/render'
import type { MonetTheme } from '@/mindmap/theme/monet'
import type { ChildHint, NodeLook, StyleSpec, ToggleLook } from '@/mindmap/theme/styles'

/**
 * 把 {@link MonetTheme} 翻译成上游引擎的 `Theme`。
 *
 * 形状和几何一行都不在这里：全部委托给 `monet.spec`（样式协议）。
 * 这里只负责三件事——把引擎的回调参数整理成 `NodeLook`、把 `BoxMetrics` 翻成 `FontStyle`、
 * 以及把折叠点定位到布局坐标。
 */

export { TOGGLE_GAP } from '@/mindmap/theme/styles'

function branchOf(node: MarkmapNode): number {
  const value = node.data?.branch
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** 引擎的测量阶段没有 `direction`，给它一个稳定的缺省值 */
const directionOf = (ctx: MeasureContext | NodeContext): Side =>
  (ctx as NodeContext).direction ?? 'right'

function lookOf(node: MarkmapNode, ctx: MeasureContext | NodeContext): NodeLook {
  const depth = ctx.depth
  const direction = directionOf(ctx)
  // 根节点要知道每个一级子节点去哪一侧，才能按侧晕染；其余节点整棵子树同色
  const children: ChildHint[] =
    depth === 0
      ? node.children.map((child, index) => ({
          branch: branchOf(child),
          side: (ctx.childSides?.[index] ?? direction) as Side,
        }))
      : []
  return {
    depth,
    branch: branchOf(node),
    isRoot: depth === 0,
    hasChildren: ctx.hasChildren,
    folded: (ctx as NodeContext).folded ?? false,
    direction,
    children,
  }
}

/** 只拿得到 `ctx` 的回调（锚点、折叠点命中）用这个，几何只依赖深度与方向 */
function bareLook(ctx: NodeContext): NodeLook {
  return {
    depth: ctx.depth,
    branch: 0,
    isRoot: ctx.depth === 0,
    hasChildren: ctx.hasChildren,
    folded: ctx.folded,
    direction: ctx.direction,
    children: [],
  }
}

export function createEngineTheme(monet: MonetTheme): Theme {
  const spec: StyleSpec = monet.spec

  const fontOf = (look: NodeLook): FontStyle => {
    const { size, weight } = spec.metrics(look).font
    return {
      family: monet.fonts.family,
      size,
      weight,
      style: 'normal',
      // 上游的 lineHeight 是像素，MonetTheme 存的是倍数
      lineHeight: Math.round(size * monet.fonts.lineHeight),
    }
  }

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
      // 单行文字 + 内边距本来就比它高，这个值只在空内容时兜底
      minHeight: 22,
      font: (node, ctx) => fontOf(lookOf(node, ctx)),
      textFill: (node, ctx) => spec.metrics(lookOf(node, ctx)).textFill,
      boxPadding: (node, ctx) => spec.metrics(lookOf(node, ctx)).padding,
      anchor(rect, side, ctx) {
        return spec.anchor(rect, side, bareLook(ctx))
      },
      render(node, box, ctx) {
        const look = lookOf(node, ctx)
        const out = spec.chrome(look, box)
        if (!ctx.hasChildren) return out
        // 双侧根节点两侧各有一个折叠点，各自收起自己那一侧；其余节点只有一个
        const dots: { side: Side; folded: boolean }[] = ctx.sides
          ? (['left', 'right'] as const)
              .filter((side) => ctx.sides![side].present)
              .map((side) => ({ side, folded: ctx.sides![side].folded }))
          : [{ side: ctx.direction, folded: ctx.folded }]
        for (const dot of dots) {
          const toggle = spec.toggle({
            ...look,
            box: { width: box.width, height: box.height },
            side: dot.side,
            folded: dot.folded,
          } satisfies ToggleLook)
          if (toggle) out.push(...toggle.primitives)
        }
        return out
      },
      toggleAnchor(rect, side, ctx) {
        // 圆点画在盒子外侧，命中中心必须跟视觉圆心重合，否则只有「正中间」才点得中
        const toggle = spec.toggle({
          ...bareLook(ctx),
          box: { width: rect.width, height: rect.height },
          side,
        } satisfies ToggleLook)
        if (!toggle) return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
        return { x: rect.x + toggle.center.x, y: rect.y + toggle.center.y }
      },
    },
    edge: {
      render(from, to, ctx: EdgeContext) {
        return spec.edge(from, to, {
          depth: ctx.node.depth,
          branch: branchOf(ctx.target),
          folded: ctx.node.folded,
        })
      },
    },
  }
}
