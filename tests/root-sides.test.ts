import { describe, expect, it } from 'vitest'
import type { MarkmapNode } from '@markmap/core'
import { layoutTree, layoutTwoSided, renderTree, type RenderResult } from '@markmap/render'
import { createEngineTheme } from '@/mindmap/engine/theme'
import { createMonetTheme } from '@/mindmap/theme/monet'

/** 最小可用的 MarkmapNode：主题只关心 id / children / data.branch */
function node(id: string, branch: number, children: MarkmapNode[] = []): MarkmapNode {
  return {
    id,
    type: 'heading',
    content: [{ type: 'text', value: id }],
    notes: [],
    data: { branch },
    children,
  }
}

function fourBranches(): MarkmapNode {
  return node('root', 0, [node('a', 0), node('b', 1), node('c', 2), node('d', 3)])
}

function sizesOf(root: MarkmapNode): Map<string, { width: number; height: number }> {
  const sizes = new Map<string, { width: number; height: number }>()
  const visit = (item: MarkmapNode) => {
    sizes.set(item.id, { width: 40, height: 20 })
    item.children.forEach(visit)
  }
  visit(root)
  return sizes
}

describe('root child sides', () => {
  it('reports which side each root child went to, in document order', () => {
    const root = fourBranches()
    const layout = layoutTwoSided(root, { sizes: sizesOf(root) })
    // 四个等大分支：靠前的去右边，靠后的去左边
    expect(layout.byId.get('root')?.childSides).toEqual(['right', 'right', 'left', 'left'])
  })

  it('keeps the folded side in childSides, so a folded side can still be tinted', () => {
    const root = fourBranches()
    const layout = layoutTwoSided(root, {
      sizes: sizesOf(root),
      foldedSides: { root: { right: true } },
    })
    const item = layout.byId.get('root')
    expect(item?.childSides).toHaveLength(4)
    expect(item?.sides?.right.folded).toBe(true)
    // 收起来的那一侧不再参与绘制
    expect(layout.byId.has('a')).toBe(false)
  })

  it('grows every branch of the root to the right in a tree', () => {
    const root = fourBranches()
    const layout = layoutTree(root, { sizes: sizesOf(root) })
    expect(layout.byId.get('root')?.childSides).toEqual(['right', 'right', 'right', 'right'])
  })

  it('hands childSides to the theme through the node context', () => {
    const root = fourBranches()
    const result = renderTree(root, {
      measurer: { measure: (text) => text.length * 8 },
      layout: { name: 'two-sided', layout: layoutTwoSided },
    })
    expect(result.contexts.get('root')?.childSides).toEqual(['right', 'right', 'left', 'left'])
  })

  it('paints one vertical tone per side, in branch order', () => {
    const root = fourBranches()
    const result = renderTree(root, {
      measurer: { measure: (text) => text.length * 8 },
      theme: createEngineTheme(createMonetTheme('light')),
      layout: { name: 'two-sided', layout: layoutTwoSided },
    })
    const svgOf = (primitives: readonly RenderResult['primitives'][number][]): string =>
      primitives
        .map((primitive) =>
          primitive.kind === 'custom'
            ? (primitive.svg?.() ?? '')
            : primitive.kind === 'group'
              ? svgOf(primitive.children)
              : '',
        )
        .join('')
    const svg = svgOf(result.primitives)
    const stopsOf = (side: 'left' | 'right') => {
      const tone = svg.match(new RegExp(`-tone-${side}"[^>]*>(.*?)</linearGradient>`))
      return [...(tone?.[1] ?? '').matchAll(/stop-color="([^"]+)"/g)].map((m) => m[1])
    }
    expect(stopsOf('right')).toHaveLength(2)
    expect(stopsOf('left')).toHaveLength(2)
    // 两侧颜色不同，说明确实按各自的子分支取色
    expect(stopsOf('right')).not.toEqual(stopsOf('left'))
  })
})
