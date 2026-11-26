import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { newId, reassignColors, type LayoutMode, type MindDoc, type MindNode, type NodeId } from '@/mindmap/model'

export interface ImportOptions {
  layout?: LayoutMode
  maxNodes?: number
  maxDepth?: number
}

export interface ImportResult {
  docs: MindDoc[]
  warnings: string[]
}

interface Outline {
  text: string
  children: Outline[]
}

const processor = unified().use(remarkParse).use(remarkGfm)

const DEFAULT_MAX_NODES = 5000
const DEFAULT_MAX_DEPTH = 12

/** 块级/行内节点的纯文本提取（用空格连接块） */
function toText(node: any): string {
  if (!node) return ''
  switch (node.type) {
    case 'text':
    case 'inlineCode':
    case 'inlineMath':
    case 'code':
      return typeof node.value === 'string' ? node.value : ''
    case 'image':
      return node.alt ?? ''
    case 'html':
      return ''
    case 'break':
      return ' '
    default:
      break
  }
  if (Array.isArray(node.children)) {
    return node.children.map(toText).join(node.type === 'paragraph' ? '' : ' ').trim()
  }
  return ''
}

/**
 * 取节点在源码里的原始切片（只限行内内容）。
 * 节点文本就是"单行 Markdown 源"，所以 **粗体** / `code` / 转义都必须原样保留，
 * 不能用 toText 拍平成纯文本，否则往返会丢格式。
 */
function inlineSource(source: string, node: any): string | null {
  const kids = node?.children
  if (!Array.isArray(kids) || kids.length === 0) return null
  const start = kids[0]?.position?.start?.offset
  const end = kids[kids.length - 1]?.position?.end?.offset
  if (typeof start !== 'number' || typeof end !== 'number') return null
  return source.slice(start, end).replace(/\s*\r?\n\s*/g, ' ').trim()
}

function listItemToOutline(item: any, state: { flatten: number }, source: string): Outline {
  const blocks: string[] = []
  const children: Outline[] = []
  for (const child of item.children ?? []) {
    if (child.type === 'list') {
      for (const li of child.children ?? []) children.push(listItemToOutline(li, state, source))
    } else if (child.type === 'paragraph') {
      blocks.push(inlineSource(source, child) ?? toText(child))
    } else {
      blocks.push(toText(child))
    }
  }
  if (blocks.length > 1) state.flatten += 1
  const prefix = item.checked === true ? '[x] ' : item.checked === false ? '[ ] ' : ''
  return { text: (prefix + blocks.join(' ')).trim(), children }
}

function buildDoc(outline: Outline, opts: Required<Pick<ImportOptions, 'maxNodes' | 'maxDepth'>> & ImportOptions): {
  doc: MindDoc
  truncated: boolean
} {
  const rootId = newId()
  const now = Date.now()
  const nodes: Record<NodeId, MindNode> = {
    [rootId]: { id: rootId, text: outline.text.slice(0, 500), parentId: null, children: [] },
  }
  let count = 1
  let truncated = false

  const walk = (parentId: NodeId, items: Outline[], depth: number) => {
    for (const item of items) {
      if (count >= opts.maxNodes) {
        truncated = true
        return
      }
      if (depth > opts.maxDepth) {
        truncated = true
        continue
      }
      const id = newId()
      nodes[id] = { id, text: item.text.slice(0, 500), parentId, children: [] }
      nodes[parentId].children.push(id)
      count += 1
      walk(id, item.children, depth + 1)
    }
  }
  walk(rootId, outline.children, 1)

  let doc: MindDoc = {
    id: rootId,
    rootId,
    title: outline.text.slice(0, 200) || '未命名导图',
    nodes,
    layout: opts.layout ?? 'two-sided',
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
  }
  doc = reassignColors(doc)
  return { doc, truncated }
}

/**
 * Markdown → 文档树。
 * 支持：`#` 标题层级、无序/有序列表嵌套、任务列表、代码块/引用（作为叶子节点）。
 * 多个 `# ` 标题 → 多个文档。
 */
export function parseMarkdown(source: string, options: ImportOptions = {}): ImportResult {
  const opts = {
    layout: options.layout,
    maxNodes: options.maxNodes ?? DEFAULT_MAX_NODES,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
  }
  const warnings: string[] = []
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (!text.trim()) return { docs: [], warnings: ['没有可导入的内容'] }

  const tree = processor.parse(text) as any
  const segments: { title: string; items: Outline[] }[] = []
  let current: { title: string; items: Outline[] } | null = null
  const headingStack: { depth: number; node: Outline }[] = []
  const state = { flatten: 0 }

  const ensureSegment = (): { title: string; items: Outline[] } => {
    if (!current) {
      current = { title: '', items: [] }
    }
    return current
  }

  const attachTarget = (): Outline[] => {
    const top = headingStack[headingStack.length - 1]
    return top ? top.node.children : ensureSegment().items
  }

  for (const node of tree.children ?? []) {
    if (node.type === 'heading') {
      const headingText = (inlineSource(text, node) ?? toText(node)).trim()
      if (node.depth === 1) {
        if (current) segments.push(current)
        current = { title: headingText, items: [] }
        headingStack.length = 0
        continue
      }
      const segment = ensureSegment()
      const outline: Outline = { text: headingText, children: [] }
      while (headingStack.length && headingStack[headingStack.length - 1].depth >= node.depth) {
        headingStack.pop()
      }
      const parent = headingStack[headingStack.length - 1]
      if (parent) parent.node.children.push(outline)
      else segment.items.push(outline)
      headingStack.push({ depth: node.depth, node: outline })
      continue
    }

    if (node.type === 'list') {
      const target = attachTarget()
      for (const li of node.children ?? []) target.push(listItemToOutline(li, state, text))
      continue
    }

    if (node.type === 'thematicBreak' || node.type === 'definition' || node.type === 'html') continue

    const blockText = toText(node).trim()
    if (blockText) attachTarget().push({ text: blockText, children: [] })
  }
  if (current) segments.push(current)

  if (state.flatten) warnings.push(`${state.flatten} 处多块内容被压平为单行`)

  const docs: MindDoc[] = []
  let truncatedAny = false

  if (segments.length === 0) {
    // 没有标题：以第一个顶层项为根，其余作为它的子节点（不丢内容）
    const roots = current ? (current as { title: string; items: Outline[] }).items : []
    if (!roots.length) return { docs: [], warnings: ['没有可导入的内容'] }
    const first = roots[0]
    const synthetic: Outline = {
      text: first.text || '未命名导图',
      children: [...first.children, ...roots.slice(1)],
    }
    const built = buildDoc(synthetic, opts)
    truncatedAny ||= built.truncated
    docs.push(built.doc)
  } else {
    for (const segment of segments) {
      const first = segment.items[0]
      const rootTitle = segment.title || first?.text || '未命名导图'
      const rootItems = segment.title ? segment.items : [...(first?.children ?? []), ...segment.items.slice(1)]
      const built = buildDoc({ text: rootTitle, children: rootItems }, opts)
      truncatedAny ||= built.truncated
      docs.push(built.doc)
    }
  }

  if (truncatedAny) {
    warnings.push(`超过限制（节点 ${opts.maxNodes} / 深度 ${opts.maxDepth}），超出部分已截断`)
  }
  return { docs, warnings }
}
