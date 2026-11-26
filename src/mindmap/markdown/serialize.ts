import type { MindDoc, MindNode } from '@/mindmap/model'

/**
 * 导出格式：tree → `#` 标题 + 缩进无序列表。
 * 不写 frontmatter、不写折叠、不写颜色、不写 id —— 状态不进 Markdown 语法。
 */

const ORDERED_MARKER = /^(\d{1,9})([.)])(?=\s)/
const LIST_MARKER = /^(?:[-*+]|\d{1,9}[.)])\s/
const HEADING = /^#{1,6}(?:\s|$)/
const BLOCKQUOTE = /^>/
const THEMATIC = /^(?:-{3,}|\*{3,}|_{3,})$/

/**
 * 只在"重新解析会改变结构"的地方转义。
 * 有序列表必须转义分隔符（`1\.`），因为 `\1` 不是合法的反斜杠转义。
 */
export function escapeText(text: string): string {
  const single = text.replace(/\s*\r?\n\s*/g, ' ').trim()
  if (!single) return ''
  const ordered = single.match(ORDERED_MARKER)
  if (ordered) {
    const at = ordered[1].length
    return `${single.slice(0, at)}\\${single.slice(at)}`
  }
  if (LIST_MARKER.test(single) || HEADING.test(single) || BLOCKQUOTE.test(single) || THEMATIC.test(single)) {
    return `\\${single}`
  }
  return single
}

export function serializeDoc(doc: MindDoc): string {
  const root = doc.nodes[doc.rootId]
  if (!root) return ''
  const lines: string[] = [`# ${escapeText(root.text) || doc.title}`, '']
  const walk = (node: MindNode, depth: number) => {
    const indent = '  '.repeat(depth)
    lines.push(`${indent}- ${escapeText(node.text)}`)
    for (const cid of node.children) {
      const child = doc.nodes[cid]
      if (child) walk(child, depth + 1)
    }
  }
  for (const cid of root.children) {
    const child = doc.nodes[cid]
    if (child) walk(child, 0)
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`
}

export function serializeDocs(docs: MindDoc[]): string {
  return docs.map(serializeDoc).join('\n')
}

export function markdownFileName(title: string, date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const safe = (title || '未命名导图')
    .replace(/[/\\:*?"<>|\r\n]/g, '-')
    .slice(0, 60)
    .trim()
  return `${safe || '未命名导图'}-${stamp}.md`
}

export function imageFileName(title: string, ext: 'png' | 'svg', date = new Date()): string {
  return markdownFileName(title, date).replace(/\.md$/, `.${ext}`)
}
