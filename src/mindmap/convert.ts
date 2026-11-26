import type { MarkmapNode } from './engine/types'
import type { MindDoc, MindNode, NodeId } from './model'
import { parseInline } from './markdown/inline'

/**
 * 模型 → 引擎树。content 为解析后的内联节点，data 携带渲染需要的结构信息。
 *
 * `branch` 以「一级节点在 root.children 里的下标」为准：持久化的 branch 字段只是
 * 缓存，历史文档里可能整体缺失（那样所有分支都会拿到 0，颜色全一样）。
 */
export function toMarkmapNode(
  doc: MindDoc,
  node: MindNode,
  depth: number,
  branch = 0,
): MarkmapNode {
  return {
    id: node.id,
    type: depth === 0 ? 'heading' : 'listItem',
    content: parseInline(node.text) as unknown[],
    notes: [],
    data: {
      depth,
      branch,
      parentId: node.parentId,
    },
    children: node.children
      .map((cid) => doc.nodes[cid])
      .filter((child): child is MindNode => Boolean(child))
      .map((child, index) => toMarkmapNode(doc, child, depth + 1, depth === 0 ? index : branch)),
  }
}

export function toMarkmapTree(doc: MindDoc): MarkmapNode | null {
  const root = doc.nodes[doc.rootId]
  if (!root) return null
  return toMarkmapNode(doc, root, 0)
}

export function foldedIds(doc: MindDoc): NodeId[] {
  return Object.values(doc.nodes)
    .filter((node) => node.collapsed && node.children.length > 0)
    .map((node) => node.id)
}

/** 节点 id → 分支色索引（渲染时查表，保证同支同色且确定） */
export function branchIndexMap(doc: MindDoc): Map<NodeId, number> {
  const map = new Map<NodeId, number>()
  const root = doc.nodes[doc.rootId]
  if (!root) return map
  const walk = (id: NodeId, inherited: number, depth: number) => {
    const node = doc.nodes[id]
    if (!node) return
    map.set(id, inherited)
    node.children.forEach((cid, index) => walk(cid, depth === 0 ? index : inherited, depth + 1))
  }
  walk(doc.rootId, 0, 0)
  return map
}

/** 导出时的折叠（按当前状态，或全部展开） */
export function expandedDoc(doc: MindDoc): MindDoc {
  const nodes: Record<NodeId, MindNode> = {}
  for (const [id, node] of Object.entries(doc.nodes)) nodes[id] = { ...node, collapsed: undefined }
  return { ...doc, nodes }
}
