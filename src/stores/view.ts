import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface Toast {
  id: number
  text: string
  actionLabel?: string
  action?: () => void
  timeout: number
}

let toastSeq = 0

export const useViewStore = defineStore('view', () => {
  const zoom = ref(1)
  const toasts = ref<Toast[]>([])
  const mobileSidebarOpen = ref(false)
  const shareOpen = ref(false)
  const settingsOpen = ref(false)
  const helpOpen = ref(false)
  const importOpen = ref(false)

  function toast(text: string, opts: { actionLabel?: string; action?: () => void; timeout?: number } = {}) {
    const item: Toast = {
      id: ++toastSeq,
      text,
      actionLabel: opts.actionLabel,
      action: opts.action,
      timeout: opts.timeout ?? 4000,
    }
    toasts.value = [...toasts.value, item]
    if (item.timeout > 0) {
      window.setTimeout(() => dismiss(item.id), item.timeout)
    }
    return item.id
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  return {
    zoom,
    toasts,
    mobileSidebarOpen,
    shareOpen,
    settingsOpen,
    helpOpen,
    importOpen,
    toast,
    dismiss,
  }
})
