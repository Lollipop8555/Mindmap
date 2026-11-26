import { describe, expect, it } from 'vitest'
import { dropGuide, insertIndicator, resolveDrop, ghostPlacement, type Geometry } from './drag'

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

describe('ghostPlacement / insertIndicator', () => {
  it('places the ghost under the last child', () => {
    const placement = ghostPlacement(fixture(), { kind: 'child', parentId: 'A' }, { width: 80, height: 30 })
    expect(placement).not.toBeNull()
    expect(placement!.side).toBe(1)
    expect(placement!.x).toBe(252)
  })

  it('places the ghost at the gap for sibling inserts', () => {
    const placement = ghostPlacement(
      fixture(),
      { kind: 'sibling', parentId: 'root', index: 1 },
      { width: 80, height: 24 },
    )
    expect(placement).not.toBeNull()
    expect(placement!.y).toBeCloseTo(3)
  })

  it('returns an indicator line for sibling targets only', () => {
    const line = insertIndicator(fixture(), { kind: 'sibling', parentId: 'root', index: 1 })
    expect(line).toEqual({ x1: 120, x2: 220, y: 15 })
    expect(insertIndicator(fixture(), { kind: 'child', parentId: 'A' })).toBeNull()
  })
})

describe('dropGuide', () => {
  const placement = (side: -1 | 0 | 1, x: number) => ({ x, y: 3, width: 80, height: 24, side })

  it('runs from the parent right edge to the drop point on the right side', () => {
    const guide = dropGuide(fixture(), { kind: 'sibling', parentId: 'root', index: 1 }, placement(1, 120))
    expect(guide).not.toBeNull()
    expect(guide!.side).toBe(1)
    // 起点 = root 右缘中线，端点 = 幽灵左侧中线
    expect(guide!.path).toBe('M80,15C100,15 100,15 120,15')
    expect(guide!.dot).toEqual({ x: 120, y: 15 })
  })

  it('mirrors on the left side (two-sided layout grows right-to-left)', () => {
    const guide = dropGuide(fixture(), { kind: 'sibling', parentId: 'root', index: 0 }, placement(-1, -120))
    expect(guide).not.toBeNull()
    expect(guide!.side).toBe(-1)
    // 起点 = root 左缘中线，端点 = 幽灵右侧中线
    expect(guide!.path).toBe('M0,15C-20,15 -20,15 -40,15')
    expect(guide!.dot).toEqual({ x: -40, y: 15 })
  })

  it('uses a vertical curve in single-sided layout', () => {
    const guide = dropGuide(fixture(), { kind: 'child', parentId: 'root' }, { ...placement(0, 100), y: 60 })
    expect(guide).not.toBeNull()
    // 起点 = root 底边中点，端点 = 幽灵顶边中点
    expect(guide!.path).toBe('M40,30C40,45 140,45 140,60')
    expect(guide!.dot).toEqual({ x: 140, y: 60 })
  })

  it('skips the guide when parent and drop point are the same place', () => {
    expect(
      dropGuide(fixture(), { kind: 'sibling', parentId: 'root', index: 1 }, placement(1, 78)),
    ).toBeNull()
  })

  it('skips the guide when the parent has no frozen rect', () => {
    expect(dropGuide(fixture(), { kind: 'child', parentId: 'ghost' }, placement(1, 120))).toBeNull()
  })
})
