import { describe, expect, it } from 'vitest'
import {
  addChild,
  addSibling,
  assignBranchColors,
  branchOf,
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
  setFoldedSide,
  setLayout,
  setText,
  setTitle,
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

  it('keeps the title in sync with the root until the user renames it', () => {
    let doc = createDoc()
    expect(doc.title).toBe('')
    doc = setText(doc, doc.rootId, '产品规划')
    expect(doc.title).toBe('产品规划')
    doc = setTitle(doc, 'Q4 规划')
    expect(doc.renamed).toBe(true)
    // 改名之后根节点怎么变都不影响标题
    doc = setText(doc, doc.rootId, '产品规划（改）')
    expect(doc.title).toBe('Q4 规划')
  })

  it('gives every branch a distinct colour before reusing one', () => {
    let doc = createDoc('root')
    const ids: string[] = []
    for (let i = 0; i < 12; i += 1) {
      const added = addChild(doc, doc.rootId, `#${i}`)
      doc = added.doc
      ids.push(added.id)
    }
    // 前 10 条必然各不相同；第 11、12 条才开始复用（用最少的那批里挑）
    const branches = ids.map((id) => doc.nodes[id].branch)
    expect(new Set(branches.slice(0, 10)).size).toBe(10)
    expect(branches.length).toBe(12)
    expect(branches.every((b) => typeof b === 'number' && b >= 0 && b < 10)).toBe(true)
  })

  it('keeps a branch colour when the node is moved', () => {
    let doc = createDoc('root')
    const a = addChild(doc, doc.rootId, 'A')
    doc = a.doc
    const b = addChild(doc, doc.rootId, 'B')
    doc = b.doc
    const before = doc.nodes[b.id].branch
    doc = moveSibling(doc, b.id, -1)
    expect(doc.nodes[b.id].branch).toBe(before)
  })

  it('lets descendants inherit the nearest branch colour', () => {
    let doc = createDoc('root')
    const a = addChild(doc, doc.rootId, 'A')
    doc = a.doc
    const a1 = addChild(doc, a.id, 'A1')
    doc = a1.doc
    const branches = assignBranchColors(doc, () => 0.5)
    const nodes = {
      ...branches.nodes,
      [branches.rootId]: { ...branches.nodes[branches.rootId], branch: 3 },
      [a.id]: { ...branches.nodes[a.id], branch: 7 },
    }
    const tuned: MindDoc = { ...branches, nodes }
    expect(branchOf(tuned, tuned.rootId)).toBe(3)
    expect(branchOf(tuned, a1.id)).toBe(7)
  })

  it('folds one side of the root without touching the other', () => {
    let doc = createDoc('root')
    const a = addChild(doc, doc.rootId, 'A')
    doc = a.doc
    const b = addChild(doc, doc.rootId, 'B')
    doc = b.doc

    doc = setFoldedSide(doc, doc.rootId, 'left', true)
    expect(doc.foldedSides).toEqual({ left: true })
    doc = setFoldedSide(doc, doc.rootId, 'right', true)
    expect(doc.foldedSides).toEqual({ left: true, right: true })
    doc = setFoldedSide(doc, doc.rootId, 'left', false)
    expect(doc.foldedSides).toEqual({ right: true })
    doc = setFoldedSide(doc, doc.rootId, 'right', false)
    expect(doc.foldedSides).toBeUndefined()
    // 根节点之外没有「两侧」
    expect(setFoldedSide(doc, a.id, 'left', true)).toBe(doc)
  })

  it('keeps whole-root folding and side folding exclusive', () => {
    let doc = createDoc('root')
    const a = addChild(doc, doc.rootId, 'A')
    doc = a.doc
    const b = addChild(doc, doc.rootId, 'B')
    doc = b.doc

    doc = setFoldedSide(doc, doc.rootId, 'left', true)
    doc = toggleFold(doc, doc.rootId, true)
    expect(doc.nodes[doc.rootId].collapsed).toBe(true)
    expect(doc.foldedSides).toBeUndefined()

    doc = setFoldedSide(doc, doc.rootId, 'right', true)
    expect(doc.foldedSides).toEqual({ right: true })
    expect(doc.nodes[doc.rootId].collapsed).toBeUndefined()
  })

  it('drops side folds when the layout or the tree changes', () => {
    let doc = createDoc('root')
    const a = addChild(doc, doc.rootId, 'A')
    doc = a.doc
    const b = addChild(doc, doc.rootId, 'B')
    doc = b.doc

    doc = setFoldedSide(doc, doc.rootId, 'left', true)
    expect(setLayout(doc, 'tree').foldedSides).toBeUndefined()
    // 根节点新长出一条分支时两侧都展开，免得新节点落在收起那侧看不见
    expect(addChild(doc, doc.rootId, 'C').doc.foldedSides).toBeUndefined()
    expect(expandAll(doc).foldedSides).toBeUndefined()
    expect(collapseAll(doc).foldedSides).toBeUndefined()
    expect(collapseToDepth(doc, 1).foldedSides).toBeUndefined()
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
