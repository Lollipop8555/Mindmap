<script setup lang="ts">
import { computed, ref } from 'vue'
import { FileUp, X } from 'lucide-vue-next'
import { useLibraryStore } from '@/stores/library'
import { useViewStore } from '@/stores/view'

const emit = defineEmits<{ done: [] }>()

const library = useLibraryStore()
const view = useViewStore()

const text = ref('')
const files = ref<File[]>([])
const busy = ref(false)
const dragging = ref(false)

const canImport = computed(() => !busy.value && (text.value.trim().length > 0 || files.value.length > 0))

function close() {
  view.importOpen = false
}

function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  files.value = [...files.value, ...Array.from(input.files ?? [])]
  input.value = ''
}

function onDrop(event: DragEvent) {
  dragging.value = false
  const dropped = Array.from(event.dataTransfer?.files ?? [])
  if (dropped.length) files.value = [...files.value, ...dropped]
  const raw = event.dataTransfer?.getData('text/plain')
  if (raw) text.value = text.value ? `${text.value}\n${raw}` : raw
}

function removeFile(index: number) {
  files.value = files.value.filter((_, i) => i !== index)
}

async function run() {
  if (!canImport.value) return
  busy.value = true
  const warnings: string[] = []
  let count = 0
  try {
    if (files.value.length) {
      const result = await library.importMarkdownFiles(files.value)
      count += result.count
      warnings.push(...result.warnings)
    }
    if (text.value.trim()) {
      const result = await library.importMarkdownText(text.value)
      count += result.docs.length
      warnings.push(...result.warnings)
    }
    emit('done')
    view.toast(`已导入 ${count} 份导图`)
    for (const warning of warnings.slice(0, 3)) view.toast(warning, { timeout: 7000 })
    if (warnings.length > 3) view.toast(`另有 ${warnings.length - 3} 条导入提示`, { timeout: 6000 })
    close()
  } catch (error) {
    console.error(error)
    view.toast('导入失败，请检查文件内容')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="mm-scrim" @click.self="close">
    <div class="mm-dialog" role="dialog" aria-modal="true" aria-label="导入 Markdown">
      <header class="imp-head">
        <h2>导入 Markdown</h2>
        <button class="mm-icon-btn" type="button" title="关闭" @click="close">
          <X :size="17" />
        </button>
      </header>

      <p class="imp-hint">
        支持 <code># 标题</code> + 列表嵌套的结构。一个文件里有多个一级标题会导入为多份导图；
        折叠、颜色等状态不在 markdown 里，导入后会重新分配。
      </p>

      <div
        class="imp-drop"
        :data-dragging="String(dragging)"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <FileUp :size="22" />
        <p>把 .md 文件拖到这里，或</p>
        <label class="mm-btn imp-pick">
          选择文件
          <input type="file" accept=".md,.markdown,.txt" multiple hidden @change="onPick" />
        </label>
      </div>

      <ul v-if="files.length" class="imp-files">
        <li v-for="(file, index) in files" :key="`${file.name}-${index}`">
          <span>{{ file.name }}</span>
          <button class="mm-icon-btn" type="button" @click="removeFile(index)">
            <X :size="13" />
          </button>
        </li>
      </ul>

      <textarea
        v-model="text"
        class="mm-input imp-text"
        rows="7"
        placeholder="# 项目计划&#10;&#10;- 需求梳理&#10;  - 用户访谈"
      />

      <footer class="imp-foot">
        <span class="imp-count">节点上限 5000，深度上限 12</span>
        <button class="mm-btn" type="button" @click="close">取消</button>
        <button class="mm-btn mm-btn--primary" type="button" :disabled="!canImport" @click="run">
          {{ busy ? '导入中…' : '导入' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.imp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.imp-head h2 {
  margin: 0;
  font-size: 16px;
}

.imp-hint {
  margin: 0 0 12px;
  color: var(--mm-text-soft);
  font-size: 12px;
  line-height: 1.7;
}

.imp-hint code {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--mm-code-bg);
  color: var(--mm-code-text);
}

.imp-drop {
  display: grid;
  place-items: center;
  gap: 6px;
  padding: 18px;
  border: 1.5px dashed var(--mm-line-strong);
  border-radius: var(--mm-r-md);
  color: var(--mm-text-faint);
  font-size: 12px;
  text-align: center;
  transition: border-color var(--mm-t-fast) var(--mm-ease), background var(--mm-t-fast) var(--mm-ease);
}

.imp-drop[data-dragging='true'] {
  border-color: var(--mm-accent);
  background: var(--mm-accent-soft);
}

.imp-drop p {
  margin: 0;
}

.imp-pick {
  border: 1px solid var(--mm-line);
  font-size: 13px;
}

.imp-files {
  display: grid;
  gap: 4px;
  max-height: 120px;
  padding: 0;
  margin: 10px 0 0;
  overflow: auto;
  list-style: none;
}

.imp-files li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px;
  border-radius: var(--mm-r-sm);
  background: var(--mm-panel-soft);
  font-size: 12px;
}

.imp-text {
  height: auto;
  margin-top: 10px;
  padding: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
  resize: vertical;
}

.imp-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

.imp-count {
  margin-right: auto;
  color: var(--mm-text-faint);
  font-size: 11px;
}
</style>
