import { describe, expect, it } from 'vitest'
import { createDoc, addChild, setText, type MindDoc } from '@/mindmap/model'
import { parseMarkdown } from './parse'
import { serializeDoc, serializeDocs } from './serialize'

interface Outline {
  text: string
  children: Outline[]
}

/** 导出会为结构性前缀加反斜杠，比较时按"渲染等价"归一 */
function canonical(text: string): string {
  return text
    .replace(/\\(.)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function outlineOf(doc: MindDoc): Outline {
  const walk = (id: string): Outline => {
    const node = doc.nodes[id]
    return {
      text: canonical(node.text),
      children: node.children.map((cid) => walk(cid)),
    }
  }
  return walk(doc.rootId)
}

function build(spec: Outline): MindDoc {
  let doc = createDoc(spec.text || 'root')
  doc = setText(doc, doc.rootId, spec.text)
  const walk = (parentId: string, children: Outline[]) => {
    for (const child of children) {
      const res = addChild(doc, parentId, child.text)
      doc = res.doc
      walk(res.id, child.children)
    }
  }
  walk(doc.rootId, spec.children)
  return doc
}

function expectRoundTrip(doc: MindDoc) {
  const text = serializeDoc(doc)
  const { docs, warnings } = parseMarkdown(text)
  expect(warnings.filter((w) => w.includes('压平'))).toEqual([])
  expect(docs).toHaveLength(1)
  expect(outlineOf(docs[0])).toEqual(outlineOf(doc))
  return text
}

describe('markdown round-trip', () => {
  it('keeps nesting and CJK bold', () => {
    const doc = build({
      text: '项目计划',
      children: [
        { text: '需求梳理', children: [{ text: '用户访谈', children: [] }] },
        { text: '**渲染**引擎 `markmap` 改造', children: [] },
        { text: '已完成：**100%** 与 `a|b`', children: [] },
      ],
    })
    const text = expectRoundTrip(doc)
    expect(text.startsWith('# 项目计划')).toBe(true)
    expect(text).not.toContain('frontmatter')
  })

  it('escapes structural prefixes instead of dropping content', () => {
    const doc = build({
      text: 'root',
      children: [
        { text: '- 看起来像列表', children: [] },
        { text: '# 看起来像标题', children: [] },
        { text: '> 看起来像引用', children: [] },
        { text: '---', children: [] },
        { text: '1. 有序列表', children: [] },
      ],
    })
    expectRoundTrip(doc)
  })

  it('keeps empty nodes as empty list items', () => {
    const doc = build({
      text: 'root',
      children: [
        { text: '', children: [] },
        { text: '有内容', children: [] },
      ],
    })
    const text = serializeDoc(doc)
    const { docs } = parseMarkdown(text)
    expect(docs[0].nodes[docs[0].rootId].children).toHaveLength(2)
  })

  it('keeps deep nesting', () => {
    const doc = build({
      text: 'root',
      children: [
        {
          text: 'L1',
          children: [
            { text: 'L2', children: [{ text: 'L3', children: [{ text: 'L4', children: [] }] }] },
          ],
        },
      ],
    })
    expectRoundTrip(doc)
  })

  it('splits multiple docs by top-level headings', () => {
    const a = build({ text: 'A', children: [{ text: 'a1', children: [] }] })
    const b = build({ text: 'B', children: [{ text: 'b1', children: [] }] })
    const text = serializeDocs([a, b])
    const { docs } = parseMarkdown(text)
    expect(docs.map((d) => d.nodes[d.rootId].text)).toEqual(['A', 'B'])
  })

  it('collapses newlines into spaces on export', () => {
    let doc = createDoc('root')
    const res = addChild(doc, doc.rootId, 'line1\nline2')
    doc = res.doc
    expect(serializeDoc(doc)).not.toContain('line1\nline2')
    expectRoundTrip(doc)
  })
})
