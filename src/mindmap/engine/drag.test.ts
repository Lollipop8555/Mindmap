import { describe, expect, it } from 'vitest'
import { dropAnchor, dropGuide, resolveDrop, type Geometry } from './drag'

function fixture(): Geometry {
  return {
    rootId: 'root',
    layout: 'two-sided',
    rects: {
      root: { x: 0, y: 0, width: 80, height: 30 },
      A: { x: 120, y: -40, width: 100, height: 30 },
      B: { x: 120, y: 40, width: 100, height: 30 },
      D: { x: -120, y: 0, width: 100, height: 30 },
    },
    nodes: {
      root: { id: 'root', parentId: null, children: ['A', 'B', 'D'], depth: 0, side: 0 },
      A: { id: 'A', parentId: 'root', children: [], depth: 1, side: 1 },
      B: { id: 'B', parentId: 'root', children: [], depth: 1, side: 1 },
      D: { id: 'D', parentId: 'root', children: [], depth: 1, side: -1 },
    },
  }
}

describe('resolveDrop', () => {
  it('drops on a node → becomes its child', () => {
    const target = resolveDrop(fixture(), 'D', { x: 170, y: -25 })
    expect(target).toEqual({ kind: 'child', parentId: 'A' })
  })

  it('drops in the gap between siblings → inserts at that index', () => {
    const target = resolveDrop(fixture(), 'D', { x: 170, y: 0 })
    expect(target).toEqual({ kind: 'sibling', parentId: 'root', index: 1 })
  })

  it('rejects dropping on itself', () => {
    expect(resolveDrop(fixture(), 'A', { x: 170, y: -25 })).toBeNull()
  })

  it('rejects dropping into own subtree', () => {
    const geo = fixture()
    geo.nodes.A.children = ['E']
    geo.nodes.E = { id: 'E', parentId: 'A', children: [], depth: 2, side: 1 }
    geo.rects.E = { x: 260, y: -40, width: 80, height: 30 }
    expect(resolveDrop(geo, 'A', { x: 300, y: -25 })).toBeNull()
  })

  it('keeps the previous target until the pointer goes deep enough (hysteresis)', () => {
    const geo = fixture()
    const previous = { kind: 'child' as const, parentId: 'B' }
    // 指针仅落在 A 的 6px 外扩区，未深入 12px → 维持上一个目标
    const shallow = resolveDrop(geo, 'D', { x: 118, y: -25 }, { previous })
    expect(shallow).toEqual(previous)
    const deep = resolveDrop(geo, 'D', { x: 170, y: -25 }, { previous })
    expect(deep).toEqual({ kind: 'child', parentId: 'A' })
  })

  it('Alt forces node hit and ignores gap bands', () => {
    expect(resolveDrop(fixture(), 'D', { x: 170, y: 0 }, { alt: true })).toBeNull()
  })

  it('scales hit tolerance with zoom', () => {
    const geo = fixture()
    // zoom 1 时 6px 外扩 → x=112 不命中；zoom 0.5 时外扩 12 → 命中 A
    expect(resolveDrop(geo, 'D', { x: 112, y: -25 })).toBeNull()
    expect(resolveDrop(geo, 'D', { x: 112, y: -25 }, { zoom: 0.5 })).toEqual({
      kind: 'child',
      parentId: 'A',
    })
  })
})

describe('dropAnchor', () => {
  it('sits midway between the two siblings it will split', () => {
    const dot = dropAnchor(fixture(), { kind: 'sibling', parentId: 'root', index: 1 })
    // A 的下沿 -10、B 的上沿 40 → 正中间；x 在右侧那一列的左边缘
    expect(dot).toEqual({ x: 120, y: 15, side: 1 })
  })

  it('sits just above the first sibling', () => {
    const dot = dropAnchor(fixture(), { kind: 'sibling', parentId: 'root', index: 0 })
    expect(dot).toEqual({ x: 120, y: -49, side: 1 })
  })

  it('sits just below the last sibling, on the left column when the branch grows left', () => {
    const dot = dropAnchor(fixture(), { kind: 'sibling', parentId: 'root', index: 3 })
    expect(dot).toEqual({ x: -20, y: 39, side: -1 })
  })

  it('goes below the last child when the parent already has children', () => {
    const geo = fixture()
    geo.nodes.A.children = ['E']
    geo.nodes.E = { id: 'E', parentId: 'A', children: [], depth: 2, side: 1 }
    geo.rects.E = { x: 260, y: -40, width: 80, height: 30 }
    expect(dropAnchor(geo, { kind: 'child', parentId: 'A' })).toEqual({ x: 260, y: -1, side: 1 })
  })

  it('grows beside a parent that has no children yet, one level gap away', () => {
    expect(dropAnchor(fixture(), { kind: 'child', parentId: 'B' })).toEqual({
      x: 260,
      y: 55,
      side: 1,
    })
    // 左侧分支镜像
    expect(dropAnchor(fixture(), { kind: 'child', parentId: 'D' })).toEqual({
      x: -160,
      y: 15,
      side: -1,
    })
  })
})

describe('dropGuide', () => {
  it('runs from the parent connection point into the gap between siblings', () => {
    const guide = dropGuide(fixture(), { kind: 'sibling', parentId: 'root', index: 1 })
    expect(guide).not.toBeNull()
    // 起点 = root 右侧边中点再外推 TOGGLE_GAP（=2），与主题画的连线起点一致
    expect(guide!.path).toBe('M82,15C101,15 101,15 120,15')
    expect(guide!.dot).toEqual({ x: 120, y: 15 })
  })

  it('mirrors on the left side', () => {
    const guide = dropGuide(fixture(), { kind: 'sibling', parentId: 'root', index: 3 })
    expect(guide).not.toBeNull()
    expect(guide!.side).toBe(-1)
    expect(guide!.path).toBe('M-2,15C-11,15 -11,39 -20,39')
    expect(guide!.dot).toEqual({ x: -20, y: 39 })
  })

  it('starts at the parent when dropping on a leaf node', () => {
    const guide = dropGuide(fixture(), { kind: 'child', parentId: 'A' })
    expect(guide).not.toBeNull()
    // A 的框是 y=-40 高 30 → 侧边中点 y=-25，出线点再向右 2
    expect(guide!.path).toBe('M222,-25C241,-25 241,-25 260,-25')
    expect(guide!.dot).toEqual({ x: 260, y: -25 })
  })

  it('skips the guide when the parent has no frozen rect', () => {
    expect(dropGuide(fixture(), { kind: 'child', parentId: 'ghost' })).toBeNull()
  })
})
