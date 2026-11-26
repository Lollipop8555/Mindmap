import { onBeforeUnmount, onMounted } from 'vue'
import { useDocumentStore } from '@/stores/document'
import { useViewStore } from '@/stores/view'

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true
}

export function useShortcuts(options: { fit: () => void; zoomBy: (factor: number) => void }) {
  const docs = useDocumentStore()
  const view = useViewStore()

  function onKeydown(event: KeyboardEvent) {
    const meta = event.metaKey || event.ctrlKey

    if (event.key === 'Escape') {
      if (docs.editingId) {
        docs.stopEditing()
        event.preventDefault()
        return
      }
      docs.select(null)
      return
    }

    if (isEditable(event.target)) return
    if (!docs.doc) return

    if (meta && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) docs.redo()
      else docs.undo()
      return
    }
    if (meta && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      docs.redo()
      return
    }

    const selected = docs.selectedId

    switch (event.key) {
      case 'Tab': {
        event.preventDefault()
        if (event.shiftKey) docs.outdent(selected)
        else docs.addChild(selected)
        return
      }
      case 'Enter': {
        if (selected) {
          event.preventDefault()
          docs.addSibling(selected)
        }
        return
      }
      case 'F2': {
        if (selected) {
          event.preventDefault()
          docs.startEditing(selected)
        }
        return
      }
      case 'Delete':
      case 'Backspace': {
        if (selected && docs.doc.nodes[selected]?.parentId) {
          event.preventDefault()
          docs.remove(selected)
          view.toast('已删除节点', { actionLabel: '撤销', action: () => docs.undo() })
        }
        return
      }
      case ' ': {
        if (selected) {
          event.preventDefault()
          docs.toggleFold(selected)
        }
        return
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        if (!selected) return
        event.preventDefault()
        if (event.altKey) {
          docs.moveSibling(selected, event.key === 'ArrowUp' ? -1 : 1)
          return
        }
        const ids = docs.visibleIds()
        const index = ids.indexOf(selected)
        if (index < 0) return
        const next = ids[index + (event.key === 'ArrowUp' ? -1 : 1)]
        if (next) docs.select(next)
        return
      }
      case 'ArrowLeft': {
        if (!selected) return
        event.preventDefault()
        const node = docs.doc.nodes[selected]
        if (node?.parentId) docs.select(node.parentId)
        return
      }
      case 'ArrowRight': {
        if (!selected) return
        event.preventDefault()
        const node = docs.doc.nodes[selected]
        if (!node) return
        if (node.collapsed) docs.toggleFold(selected)
        else if (node.children[0]) docs.select(node.children[0])
        return
      }
      case '0': {
        event.preventDefault()
        options.fit()
        return
      }
      case '+':
      case '=': {
        event.preventDefault()
        options.zoomBy(1.2)
        return
      }
      case '-':
      case '_': {
        event.preventDefault()
        options.zoomBy(1 / 1.2)
        return
      }
      case '?': {
        view.helpOpen = true
        return
      }
      default:
        return
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
