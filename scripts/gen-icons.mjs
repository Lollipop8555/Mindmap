/**
 * 从 `lucide-static` 抽取精选图标，压平成单条 path `d`，
 * 生成 `src/mindmap/icons/paths.ts`。构建期完成，运行时零网络请求。
 *
 * 用法：npm i -D lucide-static && node scripts/gen-icons.mjs
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const CURATED = [
  'activity', 'alarm-clock', 'alert-circle', 'alert-triangle', 'archive', 'arrow-down',
  'arrow-left', 'arrow-right', 'arrow-up', 'award', 'bar-chart', 'battery', 'bell', 'book',
  'book-open', 'bookmark', 'box', 'briefcase', 'bug', 'calendar', 'camera', 'check',
  'check-circle', 'check-square', 'chevron-down', 'chevron-left', 'chevron-right', 'chevron-up',
  'circle', 'clock', 'cloud', 'code', 'coffee', 'command', 'compass', 'copy', 'credit-card',
  'database', 'download', 'edit', 'external-link', 'eye', 'file', 'file-text', 'filter', 'flag',
  'folder', 'folder-open', 'gift', 'git-branch', 'globe', 'grid', 'hammer', 'headphones', 'heart',
  'help-circle', 'home', 'image', 'inbox', 'info', 'key', 'layers', 'layout', 'link', 'list',
  'lock', 'mail', 'map', 'map-pin', 'menu', 'message-circle', 'message-square', 'mic', 'minus',
  'monitor', 'moon', 'more-horizontal', 'more-vertical', 'music', 'package', 'paperclip', 'pause',
  'pen-tool', 'pie-chart', 'play', 'plus', 'power', 'printer', 'refresh-cw', 'repeat', 'rocket',
  'save', 'search', 'send', 'server', 'settings', 'share', 'shield', 'shopping-cart', 'shuffle',
  'sliders', 'smartphone', 'smile', 'speaker', 'square', 'star', 'sun', 'tag', 'target',
  'terminal', 'thumbs-up', 'timer', 'toggle', 'trash', 'trending-up', 'truck', 'upload', 'user',
  'users', 'video', 'volume', 'wallet', 'wifi', 'x', 'zap', 'zoom-in', 'zoom-out',
]

/** 旧版名字 → 现行 lucide 文件名（用户 `:icon[home]` 之类的旧写法保持可用） */
const ALIASES = {
  'alert-circle': 'circle-alert',
  'alert-triangle': 'triangle-alert',
  'bar-chart': 'chart-bar',
  'check-circle': 'circle-check',
  'check-square': 'square-check',
  edit: 'pencil',
  grid: 'grid-3x3',
  'help-circle': 'circle-help',
  home: 'house',
  layout: 'layout-dashboard',
  'more-horizontal': 'ellipsis',
  'more-vertical': 'ellipsis-vertical',
  'pie-chart': 'chart-pie',
  sliders: 'sliders-vertical',
  toggle: 'toggle-right',
}

const SVG_DIR = path.resolve('node_modules/lucide-static/icons')
const OUT = path.resolve('src/mindmap/icons/paths.ts')

const n = (value) => {
  const num = Number(value)
  return Number.isFinite(num) ? String(Number(num.toFixed(3))) : '0'
}

function rectToPath(attrs) {
  const x = Number(attrs.x ?? 0)
  const y = Number(attrs.y ?? 0)
  const w = Number(attrs.width ?? 0)
  const h = Number(attrs.height ?? 0)
  const r = Math.min(Number(attrs.rx ?? attrs.ry ?? 0), w / 2, h / 2)
  if (!r) return `M${n(x)},${n(y)}h${n(w)}v${n(h)}h${n(-w)}z`
  return [
    `M${n(x + r)},${n(y)}`,
    `h${n(w - 2 * r)}`,
    `a${n(r)},${n(r)} 0 0 1 ${n(r)},${n(r)}`,
    `v${n(h - 2 * r)}`,
    `a${n(r)},${n(r)} 0 0 1 ${n(-r)},${n(r)}`,
    `h${n(-(w - 2 * r))}`,
    `a${n(r)},${n(r)} 0 0 1 ${n(-r)},${n(-r)}`,
    `v${n(-(h - 2 * r))}`,
    `a${n(r)},${n(r)} 0 0 1 ${n(r)},${n(-r)}`,
    'z',
  ].join('')
}

function circleToPath(attrs) {
  const cx = Number(attrs.cx ?? 0)
  const cy = Number(attrs.cy ?? 0)
  const r = Number(attrs.r ?? 0)
  return `M${n(cx - r)},${n(cy)}a${n(r)},${n(r)} 0 1 0 ${n(2 * r)},0a${n(r)},${n(r)} 0 1 0 ${n(-2 * r)},0z`
}

function lineToPath(attrs) {
  return `M${n(attrs.x1 ?? 0)},${n(attrs.y1 ?? 0)}L${n(attrs.x2 ?? 0)},${n(attrs.y2 ?? 0)}`
}

function pointsToPath(attrs, close) {
  const points = String(attrs.points ?? '')
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
  if (points.length < 4) return ''
  let d = `M${n(points[0])},${n(points[1])}`
  for (let i = 2; i < points.length; i += 2) d += `L${n(points[i])},${n(points[i + 1])}`
  return close ? `${d}z` : d
}

function attrsOf(raw) {
  const attrs = {}
  const re = /([a-zA-Z-]+)="([^"]*)"/g
  let match
  while ((match = re.exec(raw))) attrs[match[1]] = match[2]
  return attrs
}

function svgToPath(svg) {
  const parts = []
  const re = /<(path|circle|rect|line|polyline|polygon)\b([^>]*)\/>/g
  let match
  while ((match = re.exec(svg))) {
    const tag = match[1]
    const attrs = attrsOf(match[2])
    if (tag === 'path') {
      if (attrs.d) parts.push(attrs.d)
    } else if (tag === 'circle') parts.push(circleToPath(attrs))
    else if (tag === 'rect') parts.push(rectToPath(attrs))
    else if (tag === 'line') parts.push(lineToPath(attrs))
    else if (tag === 'polyline') parts.push(pointsToPath(attrs, false))
    else if (tag === 'polygon') parts.push(pointsToPath(attrs, true))
  }
  return parts.filter(Boolean).join('')
}

async function main() {
  if (!existsSync(SVG_DIR)) {
    console.error(
      `找不到 ${SVG_DIR}。\n请先安装依赖：npm i -D lucide-static\n` +
        '（当前 src/mindmap/icons/paths.ts 里的占位子集可继续使用。）',
    )
    process.exit(1)
  }

  const entries = []
  for (const name of CURATED) {
    const file = path.join(SVG_DIR, `${ALIASES[name] ?? name}.svg`)
    if (!existsSync(file)) {
      console.warn(`跳过不存在的图标：${name}`)
      continue
    }
    const svg = await readFile(file, 'utf8')
    const d = svgToPath(svg)
    if (!d) {
      console.warn(`跳过无法解析的图标：${name}`)
      continue
    }
    entries.push([name, d])
  }

  const body = entries
    .map(([name, d]) => `  ${JSON.stringify(name)}: ${JSON.stringify(d)},`)
    .join('\n')

  const output = `/**
 * 由 \`scripts/gen-icons.mjs\` 自动生成，请勿手改。
 * 来源：lucide-static（ISC）。共 ${entries.length} 个图标，24x24 viewBox，
 * 按 stroke=currentColor / stroke-width=2 渲染。
 */
export const ICONS: Record<string, string> = {
${body}
}

export function hasIcon(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ICONS, name)
}

export function iconPath(name: string): string {
  return ICONS[name] ?? ''
}

export function iconNames(): string[] {
  return Object.keys(ICONS)
}
`

  await writeFile(OUT, output, 'utf8')
  console.log(`已写入 ${OUT}（${entries.length} 个图标）`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
