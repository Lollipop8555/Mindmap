<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import Sidebar from '@/components/Sidebar.vue'
import TopBar from '@/components/TopBar.vue'
import Stage from '@/components/Stage.vue'
import ShareDialog from '@/components/ShareDialog.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import ImportDialog from '@/components/ImportDialog.vue'
import HelpDialog from '@/components/HelpDialog.vue'
import Toasts from '@/components/Toasts.vue'
import { useEngine } from '@/composables/useEngine'
import { useShortcuts } from '@/composables/useShortcuts'
import { useLibraryStore } from '@/stores/library'
import { useDocumentStore } from '@/stores/document'
import { useSettingsStore } from '@/stores/settings'
import { useViewStore } from '@/stores/view'

const library = useLibraryStore()
const docs = useDocumentStore()
const settings = useSettingsStore()
const view = useViewStore()

const { controller, mount } = useEngine()

async function openDoc(id: string) {
  await docs.open(id)
  settings.lastDocId = id
  view.mobileSidebarOpen = false
}

function fitView() {
  const engine = controller.value
  if (!engine) return
  engine.fit()
  view.zoom = engine.getZoom()
}

useShortcuts({
  fit: fitView,
  zoomBy: (factor) => {
    controller.value?.zoomBy(factor)
    if (controller.value) view.zoom = controller.value.getZoom()
  },
})

function flushOnHide() {
  if (document.visibilityState === 'hidden') void docs.flush()
}
function flushNow() {
  void docs.flush()
}

onMounted(async () => {
  await library.refresh()
  await library.ensureSeed()
  await library.refresh()

  // PWA 快捷方式：/Mindmap/#new
  if (window.location.hash === '#new') {
    const fresh = await library.create()
    await openDoc(fresh.id)
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  } else {
    const preferred = settings.lastDocId
    const target =
      (preferred && library.docs.some((doc) => doc.id === preferred) ? preferred : null) ??
      library.docs[0]?.id
    if (target) await openDoc(target)
  }

  document.addEventListener('visibilitychange', flushOnHide)
  window.addEventListener('pagehide', flushNow)

  // 撤销/重做后需要重新同步扁平列表的标题等元信息
  watch(
    () => docs.revision,
    () => {
      if (!library.docs.some((doc) => doc.id === docs.doc?.id) && docs.doc) void library.refresh()
    },
  )
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', flushOnHide)
  window.removeEventListener('pagehide', flushNow)
  void docs.flush()
})
</script>

<template>
  <div class="mm-shell" :data-collapsed="String(settings.sidebarCollapsed)">
    <Sidebar @open="openDoc" />
    <div class="mm-main">
      <TopBar :engine-ready="controller?.ready ?? false" />
      <Stage :controller="controller" :mount-engine="mount" />
    </div>

    <ShareDialog v-if="view.shareOpen" :controller="controller" />
    <SettingsPanel v-if="view.settingsOpen" />
    <ImportDialog v-if="view.importOpen" @done="library.refresh()" />
    <HelpDialog v-if="view.helpOpen" />
    <Toasts />
  </div>
</template>
