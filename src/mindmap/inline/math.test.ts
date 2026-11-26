import { describe, expect, it } from 'vitest'
import { mathSegments } from './math'

const shape = (input: string) => mathSegments(input).map((segment) => [segment.text, segment.script])

describe('mathSegments', () => {
  it('上下标变成独立 run', () => {
    expect(shape('a^2+b^2=c^2')).toEqual([
      ['a', 0],
      ['2', 1],
      ['+b', 0],
      ['2', 1],
      ['=c', 0],
      ['2', 1],
    ])
  })

  it('大括号分组与下标', () => {
    expect(shape('x_{n+1}')).toEqual([
      ['x', 0],
      ['n+1', -1],
    ])
  })

  it('常见命令换成 Unicode', () => {
    expect(shape('\\alpha \\times \\beta \\le \\infty')).toEqual([
      ['α × β ≤ ∞', 0],
    ])
  })

  it('分式退化成 a/b', () => {
    expect(shape('\\frac{a}{b}')).toEqual([['a/b', 0]])
  })

  it('不认识的命令保留名字，不吞字符', () => {
    expect(shape('\\foo x')).toEqual([['foo x', 0]])
  })
})
