import { describe, expect, it } from 'vitest'
import {
  addChild,
  addSibling,
  canMove,
  collapseAll,
  collapseToDepth,
  createDoc,
  expandAll,
  flatten,
  indent,
  moveNode,
  moveSibling,
  outdent,
  removeNode,
  restore,
  setText,
  snapshot,
  toggleFold,
  validate,
  visibleIds,
  type MindDoc,
} from './model'

function texts(doc: MindDoc): string[] {
  return flatten(doc).map((node) => node.text)
}

describe('mindmap model', () => {
  it('creates a root-only document', () => {
    const doc = createDoc('项目计划')
    expect(doc.rootId).toBe(doc.id)
    expect(nodeCount(doc)).toBe(1)
    expect(doc.nodes[doc.rootId].text).toBe('项目计划')
  })

  it('adds children and siblings in order', () => {
    let doc = createDoc('root')
    const a = addChild(doc, doc.rootId, 'A')
    doc = a.doc
    const b = addChild(doc, doc.rootId, 'B')
    doc = b.doc
    const a2 = addSibling(doc, a.id, 'A2')
    doc = a2.doc
    expect(doc.nodes[doc.rootId].children).toEqual([a.id, a2.id, b.id])
    expect(doc.nodes[a2.id].parentId).toBe(doc.rootId)
  })

  it('removes a whole subtree and prunes ids', () => {
    let doc = createDoc('root')
    const a = addChild(doc, doc.rootId, 'A')
    doc = a.doc
    const child = addChild(doc, a.id, 'A1')
    doc = child.doc
    const { doc: next, removed } = removeNode(doc, a.id)
    expect(removed.sort()).toEqual([a.id, child.id].sort())
    expect(next.nodes[a.id]).toBeUndefined()
    expect(next.nodes[child.id]).toBeUndefined()
    expect(validate(next)).toEqual([])
  })

  it('refuses to move a node into its own subtree', () => {
    let doc = createDoc('root')
    const a = addChild(doc, doc.rootId, 'A')
    doc = a.doc
    const child = addChild(doc, a.id, 'A1')
    doc = child.doc
    expect(canMove(doc, a.id, { kind: 'child', parentId: child.id })).toBe(false)
    expect(canMove(doc, child.id, { kind: 'child', parentId: a.id })).toBe(false)
    expect(moveNode(doc, a.id, { kind: 'child', parentId: child.id })).toBe(doc)
  })

  it('moves nodes to child and sibling targets', () => {
    let doc = createDoc('root')
    const a = addChild(doc, doc.rootId, 'A')
    doc = a.doc
    const b = addChild(doc, doc.rootId, 'B')
    doc = b.doc
    const c = addChild(doc, doc.rootId, 'C')
    doc = c.doc

    doc = moveNode(doc, c.id, { kind: 'child', parentId: a.id })
    expect(doc.nodes[c.id].parentId).toBe(a.id)
    expect(doc.nodes[doc.rootId].children).toEqual([a.id, b.id])

    doc = moveNode(doc, a.id, { kind: 'sibling', parentId: doc.rootId, index: 1 })
    expect(doc.nodes[doc.rootId].children).toEqual([b.id, a.id])
    expect(doc.nodes[c.id].parentId).toBe(a.id)
    expect(validate(doc)).toEqual([])
  })

  it('supports outdent and indent', () => {
    let doc = createDoc('root')
    const a = addChild(doc, doc.rootId, 'A')
    doc = a.doc
    const b = addChild(doc, doc.rootId, 'B')
    doc = b.doc

    doc = indent(doc, b.id)
    expect(doc.nodes[b.id].parentId).toBe(a.id)

    doc = outdent(doc, b.id)
    expect(doc.nodes[b.id].parentId).toBe(doc.rootId)
  })

  it('moves siblings up and down', () => {
    let doc = createDoc('root')
    const a = addChild(doc, doc.rootId, 'A')
    doc = a.doc
    const b = addChild(doc, doc.rootId, 'B')
    doc = b.doc
    const c = addChild(doc, doc.rootId, 'C')
    doc = c.doc

    doc = moveSibling(doc, c.id, -1)
    expect(doc.nodes[doc.rootId].children).toEqual([a.id, c.id, b.id])
    doc = moveSibling(doc, a.id, -1)
    expect(doc.nodes[doc.rootId].children).toEqual([a.id, c.id, b.id])
  })

  it('hides descendants of folded nodes', () => {
    let doc = createDoc('root')
    const a = addChild(doc, doc.rootId, 'A')
    doc = a.doc
    const a1 = addChild(doc, a.id, 'A1')
    doc = a1.doc

    expect(visibleIds(doc)).toEqual([doc.rootId, a.id, a1.id])
    doc = toggleFold(doc, a.id, true)
    expect(visibleIds(doc)).toEqual([doc.rootId, a.id])
    doc = expandAll(doc)
    expect(visibleIds(doc)).toContain(a1.id)
    doc = collapseAll(doc)
    expect(visibleIds(doc)).toEqual([doc.rootId])
  })

  it('collapses to a given depth', () => {
    let doc = createDoc('root')
    const a = addChild(doc, doc.rootId, 'A')
    doc = a.doc
    const a1 = addChild(doc, a.id, 'A1')
    doc = a1.doc

    doc = collapseToDepth(doc, 1)
    expect(visibleIds(doc)).toEqual([doc.rootId, a.id])
  })

  it('round-trips through snapshot/restore', () => {
    let doc = createDoc('root')
    const a = addChild(doc, doc.rootId, 'A')
    doc = a.doc
    const before = snapshot(doc)
    doc = setText(doc, a.id, 'A 改过')
    expect(texts(doc)).toContain('A 改过')
    const restored = restore(doc, before)
    expect(restored.nodes[a.id].text).toBe('A')
    expect(validate(restored)).toEqual([])
  })
})

function nodeCount(doc: MindDoc): number {
  return Object.keys(doc.nodes).length
}
