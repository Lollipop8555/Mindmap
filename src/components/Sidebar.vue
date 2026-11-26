<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ChevronDown,
  FileText,
  PanelLeftClose,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-vue-next'
import { useLibraryStore } from '@/stores/library'
import { useDocumentStore } from '@/stores/document'
import { useSettingsStore } from '@/stores/settings'
import { useViewStore } from '@/stores/view'

const emit = defineEmits<{ open: [id: string]; create: [] }>()

const library = useLibraryStore()
const docs = useDocumentStore()
const settings = useSettingsStore()
const view = useViewStore()

const showTrash = ref(false)
const busy = ref(false)

const isMobile = computed(() => window.matchMedia('(max-width: 720px)').matches)
const sidebarHidden = computed(() =>
  isMobile.value ? !view.mobileSidebarOpen : settings.sidebarCollapsed,
)

function closeOnMobile() {
  if (isMobile.value) view.mobileSidebarOpen = false
}

async function createDoc() {
  busy.value = true
  try {
    await docs.flush()
    // 新建只是开一份内存草稿，落库交给 document store（空导图不落库）
    emit('create')
  } finally {
    busy.value = false
  }
}

async function switchTo(id: string) {
  if (docs.doc?.id === id) {
    closeOnMobile()
    return
  }
  await docs.flush()
  emit('open', id)
}

async function removeDoc(id: string, title: string) {
  await docs.flush()
  await library.softDelete(id)
  view.toast(`已移入回收站：${title}`, {
    actionLabel: '撤销',
    action: async () => {
      await library.restore(id)
      if (!docs.doc) {
        const first = library.docs[0]
        if (first) emit('open', first.id)
      }
    },
  })
  if (docs.doc?.id === id) {
    docs.close()
    const next = library.docs[0]
    if (next) emit('open', next.id)
  }
}

async function restoreDoc(id: string) {
  await library.restore(id)
  view.toast('已恢复')
}

async function purgeDoc(id: string) {
  await library.purge(id)
  view.toast('已彻底删除')
}

async function purgeAll() {
  if (!window.confirm(`彻底删除回收站中的 ${library.trash.length} 份导图？此操作不可撤销。`)) return
  await library.purgeAll()
  view.toast('回收站已清空')
}

function relative(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.round(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.round(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.round(hour / 24)
  if (day < 30) return `${day} 天前`
  return new Date(ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}
</script>

<template>
  <aside class="mm-sidebar" :data-open="String(!sidebarHidden)" aria-label="导图列表">
    <header class="sb-head">
      <span class="sb-brand">导图</span>
      <div class="sb-head-actions">
        <button
          class="mm-icon-btn"
          type="button"
          title="新建导图"
          :disabled="busy"
          @click="createDoc"
        >
          <Plus :size="17" />
        </button>
        <button
          class="mm-icon-btn"
          type="button"
          title="收起侧栏"
          @click="settings.sidebarCollapsed = true"
        >
          <PanelLeftClose :size="17" />
        </button>
        <button class="mm-icon-btn sb-mobile-close" type="button" @click="closeOnMobile">
          <X :size="17" />
        </button>
      </div>
    </header>

    <label class="sb-search">
      <Search :size="15" />
      <input v-model="library.query" class="mm-input" placeholder="搜索标题" type="search" />
    </label>

    <div class="mm-list">
      <div
        v-for="doc in library.filtered"
        :key="doc.id"
        role="button"
        tabindex="0"
        class="mm-list-item sb-doc"
        :data-active="String(docs.doc?.id === doc.id)"
        @click="switchTo(doc.id)"
        @keydown.enter.prevent="switchTo(doc.id)"
        @keydown.space.prevent="switchTo(doc.id)"
      >
        <span class="mm-list-item__title">{{ doc.title || '未命名导图' }}</span>
        <span class="mm-list-item__meta">
          {{ relative(doc.updatedAt) }} · {{ doc.nodeCount }} 节点
        </span>
        <button
          class="sb-doc-del mm-icon-btn"
          type="button"
          title="移入回收站"
          @click.stop="removeDoc(doc.id, doc.title)"
        >
          <Trash2 :size="14" />
        </button>
      </div>

      <p v-if="!library.filtered.length && library.ready" class="sb-hint">
        没有匹配的导图。换个关键词，或新建一份。
      </p>
    </div>

    <footer class="sb-foot">
      <button type="button" class="mm-btn sb-foot-btn" @click="showTrash = !showTrash">
        <Trash2 :size="15" />
        <span>回收站</span>
        <span v-if="library.trash.length" class="sb-badge">{{ library.trash.length }}</span>
        <ChevronDown :size="14" :class="['sb-chevron', { 'sb-chevron--open': showTrash }]" />
      </button>

      <div v-if="showTrash" class="sb-trash">
        <div v-for="doc in library.trash" :key="doc.id" class="sb-trash-row">
          <span class="sb-trash-title">{{ doc.title }}</span>
          <button class="mm-icon-btn" type="button" title="恢复" @click="restoreDoc(doc.id)">
            <RotateCcw :size="14" />
          </button>
          <button class="mm-icon-btn" type="button" title="彻底删除" @click="purgeDoc(doc.id)">
            <Trash2 :size="14" />
          </button>
        </div>
        <p v-if="!library.trash.length" class="sb-hint">回收站是空的。</p>
        <button v-else class="mm-btn mm-btn--danger sb-purge" type="button" @click="purgeAll">
          清空回收站
        </button>
      </div>

      <button type="button" class="mm-btn sb-foot-btn" @click="view.settingsOpen = true">
        <Settings2 :size="15" />
        <span>设置</span>
      </button>
      <button type="button" class="mm-btn sb-foot-btn" @click="view.importOpen = true">
        <FileText :size="15" />
        <span>导入 Markdown</span>
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.sb-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--mm-topbar);
  padding: 0 8px 0 16px;
}

.sb-brand {
  font-weight: 600;
  letter-spacing: 0.04em;
}

.sb-head-actions {
  display: flex;
  gap: 2px;
}

.sb-mobile-close {
  display: none;
}

.sb-search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  margin-bottom: 6px;
  color: var(--mm-text-faint);
}

.sb-search .mm-input {
  padding-left: 8px;
}

.sb-doc {
  position: relative;
  padding-right: 32px;
}

.sb-doc-del {
  position: absolute;
  top: 50%;
  right: 4px;
  opacity: 0;
  transform: translateY(-50%);
  transition: opacity var(--mm-t-fast) var(--mm-ease);
}

.sb-doc:hover .sb-doc-del,
.sb-doc:focus-within .sb-doc-del {
  opacity: 1;
}

.sb-hint {
  margin: 8px 4px;
  color: var(--mm-text-faint);
  font-size: 12px;
  line-height: 1.6;
}

.sb-foot {
  padding: 8px;
  border-top: 1px solid var(--mm-line);
}

.sb-foot-btn {
  width: 100%;
  justify-content: flex-start;
  color: var(--mm-text-soft);
}

.sb-badge {
  margin-left: auto;
  padding: 0 6px;
  border-radius: var(--mm-r-pill);
  background: var(--mm-panel-soft);
  color: var(--mm-text-faint);
  font-size: 11px;
}

.sb-chevron {
  margin-left: auto;
  transition: transform var(--mm-t-fast) var(--mm-ease);
}

.sb-chevron--open {
  transform: rotate(180deg);
}

.sb-trash {
  max-height: 220px;
  overflow: auto;
  padding: 4px 4px 8px;
}

.sb-trash-row {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  border-radius: var(--mm-r-sm);
  color: var(--mm-text-soft);
  font-size: 13px;
}

.sb-trash-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-purge {
  width: 100%;
  margin-top: 4px;
  font-size: 12px;
}

@media (max-width: 720px) {
  .sb-mobile-close {
    display: grid;
  }
}
</style>
