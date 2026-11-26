import type { MarkmapNode } from './engine/types'
import type { MindDoc, MindNode, NodeId } from './model'
import { parseInline } from './markdown/inline'

/** 节点自己的分支色；历史文档里可能没有，退回按位置推的默认值 */
function branchAt(node: MindNode, fallback: number): number {
  return typeof node.branch === 'number' ? node.branch : fallback
}

/**
 * 模型 → 引擎树。content 为解析后的内联节点，data 携带渲染需要的结构信息。
 *
 * `branch` 以持久化的字段为准（新建导图时是随机分配的）；历史文档里可能整体缺失，
 * 那时退回「一级节点在 root.children 里的下标」，保证老数据也不会全是同色。
 */
export function toMarkmapNode(
  doc: MindDoc,
  node: MindNode,
  depth: number,
  fallbackBranch = 0,
): MarkmapNode {
  const branch = branchAt(node, fallbackBranch)
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
      .map((child, index) =>
        toMarkmapNode(doc, child, depth + 1, branchAt(child, depth === 0 ? index : branch)),
      ),
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
  const walk = (node: MindNode, inherited: number, depth: number) => {
    const branch = branchAt(node, inherited)
    map.set(node.id, branch)
    node.children.forEach((cid, index) => {
      const child = doc.nodes[cid]
      if (child) walk(child, depth === 0 ? index : branch, depth + 1)
    })
  }
  walk(root, 0, 0)
  return map
}

/** 导出时的折叠（按当前状态，或全部展开） */
export function expandedDoc(doc: MindDoc): MindDoc {
  const nodes: Record<NodeId, MindNode> = {}
  for (const [id, node] of Object.entries(doc.nodes)) nodes[id] = { ...node, collapsed: undefined }
  return { ...doc, nodes }
}
