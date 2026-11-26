import type { Parent, PhrasingContent, Text } from 'mdast'
import { isTone, type Tone } from '@/mindmap/theme/palette'

/**
 * 富内联的节点契约。渲染插件只认这些类型，不认 markdown 语法：
 * 将来若把 `:badge[x]` 换成 `[[x]]`，只需改解析层。
 */
/** mdast 的 `Parent.children` 是 `RootContent[]`，我们的内联节点只装 phrasing */
interface MmParent {
  children: PhrasingContent[]
}

export interface MmBadge extends MmParent {
  type: 'mmBadge'
  tone: Tone
}

export interface MmColor extends MmParent {
  type: 'mmColor'
  color: string
}

export interface MmUnderline extends MmParent {
  type: 'mmUnderline'
}

export interface MmKbd extends MmParent {
  type: 'mmKbd'
}

export interface MmSup extends MmParent {
  type: 'mmSup'
}

export interface MmSub extends MmParent {
  type: 'mmSub'
}

export interface MmIcon extends MmParent {
  type: 'mmIcon'
  name: string
}

export interface MmDate extends MmParent {
  type: 'mmDate'
  value: string
}

export interface MmProgress extends MmParent {
  type: 'mmProgress'
  value: number
  tone: Tone
}

declare module 'mdast' {
  interface PhrasingContentMap {
    mmBadge: MmBadge
    mmColor: MmColor
    mmUnderline: MmUnderline
    mmKbd: MmKbd
    mmSup: MmSup
    mmSub: MmSub
    mmIcon: MmIcon
    mmDate: MmDate
    mmProgress: MmProgress
  }
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

export function textNode(value: string): Text {
  return { type: 'text', value }
}

export function plainText(nodes: readonly PhrasingContent[] | undefined): string {
  if (!nodes) return ''
  let out = ''
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'inlineCode') out += node.value
    else if (node.type === 'image') out += node.alt ?? ''
    else if ('children' in node) out += plainText((node as Parent).children as PhrasingContent[])
  }
  return out
}

type Attrs = Record<string, string | undefined>

function readAttrs(node: { attributes?: Record<string, string | null> | null }): Attrs {
  const out: Attrs = {}
  for (const [key, value] of Object.entries(node.attributes ?? {})) out[key] = value ?? undefined
  return out
}

function attr(attrs: Attrs, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = attrs[key]
    if (value != null && value !== '') return value
  }
  return undefined
}

function parseInt10(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** 降级：把指令还原成字面量文本，绝不丢字 */
export function literal(name: string, label: string, attrs: Attrs): Text {
  const entries = Object.entries(attrs).filter(([, v]) => v != null && v !== '')
  const suffix = entries.length
    ? `{${entries.map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`).join(' ')}}`
    : ''
  return { type: 'text', value: label ? `:${name}[${label}]${suffix}` : `:${name}${suffix}` }
}

interface DirectiveNode {
  type: 'textDirective' | 'leafDirective' | 'containerDirective'
  name: string
  attributes?: Record<string, string | null> | null
  children?: PhrasingContent[]
}

type Handler = (node: DirectiveNode, label: string, attrs: Attrs) => PhrasingContent | null

/* ------------------------------------------------------------------ */
/* 注册表                                                              */
/* ------------------------------------------------------------------ */

const handlers = new Map<string, Handler>()

export function registerDirective(name: string, handler: Handler): void {
  handlers.set(name.toLowerCase(), handler)
}

export function hasDirective(name: string): boolean {
  return handlers.has(name.toLowerCase())
}

/** 渲染层需要的内联插件名（见 inline/plugin.ts） */
registerDirective('badge', (node, label, attrs) => {
  const tone = attr(attrs, 'tone', 'c')
  return {
    type: 'mmBadge',
    tone: isTone(tone) ? tone : 'blue',
    children: node.children?.length ? node.children : [textNode(label)],
  }
})

registerDirective('color', (node, label, attrs) => {
  const color = attr(attrs, 'c', 'color') ?? 'blue'
  return {
    type: 'mmColor',
    color,
    children: node.children?.length ? node.children : [textNode(label)],
  }
})

registerDirective('u', (node, label) => ({
  type: 'mmUnderline',
  children: node.children?.length ? node.children : [textNode(label)],
}))

registerDirective('kbd', (node, label) => ({
  type: 'mmKbd',
  children: node.children?.length ? node.children : [textNode(label)],
}))

registerDirective('sup', (node, label) => ({
  type: 'mmSup',
  children: node.children?.length ? node.children : [textNode(label)],
}))

registerDirective('sub', (node, label) => ({
  type: 'mmSub',
  children: node.children?.length ? node.children : [textNode(label)],
}))

registerDirective('icon', (node, label, attrs) => {
  const name = (attr(attrs, 'name') ?? label).trim()
  if (!name) return null
  return { type: 'mmIcon', name, children: [] }
})

registerDirective('date', (node, label, attrs) => {
  const value = (attr(attrs, 'v') ?? label).trim()
  if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(value)) return null
  return { type: 'mmDate', value, children: [] }
})

registerDirective('progress', (node, label, attrs) => {
  const raw = attr(attrs, 'v') ?? label
  if (!/^\d{1,3}$/.test(raw.trim())) return null
  const tone = attr(attrs, 'tone', 'c')
  return {
    type: 'mmProgress',
    value: parseInt10(raw, 0, 0, 100),
    tone: isTone(tone) ? tone : 'sage',
    children: [],
  }
})

/** 把 textDirective 转成契约节点；未知名字或非法属性 → 字面量文本 */
export function convertDirective(node: DirectiveNode): PhrasingContent {
  const name = node.name?.toLowerCase?.() ?? ''
  const label = plainText(node.children)
  const attrs = readAttrs(node)
  const handler = handlers.get(name)
  if (!handler) return literal(name || '?', label, attrs)
  const built = handler(node, label, attrs)
  return built ?? literal(name, label, attrs)
}
