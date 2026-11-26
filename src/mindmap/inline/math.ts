import type { AtomRenderer, AtomSize, Measurer, TextStyle, TextRun } from '@/mindmap/engine/types'

/**
 * 轻量公式排版：`$...$` 里的 LaTeX 没必要上 KaTeX（几百 KB，且与「纯静态离线」
 * 相冲）。这里只做两件让公式「像公式」的事：
 *
 * 1. 常见命令还原成 Unicode（`\times` → ×，`\alpha` → α，`\frac{a}{b}` → a/b）；
 * 2. `^` / `_` 变成真正的上标/下标 run，而不是留一个脱字符。
 *
 * 根号覆盖线、矩阵、积分上下限这类真排版不做，写不清就用 `:sup[]` 指令。
 */

export interface MathSegment {
  text: string
  /** 0 正常，1 上标，-1 下标 */
  script: 0 | 1 | -1
}

const MATH_FAMILY = '"Cambria Math", "Latin Modern Math", Georgia, "Times New Roman", serif'

const SYMBOLS: Record<string, string> = {
  cdot: '·',
  times: '×',
  div: '÷',
  pm: '±',
  mp: '∓',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  ne: '≠',
  neq: '≠',
  approx: '≈',
  equiv: '≡',
  to: '→',
  rightarrow: '→',
  leftarrow: '←',
  Rightarrow: '⇒',
  infty: '∞',
  sum: '∑',
  prod: '∏',
  int: '∫',
  partial: '∂',
  nabla: '∇',
  angle: '∠',
  perp: '⊥',
  circ: '∘',
  degree: '°',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  phi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Sigma: 'Σ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
}

const SPACES: Record<string, string> = { ',': ' ', ';': ' ', ':': ' ', ' ': ' ', '!': '' }

/** 读出 `{...}` 的内容（支持嵌套），返回内容与结束位置 */
function readGroup(input: string, start: number): { body: string; end: number } {
  let depth = 0
  let body = ''
  for (let i = start; i < input.length; i += 1) {
    const ch = input[i]
    if (ch === '{') {
      depth += 1
      if (depth === 1) continue
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0) return { body, end: i + 1 }
    }
    body += ch
  }
  return { body, end: input.length }
}

function readScript(input: string, start: number): { body: string; end: number } {
  if (input[start] === '{') return readGroup(input, start)
  return { body: input[start] ?? '', end: start + 1 }
}

export function mathSegments(input: string): MathSegment[] {
  const out: MathSegment[] = []
  let buffer = ''
  const script: 0 | 1 | -1 = 0

  const flush = () => {
    if (!buffer) return
    out.push({ text: buffer, script })
    buffer = ''
  }
  const push = (text: string, at: 1 | -1) => {
    if (!text) return
    out.push({ text, script: at })
  }

  let i = 0
  while (i < input.length) {
    const ch = input[i]

    if (ch === '\\') {
      const name = /^[a-zA-Z]+/.exec(input.slice(i + 1))?.[0]
      if (!name) {
        const spaced = SPACES[input[i + 1]]
        if (spaced !== undefined) buffer += spaced
        i += 2
        continue
      }
      i += 1 + name.length

      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const numerator = readGroup(input, i)
        const denominator = readGroup(input, numerator.end)
        flush()
        buffer += `${numerator.body}/${denominator.body}`
        i = denominator.end
        continue
      }
      if (name === 'sqrt') {
        const group = readGroup(input, i)
        flush()
        buffer += `√${group.body}`
        i = group.end
        continue
      }
      if (name === 'left' || name === 'right') {
        i += 1
        continue
      }
      if (name === 'text' || name === 'mathrm' || name === 'operatorname') {
        const group = readGroup(input, i)
        buffer += group.body
        i = group.end
        continue
      }
      buffer += SYMBOLS[name] ?? name
      continue
    }

    if (ch === '^' || ch === '_') {
      flush()
      const group = readScript(input, i + 1)
      push(
        mathSegments(group.body)
          .map((segment) => segment.text)
          .join(''),
        ch === '^' ? 1 : -1,
      )
      i = group.end
      continue
    }

    if (ch === '{' || ch === '}') {
      i += 1
      continue
    }
    if (ch === '~') {
      buffer += ' '
      i += 1
      continue
    }
    if (ch === '&') {
      i += 1
      continue
    }
    buffer += ch
    i += 1
  }
  flush()
  return out
}

function baselineOf(style: TextStyle): number {
  const { size, lineHeight } = style.font
  return (lineHeight + size * 0.7) / 2
}

const SCRIPT_FACTOR = 0.7

function fontFor(style: TextStyle, script: 0 | 1 | -1) {
  return {
    ...style.font,
    family: MATH_FAMILY,
    style: 'italic' as const,
    size: script === 0 ? style.font.size : style.font.size * SCRIPT_FACTOR,
  }
}

/**
 * render 阶段拿不到 measurer（引擎只在 measure 里注入），所以把 measure 算出的
 * 每段宽度缓存下来，render 直接复用，保证图元宽度与布局宽度完全一致。
 */
const widthsCache = new Map<string, number[]>()

function cacheKey(value: string, style: TextStyle): string {
  return `${style.font.size}|${style.font.weight}|${value}`
}

function measureSegments(
  segments: MathSegment[],
  style: TextStyle,
  measurer: Measurer,
): number[] {
  return segments.map((segment) => measurer.measure(segment.text, fontFor(style, segment.script)))
}

export interface InlineMathLike {
  type: 'inlineMath'
  value: string
}

export const mathAtom: AtomRenderer<InlineMathLike> = {
  measure(inline, style, ctx): AtomSize {
    const segments = mathSegments(inline.value)
    const widths = measureSegments(segments, style, ctx.measurer)
    widthsCache.set(cacheKey(inline.value, style), widths)
    return {
      width: widths.reduce((sum, width) => sum + width, 0),
      height: style.font.lineHeight,
      baseline: baselineOf(style),
    }
  },

  render(inline, box, style) {
    const segments = mathSegments(inline.value)
    const cached = widthsCache.get(cacheKey(inline.value, style))
    const widths = cached && cached.length === segments.length ? cached : null
    const base = baselineOf(style)
    const runs: TextRun[] = []
    let x = 0
    segments.forEach((segment, index) => {
      const font = fontFor(style, segment.script)
      const shift =
        segment.script === 1
          ? -style.font.size * 0.32
          : segment.script === -1
            ? style.font.size * 0.16
            : 0
      runs.push({ text: segment.text, x, y: base + shift, font, fill: style.fill })
      // 缓存缺失时按字符数粗略前进，宁可略挤也不重叠到下一个原子
      x += widths ? widths[index] : segment.text.length * font.size * 0.55
    })
    return [{ kind: 'text', x: box.x, y: box.y, runs }]
  },
}
