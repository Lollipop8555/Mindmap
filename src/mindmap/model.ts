import { nanoid } from 'nanoid'

export type NodeId = string
export type LayoutMode = 'two-sided' | 'tree'
export type Side = 'left' | 'right'

/**
 * 双侧布局下根节点被收起的侧。
 *
 * 只有根节点会同时向左右生长，所以只有它有「左右各一个折叠点」；其余节点要么整体
 * 折叠（`collapsed`），要么不分侧。两者互斥：整体折叠时清空这里。
 */
export interface FoldedSides {
  left?: boolean
  right?: boolean
}

export interface MindNode {
  id: NodeId
  /** 单行 Markdown 源串 */
  text: string
  parentId: NodeId | null
  children: NodeId[]
  collapsed?: boolean
  /** 分支色索引，仅一级节点持有，后代继承 */
  branch?: number
}

export interface MindDoc {
  id: string
  rootId: NodeId
  title: string
  nodes: Record<NodeId, MindNode>
  layout: LayoutMode
  createdAt: number
  updatedAt: number
  deletedAt?: number
  view?: { x: number; y: number; k: number }
  /** 双侧布局下根节点收起的侧；缺省即两侧都展开 */
  foldedSides?: FoldedSides
  /**
   * 用户是否显式改过标题。
   *
   * `false`：标题跟着根节点文字走（新建导图的默认状态）；
   * `true` 或旧数据里的 `undefined`：标题以 `title` 为准，不再跟随根节点。
   */
  renamed?: boolean
  schemaVersion: 1
}

export type DropTarget =
  | { kind: 'child'; parentId: NodeId }
  | { kind: 'sibling'; parentId: NodeId; index: number }

export type Snapshot = Pick<MindDoc, 'rootId' | 'title' | 'layout' | 'nodes' | 'foldedSides'>

export const BRANCH_COUNT = 10
export const ROOT_TEXT_MAX = 200
export const UNTITLED = '未命名导图'

export function newId(): NodeId {
  return nanoid(12)
}

/** 节点文本是"单行 Markdown"：换行一律压成空格（粘贴多行也不破坏布局） */
export function singleLine(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, ' ')
}

/* ------------------------------------------------------------------ */
/* 读                                                                  */
/* ------------------------------------------------------------------ */

export function nodeOf(doc: MindDoc, id: NodeId): MindNode | undefined {
  return doc.nodes[id]
}

export function childrenOf(doc: MindDoc, id: NodeId): MindNode[] {
  const node = doc.nodes[id]
  if (!node) return []
  return node.children.map((cid) => doc.nodes[cid]).filter(Boolean)
}

/** 先序遍历（含根） */
export function flatten(doc: MindDoc): MindNode[] {
  const out: MindNode[] = []
  const walk = (id: NodeId) => {
    const node = doc.nodes[id]
    if (!node) return
    out.push(node)
    node.children.forEach(walk)
  }
  walk(doc.rootId)
  return out
}

export function nodeCount(doc: MindDoc): number {
  return Object.keys(doc.nodes).length
}

export function depthOf(doc: MindDoc, id: NodeId): number {
  let depth = 0
  let cur = doc.nodes[id]
  const seen = new Set<NodeId>()
  while (cur?.parentId) {
    if (seen.has(cur.id)) break
    seen.add(cur.id)
    depth += 1
    cur = doc.nodes[cur.parentId]
  }
  return depth
}

export function pathOf(doc: MindDoc, id: NodeId): MindNode[] {
  const path: MindNode[] = []
  let cur = doc.nodes[id]
  const seen = new Set<NodeId>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    path.unshift(cur)
    cur = cur.parentId ? doc.nodes[cur.parentId] : undefined!
  }
  return path
}

export function isDescendant(doc: MindDoc, candidate: NodeId, ancestor: NodeId): boolean {
  if (candidate === ancestor) return false
  let cur = doc.nodes[candidate]
  const seen = new Set<NodeId>()
  while (cur?.parentId) {
    if (seen.has(cur.parentId)) return false
    seen.add(cur.parentId)
    if (cur.parentId === ancestor) return true
    cur = doc.nodes[cur.parentId]
  }
  return false
}

/** 一级分支的 branch 索引（后代继承最近的一级祖先；根节点也有自己的色调） */
export function branchOf(doc: MindDoc, id: NodeId): number {
  const path = pathOf(doc, id)
  // 从节点本身往上找：颜色只定在一级节点（和根）上，越靠近自己的越优先
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const branch = path[i].branch
    if (typeof branch === 'number') return branch
  }
  return 0
}

/** 折叠后仍可见的节点（按视觉顺序） */
export function visibleIds(doc: MindDoc): NodeId[] {
  const out: NodeId[] = []
  const walk = (id: NodeId) => {
    const node = doc.nodes[id]
    if (!node) return
    out.push(id)
    if (node.collapsed) return
    node.children.forEach(walk)
  }
  walk(doc.rootId)
  return out
}

export function subtreeIds(doc: MindDoc, id: NodeId): NodeId[] {
  const out: NodeId[] = []
  const walk = (nid: NodeId) => {
    const node = doc.nodes[nid]
    if (!node) return
    out.push(nid)
    node.children.forEach(walk)
  }
  walk(id)
  return out
}

export function maxDepth(doc: MindDoc): number {
  let max = 0
  for (const node of flatten(doc)) max = Math.max(max, depthOf(doc, node.id))
  return max
}

/* ------------------------------------------------------------------ */
/* 写（全部不可变）                                                     */
/* ------------------------------------------------------------------ */

function touch(doc: MindDoc, nodes: Record<NodeId, MindNode>, patch?: Partial<MindDoc>): MindDoc {
  return { ...doc, ...patch, nodes, updatedAt: Date.now() }
}

function withNode(
  nodes: Record<NodeId, MindNode>,
  id: NodeId,
  patch: Partial<MindNode>,
): Record<NodeId, MindNode> {
  const node = nodes[id]
  if (!node) return nodes
  return { ...nodes, [id]: { ...node, ...patch } }
}

/**
 * 新建文档。`title` 同时写进根节点：新导图默认「名字就是根节点」，
 * 根节点留空时标题也是空串，由界面回退成「未命名导图」。
 */
export function createDoc(title = ''): MindDoc {
  const rootId = newId()
  const now = Date.now()
  const text = singleLine(title).slice(0, ROOT_TEXT_MAX)
  return assignBranchColors({
    id: rootId,
    rootId,
    title: text,
    nodes: {
      [rootId]: { id: rootId, text, parentId: null, children: [] },
    },
    layout: 'two-sided',
    createdAt: now,
    updatedAt: now,
    renamed: false,
    schemaVersion: 1,
  })
}

/** 从若干层文本构建（导入用）：每一项是 [文本, 子项...] 的扁平描述 */
export function createDocFromOutline(
  outline: { text: string; children?: unknown[] }[],
  opts: { title?: string; layout?: LayoutMode } = {},
): MindDoc {
  let doc = createDoc(outline[0]?.text?.trim() || opts.title || '')
  if (opts.layout) doc.layout = opts.layout
  if (opts.title) doc.title = opts.title
  doc.nodes[doc.rootId].text = outline[0]?.text?.trim() || doc.title

  const addChildren = (parentId: NodeId, items: { text: string; children?: any[] }[] | undefined) => {
    for (const item of items ?? []) {
      const res = addChild(doc, parentId, item.text)
      doc = res.doc
      addChildren(res.id, item.children)
    }
  }
  addChildren(doc.rootId, outline[0]?.children as any)
  return assignBranchColors(doc)
}

export function addChild(
  doc: MindDoc,
  parentId: NodeId,
  text = '',
  index?: number,
): { doc: MindDoc; id: NodeId } {
  const parent = doc.nodes[parentId]
  if (!parent) return { doc, id: parentId }
  const id = newId()
  const nodes: Record<NodeId, MindNode> = {
    ...doc.nodes,
    [id]: { id, text: singleLine(text), parentId, children: [] },
  }
  const children = [...parent.children]
  children.splice(index ?? children.length, 0, id)
  nodes[parentId] = { ...parent, children, collapsed: parent.collapsed && false }
  // 根节点新长出一条分支时两侧都展开，免得新建的节点落在收起的那一侧看不见
  const patch = parentId === doc.rootId && hasSideFolds(doc) ? { foldedSides: undefined } : undefined
  return { doc: assignBranchColors(touch(doc, nodes, patch)), id }
}

export function addSibling(
  doc: MindDoc,
  id: NodeId,
  text = '',
  before = false,
): { doc: MindDoc; id: NodeId } {
  const node = doc.nodes[id]
  if (!node?.parentId) return { doc, id }
  const parent = doc.nodes[node.parentId]
  if (!parent) return { doc, id }
  const index = parent.children.indexOf(id)
  return addChild(doc, parent.id, text, before ? index : index + 1)
}

/** 删除节点及其子树。根节点不可删。 */
export function removeNode(doc: MindDoc, id: NodeId): { doc: MindDoc; removed: NodeId[] } {
  const node = doc.nodes[id]
  if (!node || !node.parentId) return { doc, removed: [] }
  const removed = subtreeIds(doc, id)
  const nodes = { ...doc.nodes }
  for (const rid of removed) delete nodes[rid]
  const parent = nodes[node.parentId]
  if (!parent) return { doc, removed: [] }
  nodes[parent.id] = { ...parent, children: parent.children.filter((cid) => cid !== id) }
  return { doc: assignBranchColors(touch(doc, nodes)), removed }
}

export function setText(doc: MindDoc, id: NodeId, text: string): MindDoc {
  const node = doc.nodes[id]
  if (!node) return doc
  const clean = singleLine(text)
  if (node.text === clean) return doc
  const next = withNode(doc.nodes, id, { text: clean })
  // 根节点文字就是文档的「名字来源」：只要用户没重命名过，标题跟着一起变
  const title =
    id === doc.rootId && doc.renamed !== true ? clean.slice(0, ROOT_TEXT_MAX) : doc.title
  return touch(doc, next, title === doc.title ? undefined : { title })
}

export function setTitle(doc: MindDoc, title: string): MindDoc {
  const clean = singleLine(title).slice(0, ROOT_TEXT_MAX)
  // 显式改名之后就锁住标题，不再跟根节点走（哪怕是改回和根节点一样的字）
  if (doc.title === clean && doc.renamed === true) return doc
  return { ...doc, title: clean, renamed: true, updatedAt: Date.now() }
}

export function toggleFold(doc: MindDoc, id: NodeId, value?: boolean): MindDoc {
  const node = doc.nodes[id]
  if (!node || node.children.length === 0) return doc
  const next = value ?? !node.collapsed
  const nodes = withNode(doc.nodes, id, { collapsed: next || undefined })
  // 整体折叠与按侧折叠互斥：根节点整体收起后，之前的按侧折叠不再有意义
  return touch(doc, nodes, id === doc.rootId && next && hasSideFolds(doc) ? { foldedSides: undefined } : undefined)
}

/** 是否有任何一侧被收起（只有双侧布局的根会用） */
export function hasSideFolds(doc: MindDoc): boolean {
  return Boolean(doc.foldedSides?.left || doc.foldedSides?.right)
}

/**
 * 收起/展开根节点的某一侧。只有双侧布局的根有左右两侧；整体折叠时自动展开。
 */
export function setFoldedSide(doc: MindDoc, id: NodeId, side: Side, folded: boolean): MindDoc {
  const node = doc.nodes[id]
  if (!node || node.id !== doc.rootId || doc.layout !== 'two-sided') return doc
  const current: FoldedSides = doc.foldedSides ?? {}
  if (Boolean(current[side]) === folded) return doc
  const next: FoldedSides = { ...current, [side]: folded || undefined }
  const empty = !next.left && !next.right
  const nodes = node.collapsed ? withNode(doc.nodes, id, { collapsed: undefined }) : doc.nodes
  return touch(doc, nodes, { foldedSides: empty ? undefined : next })
}

export function toggleFoldedSide(doc: MindDoc, id: NodeId, side: Side): MindDoc {
  return setFoldedSide(doc, id, side, !doc.foldedSides?.[side])
}

export function setLayout(doc: MindDoc, layout: LayoutMode): MindDoc {
  if (doc.layout === layout) return doc
  // 树形布局没有左右两侧，按侧折叠状态直接作废
  return { ...doc, layout, foldedSides: undefined, updatedAt: Date.now() }
}

export function setView(doc: MindDoc, view: { x: number; y: number; k: number }): MindDoc {
  return { ...doc, view, updatedAt: Date.now() }
}

export function canMove(doc: MindDoc, id: NodeId, target: DropTarget): boolean {
  const node = doc.nodes[id]
  if (!node || !node.parentId) return false // 根不可移动
  if (target.parentId === id) return false
  if (isDescendant(doc, target.parentId, id)) return false
  if (!doc.nodes[target.parentId]) return false
  // 已经挂在该父级末尾（child 语义）→ 无位移
  if (target.kind === 'child' && node.parentId === target.parentId) return false
  return true
}

/** 移动节点。target.index 以"移除自身之后"的目标父级 children 为基准。 */
export function moveNode(doc: MindDoc, id: NodeId, target: DropTarget): MindDoc {
  if (!canMove(doc, id, target)) return doc
  const node = doc.nodes[id]
  const oldParentId = node.parentId!
  if (target.kind === 'child' && oldParentId === target.parentId) {
    // 已经在这个父级下且是最后一个 → 无变化
    const parent = doc.nodes[target.parentId]
    if (parent && parent.children[parent.children.length - 1] === id) return doc
  }
  const nodes = { ...doc.nodes }
  const oldParent = nodes[oldParentId]
  if (!oldParent) return doc
  nodes[oldParentId] = { ...oldParent, children: oldParent.children.filter((cid) => cid !== id) }

  const newParent = nodes[target.parentId]
  if (!newParent) return doc
  const children = [...newParent.children]
  const index = target.kind === 'child' ? children.length : Math.max(0, Math.min(target.index, children.length))
  children.splice(index, 0, id)
  nodes[target.parentId] = { ...newParent, children, collapsed: undefined }
  nodes[id] = { ...node, parentId: target.parentId }
  // 拖进根节点也算新增一条一级分支：两侧展开，保证看得到
  const patch =
    target.parentId === doc.rootId && hasSideFolds(doc) ? { foldedSides: undefined } : undefined
  return assignBranchColors(touch(doc, nodes, patch))
}

/** 降级：成为父节点的下一个兄弟 */
export function outdent(doc: MindDoc, id: NodeId): MindDoc {
  const node = doc.nodes[id]
  if (!node?.parentId) return doc
  const parent = doc.nodes[node.parentId]
  if (!parent?.parentId) return doc
  const grand = doc.nodes[parent.parentId]
  if (!grand) return doc
  const index = grand.children.indexOf(parent.id)
  return moveNode(doc, id, { kind: 'sibling', parentId: grand.id, index: index + 1 })
}

/** 升级：成为上一个兄弟的最后一个子节点 */
export function indent(doc: MindDoc, id: NodeId): MindDoc {
  const node = doc.nodes[id]
  if (!node?.parentId) return doc
  const parent = doc.nodes[node.parentId]
  if (!parent) return doc
  const index = parent.children.indexOf(id)
  if (index <= 0) return doc
  const prev = parent.children[index - 1]
  return moveNode(doc, id, { kind: 'child', parentId: prev })
}

/** 同级上/下移 */
export function moveSibling(doc: MindDoc, id: NodeId, delta: number): MindDoc {
  const node = doc.nodes[id]
  if (!node?.parentId) return doc
  const parent = doc.nodes[node.parentId]
  if (!parent) return doc
  const from = parent.children.indexOf(id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= parent.children.length) return doc
  const children = [...parent.children]
  children.splice(from, 1)
  children.splice(to, 0, id)
  return touch(doc, { ...doc.nodes, [parent.id]: { ...parent, children } })
}

/**
 * 从「用得最少」的颜色里随机挑一个：全 0 时等于在所有颜色里随机，
 * 用完一轮之后退回「用得最少的那些」里随机，不会出现连续同色。
 */
function pickBranch(used: readonly number[], rng: () => number): number {
  const counts = new Array<number>(BRANCH_COUNT).fill(0)
  for (const branch of used) {
    if (branch >= 0 && branch < BRANCH_COUNT) counts[branch] += 1
  }
  const min = Math.min(...counts)
  const candidates: number[] = []
  counts.forEach((count, index) => {
    if (count === min) candidates.push(index)
  })
  return candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))]
}

/**
 * 给一级分支上色（根节点也有自己的色调）：
 *
 * - 已经定过色的节点保持不动，拖动/排序时颜色跟着节点走；
 * - 新分支在「用得最少」的颜色里随机挑，用完了就全体里挑，避免一片同色；
 * - 深层节点不留 branch，颜色只定在一级节点上，后代继承。
 */
export function assignBranchColors(doc: MindDoc, rng: () => number = Math.random): MindDoc {
  const root = doc.nodes[doc.rootId]
  if (!root) return doc
  let changed = false
  const nodes = { ...doc.nodes }

  if (typeof root.branch !== 'number' || root.branch < 0 || root.branch >= BRANCH_COUNT) {
    nodes[root.id] = { ...root, branch: pickBranch([], rng) }
    changed = true
  }

  for (const node of Object.values(nodes)) {
    if (node.parentId && node.parentId !== doc.rootId && typeof node.branch === 'number') {
      nodes[node.id] = { ...node, branch: undefined }
      changed = true
    }
  }

  const used = nodes[root.id].children
    .map((cid) => nodes[cid]?.branch)
    .filter((branch): branch is number => typeof branch === 'number')
  nodes[root.id].children.forEach((cid) => {
    const child = nodes[cid]
    if (!child || typeof child.branch === 'number') return
    const branch = pickBranch(used, rng)
    used.push(branch)
    nodes[cid] = { ...child, branch }
    changed = true
  })

  return changed ? touch(doc, nodes) : doc
}

/* ------------------------------------------------------------------ */
/* 校验 & 快照                                                          */
/* ------------------------------------------------------------------ */

export function validate(doc: MindDoc): string[] {
  const errors: string[] = []
  const root = doc.nodes[doc.rootId]
  if (!root) return ['根节点缺失']
  if (root.parentId !== null) errors.push('根的 parentId 不为 null')

  const roots = Object.values(doc.nodes).filter((n) => n.parentId === null)
  if (roots.length !== 1) errors.push(`存在 ${roots.length} 个根节点`)

  for (const node of Object.values(doc.nodes)) {
    const seen = new Set<NodeId>()
    for (const cid of node.children) {
      if (seen.has(cid)) errors.push(`${node.id} 的子节点重复: ${cid}`)
      seen.add(cid)
      const child = doc.nodes[cid]
      if (!child) errors.push(`${node.id} 引用了不存在的子节点 ${cid}`)
      else if (child.parentId !== node.id) errors.push(`${cid} 的 parentId 与父级不一致`)
    }
    if (typeof node.branch === 'number' && (node.branch < 0 || node.branch >= BRANCH_COUNT)) {
      errors.push(`${node.id} 的 branch 越界`)
    }
  }

  const visited = new Set<NodeId>()
  const walk = (id: NodeId, guard: Set<NodeId>) => {
    if (guard.has(id)) {
      errors.push(`检测到环: ${id}`)
      return
    }
    if (visited.has(id)) return
    visited.add(id)
    const node = doc.nodes[id]
    if (!node) return
    const nextGuard = new Set(guard).add(id)
    node.children.forEach((cid) => walk(cid, nextGuard))
  }
  walk(doc.rootId, new Set())

  if (visited.size !== Object.keys(doc.nodes).length) {
    errors.push(`存在 ${Object.keys(doc.nodes).length - visited.size} 个不可达节点`)
  }
  return errors
}

export function snapshot(doc: MindDoc): Snapshot {
  return {
    rootId: doc.rootId,
    title: doc.title,
    layout: doc.layout,
    nodes: doc.nodes,
    foldedSides: doc.foldedSides,
  }
}

export function restore(doc: MindDoc, snap: Snapshot): MindDoc {
  return { ...doc, ...snap, updatedAt: Date.now() }
}

/* ------------------------------------------------------------------ */
/* 简化：折叠到指定层级 / 全部展开                                      */
/* ------------------------------------------------------------------ */

export function collapseToDepth(doc: MindDoc, depth: number): MindDoc {
  const nodes = { ...doc.nodes }
  for (const node of Object.values(nodes)) {
    const d = depthOf(doc, node.id)
    const collapsed = d >= depth && node.children.length > 0
    nodes[node.id] = { ...node, collapsed: collapsed || undefined }
  }
  return touch(doc, nodes, { foldedSides: undefined })
}

export function expandAll(doc: MindDoc): MindDoc {
  const nodes = { ...doc.nodes }
  for (const node of Object.values(nodes)) nodes[node.id] = { ...node, collapsed: undefined }
  return touch(doc, nodes, { foldedSides: undefined })
}

export function collapseAll(doc: MindDoc): MindDoc {
  const nodes = { ...doc.nodes }
  for (const node of Object.values(nodes)) {
    nodes[node.id] = { ...node, collapsed: node.children.length ? true : undefined }
  }
  return touch(doc, nodes, { foldedSides: undefined })
}
