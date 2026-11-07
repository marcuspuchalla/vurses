import { computed, defineComponent, h, ref, type PropType, type VNodeChild } from 'vue'
import { useKeyBindings, useKeymap } from '../composables.js'
import type { KeyBindingInfo } from '../app/context.js'
import { formatKey } from '../input/keys.js'
import { textWidth } from '../render/text.js'
import { Dialog } from './containers.js'

export { useKeyBindings }
export type { KeyBinding, UseKeymapOptions } from '../composables.js'
export type { KeyBindingInfo }

/** `'ctrl+s|ctrl+x'` → `'^S / ^X'` */
export function formatCombo(keys: string): string {
  return keys
    .split('|')
    .map((k) => formatKey(k.trim()))
    .join(' / ')
}

/** Groups bindings by `group` (ungrouped first, then in order of appearance). */
export function groupBindings(list: KeyBindingInfo[], fallback = 'General'): { group: string; items: KeyBindingInfo[] }[] {
  const groups = new Map<string, KeyBindingInfo[]>()
  for (const b of list) {
    const g = b.group ?? fallback
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(b)
  }
  return [...groups].map(([group, items]) => ({ group, items }))
}

/**
 * Lists every key binding registered with `useKeymap` (with descriptions),
 * grouped. As an overlay toggled with `?` (default), or inline as a panel.
 *   <KeyHelp />                      — press ? to open, esc / ? to close
 *   <KeyHelp inline title="Keys" />  — always visible panel
 *   <KeyHelp :extra="[{ keys: 'tab', description: 'Next field', group: 'Navigation' }]" />
 */
export const KeyHelp = defineComponent({
  name: 'KeyHelp',
  props: {
    hotkey: { type: String, default: '?' },
    /** Controlled open state (`v-model:open`). */
    open: { type: Boolean, default: undefined },
    inline: Boolean,
    title: { type: String, default: 'Keyboard shortcuts' },
    /** Additional entries (e.g. component-level keys). */
    extra: { type: Array as PropType<KeyBindingInfo[]>, default: () => [] },
    /** Include bindings without a description (shown with their key only). */
    showUndescribed: { type: Boolean, default: false },
    width: { type: [Number, String], default: 60 },
    /** Columns in the overlay. */
    columns: { type: Number, default: 1 },
  },
  emits: ['update:open'],
  setup(props, { emit }) {
    const internal = ref(false)
    const isOpen = computed(() => props.open ?? internal.value)
    const setOpen = (v: boolean) => {
      internal.value = v
      emit('update:open', v)
    }
    const all = useKeyBindings()
    // priority above Dialog's modal handler (100) so the hotkey also closes the overlay
    useKeymap(
      () =>
        props.inline
          ? {}
          : {
              [props.hotkey]: { handler: () => setOpen(!isOpen.value), description: 'Toggle this help', group: 'General' },
            },
      { priority: 101 },
    )
    const entries = computed(() => {
      const list = [...all.value, ...props.extra].filter((b) => props.showUndescribed || b.description)
      return groupBindings(list)
    })
    const body = (): VNodeChild[] => {
      const groups = entries.value
      if (!groups.length) return [h('tui-text', { color: 'muted' }, 'No key bindings registered')]
      const keyW = Math.max(4, ...groups.flatMap((g) => g.items.map((b) => textWidth(formatCombo(b.keys)))))
      const cols = Math.max(1, props.columns)
      const render = (g: { group: string; items: KeyBindingInfo[] }, gi: number, list: unknown[]) =>
        h('tui-box', { key: g.group, flexDirection: 'column', flexShrink: 0, marginBottom: cols === 1 && gi < list.length - 1 ? 1 : 0, ...(cols > 1 ? { flexGrow: 1, flexBasis: 0 } : {}) }, [
          h('tui-text', { bold: true, color: 'primary', wrap: 'none' }, g.group),
          ...g.items.map((b, i) =>
            h('tui-text', { key: i, wrap: 'truncate' }, [
              h('tui-text', { color: 'accent', bold: true }, formatCombo(b.keys).padEnd(keyW + 2)),
              h('tui-text', { color: b.description ? 'text' : 'muted' }, b.description ?? ''),
            ]),
          ),
        ])
      if (cols === 1) return groups.map(render)
      const rows: VNodeChild[] = []
      for (let i = 0; i < groups.length; i += cols) {
        rows.push(h('tui-box', { key: i, flexDirection: 'row', gap: 2, flexShrink: 0, marginBottom: i + cols < groups.length ? 1 : 0 }, groups.slice(i, i + cols).map(render)))
      }
      return rows
    }
    return () => {
      if (props.inline) {
        return h('tui-box', { flexDirection: 'column', border: 'round', borderColor: 'border', title: props.title, titleColor: 'muted', paddingX: 1, gap: 1, flexShrink: 0 }, body())
      }
      return h(
        Dialog,
        { open: isOpen.value, 'onUpdate:open': setOpen, title: props.title, width: props.width },
        {
          default: () => body(),
          footer: () => [h('tui-text', { color: 'muted' }, [h('tui-text', { color: 'accent', bold: true }, formatKey(props.hotkey.split('|')[0])), ' or ', h('tui-text', { color: 'accent', bold: true }, 'esc'), ' to close'])],
        },
      )
    }
  },
})
