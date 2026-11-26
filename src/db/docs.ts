import { getDB, type DocRow, type NodeRow } from './db'
import type { MindDoc, MindNode } from '@/mindmap/model'

export type DocMeta = Omit<DocRow, 'schemaVersion'> & { schemaVersion: number }

function toRows(doc: MindDoc): NodeRow[] {
  const rows: NodeRow[] = []
  const now = Date.now()
  for (const node of Object.values(doc.nodes)) {
    const parent = node.parentId ? doc.nodes[node.parentId] : undefined
    rows.push({
      docId: doc.id,
      id: node.id,
      parentId: node.parentId,
      order: parent ? parent.children.indexOf(node.id) : 0,
      text: node.text,
      collapsed: node.collapsed,
      branch: node.branch,
      updatedAt: now,
    })
  }
  return rows
}

function metaOf(doc: MindDoc): DocMeta {
  return {
    id: doc.id,
    rootId: doc.rootId,
    title: doc.title,
    layout: doc.layout,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    deletedAt: doc.deletedAt,
    view: doc.view,
    nodeCount: Object.keys(doc.nodes).length,
    schemaVersion: 1,
  }
}

function rebuild(row: DocRow, rows: NodeRow[]): MindDoc {
  const nodes: Record<string, MindNode> = {}
  for (const r of rows) {
    nodes[r.id] = {
      id: r.id,
      text: r.text,
      parentId: r.parentId,
      children: [],
      collapsed: r.collapsed || undefined,
      branch: r.branch,
    }
  }
  const byParent = new Map<string, NodeRow[]>()
  for (const r of rows) {
    // 根（parentId 为 null）不进入分组
    if (!r.parentId) continue
    const list = byParent.get(r.parentId) ?? []
    list.push(r)
    byParent.set(r.parentId, list)
  }
  for (const [, list] of byParent) {
    list.sort((a, b) => a.order - b.order)
    const parent = nodes[list[0].parentId!]
    if (!parent) continue
    parent.children = list.map((r) => r.id).filter((id) => nodes[id])
  }
  // 环/孤儿兜底：只保留从 root 可达的部分
  const reachable = new Set<string>()
  const walk = (id: string) => {
    if (reachable.has(id)) return
    const node = nodes[id]
    if (!node) return
    reachable.add(id)
    node.children.forEach(walk)
  }
  walk(row.rootId)
  for (const id of Object.keys(nodes)) if (!reachable.has(id)) delete nodes[id]

  return {
    id: row.id,
    rootId: row.rootId,
    title: row.title,
    nodes,
    layout: row.layout ?? 'two-sided',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    view: row.view,
    schemaVersion: 1,
  }
}

export const docStore = {
  async list(includeDeleted = false): Promise<DocMeta[]> {
    const db = await getDB()
    const rows = await db.getAllFromIndex('docs', 'by-updated')
    const all = rows.reverse()
    return (includeDeleted ? all : all.filter((r) => !r.deletedAt)) as DocMeta[]
  },

  async load(docId: string): Promise<MindDoc | null> {
    const db = await getDB()
    const row = await db.get('docs', docId)
    if (!row) return null
    const rows = await db.getAllFromIndex('nodes', 'by-doc', docId)
    if (!rows.length) return null
    return rebuild(row, rows)
  },

  async create(doc: MindDoc): Promise<void> {
    const db = await getDB()
    const tx = db.transaction(['docs', 'nodes'], 'readwrite')
    tx.objectStore('docs').put(metaOf(doc))
    const store = tx.objectStore('nodes')
    for (const row of toRows(doc)) store.put(row)
    await tx.done
  },

  async saveMeta(doc: MindDoc): Promise<void> {
    const db = await getDB()
    await db.put('docs', metaOf(doc))
  },

  /**
   * 一次事务批量写入。传整篇 doc，由内部算出 upsert 节点的 order/parent，
   * 避免调用方重复算序；remove 为被删除的节点（含整棵子树）。
   */
  async saveNodes(doc: MindDoc, upsertIds: string[], remove: string[]): Promise<void> {
    const db = await getDB()
    const tx = db.transaction(['docs', 'nodes'], 'readwrite')
    const store = tx.objectStore('nodes')
    const all = new Map(toRows(doc).map((row) => [row.id, row]))
    for (const id of upsertIds) {
      const row = all.get(id)
      if (row) store.put(row)
    }
    for (const id of remove) store.delete([doc.id, id])
    await tx.done
  },

  /** 全量保存（导入、恢复、迁移用） */
  async saveDoc(doc: MindDoc): Promise<void> {
    const db = await getDB()
    const tx = db.transaction(['docs', 'nodes'], 'readwrite')
    tx.objectStore('docs').put(metaOf(doc))
    const store = tx.objectStore('nodes')
    const existing = await store.index('by-doc').getAllKeys(doc.id)
    for (const key of existing) store.delete(key)
    for (const row of toRows(doc)) store.put(row)
    await tx.done
  },

  async softDelete(docId: string): Promise<void> {
    const db = await getDB()
    const row = await db.get('docs', docId)
    if (!row) return
    await db.put('docs', { ...row, deletedAt: Date.now(), updatedAt: Date.now() })
  },

  async restore(docId: string): Promise<void> {
    const db = await getDB()
    const row = await db.get('docs', docId)
    if (!row) return
    await db.put('docs', { ...row, deletedAt: undefined, updatedAt: Date.now() })
  },

  async purge(docId: string): Promise<void> {
    const db = await getDB()
    const tx = db.transaction(['docs', 'nodes'], 'readwrite')
    tx.objectStore('docs').delete(docId)
    const range = IDBKeyRange.bound([docId, ''], [docId, '\uffff'])
    tx.objectStore('nodes').delete(range)
    await tx.done
  },

  async purgeAll(): Promise<void> {
    const db = await getDB()
    const tx = db.transaction(['docs', 'nodes'], 'readwrite')
    tx.objectStore('docs').clear()
    tx.objectStore('nodes').clear()
    await tx.done
  },
}

export type DocStore = typeof docStore
