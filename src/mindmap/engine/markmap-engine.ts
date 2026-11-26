import { select } from 'd3-selection'
import { zoomIdentity } from 'd3-zoom'
import type {
  Layout,
  MarkmapNode as EngineNode,
  MeasureContext,
  NodeContext,
  Theme,
} from '@markmap/core'
import {
  basicContent,
  createCanvasMeasurer,
  layoutText,
  primitivesToSVG,
  renderTree,
  toSVGString,
  transformContent,
  treeLayout,
  twoSidedLayout,
} from '@markmap/render'
import type { Gestures } from '@markmap/view'
import { Markmap, pointerGestures } from '@markmap/view'
import { setInlineScheme } from '@/mindmap/inline/palette'
import { mmInlineContent } from '@/mindmap/inline/plugin'
import { parseInline } from '@/mindmap/markdown/inline'
import { createMonetTheme, type MonetTheme } from '@/mindmap/theme/monet'
import { createEngineTheme } from './theme'
import type {
  Engine,
  ExportOptions,
  FoldedSides,
  HitResult,
  MarkmapNode,
  NodeState,
  Point,
  Rect,
  Size,
} from './types'

/**
 * 真实引擎：vendor 的 markmap 之上的一层薄适配。
 *
 * 只做四件事：把 app 的树/主题翻译过去、把上游事件与坐标翻译回来、
 * 自己补一层 SVG overlay（拖拽虚影/高亮）、以及导出 SVG/PNG。
 */

type LayoutMode = 'two-sided' | 'tree'

const WRAP_WIDTH = 320
const LEVEL_GAP = 60
const SIBLING_GAP = 12
const FIT_PADDING = 56
const FIT_MAX_SCALE = 1.4
const DURATION = 220

function layoutOf(mode: LayoutMode): Layout {
  return mode === 'tree' ? treeLayout : twoSidedLayout
}

/** 折叠圆点/链接点击：只接管 toggle，其余交给 Stage 的指针逻辑 */
const blankAwareGestures: Gestures = (instance) => {
  const selection = select(instance.element)
  instance.zoomBehavior.filter((event: Event) => {
    if (event.type === 'wheel') return true
    if (event.type === 'dblclick') return false
    const mouse = event as MouseEvent
    if (mouse.button ?? 0) return false
    const target = event.target as Element | null
    return !target?.closest?.('[data-node-id]')
  })
  selection.call(instance.zoomBehavior as never)
  const stopPointer = pointerGestures(instance)
  return () => {
    selection.on('.zoom', null)
    stopPointer()
  }
}

export function createMarkmapEngine(): Engine {
  let mm: Markmap | null = null
  let svg: SVGSVGElement | null = null
  let overlay: SVGGElement | null = null
  let measurer = createCanvasMeasurer()
  let monet: MonetTheme = createMonetTheme('light')
  let theme: Theme = createEngineTheme(monet)
  let mode: LayoutMode = 'two-sided'
  let states: Record<string, NodeState> = {}
  /** 状态重试用的 rAF 句柄与次数（首帧动画期间节点元素尚未创建） */
  let stateRaf = 0
  let stateRetry = 0
  /** 每次 fit/缩放自增，用来作废「打开后延迟校准」的那一次 */
  let fitToken = 0
  /** 用户是否亲自动过画布；动过就不再自动纠正视图 */
  let touched = false

  const listeners = new Map<string, Set<(payload?: unknown) => void>>()
  const emit = (event: string, payload?: unknown) => {
    for (const cb of listeners.get(event) ?? []) cb(payload)
  }

  const plugins = [basicContent, mmInlineContent] as unknown as ReturnType<
    typeof Array.prototype.slice
  >

  function viewOptions() {
    return {
      theme,
      plugins,
      layout: layoutOf(mode),
      wrapWidth: WRAP_WIDTH,
      levelGap: LEVEL_GAP,
      siblingGap: SIBLING_GAP,
      fitPadding: FIT_PADDING,
      fitMaxScale: FIT_MAX_SCALE,
      minScale: 0.1,
      maxScale: 4,
      duration: DURATION,
      colorScheme: monet.scheme,
      highlight: false,
      zoom: true,
      pan: true,
      gestures: blankAwareGestures,
    }
  }

  function syncOverlayTransform() {
    if (!overlay || !mm) return
    const { k, x, y } = mm.transform
    overlay.setAttribute('transform', `translate(${x},${y}) scale(${k})`)
  }

  /**
   * 把节点状态打到后端复用的 <g> 上（`@markmap/view` 按 key 复用 DOM，重绘不会丢属性）。
   *
   * 首帧渲染是带动画的：`render` 事件在 tween 启动时就发出，此时节点元素还没建出来，
   * 所以找不到元素时用 rAF 重试几帧，直到 tween 把第一帧画出来。
   */
  function applyStates() {
    const backend = mm?.backend as { get?: (key: string) => Element | undefined } | undefined
    if (!mm || !backend?.get) return

    const known = new Set(Object.keys(states))
    let missing = 0
    for (const id of known) {
      const el = backend.get(`node:${id}`) as SVGGElement | undefined
      if (!el) {
        missing++
        continue
      }
      const state = states[id] ?? {}
      el.classList.add('mm-node')
      const names = (['selected', 'editing', 'dragging', 'dimmed'] as const).filter(
        (name) => state[name],
      )
      el.setAttribute('data-state', names.join(' '))
      for (const name of ['selected', 'editing', 'dragging', 'dimmed'] as const) {
        if (state[name]) el.setAttribute(`data-${name}`, 'true')
        else el.removeAttribute(`data-${name}`)
      }
    }

    // 状态里没有的节点：清掉上一轮残留的属性
    for (const el of svg?.querySelectorAll<SVGGElement>('.mm-node[data-state]') ?? []) {
      if (known.has(el.dataset.nodeId ?? '')) continue
      el.classList.remove('mm-node')
      el.removeAttribute('data-state')
      for (const name of ['selected', 'editing', 'dragging', 'dimmed']) {
        el.removeAttribute(`data-${name}`)
      }
    }

    if (missing > 0 && stateRetry < 60) {
      stateRetry++
      cancelAnimationFrame(stateRaf)
      stateRaf = requestAnimationFrame(applyStates)
    }
  }

  function bind(instance: Markmap) {
    let lastFolded = new Set<string>()
    instance.on('zoom', (transform) => {
      syncOverlayTransform()
      emit('zoom', { k: transform.k })
    })
    instance.on('render', () => {
      // 新一轮渲染：重新给状态应用留出重试预算（首帧动画期间元素可能还没建出来）
      stateRetry = 0
      applyStates()
      syncOverlayTransform()
      emit('render')
    })
    instance.on('fold', (folded) => {
      for (const id of folded) {
        if (!lastFolded.has(id)) emit('fold', { id, folded: true })
      }
      for (const id of lastFolded) {
        if (!folded.has(id)) emit('fold', { id, folded: false })
      }
      lastFolded = new Set(folded)
    })
    instance.on('foldSides', (sides) => emit('foldSides', sides))
  }

  function measureNode(text: string, opts: { depth: number; branch: number }): Size {
    const node: EngineNode = {
      id: 'measure',
      type: 'listItem',
      content: parseInline(text) as never,
      notes: [],
      data: { depth: opts.depth, branch: opts.branch },
      children: [],
    }
    const mctx: MeasureContext = {
      depth: opts.depth,
      path: ['measure'],
      hasChildren: false,
      folded: false,
    }
    const style = {
      font: theme.node.font?.(node, mctx) ?? theme.font,
      fill: theme.node.textFill?.(node, mctx) ?? theme.textFill,
    }
    const ctx = {
      theme,
      measurer,
      node,
      wrapWidth: WRAP_WIDTH,
    }
    const layout = layoutText(transformContent(plugins as never, ctx as never), {
      style,
      wrapWidth: WRAP_WIDTH,
      plugins: plugins as never,
      ctx: ctx as never,
    })
    const [top, right, bottom, left] =
      theme.node.boxPadding?.(node, mctx) ?? theme.node.padding
    return {
      width: Math.round(layout.width + left + right),
      height: Math.round(Math.max(layout.height + top + bottom, theme.node.minHeight ?? 0)),
    }
  }

  /** 按指定配色造一套主题：导出配色和当前视图不一致时要用它重新渲染（节点样式跟着视图走） */
  function paletteFor(scheme: 'light' | 'dark') {
    const next = createMonetTheme(scheme, monet.style)
    return { monet: next, theme: createEngineTheme(next) }
  }

  /** 导出用的完整渲染结果（可选全部展开、可选浅色/深色配色） */
  function renderForExport(opts?: ExportOptions) {
    const root = mm?.tree
    if (!root || !mm) return null
    const folded = opts?.foldAll ? new Set<string>() : new Set(mm.foldedIds)
    const foldedSides = opts?.foldAll ? {} : mm.foldedSides
    const scheme = opts?.colorScheme ?? monet.scheme
    // 配色不是「跟着视图走」时必须用对应 scheme 的主题**重新渲染**：节点卡片、圆点、
    // 连线的颜色在渲染期就写成了真实色值，只改 <style> 里的 CSS 变量换不掉它们。
    const active = scheme === monet.scheme ? { monet, theme } : paletteFor(scheme)
    // 富内联的颜色取自模块级 scheme，渲染前后切一下再还原，别污染画布
    const inlineWas = monet.scheme
    if (scheme !== inlineWas) setInlineScheme(scheme)
    let result: ReturnType<typeof renderTree>
    try {
      result = renderTree(root, {
        ...viewOptions(),
        theme: active.theme,
        colorScheme: scheme,
        measurer,
        folded,
        foldedSides,
      } as never)
    } finally {
      if (scheme !== inlineWas) setInlineScheme(inlineWas)
    }
    const padding = opts?.padding ?? 32
    // `paper` 是「当前配色的纸色」占位符。SVG 里必须落成真实色值：写 fill="paper"
    // 是非法的，浏览器会当作没有填充，导出的图就变成透明底。
    const requested = opts?.background ?? true
    const background = requested === 'paper' ? active.monet.chrome.paper : requested
    let markup = toSVGString(result, {
      padding,
      background: typeof background === 'boolean' ? background : false,
      colorScheme: scheme,
    })
    if (typeof background === 'string') {
      const box = {
        x: result.bounds.x - padding,
        y: result.bounds.y - padding,
        width: result.bounds.width + padding * 2,
        height: result.bounds.height + padding * 2,
      }
      const rect = `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="${background}"/>`
      markup = markup.replace(/(<style>[\s\S]*?<\/style>)/, `$1${rect}`)
    }
    return { markup, box: result.bounds, padding }
  }

  function exportScale(markup: string, scale: number): string {
    if (scale === 1) return markup
    return markup.replace(
      /<svg([^>]*?)width="([\d.]+)"([^>]*?)height="([\d.]+)"/,
      (_all, a: string, w: string, b: string, h: string) =>
        `<svg${a}width="${Number(w) * scale}"${b}height="${Number(h) * scale}"`,
    )
  }

  const engine: Engine = {
    mount(el, opts) {
      mode = opts.layout
      monet = createMonetTheme('light')
      theme = createEngineTheme(monet)
      setInlineScheme(monet.scheme)
      measurer = createCanvasMeasurer()

      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('class', 'mm-engine-svg')
      svg.setAttribute('width', '100%')
      svg.setAttribute('height', '100%')
      svg.style.display = 'block'
      svg.style.touchAction = 'none'
      el.appendChild(svg)
      touched = false
      fitToken += 1
      // 用户自己动过画布（拖拽/滚轮/触摸）之后就不再自动纠正视图
      const markTouched = () => {
        touched = true
      }
      for (const type of ['pointerdown', 'wheel', 'touchstart']) {
        svg.addEventListener(type, markTouched, { passive: true })
      }

      mm = new Markmap(svg, viewOptions() as never)
      bind(mm)
      mm.setTree(opts.tree as unknown as EngineNode)
      mm.setFoldState(opts.folded, opts.foldedSides ?? {}, { animate: false })

      overlay = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      overlay.setAttribute('class', 'mm-engine-overlay')
      svg.appendChild(overlay)
      syncOverlayTransform()
      applyStates()
    },

    setTree(root, opts) {
      if (!mm) return
      // 换文档时不放「上一次画的是别的图」的补间：位置会从旧图飞过来，看起来就是
      // 打开导图先摆错位置再慢慢归位。
      mm.setTree(root as unknown as EngineNode, undefined, { animate: opts?.animate })
      applyStates()
    },

    setFoldedIds(ids, opts) {
      mm?.setFoldedIds(ids, { animate: opts?.animate })
    },

    setFoldedSides(sides: FoldedSides, opts) {
      if (!mm) return
      mm.setFoldState(mm.foldedIds, sides, { animate: opts?.animate })
    },

    setLayout(next) {
      if (!mm || mode === next) return
      mode = next
      mm.setOptions(viewOptions() as never)
    },

    setTheme(next) {
      monet = next as MonetTheme
      theme = createEngineTheme(monet)
      // 富内联的颜色是图元里的真实色值，必须在重绘前切好
      setInlineScheme(monet.scheme)
      mm?.setOptions(viewOptions() as never)
    },

    fit(opts) {
      if (!mm) return
      fitToken += 1
      mm.fit({ animate: opts?.animate })
      if (!opts?.settle) return
      // 打开文档时容器尺寸/布局有可能晚一帧才定下来，量早了就会「不居中」。这里在
      // 动画结束后无声地再校一次（同一份几何下这次 fit 是幂等的，画面不会跳）；
      // 期间用户只要碰过画布或点过缩放，就交还给他，不再纠正。
      const token = fitToken
      const el = mm.element
      touched = false
      window.setTimeout(() => {
        if (!mm || token !== fitToken || touched) return
        const { width, height } = el.getBoundingClientRect()
        if (!width || !height) return
        mm.fit({ animate: false })
      }, 420)
    },

    center() {
      fitToken += 1
      mm?.fit()
    },

    zoomBy(factor) {
      fitToken += 1
      mm?.zoomBy(factor)
    },

    zoomTo(k) {
      if (!mm) return
      fitToken += 1
      const { width, height } = mm.element.getBoundingClientRect()
      const t = mm.transform
      const cx = (width / 2 - t.x) / t.k
      const cy = (height / 2 - t.y) / t.k
      const target = zoomIdentity
        .translate(width / 2 - cx * k, height / 2 - cy * k)
        .scale(k)
      select(mm.element).call(mm.zoomBehavior.transform as never, target as never)
    },

    getZoom() {
      return mm?.transform.k ?? 1
    },

    screenRect(id): Rect | null {
      const rect = mm?.screenRect(id)
      return rect ? { ...rect } : null
    },

    layoutRects() {
      const byId = mm?.result?.layout.byId
      const rects: Record<string, Rect> = {}
      if (!byId) return rects
      for (const [id, item] of byId) {
        rects[id] = { x: item.rect.x, y: item.rect.y, width: item.rect.width, height: item.rect.height }
      }
      return rects
    },

    layoutPoint(clientX, clientY): Point | null {
      if (!mm) return null
      const [x, y] = mm.layoutPoint(clientX, clientY)
      return { x, y }
    },

    screenPoint(x, y): Point | null {
      if (!mm) return null
      const [px, py] = mm.screenPoint(x, y)
      return { x: px, y: py }
    },

    hitAt(x, y): HitResult | null {
      const target = mm?.hitAt(x, y)
      if (!target) return { type: 'blank' }
      if (target.kind === 'node') return { type: 'node', id: target.nodeId }
      if (target.kind === 'toggle') {
        // 上游的 Side 还包含树形布局的 'top'，这里只有左右两个折叠点
        const side = target.side === 'left' || target.side === 'right' ? target.side : undefined
        return { type: 'toggle', id: target.nodeId, ...(side && { side }) }
      }
      if (target.kind === 'link') return { type: 'link' }
      return { type: 'blank' }
    },

    setNodeStates(next) {
      states = next ?? {}
      stateRetry = 0
      applyStates()
    },

    setOverlay(primitives) {
      if (!overlay) return
      overlay.innerHTML = primitivesToSVG(primitives as never)
      syncOverlayTransform()
    },

    clearOverlay() {
      if (overlay) overlay.innerHTML = ''
    },

    measureNode,

    toSVG(opts) {
      const made = renderForExport(opts)
      if (!made) return ''
      return exportScale(made.markup, opts?.scale ?? 1)
    },

    async toPNG(opts) {
      const made = renderForExport(opts)
      if (!made) return new Blob()
      const markup = made.markup
      const scale = opts?.scale ?? 2
      const width = Math.ceil((made.box.width + made.padding * 2) * scale)
      const height = Math.ceil((made.box.height + made.padding * 2) * scale)
      const image = new Image()
      const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('导出 PNG 失败：SVG 无法栅格化'))
        image.src = url
      })
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('导出 PNG 失败：无法创建 canvas')
      ctx.drawImage(image, 0, 0, width, height)
      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob)
          else reject(new Error('导出 PNG 失败：canvas 为空'))
        }, 'image/png')
      })
    },

    on(event, cb) {
      let set = listeners.get(event)
      if (!set) listeners.set(event, (set = new Set()))
      set.add(cb)
      return () => {
        set?.delete(cb)
      }
    },

    destroy() {
      cancelAnimationFrame(stateRaf)
      listeners.clear()
      mm?.destroy()
      mm = null
      overlay = null
      svg?.remove()
      svg = null
      states = {}
    },
  }

  return engine
}

/** 供 NodeContext 相关工具复用（避免重复 import 的类型噪音） */
export type { NodeContext }
