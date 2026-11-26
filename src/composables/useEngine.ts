import { onBeforeUnmount, shallowRef, watch } from 'vue'
import { MindmapController } from '@/mindmap/engine/controller'
import { createMarkmapEngine } from '@/mindmap/engine/markmap-engine'
import type { Engine } from '@/mindmap/engine/types'
import { createMonetTheme } from '@/mindmap/theme/monet'
import { useDocumentStore } from '@/stores/document'
import { useSettingsStore } from '@/stores/settings'
import { useViewStore } from '@/stores/view'

/**
 * 引擎生命周期与 store 的单向同步。
 * 引擎实例用 shallowRef 持有，避免被 Vue 代理整棵图。
 */
export function useEngine(createEngine: () => Engine = createMarkmapEngine) {
  const docs = useDocumentStore()
  const settings = useSettingsStore()
  const view = useViewStore()
  const controller = shallowRef<MindmapController | null>(null)
  let mounted = false

  function mount(el: HTMLElement) {
    const instance = new MindmapController(createEngine(), {
      onFold: (id, folded) => {
        if (!docs.doc) return
        const collapsed = Boolean(docs.doc.nodes[id]?.collapsed)
        if (collapsed !== folded) docs.toggleFold(id)
      },
      onFoldSide: (id, side, folded) => {
        // 只有双侧布局的根节点有左右两侧
        if (!docs.doc || id !== docs.doc.rootId) return
        docs.setFoldedSide(side, folded)
      },
      onZoom: (k) => {
        view.zoom = k
      },
      onSelect: (id) => docs.select(id),
      onBlankClick: () => docs.select(null),
      onLink: (href) => {
        if (/^(https?:|mailto:|tel:)/i.test(href)) window.open(href, '_blank', 'noopener,noreferrer')
      },
      onRender: () => docs.setRenderedIds(instance.renderedIds()),
    })
    instance.mount(el, { layout: settings.layout, theme: createMonetTheme(settings.resolvedTheme) })
    controller.value = instance
    mounted = true
    if (docs.doc) instance.applyDocument(docs.doc)
  }

  watch(
    () => docs.revision,
    () => {
      if (!mounted || !docs.doc) return
      controller.value?.applyDocument(docs.doc)
    },
  )

  watch(
    () => settings.layout,
    (layout) => docs.setLayout(layout),
  )

  watch(
    () => settings.resolvedTheme,
    (scheme) => controller.value?.setTheme(createMonetTheme(scheme)),
  )

  watch(
    [() => docs.selectedId, () => docs.editingId],
    ([selected, editing]) => controller.value?.setSelection(selected, editing),
  )

  onBeforeUnmount(() => {
    controller.value?.destroy()
    controller.value = null
    mounted = false
  })

  return { controller, mount }
}
