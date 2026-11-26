import type { Primitive, Size } from '@markmap/core'
import { hashOf, mix, round2 } from './shape'
import type { StylePalette } from './types'

/** 根节点卡片：中性底 + 两侧分支色晕染。 */
export interface RootCardPaint {
  /** 卡片底色，跟画布同族但高一层 */
  base: string
  /** 反色描边：浅底给深线、深底给浅线 */
  stroke: string
  /** 每侧的分支色标（已混到接近底色），没有分支的一侧缺省 */
  washes: { left?: string[]; right?: string[] }
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
export function rootCard(box: Size, radius: number, paint: RootCardPaint): Primitive {
  const width = round2(box.width)
  const height = round2(box.height)
  const sides = (['left', 'right'] as const).filter((side) => paint.washes[side]?.length)
  const id = `mm-root-${hashOf(
    [paint.base, paint.stroke, width, height, radius, ...sides.map((s) => paint.washes[s]!.join(','))].join(
      '|',
    ),
  )}`
  const clip = `${id}-clip`
  const defs = [
    `<clipPath id="${clip}"><rect x="0" y="0" width="${width}" height="${height}" rx="${radius}"/></clipPath>`,
  ]
  const washes: string[] = []
  for (const side of sides) {
    const stops = paint.washes[side]!
    const step = Math.max(1, stops.length - 1)
    const toneId = `${id}-tone-${side}`
    const fadeId = `${id}-fade-${side}`
    const maskId = `${id}-mask-${side}`
    defs.push(
      `<linearGradient id="${toneId}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${height}">` +
        stops
          .map((color, i) => `<stop offset="${round2((i / step) * 100)}%" stop-color="${color}"/>`)
          .join('') +
        `</linearGradient>`,
    )
    // 亮度遮罩：边缘白（显色）→ 内侧黑（透明），横向淡出
    const near = side === 'left' ? 0 : width
    const far = side === 'left' ? round2(width * WASH_FADE) : round2(width * (1 - WASH_FADE))
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
  const border = round2(Math.max(0, radius - 0.5))
  return {
    kind: 'custom',
    svg: () =>
      `<defs>${defs.join('')}</defs>` +
      `<g clip-path="url(#${clip})">` +
      `<rect x="0" y="0" width="${width}" height="${height}" fill="${paint.base}"/>` +
      washes.join('') +
      `</g>` +
      `<rect x="0.5" y="0.5" width="${round2(width - 1)}" height="${round2(height - 1)}" rx="${border}" ` +
      `fill="none" stroke="${paint.stroke}" stroke-width="1"/>`,
  }
}

/** 根卡片配色：底色取面板色，两侧按分支色淡染。 */
export function rootCardPaint(palette: StylePalette, washes: RootCardPaint['washes']): RootCardPaint {
  return {
    base: palette.panel,
    // 反色描边：浅底压深、深底提亮，形状永远看得出来
    stroke: mix(palette.panel, palette.text, palette.scheme === 'dark' ? 0.28 : 0.22),
    washes,
  }
}
