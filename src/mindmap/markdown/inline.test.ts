import { describe, expect, it } from 'vitest'
import type { PhrasingContent } from 'mdast'
import { parseInline } from './inline'

/** 把内联节点压平成一串 `type:text`，方便断言顺序 */
function shapes(nodes: PhrasingContent[]): string[] {
  const out: string[] = []
  for (const node of nodes) {
    const text = 'value' in node && typeof node.value === 'string' ? node.value : ''
    if (node.type === 'text') out.push(text)
    else out.push(`${node.type}(${text || flatten(node)})`)
  }
  return out
}

function flatten(node: PhrasingContent): string {
  const children = 'children' in node ? (node.children as PhrasingContent[]) : []
  return children
    .map((child) => ('value' in child && typeof child.value === 'string' ? child.value : ''))
    .join('')
}

describe('parseInline 简写', () => {
  it('把 ==高亮== 转成 mark', () => {
    expect(shapes(parseInline('前 ==重点== 后'))).toEqual(['前 ', 'mark(重点)', ' 后'])
  })

  it('把 ++下划线++ 转成 mmUnderline', () => {
    expect(shapes(parseInline('++强调++'))).toEqual(['mmUnderline(强调)'])
  })

  it('把 ^上标^ 转成 mmSup', () => {
    expect(shapes(parseInline('H^2^O'))).toEqual(['H', 'mmSup(2)', 'O'])
  })

  it('不把 ~x~ 当下标（GFM 单波浪线是删除线）', () => {
    expect(shapes(parseInline('H~2~O'))).toEqual(['H', 'delete(2)', 'O'])
  })

  it('把 #标签 转成 mmBadge，且同一标签稳定同色', () => {
    const [a] = parseInline('#设计') as unknown as { type: string; tone: string }[]
    const [b] = parseInline('#设计 和 #设计') as unknown as { type: string; tone: string }[]
    expect(a.type).toBe('mmBadge')
    expect(a.tone).toBe(b.tone)
  })

  it('不在 URL 片段里误判标签', () => {
    const nodes = parseInline('见 https://example.com/#foo 说明') as unknown as {
      type: string
    }[]
    expect(nodes.some((node) => node.type === 'mmBadge')).toBe(false)
  })
})
