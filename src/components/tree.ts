import { computed, defineComponent, h, ref, watch, type PropType, type VNodeChild } from 'vue'
import { useFocus } from '../composables.js'
import { matchKey } from '../input/keys.js'
import { useLayout } from './primitives.js'
import { ScrollbarTrack } from './inputs.js'

export interface TreeNode {
  label: string
  children?: TreeNode[]
  /** Icon drawn before the label (e.g. '📁'). */
  icon?: string
  /** Identity used for v-model / expansion (defaults to the node's path, e.g. "0/2"). */
  value?: unknown
  disabled?: boolean
  /** Color of the label. */
  color?: string
  /** Initially expanded (when `expanded` isn't controlled). */
  expanded?: boolean
}

export interface TreeRow {
  node: TreeNode
  depth: number
  /** Index path, e.g. "0/2/1". */
  path: string
  key: unknown
  parent: TreeRow | null
  hasChildren: boolean
  expanded: boolean
  /** Guide prefix, e.g. "│ ├─". */
  guide: string
  isLast: boolean
}

const keyOf = (n: TreeNode, path: string) => (n.value !== undefined ? n.value : path)

/**
 * Expandable tree.
 *   <Tree :nodes="files" v-model="selected" :height="12" @select="open" />
 * Keys: ↑/↓ (k/j) move, → expands (or enters), ← collapses (or goes to the
 * parent), enter selects (and toggles branches), space toggles, home/end,
 * pgup/pgdn; `*` expands all siblings. Click selects, click a branch toggles it.
 * Custom labels: `<template #label="{ node, depth, expanded, selected, active }">`.
 */
export const Tree = defineComponent({
  name: 'Tree',
  props: {
    nodes: { type: Array as PropType<TreeNode[]>, required: true },
    /** Selected node's value (or path). */
    modelValue: { type: null as unknown as PropType<unknown>, default: undefined },
    /** Controlled list of expanded node keys (use with `v-model:expanded`). */
    expanded: { type: Array as PropType<unknown[]>, default: undefined },
    /** Expand everything initially. */
    expandAll: Boolean,
    /** Visible rows (virtual scrolling). Defaults to the available height. */
    height: Number,
    /** Draw guide lines (├─ └─ │). */
    guides: { type: Boolean, default: true },
    /** Show ▸/▾ markers for branches. */
    markers: { type: Boolean, default: true },
    disabled: Boolean,
    autoFocus: Boolean,
    showSelectionWhenBlurred: { type: Boolean, default: true },
  },
  emits: ['update:modelValue', 'update:expanded', 'select', 'toggle', 'highlight'],
  setup(props, { emit, slots, expose }) {
    const initial = new Set<unknown>()
    const seed = (nodes: TreeNode[], prefix: string) =>
      nodes.forEach((n, i) => {
        const path = prefix ? `${prefix}/${i}` : String(i)
        if (n.children?.length && (props.expandAll || n.expanded)) initial.add(keyOf(n, path))
        if (n.children) seed(n.children, path)
      })
    seed(props.nodes, '')
    const internal = ref(initial)
    const openSet = computed(() => (props.expanded ? new Set(props.expanded) : internal.value))

    const rows = computed(() => {
      const out: TreeRow[] = []
      const walk = (nodes: TreeNode[], depth: number, prefix: string, parent: TreeRow | null, guide: string) => {
        nodes.forEach((node, i) => {
          const path = prefix ? `${prefix}/${i}` : String(i)
          const key = keyOf(node, path)
          const hasChildren = !!node.children?.length
          const expanded = hasChildren && openSet.value.has(key)
          const isLast = i === nodes.length - 1
          const own = depth === 0 ? '' : isLast ? '└─' : '├─'
          const row: TreeRow = { node, depth, path, key, parent, hasChildren, expanded, guide: guide + own, isLast }
          out.push(row)
          if (expanded) walk(node.children!, depth + 1, path, row, depth === 0 ? '' : guide + (isLast ? '  ' : '│ '))
        })
      }
      walk(props.nodes, 0, '', null, '')
      return out
    })

    const cursor = ref(0)
    const syncCursor = () => {
      if (props.modelValue === undefined) return
      const i = rows.value.findIndex((r) => r.key === props.modelValue)
      if (i >= 0) cursor.value = i
    }
    syncCursor()
    watch(() => props.modelValue, syncCursor)
    watch(
      () => rows.value.length,
      (n) => (cursor.value = Math.max(0, Math.min(cursor.value, n - 1))),
    )

    const setExpanded = (row: TreeRow, open: boolean) => {
      if (!row.hasChildren || row.expanded === open) return
      const next = new Set(openSet.value)
      if (open) next.add(row.key)
      else next.delete(row.key)
      internal.value = next
      emit('update:expanded', [...next])
      emit('toggle', row.node, open)
    }
    const move = (to: number) => {
      const n = rows.value.length
      if (!n) return
      cursor.value = Math.max(0, Math.min(n - 1, to))
      const r = rows.value[cursor.value]
      emit('highlight', r.node, r.path)
    }
    const select = (row: TreeRow | undefined) => {
      if (!row || row.node.disabled) return
      emit('update:modelValue', row.key)
      emit('select', row.node, row.path)
    }
    const { layout, onLayout } = useLayout()
    const visibleRows = () => Math.max(1, props.height ?? layout.value?.innerHeight ?? rows.value.length)

    const focus = useFocus({
      autoFocus: props.autoFocus,
      disabled: () => props.disabled,
      onKey(e) {
        const rs = rows.value
        const row = rs[cursor.value]
        const page = visibleRows()
        if (matchKey(e, 'up|k|ctrl+p')) move(cursor.value - 1)
        else if (matchKey(e, 'down|j|ctrl+n')) move(cursor.value + 1)
        else if (matchKey(e, 'pageup')) move(cursor.value - page)
        else if (matchKey(e, 'pagedown')) move(cursor.value + page)
        else if (matchKey(e, 'home|g')) move(0)
        else if (matchKey(e, 'end|shift+g')) move(rs.length - 1)
        else if (matchKey(e, 'right|l')) {
          if (!row) return
          if (row.hasChildren && !row.expanded) setExpanded(row, true)
          else if (row.hasChildren) move(cursor.value + 1)
        } else if (matchKey(e, 'left|h')) {
          if (!row) return
          if (row.expanded) setExpanded(row, false)
          else if (row.parent) move(rs.indexOf(row.parent))
        } else if (matchKey(e, 'space')) {
          if (row?.hasChildren) setExpanded(row, !row.expanded)
          else select(row)
        } else if (matchKey(e, 'enter')) {
          if (!row) return
          select(row)
          if (row.hasChildren) setExpanded(row, !row.expanded)
        } else if (e.char === '*') {
          if (!row) return
          const siblings = row.parent ? rs.filter((r) => r.parent === row.parent) : rs.filter((r) => r.depth === 0)
          const next = new Set(openSet.value)
          for (const s of siblings) if (s.hasChildren) next.add(s.key)
          internal.value = next
          emit('update:expanded', [...next])
        } else return
        e.stopPropagation()
      },
    })

    expose({
      expandAll: () => {
        const next = new Set<unknown>()
        const walk = (nodes: TreeNode[], prefix: string) =>
          nodes.forEach((n, i) => {
            const path = prefix ? `${prefix}/${i}` : String(i)
            if (n.children?.length) {
              next.add(keyOf(n, path))
              walk(n.children, path)
            }
          })
        walk(props.nodes, '')
        internal.value = next
        emit('update:expanded', [...next])
      },
      collapseAll: () => {
        internal.value = new Set()
        emit('update:expanded', [])
      },
    })

    let scroll = 0
    return () => {
      const active = focus.isFocused.value
      const rs = rows.value
      const n = rs.length
      const visible = visibleRows()
      let s = scroll
      if (cursor.value < s) s = cursor.value
      if (cursor.value >= s + visible) s = cursor.value - visible + 1
      s = Math.max(0, Math.min(s, Math.max(0, n - visible)))
      scroll = s
      const showSel = active || props.showSelectionWhenBlurred
      const children = rs.slice(s, s + visible).map((row, k) => {
        const i = s + k
        const highlighted = i === cursor.value && showSel
        const selected = props.modelValue !== undefined && row.key === props.modelValue
        const node = row.node
        const leaf = props.guides && row.depth > 0 ? '─ ' : '  '
        const marker = props.markers ? (row.hasChildren ? (row.expanded ? '▾ ' : '▸ ') : leaf) : props.guides && row.depth > 0 ? ' ' : ''
        const label: VNodeChild = slots.label
          ? slots.label({ node, depth: row.depth, expanded: row.expanded, selected, highlighted, active, path: row.path })
          : h(
              'tui-text',
              {
                color: node.disabled ? 'muted' : highlighted && active ? 'focus' : selected ? 'primary' : node.color,
                bold: (highlighted && active) || selected,
                wrap: 'truncate',
              },
              node.label,
            )
        return h(
          'tui-box',
          {
            key: row.path,
            flexDirection: 'row',
            flexShrink: 0,
            bg: highlighted ? (active ? 'selection' : 'surface') : undefined,
            onClick: () => {
              move(i)
              select(row)
              if (row.hasChildren) setExpanded(row, !row.expanded)
            },
          },
          [
            h('tui-text', { wrap: 'none', flexShrink: 0 }, [
              props.guides && row.guide ? h('tui-text', { color: 'border' }, row.guide) : props.guides ? null : '  '.repeat(row.depth),
              marker ? h('tui-text', { color: row.hasChildren ? (highlighted && active ? 'focus' : 'muted') : 'border' }, marker) : null,
              node.icon ? `${node.icon} ` : null,
            ]),
            h('tui-box', { flexGrow: 1, flexShrink: 1, overflow: 'hidden' }, [label]),
          ],
        )
      })
      const scrollable = n > visible
      return h(
        'tui-box',
        {
          ref: focus.el,
          flexDirection: 'row',
          height: props.height,
          flexShrink: props.height ? 0 : 1,
          onLayout: props.height ? undefined : onLayout,
          onWheel: (e: { direction: string; stopPropagation(): void }) => {
            e.stopPropagation()
            move(cursor.value + (e.direction === 'up' ? -1 : 1))
          },
        },
        [
          h('tui-box', { flexDirection: 'column', flexGrow: 1, flexShrink: 1, overflow: 'hidden' }, children.length ? children : [h('tui-text', { color: 'muted' }, 'Empty')]),
          scrollable ? h(ScrollbarTrack, { total: n, visible, offset: s }) : null,
        ],
      )
    }
  },
})
