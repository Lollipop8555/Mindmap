<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  CircleHelp,
  Download,
  GitFork,
  IndentIncrease,
  ListTree,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Redo2,
  Share2,
  Sun,
  SunMoon,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-vue-next'
import { NODE_STYLES, nextStyle } from '@/mindmap/theme/styles'
import { useDocumentStore } from '@/stores/document'
import { useLibraryStore } from '@/stores/library'
import { useSettingsStore } from '@/stores/settings'
import { useViewStore } from '@/stores/view'

const props = defineProps<{ engineReady: boolean }>()

const docs = useDocumentStore()
const library = useLibraryStore()
const settings = useSettingsStore()
const view = useViewStore()

const titleInput = ref<HTMLInputElement | null>(null)
const editingTitle = ref(false)
const draft = ref('')
const foldMenu = ref(false)
const moreMenu = ref(false)

const title = computed(() => docs.doc?.title ?? '')

watch(
  () => docs.doc?.id,
  () => {
    editingTitle.value = false
    foldMenu.value = false
    moreMenu.value = false
  },
)

async function startTitleEdit() {
  if (!docs.doc) return
  draft.value = docs.doc.title
  editingTitle.value = true
  await nextTick()
  titleInput.value?.focus()
  titleInput.value?.select()
}

function commitTitle() {
  if (!editingTitle.value) return
  editingTitle.value = false
  const next = draft.value.trim()
  if (!next || !docs.doc || next === docs.doc.title) return
  docs.setTitle(next)
  void library.rename(docs.doc.id, next)
}

function cancelTitle() {
  editingTitle.value = false
}

function download(text: string, filename: string, type = 'text/markdown;charset=utf-8') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function exportMarkdown() {
  moreMenu.value = false
  if (!docs.doc) return
  await docs.flush()
  const text = await library.exportText(docs.doc.id)
  download(text, `${docs.doc.title || '未命名导图'}.md`)
  view.toast('已导出 Markdown')
}

async function exportAll() {
  moreMenu.value = false
  const text = await library.exportAllText()
  download(text, `mindmap-backup-${new Date().toISOString().slice(0, 10)}.md`)
  view.toast('已导出整库备份', { timeout: 6000 })
}

async function deleteDoc() {
  moreMenu.value = false
  if (!docs.doc) return
  const id = docs.doc.id
  const name = docs.doc.title || '未命名导图'
  await docs.flush()
  // 空草稿本来就没落库，关掉即可，不用真的进回收站
  if (docs.persisted) {
    await library.softDelete(id)
    view.toast(`已移入回收站：${name}`, { actionLabel: '撤销', action: () => library.restore(id) })
  }
  docs.close()
  const next = library.docs[0]
  if (next) await docs.open(next.id)
}

function applyFold(depth: number | 'all-expand' | 'all-collapse') {
  foldMenu.value = false
  if (depth === 'all-expand') docs.expandAll()
  else if (depth === 'all-collapse') docs.collapseAll()
  else docs.collapseToDepth(depth)
}

/* ------------------------- 视图：布局 / 主题 / 帮助 ------------------------- */

const twoSided = computed(() => settings.layout === 'two-sided')

function toggleLayout() {
  settings.layout = twoSided.value ? 'tree' : 'two-sided'
  view.toast(twoSided.value ? '已切换到单侧布局' : '已切换到左右平衡布局', { timeout: 1800 })
}

const THEME_ORDER = ['auto', 'light', 'dark'] as const
const THEME_ICON = { auto: SunMoon, light: Sun, dark: Moon }
const THEME_LABEL = { auto: '跟随系统', light: '浅色', dark: '深色' }

const themeIcon = computed(() => THEME_ICON[settings.theme])
const themeTitle = computed(() => `主题：${THEME_LABEL[settings.theme]}（点击切换）`)

function cycleTheme() {
  const index = THEME_ORDER.indexOf(settings.theme)
  settings.theme = THEME_ORDER[(index + 1) % THEME_ORDER.length]
  view.toast(`主题：${THEME_LABEL[settings.theme]}`, { timeout: 1600 })
}

/* ------------------------------ 视图：节点样式 ------------------------------ */

const nodeStyleLabel = computed(
  () => NODE_STYLES.find((style) => style.id === settings.nodeStyle)?.label ?? '卡片',
)
const nodeStyleTitle = computed(() => `节点样式：${nodeStyleLabel.value}（点击切换）`)

function cycleNodeStyle() {
  settings.nodeStyle = nextStyle(settings.nodeStyle)
  const next = NODE_STYLES.find((style) => style.id === settings.nodeStyle)
  view.toast(`节点样式：${next?.label ?? ''}`, { timeout: 1600 })
}
</script>

<template>
  <header class="mm-topbar">
    <button
      class="mm-icon-btn tb-mobile"
      type="button"
      title="打开列表"
      @click="view.mobileSidebarOpen = !view.mobileSidebarOpen"
    >
      <PanelLeft :size="18" />
    </button>
    <button
      v-if="settings.sidebarCollapsed"
      class="mm-icon-btn tb-desktop"
      type="button"
      title="展开侧栏"
      @click="settings.sidebarCollapsed = false"
    >
      <PanelLeft :size="18" />
    </button>

    <input
      v-if="editingTitle"
      ref="titleInput"
      v-model="draft"
      class="mm-input tb-title tb-title--editing"
      maxlength="200"
      @blur="commitTitle"
      @keydown.enter.prevent="commitTitle"
      @keydown.esc.prevent="cancelTitle"
    />
    <button v-else class="tb-title" type="button" title="点击重命名" @click="startTitleEdit">
      {{ title || '未命名导图' }}
    </button>

    <span v-if="!props.engineReady" class="tb-badge" title="渲染引擎尚未接入，当前为占位画布">
      引擎待接入
    </span>

    <div class="tb-actions">
      <button
        class="mm-icon-btn"
        type="button"
        title="撤销 (⌘Z)"
        :disabled="!docs.canUndo"
        @click="docs.undo()"
      >
        <Undo2 :size="17" />
      </button>
      <button
        class="mm-icon-btn"
        type="button"
        title="重做 (⇧⌘Z)"
        :disabled="!docs.canRedo"
        @click="docs.redo()"
      >
        <Redo2 :size="17" />
      </button>

      <button
        class="mm-icon-btn"
        type="button"
        :title="twoSided ? '当前：左右平衡（点击切到单侧）' : '当前：单侧生长（点击切到左右平衡）'"
        @click="toggleLayout"
      >
        <GitFork v-if="twoSided" :size="17" />
        <IndentIncrease v-else :size="17" />
      </button>

      <button class="mm-icon-btn" type="button" :title="nodeStyleTitle" @click="cycleNodeStyle">
        <!-- 卡片：一个圆角块 + 一行字 -->
        <svg
          v-if="settings.nodeStyle === 'card'"
          width="17"
          height="17"
          viewBox="0 0 17 17"
          fill="none"
          aria-hidden="true"
        >
          <rect x="2.7" y="4.4" width="11.6" height="8.2" rx="2.6" stroke="currentColor" stroke-width="1.3" />
          <path d="M5.6 8.5h5.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
        </svg>
        <!-- 藤蔓：一条主干 + 一条分出的枝 -->
        <svg
          v-else-if="settings.nodeStyle === 'vine'"
          width="17"
          height="17"
          viewBox="0 0 17 17"
          fill="none"
          aria-hidden="true"
        >
          <path d="M2.6 6.4h11.8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
          <path
            d="M9.2 6.4c0 3.1 1.5 4.9 3.2 5.3"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
          <circle cx="12.8" cy="12" r="1.1" fill="currentColor" />
        </svg>
        <!-- 逐层弱化：三层越来越淡的卡片 -->
        <svg v-else width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
          <rect x="2.6" y="3.2" width="11.8" height="4" rx="1.8" stroke="currentColor" stroke-width="1.2" />
          <rect x="3.8" y="8.1" width="9.4" height="3.4" rx="1.6" stroke="currentColor" stroke-width="1.1" opacity="0.6" />
          <rect x="5" y="12.4" width="7" height="2.6" rx="1.3" stroke="currentColor" stroke-width="1" opacity="0.35" />
        </svg>
      </button>

      <button class="mm-icon-btn" type="button" :title="themeTitle" @click="cycleTheme">
        <component :is="themeIcon" :size="17" />
      </button>

      <button
        class="mm-icon-btn tb-wide"
        type="button"
        title="语法说明"
        @click="view.helpOpen = true"
      >
        <CircleHelp :size="17" />
      </button>

      <div class="tb-anchor">
        <button
          class="mm-icon-btn tb-wide"
          type="button"
          title="折叠层级"
          :disabled="!docs.doc"
          @click="foldMenu = !foldMenu"
        >
          <ListTree :size="17" />
        </button>
        <div v-if="foldMenu" class="tb-menu">
          <button type="button" @click="applyFold(1)">折叠到第 1 层</button>
          <button type="button" @click="applyFold(2)">折叠到第 2 层</button>
          <button type="button" @click="applyFold(3)">折叠到第 3 层</button>
          <hr class="mm-hr" />
          <button type="button" @click="applyFold('all-expand')">展开全部</button>
          <button type="button" @click="applyFold('all-collapse')">折叠全部</button>
        </div>
      </div>

      <span class="tb-save" :data-status="docs.saveStatus">
        {{ docs.saveStatus === 'saving' ? '保存中…' : docs.saveStatus === 'error' ? '保存失败' : '已保存' }}
      </span>

      <button
        v-if="docs.doc"
        class="mm-btn mm-btn--primary tb-share"
        type="button"
        title="分享 / 导出图片"
        @click="view.shareOpen = true"
      >
        <Share2 :size="15" />
        <span class="tb-share-text">分享</span>
      </button>

      <div class="tb-anchor">
        <button class="mm-icon-btn" type="button" title="更多" @click="moreMenu = !moreMenu">
          <MoreHorizontal :size="18" />
        </button>
        <div v-if="moreMenu" class="tb-menu tb-menu--right">
          <button type="button" @click="view.importOpen = true; moreMenu = false">
            <Upload :size="14" /> 导入 Markdown
          </button>
          <button type="button" :disabled="!docs.doc" @click="exportMarkdown">
            <Download :size="14" /> 导出 Markdown
          </button>
          <button type="button" @click="exportAll">
            <Download :size="14" /> 整库备份
          </button>
          <hr class="mm-hr" />
          <button type="button" :disabled="!docs.doc" class="tb-danger" @click="deleteDoc">
            <Trash2 :size="14" /> 移入回收站
          </button>
        </div>
      </div>
    </div>

    <div v-if="foldMenu || moreMenu" class="tb-scrim" @click="foldMenu = false; moreMenu = false" />
  </header>
</template>

<style scoped>
.tb-title {
  max-width: 40vw;
  padding: 4px 8px;
  border-radius: var(--mm-r-sm);
  overflow: hidden;
  font-weight: 600;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tb-title:hover {
  background: color-mix(in srgb, var(--mm-text) 6%, transparent);
}

.tb-title--editing {
  max-width: 40vw;
  height: 32px;
}

.tb-badge {
  padding: 2px 8px;
  border-radius: var(--mm-r-pill);
  background: color-mix(in srgb, var(--mm-warn) 22%, transparent);
  color: color-mix(in srgb, var(--mm-warn) 70%, var(--mm-text));
  font-size: 11px;
  white-space: nowrap;
}

.tb-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.tb-save {
  margin: 0 6px;
  color: var(--mm-text-faint);
  font-size: 12px;
  white-space: nowrap;
}

.tb-save[data-status='error'] {
  color: var(--mm-danger);
}

.tb-anchor {
  position: relative;
}

.tb-wide {
  width: auto;
  gap: 2px;
  padding: 0 6px;
}

.tb-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  min-width: 168px;
  padding: 6px;
  border: 1px solid var(--mm-line);
  border-radius: var(--mm-r-md);
  background: var(--mm-panel);
  box-shadow: var(--mm-shadow-lg);
}

.tb-menu--right {
  right: 0;
  left: auto;
}

.tb-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: var(--mm-r-sm);
  text-align: left;
  white-space: nowrap;
}

.tb-menu button:hover {
  background: color-mix(in srgb, var(--mm-text) 6%, transparent);
}

.tb-menu button:disabled {
  opacity: 0.4;
}

.tb-danger {
  color: var(--mm-danger);
}

.tb-scrim {
  position: fixed;
  inset: 0;
  z-index: 45;
}

.tb-mobile {
  display: none;
}

.tb-share {
  margin-left: 4px;
}

@media (max-width: 720px) {
  .tb-mobile {
    display: grid;
  }

  .tb-desktop,
  .tb-wide,
  .tb-save,
  .tb-share-text {
    display: none;
  }

  .tb-title {
    max-width: 52vw;
  }
}
</style>
