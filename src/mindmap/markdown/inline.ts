import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkDirective from 'remark-directive'
import remarkCjkFriendly from 'remark-cjk-friendly'
import { visit } from 'unist-util-visit'
import type { PhrasingContent, Root } from 'mdast'
import { convertDirective } from '@/mindmap/inline/directives'
import { TONES, type Tone } from '@/mindmap/theme/palette'

const DIRECTIVE_TYPES = new Set(['textDirective', 'leafDirective', 'containerDirective'])

/** 把 remark-directive 节点替换成我们自己的内联契约节点 / 字面量文本 */
function directiveToContract() {
  return (tree: Root) => {
    visit(tree, (node: any, index: number | undefined, parent: any) => {
      if (!DIRECTIVE_TYPES.has(node?.type)) return
      if (!parent || index == null) return
      parent.children[index] = convertDirective(node)
    })
  }
}

/**
 * GFM 之外的简写，只在「纯文本节点」上做，`$a^2+b^2$`（inlineMath）等不会被误伤。
 *
 * 下标没有 `~下标~` 简写：GFM 的删除线接受单波浪线（`~x~` 就是删除线），
 * 解析阶段已经吃掉，下标只能用 `:sub[...]`。
 */
const SHORTHANDS: { re: RegExp; type: string }[] = [
  { re: /==([^=\n]+?)==/g, type: 'mark' },
  { re: /\+\+([^+\n]+?)\+\+/g, type: 'mmUnderline' },
  { re: /\^([^\s^\n]+?)\^/g, type: 'mmSup' },
]

function splitShorthands(value: string): PhrasingContent[] {
  const out: PhrasingContent[] = []
  let rest = value
  for (;;) {
    let best: { index: number; length: number; inner: string; type: string } | null = null
    for (const { re, type } of SHORTHANDS) {
      re.lastIndex = 0
      const match = re.exec(rest)
      if (!match) continue
      if (!best || match.index < best.index) {
        best = { index: match.index, length: match[0].length, inner: match[1], type }
      }
    }
    if (!best) break
    if (best.index > 0) out.push({ type: 'text', value: rest.slice(0, best.index) })
    out.push({
      type: best.type,
      children: [{ type: 'text', value: best.inner }],
    } as unknown as PhrasingContent)
    rest = rest.slice(best.index + best.length)
  }
  if (rest) out.push({ type: 'text', value: rest })
  return out.length ? out : [{ type: 'text', value }]
}

function inlineShorthands() {
  return (tree: Root) => {
    visit(tree, 'text', (node, index: number | undefined, parent: any) => {
      if (!parent || index == null) return
      const parts = splitShorthands(node.value)
      if (parts.length === 1 && parts[0].type === 'text') return
      parent.children.splice(index, 1, ...parts)
      // 跳过刚插入的片段，避免对生成节点里的文本重复处理
      return index + parts.length
    })
  }
}

/** `#标签`：前置空白或行首，标签体不含空白，颜色由字符串哈希到 10 色板 */
const TAG_RE = /(^|[\s(（【])#([\p{L}\p{N}_\-+/]{1,24})/gu

function hashTone(tag: string): Tone {
  let hash = 0
  for (const ch of tag) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  return TONES[hash % TONES.length]
}

function inlineTags() {
  return (tree: Root) => {
    visit(tree, 'text', (node, index: number | undefined, parent: any) => {
      if (!parent || index == null || !node.value.includes('#')) return
      const parts: PhrasingContent[] = []
      let rest = node.value
      for (;;) {
        // rest 每轮都会变短，lastIndex 必须归零，否则会跳过后面的标签
        TAG_RE.lastIndex = 0
        const match = TAG_RE.exec(rest)
        if (!match) break
        const start = match.index + match[1].length
        const tag = match[2]
        if (start > 0) parts.push({ type: 'text', value: rest.slice(0, start) })
        parts.push({
          type: 'mmBadge',
          tone: hashTone(tag),
          children: [{ type: 'text', value: `#${tag}` }],
        } as unknown as PhrasingContent)
        rest = rest.slice(start + tag.length + 1)
      }
      if (!parts.length) return
      if (rest) parts.push({ type: 'text', value: rest })
      parent.children.splice(index, 1, ...parts)
      return index + parts.length
    })
  }
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkDirective)
  .use(remarkCjkFriendly)
  .use(directiveToContract)
  .use(inlineShorthands)
  .use(inlineTags)

const CACHE_LIMIT = 500
const cache = new Map<string, PhrasingContent[]>()

/** 单行 Markdown → 内联节点数组。同步、可缓存，供引擎测量与渲染调用。 */
export function parseInline(text: string): PhrasingContent[] {
  const hit = cache.get(text)
  if (hit) {
    // LRU：命中后移到末尾
    cache.delete(text)
    cache.set(text, hit)
    return hit
  }

  let result: PhrasingContent[]
  try {
    // parse 只跑 micromark；:badge[...] 之类的转换在 transformer 里，必须 run 一次
    const parsed = processor.parse(text)
    const tree = processor.runSync(parsed) as Root
    const first = tree.children.find(
      (node) => node.type === 'paragraph' || node.type === 'heading',
    ) as any
    result = (first?.children ?? []) as PhrasingContent[]
    // 单行约束：换行与硬换行一律压成空格
    result = normalizeSingleLine(result)
  } catch {
    result = [{ type: 'text', value: text }]
  }

  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(text, result)
  return result
}

function normalizeSingleLine(nodes: PhrasingContent[]): PhrasingContent[] {
  return nodes.map((node) => {
    if (node.type === 'break' || node.type === 'html') {
      return { type: 'text', value: node.type === 'break' ? ' ' : '' }
    }
    if ('children' in node) {
      return { ...node, children: normalizeSingleLine(node.children as PhrasingContent[]) } as PhrasingContent
    }
    return node
  })
}

export function clearInlineCache(): void {
  cache.clear()
}

/** 供工具提示/导出时的纯文本（保留指令的字面量） */
export function inlineToPlainText(nodes: readonly PhrasingContent[]): string {
  let out = ''
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'inlineCode') out += node.value
    else if (node.type === 'inlineMath') out += node.value
    else if (node.type === 'image') out += node.alt ?? ''
    else if ('children' in node) out += inlineToPlainText(node.children as PhrasingContent[])
  }
  return out
}
