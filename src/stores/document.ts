import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import * as M from '@/mindmap/model'
import type { MindDoc } from '@/mindmap/model'
import { docStore } from '@/db/docs'
import { useLibraryStore } from './library'

export type SaveStatus = 'saved' | 'saving' | 'error'
type DirtyKind = 'full' | 'meta' | string[]

const HISTORY_LIMIT = 50
const SAVE_DEBOUNCE = 500

/**
 * 草稿有没有「实质内容」。空导图（根节点没写字、也没子节点、标题也没手动改过）
 * 不落库，避免库里堆一堆「未命名导图」。
 */
function hasBody(next: MindDoc): boolean {
  const root = next.nodes[next.rootId]
  if (!root) return false
  return root.children.length > 0 || root.text.trim().length > 0 || next.renamed === true
}

export const useDocumentStore = defineStore('document', () => {
  const doc = shallowRef<MindDoc | null>(null)
  const revision = ref(0)
  const selectedId = ref<string | null>(null)
  const editingId = ref<string | null>(null)
  const saveStatus = ref<SaveStatus>('saved')
  /** 当前文档是否已经写进数据库（新建的草稿在第一次有内容之前是 false） */
  const persisted = ref(false)
  const undoStack = ref<M.Snapshot[]>([])
  const redoStack = ref<M.Snapshot[]>([])

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)
  const rootId = computed(() => doc.value?.rootId ?? null)
  const nodeCount = computed(() => (doc.value ? Object.keys(doc.value.nodes).length : 0))

  let pendingFull = false
  let pendingMeta = false
  let pendingIds = new Set<string>()
  let saveTimer: number | null = null
  let flushing = false

  function markDirty(kind: DirtyKind) {
    if (kind === 'full') pendingFull = true
    else if (kind === 'meta') pendingMeta = true
    else for (const id of kind) pendingIds.add(id)
    scheduleSave()
  }

  function scheduleSave() {
    if (saveTimer != null) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      void flush()
    }, SAVE_DEBOUNCE)
  }

  /** 保存后把标题同步回侧边列表（列表是 DB 元信息的快照，不整表重查） */
  function syncListTitle(snapshotDoc: MindDoc) {
    const item = useLibraryStore().docs.find((entry) => entry.id === snapshotDoc.id)
    if (item && item.title !== snapshotDoc.title) item.title = snapshotDoc.title
  }

  async function flush(): Promise<void> {
    if (!doc.value || flushing) return
    if (!pendingFull && !pendingMeta && pendingIds.size === 0) return
    const snapshotDoc = doc.value
    const ids = [...pendingIds]
    const full = pendingFull
    const meta = pendingMeta
    pendingFull = false
    pendingMeta = false
    pendingIds = new Set()
    flushing = true
    saveStatus.value = 'saving'
    try {
      if (!persisted.value) {
        // 草稿第一次有内容：整篇落库，之后才走增量
        if (!hasBody(snapshotDoc)) return
        await docStore.create(snapshotDoc)
        persisted.value = true
        saveStatus.value = 'saved'
        await useLibraryStore().refresh()
        return
      }
      if (full) await docStore.saveDoc(snapshotDoc)
      else {
        if (ids.length) await docStore.saveNodes(snapshotDoc, ids, [])
        if (meta) await docStore.saveMeta(snapshotDoc)
      }
      saveStatus.value = 'saved'
      syncListTitle(snapshotDoc)
    } catch (error) {
      console.error('[mindmap] 保存失败', error)
      saveStatus.value = 'error'
      // 回填待保存标记，下次再试
      pendingFull ||= full
      pendingMeta ||= meta
      ids.forEach((id) => pendingIds.add(id))
    } finally {
      flushing = false
    }
  }

  function pushUndo(previous: MindDoc) {
    const snap = M.snapshot(previous)
    undoStack.value = [...undoStack.value, snap].slice(-HISTORY_LIMIT)
    redoStack.value = []
  }

  function apply(next: MindDoc, dirty: DirtyKind = 'full', history = true) {
    if (!doc.value || next === doc.value) return
    const titleChanged = doc.value.title !== next.title
    if (history) pushUndo(doc.value)
    doc.value = next
    revision.value += 1
    markDirty(dirty)
    // 根节点改名会顺带改文档标题：只标了节点的时候得补一条 meta
    if (titleChanged && Array.isArray(dirty)) markDirty('meta')
  }

  /* ---------------------------------------------------------------- */

  /** 上一次真正画出来的节点：按侧折叠会整块藏起来，模型本身并不知道 */
  let rendered: Set<string> | null = null

  function setRenderedIds(ids: string[] | null) {
    rendered = ids ? new Set(ids) : null
  }

  function resetView() {
    // 打开时不要预选 root：否则一进来就弹出节点工具气泡，挡住画布
    rendered = null
    selectedId.value = null
    editingId.value = null
    undoStack.value = []
    redoStack.value = []
    saveStatus.value = 'saved'
  }

  async function open(id: string): Promise<boolean> {
    await flush()
    const loaded = await docStore.load(id)
    if (!loaded) return false
    doc.value = loaded
    persisted.value = true
    revision.value += 1
    resetView()
    return true
  }

  /**
   * 打开一份还没落库的草稿（新建导图用）。它和普通文档一样编辑，
   * 第一次有实质内容时由 {@link flush} 写入数据库。
   */
  async function openDraft(next: MindDoc): Promise<void> {
    await flush()
    doc.value = next
    persisted.value = false
    revision.value += 1
    resetView()
  }

  function close() {
    doc.value = null
    persisted.value = false
    selectedId.value = null
    editingId.value = null
    revision.value += 1
  }

  function select(id: string | null) {
    selectedId.value = id
    if (editingId.value && editingId.value !== id) editingId.value = null
  }

  function startEditing(id: string) {
    if (!doc.value?.nodes[id]) return
    selectedId.value = id
    editingId.value = id
    ensureVisible(id)
  }

  function stopEditing() {
    editingId.value = null
  }

  /** 展开祖先，保证节点可见（不入历史） */
  function ensureVisible(id: string) {
    if (!doc.value) return
    const nodes = { ...doc.value.nodes }
    let changed = false
    let cur = nodes[id]
    while (cur?.parentId) {
      const parent = nodes[cur.parentId]
      if (!parent) break
      if (parent.collapsed) {
        nodes[parent.id] = { ...parent, collapsed: undefined }
        changed = true
      }
      cur = parent
    }
    if (changed) apply({ ...doc.value, nodes }, [])
  }

  /* ------------------------------ 结构操作 ------------------------------ */

  function addChild(parentId?: string | null, text = ''): string | null {
    if (!doc.value) return null
    const pid = parentId ?? selectedId.value ?? doc.value.rootId
    const res = M.addChild(doc.value, pid, text)
    apply(res.doc, 'full')
    selectedId.value = res.id
    editingId.value = res.id
    return res.id
  }

  function addSibling(id?: string | null, text = ''): string | null {
    if (!doc.value) return null
    const target = id ?? selectedId.value
    if (!target) return addChild()
    const node = doc.value.nodes[target]
    if (!node?.parentId) return addChild(target, text)
    const res = M.addSibling(doc.value, target, text)
    apply(res.doc, 'full')
    selectedId.value = res.id
    editingId.value = res.id
    return res.id
  }

  function remove(id?: string | null) {
    if (!doc.value) return
    const target = id ?? selectedId.value
    if (!target) return
    const node = doc.value.nodes[target]
    if (!node?.parentId) return
    const parentId = node.parentId
    const res = M.removeNode(doc.value, target)
    if (!res.removed.length) return
    apply(res.doc, 'full')
    selectedId.value = parentId
    if (editingId.value && res.removed.includes(editingId.value)) editingId.value = null
  }

  function commitText(id: string, text: string) {
    if (!doc.value) return
    const clean = text.replace(/\r?\n/g, ' ').trim()
    const next = M.setText(doc.value, id, clean)
    editingId.value = null
    if (next === doc.value) return
    apply(next, [id])
  }

  function toggleFold(id?: string | null) {
    if (!doc.value) return
    const target = id ?? selectedId.value
    if (!target) return
    apply(M.toggleFold(doc.value, target), [target])
  }

  /** 收起/展开根节点的某一侧（双侧布局下左右两个折叠点） */
  function setFoldedSide(side: M.Side, folded: boolean) {
    if (!doc.value) return
    const next = M.setFoldedSide(doc.value, doc.value.rootId, side, folded)
    if (next === doc.value) return
    // 按侧折叠状态存在文档元信息里，不进节点表
    apply(next, 'meta')
  }

  function move(id: string, target: M.DropTarget) {
    if (!doc.value) return
    if (!M.canMove(doc.value, id, target)) return
    const next = M.moveNode(doc.value, id, target)
    if (next === doc.value) return
    apply(next, 'full')
    selectedId.value = id
    ensureVisible(id)
  }

  function outdent(id?: string | null) {
    if (!doc.value) return
    const target = id ?? selectedId.value
    if (!target) return
    const next = M.outdent(doc.value, target)
    if (next === doc.value) return
    apply(next, 'full')
  }

  function indent(id?: string | null) {
    if (!doc.value) return
    const target = id ?? selectedId.value
    if (!target) return
    const next = M.indent(doc.value, target)
    if (next === doc.value) return
    apply(next, 'full')
  }

  function moveSibling(id: string | null | undefined, delta: number) {
    if (!doc.value) return
    const target = id ?? selectedId.value
    if (!target) return
    const next = M.moveSibling(doc.value, target, delta)
    if (next === doc.value) return
    apply(next, 'full')
  }

  function setTitle(title: string) {
    if (!doc.value) return
    apply(M.setTitle(doc.value, title), 'meta')
  }

  function setLayout(layout: M.LayoutMode) {
    if (!doc.value) return
    apply(M.setLayout(doc.value, layout), 'meta')
  }

  function collapseToDepth(depth: number) {
    if (!doc.value) return
    apply(M.collapseToDepth(doc.value, depth), 'full')
  }

  function expandAll() {
    if (!doc.value) return
    apply(M.expandAll(doc.value), 'full')
  }

  function collapseAll() {
    if (!doc.value) return
    apply(M.collapseAll(doc.value), 'full')
  }

  function saveView(view: { x: number; y: number; k: number }) {
    if (!doc.value) return
    doc.value = { ...doc.value, view }
    markDirty('meta')
  }

  /* ------------------------------ 历史 ------------------------------ */

  function undo() {
    if (!doc.value) return
    const prev = undoStack.value[undoStack.value.length - 1]
    if (!prev) return
    undoStack.value = undoStack.value.slice(0, -1)
    redoStack.value = [...redoStack.value, M.snapshot(doc.value)].slice(-HISTORY_LIMIT)
    doc.value = M.restore(doc.value, prev)
    revision.value += 1
    markDirty('full')
    validateSelection()
  }

  function redo() {
    if (!doc.value) return
    const next = redoStack.value[redoStack.value.length - 1]
    if (!next) return
    redoStack.value = redoStack.value.slice(0, -1)
    undoStack.value = [...undoStack.value, M.snapshot(doc.value)].slice(-HISTORY_LIMIT)
    doc.value = M.restore(doc.value, next)
    revision.value += 1
    markDirty('full')
    validateSelection()
  }

  function validateSelection() {
    if (!doc.value) return
    if (selectedId.value && !doc.value.nodes[selectedId.value]) {
      selectedId.value = doc.value.rootId
    }
    if (editingId.value && !doc.value.nodes[editingId.value]) editingId.value = null
  }

  function nodesInOrder(): M.MindNode[] {
    return doc.value ? M.flatten(doc.value) : []
  }

  function visibleIds(): string[] {
    if (!doc.value) return []
    const ids = M.visibleIds(doc.value)
    // 按侧折叠的节点模型上仍存在，只是没画出来：键盘导航要跳过它们
    return rendered ? ids.filter((id) => rendered!.has(id)) : ids
  }

  function validate(): string[] {
    return doc.value ? M.validate(doc.value) : []
  }

  return {
    doc,
    revision,
    selectedId,
    editingId,
    saveStatus,
    persisted,
    canUndo,
    canRedo,
    rootId,
    nodeCount,
    open,
    openDraft,
    close,
    select,
    startEditing,
    stopEditing,
    addChild,
    addSibling,
    remove,
    commitText,
    toggleFold,
    setFoldedSide,
    move,
    outdent,
    indent,
    moveSibling,
    setTitle,
    setLayout,
    collapseToDepth,
    expandAll,
    collapseAll,
    saveView,
    undo,
    redo,
    flush,
    ensureVisible,
    nodesInOrder,
    visibleIds,
    setRenderedIds,
    validate,
  }
})
