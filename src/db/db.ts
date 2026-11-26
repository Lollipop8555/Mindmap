import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { FoldedSides, LayoutMode } from '@/mindmap/model'

export interface DocRow {
  id: string
  rootId: string
  title: string
  layout: LayoutMode
  createdAt: number
  updatedAt: number
  deletedAt?: number
  view?: { x: number; y: number; k: number }
  /** 双侧布局下根节点收起的侧 */
  foldedSides?: FoldedSides
  /** 用户是否显式改过标题；undefined 视为改过（旧数据），false 表示标题跟根节点走 */
  renamed?: boolean
  nodeCount: number
  schemaVersion: number
}

export interface NodeRow {
  docId: string
  id: string
  parentId: string | null
  /** 同级顺序 */
  order: number
  text: string
  collapsed?: boolean
  branch?: number
  updatedAt: number
}

interface MindmapDB extends DBSchema {
  docs: {
    key: string
    value: DocRow
    indexes: { 'by-updated': number; 'by-deleted': number }
  }
  nodes: {
    key: [string, string]
    value: NodeRow
    indexes: { 'by-doc': string }
  }
}

const DB_NAME = 'mindmap'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<MindmapDB>> | null = null

export function getDB(): Promise<IDBPDatabase<MindmapDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MindmapDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('docs')) {
          const docs = db.createObjectStore('docs', { keyPath: 'id' })
          docs.createIndex('by-updated', 'updatedAt')
          docs.createIndex('by-deleted', 'deletedAt')
        }
        if (!db.objectStoreNames.contains('nodes')) {
          const nodes = db.createObjectStore('nodes', { keyPath: ['docId', 'id'] })
          nodes.createIndex('by-doc', 'docId')
        }
      },
    })
  }
  return dbPromise
}

/** 仅测试用：重置连接 */
export function resetDBConnection(): void {
  dbPromise = null
}
