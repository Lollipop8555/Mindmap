<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { useViewStore } from '@/stores/view'

const view = useViewStore()

const groups = [
  {
    title: '结构',
    items: [
      ['Enter', '新建同级节点'],
      ['Tab', '新建子节点'],
      ['Shift + Tab', '降级（成为父级的兄弟）'],
      ['Alt + ↑ / ↓', '同级上移 / 下移'],
      ['Delete / Backspace', '删除节点与子树'],
      ['空格', '折叠 / 展开'],
    ],
  },
  {
    title: '编辑',
    items: [
      ['双击 / F2', '编辑节点文本'],
      ['Enter', '提交编辑'],
      ['Esc', '取消编辑'],
      ['⌘/Ctrl + B', '加粗'],
      ['⌘/Ctrl + I', '斜体'],
      ['⌘/Ctrl + U', '下划线（++文本++）'],
      ['⌘/Ctrl + H', '高亮（==文本==）'],
      ['⌘/Ctrl + E', '行内代码'],
      ['⌘/Ctrl + K', '插入链接'],
    ],
  },
  {
    title: '画布',
    items: [
      ['↑ / ↓ / ← / →', '在节点间移动'],
      ['0', '适应画布'],
      ['+ / -', '放大 / 缩小'],
      ['⌘/Ctrl + Z', '撤销'],
      ['⇧⌘/Ctrl + Z', '重做'],
      ['?', '打开本帮助'],
    ],
  },
]

function close() {
  view.helpOpen = false
}
</script>

<template>
  <div class="mm-scrim" @click.self="close">
    <div class="mm-dialog" role="dialog" aria-modal="true" aria-label="快捷键">
      <header class="help-head">
        <h2>快捷键与语法</h2>
        <button class="mm-icon-btn" type="button" title="关闭" @click="close">
          <X :size="17" />
        </button>
      </header>

      <section v-for="group in groups" :key="group.title" class="help-group">
        <h3>{{ group.title }}</h3>
        <dl>
          <div v-for="item in group.items" :key="item[0]">
            <dt><kbd>{{ item[0] }}</kbd></dt>
            <dd>{{ item[1] }}</dd>
          </div>
        </dl>
      </section>

      <section class="help-group">
        <h3>富内联</h3>
        <p class="help-syntax">
          <code>**粗体**</code> <code>*斜体*</code> <code>~~删除~~</code>
          <code>==高亮==</code> <code>`代码`</code> <code>++下划线++</code>
          <code>^上标^</code> <code>#标签</code> <code>$a^2+b^2$</code>
        </p>
        <p class="help-syntax">
          <code>:badge[进行中]{tone="amber"}</code> <code>:progress[60]</code>
          <code>:date[2026-12-31]</code> <code>:icon[rocket]</code>
          <code>:kbd[⌘K]</code> <code>:sup[2]</code> <code>:sub[2]</code>
          <code>:color[文字]{c="rose"}</code>
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.help-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.help-head h2 {
  margin: 0;
  font-size: 16px;
}

.help-group {
  margin-top: 14px;
}

.help-group h3 {
  margin: 0 0 6px;
  color: var(--mm-text-soft);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.help-group dl {
  margin: 0;
}

.help-group dl > div {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 3px 0;
}

.help-group dt {
  flex: 0 0 132px;
}

.help-group dd {
  margin: 0;
  color: var(--mm-text-soft);
  font-size: 13px;
}

.help-group kbd {
  padding: 2px 6px;
  border: 1px solid var(--mm-line);
  border-bottom-width: 2px;
  border-radius: 5px;
  background: var(--mm-panel-soft);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}

.help-syntax {
  margin: 4px 0;
  line-height: 2;
}

.help-syntax code {
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--mm-code-bg);
  color: var(--mm-code-text);
  font-size: 12px;
}
</style>
