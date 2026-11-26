<script setup lang="ts">
import { useViewStore } from '@/stores/view'

const view = useViewStore()

function run(id: number, action?: () => void) {
  action?.()
  view.dismiss(id)
}
</script>

<template>
  <div class="mm-toasts" role="status" aria-live="polite">
    <div v-for="item in view.toasts" :key="item.id" class="mm-toast">
      <span>{{ item.text }}</span>
      <button v-if="item.actionLabel" type="button" @click="run(item.id, item.action)">
        {{ item.actionLabel }}
      </button>
      <button type="button" class="toast-close" @click="view.dismiss(item.id)">✕</button>
    </div>
  </div>
</template>

<style scoped>
.toast-close {
  color: inherit;
  opacity: 0.55;
}
</style>
