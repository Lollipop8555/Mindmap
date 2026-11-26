import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { docStore, type DocMeta } from '@/db/docs'
import { createDoc, nodeCount, setTitle, type MindDoc } from '@/mindmap/model'
import { parseMarkdown } from '@/mindmap/markdown/parse'
import { serializeDoc, serializeDocs } from '@/mindmap/markdown/serialize'
import { useSettingsStore } from './settings'

/** 首次打开时的示例文档，避免空工作区劝退 */
const SEED = `# 我的第一个导图

- 双击改文字
  - 支持 **粗体**、*斜体*、==高亮==、\`代码\`
  - 支持 :badge[徽标]{tone="sage"}、:icon[star]、:progress[60]
  - 支持 $a^2+b^2=c^2$ 与 :date[2026-12-31]
- 拖拽节点
  - 拖到节点上 = 变成它的子节点
  - 拖到同级间隙 = 调整顺序
- 两种布局
  - 左右平衡 / 单侧生长
`

export const useLibraryStore = defineStore('library', () => {
  const docs = ref<DocMeta[]>([])
  const trash = ref<DocMeta[]>([])
  const query = ref('')
  const loading = ref(false)
  const ready = ref(false)

  const filtered = computed(() => {
    const q = query.value.trim().toLowerCase()
    if (!q) return docs.value
    return docs.value.filter((doc) => doc.title.toLowerCase().includes(q))
  })

  async function refresh(): Promise<void> {
    loading.value = true
    try {
      const all = await docStore.list(true)
      docs.value = all.filter((doc) => !doc.deletedAt)
      trash.value = all.filter((doc) => Boolean(doc.deletedAt))
    } finally {
      loading.value = false
      ready.value = true
    }
  }

  async function ensureSeed(): Promise<void> {
    const all = await docStore.list(true)
    if (all.length > 0) return
    const result = parseMarkdown(SEED)
    const doc = result.docs[0] ?? createDoc()
    await docStore.create(doc)
  }

  async function create(title?: string): Promise<MindDoc> {
    const settings = useSettingsStore()
    const doc = createDoc(title?.trim() || '未命名导图')
    doc.layout = settings.layout
    await docStore.create(doc)
    await refresh()
    settings.lastDocId = doc.id
    return doc
  }

  async function importMarkdownText(text: string): Promise<{ docs: MindDoc[]; warnings: string[] }> {
    const settings = useSettingsStore()
    const result = parseMarkdown(text, { layout: settings.layout })
    for (const doc of result.docs) await docStore.create(doc)
    await refresh()
    return result
  }

  async function importMarkdownFiles(files: File[]): Promise<{ count: number; warnings: string[] }> {
    const warnings: string[] = []
    let count = 0
    for (const file of files) {
      if (!/\.(md|markdown|txt)$/i.test(file.name)) {
        warnings.push(`${file.name}：不是 Markdown 文件，已跳过`)
        continue
      }
      const text = await file.text()
      const result = await importMarkdownText(text)
      count += result.docs.length
      warnings.push(...result.warnings.map((w) => `${file.name}：${w}`))
    }
    return { count, warnings }
  }

  async function rename(id: string, title: string): Promise<void> {
    const full = await docStore.load(id)
    if (!full) return
    const next = setTitle(full, title)
    await docStore.saveMeta({ ...next, updatedAt: Date.now() })
    const item = docs.value.find((doc) => doc.id === id)
    if (item) item.title = next.title
  }

  async function softDelete(id: string): Promise<void> {
    await docStore.softDelete(id)
    await refresh()
  }

  async function restore(id: string): Promise<void> {
    await docStore.restore(id)
    await refresh()
  }

  async function purge(id: string): Promise<void> {
    await docStore.purge(id)
    await refresh()
  }

  async function purgeAll(): Promise<void> {
    for (const doc of trash.value) await docStore.purge(doc.id)
    await refresh()
  }

  async function exportText(id: string): Promise<string> {
    const doc = await docStore.load(id)
    return doc ? serializeDoc(doc) : ''
  }

  async function exportAllText(): Promise<string> {
    const all: MindDoc[] = []
    for (const meta of docs.value) {
      const doc = await docStore.load(meta.id)
      if (doc) all.push(doc)
    }
    return serializeDocs(all)
  }

  function countOf(id: string): number {
    return docs.value.find((doc) => doc.id === id)?.nodeCount ?? 0
  }

  return {
    docs,
    trash,
    query,
    loading,
    ready,
    filtered,
    refresh,
    ensureSeed,
    create,
    importMarkdownText,
    importMarkdownFiles,
    rename,
    softDelete,
    restore,
    purge,
    purgeAll,
    exportText,
    exportAllText,
    countOf,
    nodeCount,
  }
})
