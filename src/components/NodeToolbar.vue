<script setup lang="ts">
import { computed } from 'vue'
import { ChevronsDownUp, CornerDownRight, Pencil, Plus, Trash2 } from 'lucide-vue-next'
import type { Rect } from '@/mindmap/engine/types'

const props = defineProps<{
  rect: Rect
  zoom: number
  canFold: boolean
  isRoot: boolean
}>()

const emit = defineEmits<{
  edit: []
  'add-child': []
  'add-sibling': []
  fold: []
  remove: []
}>()

const style = computed(() => ({
  left: `${Math.max(8, props.rect.x + props.rect.width / 2)}px`,
  top: `${Math.max(36, props.rect.y - 8)}px`,
}))
</script>

<template>
  <div class="mm-toolbar node-toolbar" :style="style" role="toolbar" aria-label="节点操作">
    <button class="mm-icon-btn" type="button" title="编辑 (F2)" @click="emit('edit')">
      <Pencil :size="15" />
    </button>
    <button class="mm-icon-btn" type="button" title="新建子节点 (Tab)" @click="emit('add-child')">
      <Plus :size="15" />
    </button>
    <button
      class="mm-icon-btn"
      type="button"
      title="新建同级 (Enter)"
      :disabled="isRoot"
      @click="emit('add-sibling')"
    >
      <CornerDownRight :size="15" />
    </button>
    <button
      class="mm-icon-btn"
      type="button"
      title="折叠 / 展开 (空格)"
      :disabled="!canFold"
      @click="emit('fold')"
    >
      <ChevronsDownUp :size="15" />
    </button>
    <span class="node-toolbar__sep" />
    <button
      class="mm-icon-btn node-toolbar__danger"
      type="button"
      title="删除 (Delete)"
      :disabled="isRoot"
      @click="emit('remove')"
    >
      <Trash2 :size="15" />
    </button>
  </div>
</template>

<style scoped>
.node-toolbar {
  transform: translate(-50%, -100%);
  animation: tb-in var(--mm-t-fast) var(--mm-ease);
}

.node-toolbar__sep {
  width: 1px;
  height: 18px;
  margin: 0 2px;
  background: var(--mm-line);
}

.node-toolbar__danger:hover {
  color: var(--mm-danger);
}

@keyframes tb-in {
  from {
    opacity: 0;
    transform: translate(-50%, calc(-100% + 4px));
  }
  to {
    opacity: 1;
    transform: translate(-50%, -100%);
  }
}
</style>
