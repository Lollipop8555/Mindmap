import type {
  AtomSize,
  ContentPlugin,
  InlineContext,
  Primitive,
  Rect,
  TextStyle,
} from '@/mindmap/engine/types'
import { NAMED_COLORS } from '@/mindmap/theme/palette'
import { inlineChrome, toneBg, toneInk } from './palette'
import { hasIcon, iconPath } from '@/mindmap/icons/paths'
import type {
  MmBadge,
  MmColor,
  MmDate,
  MmIcon,
  MmProgress,
  MmSub,
  MmSup,
} from './directives'
import { plainText } from './directives'
import { mathAtom } from './math'

const CODE_FAMILY =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

function baselineOf(style: TextStyle): number {
  const { size, lineHeight } = style.font
  return (lineHeight + size * 0.7) / 2
}

function textPrimitive(
  text: string,
  box: Rect,
  style: TextStyle,
  opts: { sizeFactor?: number; baselineShift?: number; fill?: string } = {},
): Primitive {
  const size = style.font.size * (opts.sizeFactor ?? 1)
  const font = { ...style.font, size }
  const localBaseline = baselineOf({ font, fill: style.fill }) + (opts.baselineShift ?? 0)
  return {
    kind: 'text',
    x: box.x,
    y: box.y,
    runs: [
      {
        text,
        x: 0,
        y: localBaseline,
        font,
        fill: opts.fill ?? style.fill,
      },
    ],
  }
}

function measureText(text: string, style: TextStyle, ctx: InlineContext, sizeFactor = 1): number {
  const font = { ...style.font, size: style.font.size * sizeFactor }
  return ctx.measurer.measure(text, font)
}

function todayISO(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function normalizeDate(value: string): string {
  const [y, m, d] = value.split('-').map((part) => Number.parseInt(part, 10))
  if (!y || !m || !d) return value
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function displayDate(value: string): string {
  const [y, m, d] = normalizeDate(value).split('-')
  return `${Number(m)}月${Number(d)}日${y ? '' : ''}`
}

/**
 * 富内联渲染插件。所有元素都只用 styles（文字修饰）或 atoms（盒状图元），
 * 保证 SVG 与 canvas（PNG 导出）后端表现一致；不使用 svg-only 的 custom。
 */
export const mmInlineContent: ContentPlugin = {
  name: 'mindmap-inline',
  styles: {
    mmBadge: (inline: MmBadge, style: TextStyle) => ({
      font: { size: style.font.size * 0.9, weight: 500 },
      fill: toneInk(inline.tone),
      decoration: {
        background: toneBg(inline.tone),
        // 徽标是小方块/小圆角卡片；999 在短词上会变成椭圆，看着像药丸
        radius: Math.round(style.font.size * 0.34),
        padding: style.font.size * 0.38,
      },
    }),

    mmColor: (inline: MmColor, style: TextStyle) => ({
      fill:
        NAMED_COLORS[inline.color] ??
        (inline.color.startsWith('#') ? inline.color : inlineChrome().accent),
    }),

    mmUnderline: (_inline: unknown, style: TextStyle) => ({
      decoration: { underline: style.fill },
    }),

    mmKbd: (_inline: unknown, style: TextStyle) => ({
      font: {
        family: CODE_FAMILY,
        size: style.font.size * 0.85,
        weight: 500,
      },
      fill: inlineChrome().codeText,
      decoration: {
        background: inlineChrome().codeBg,
        radius: 4,
        padding: Math.round(style.font.size * 0.3),
      },
    }),
  },

  atoms: {
    /** `$...$`：LaTeX → Unicode + 真正的上下标 run */
    inlineMath: mathAtom,

    mmSup: {
      measure(inline: MmSup, style, ctx): AtomSize {
        const text = plainText(inline.children)
        const size = style.font.size
        return {
          width: measureText(text, style, ctx, 0.72),
          height: style.font.lineHeight,
          baseline: baselineOf(style) - size * 0.34,
        }
      },
      render(inline: MmSup, box, style): Primitive[] {
        return [textPrimitive(plainText(inline.children), box, style, {
          sizeFactor: 0.72,
          baselineShift: -style.font.size * 0.34,
        })]
      },
    },

    mmSub: {
      measure(inline: MmSub, style, ctx): AtomSize {
        const text = plainText(inline.children)
        return {
          width: measureText(text, style, ctx, 0.72),
          height: style.font.lineHeight,
          baseline: baselineOf(style) + style.font.size * 0.18,
        }
      },
      render(inline: MmSub, box, style): Primitive[] {
        return [textPrimitive(plainText(inline.children), box, style, {
          sizeFactor: 0.72,
          baselineShift: style.font.size * 0.18,
        })]
      },
    },

    mmIcon: {
      measure(_inline: MmIcon, style): AtomSize {
        const size = style.font.size * 1.1
        return { width: size + style.font.size * 0.25, height: size, baseline: style.font.size * 0.84 }
      },
      render(inline: MmIcon, box, style): Primitive[] {
        const name = inline.name
        if (!hasIcon(name)) {
          // 未知图标 → 退回文字，不出现裂图
          return [textPrimitive(`:${name}`, { ...box, width: box.width }, style, { sizeFactor: 0.9 })]
        }
        const size = box.height
        const k = size / 24
        const gap = style.font.size * 0.25
        return [
          {
            kind: 'group',
            transform: [k, 0, 0, k, box.x + gap / 2, box.y],
            children: [
              {
                kind: 'path',
                d: iconPath(name),
                stroke: style.fill,
                strokeWidth: 2,
              },
            ],
          },
        ]
      },
    },

    mmDate: {
      measure(inline: MmDate, style, ctx): AtomSize {
        const text = displayDate(inline.value)
        return {
          width: measureText(text, style, ctx, 0.95) + style.font.size * 0.2,
          height: style.font.lineHeight,
          baseline: baselineOf(style),
        }
      },
      render(inline: MmDate, box, style): Primitive[] {
        const overdue = normalizeDate(inline.value) < todayISO()
        return [
          textPrimitive(displayDate(inline.value), box, style, {
            sizeFactor: 0.95,
            fill: overdue ? inlineChrome().danger : style.fill,
          }),
        ]
      },
    },

    mmProgress: {
      measure(inline: MmProgress, style, ctx): AtomSize {
        const percent = `${inline.value}%`
        return {
          width:
            style.font.size * 2.4 +
            style.font.size * 0.35 +
            measureText(percent, style, ctx, 0.8),
          height: style.font.lineHeight,
          baseline: baselineOf(style),
        }
      },
      render(inline: MmProgress, box, style): Primitive[] {
        const barW = style.font.size * 2.4
        const barH = Math.max(3, style.font.size * 0.4)
        const y = box.y + (style.font.lineHeight - barH) / 2
        const ratio = Math.min(1, Math.max(0, inline.value / 100))
        const ink = toneInk(inline.tone)
        return [
          {
            kind: 'rect',
            x: box.x,
            y,
            w: barW,
            h: barH,
            r: barH / 2,
            fill: toneBg(inline.tone),
            stroke: ink,
            strokeWidth: 1,
          },
          {
            kind: 'rect',
            x: box.x,
            y,
            w: Math.max(barH, barW * ratio),
            h: barH,
            r: barH / 2,
            fill: ink,
          },
          textPrimitive(
            `${inline.value}%`,
            { x: box.x + barW + style.font.size * 0.35, y: box.y, width: box.width, height: box.height },
            style,
            { sizeFactor: 0.8 },
          ),
        ]
      },
    },
  },
}
