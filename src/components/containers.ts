import {
  Teleport,
  computed,
  defineComponent,
  h,
  nextTick,
  ref,
  shallowRef,
  watch,
  onBeforeUnmount,
  type PropType,
  type VNodeChild,
} from 'vue'
import { useAppContext, useFocus, useInput, useTicker } from '../composables.js'
import type { FocusEntry } from '../app/focus.js'
import type { LayoutInfo, TElement } from '../dom/nodes.js'
import { formatKey, matchKey } from '../input/keys.js'
import { List, ScrollbarTrack, TextInput, normalizeOptions } from './inputs.js'

/**
 * Scrollable viewport. Scroll with the mouse wheel, or arrows / PgUp / PgDn /
 * Home / End while focused. `stick-to-bottom` keeps following new content (logs).
 */
export const ScrollBox = defineComponent({
  name: 'ScrollBox',
  props: {
    stickToBottom: Boolean,
    scrollbar: { type: Boolean, default: true },
    focusable: { type: Boolean, default: true },
    /** Rows per wheel tick. */
    step: { type: Number, default: 1 },
  },
  emits: ['scroll'],
  setup(props, { slots, expose, emit }) {
    const offset = ref(0)
    const viewport = shallowRef<LayoutInfo | null>(null)
    const viewH = computed(() => viewport.value?.innerHeight ?? 0)
    const contentH = computed(() => viewport.value?.scrollHeight ?? 0)
    const max = computed(() => Math.max(0, contentH.value - viewH.value))
    const scrollTo = (y: number) => {
      const v = Math.max(0, Math.min(max.value, Math.round(y)))
      if (v !== offset.value) {
        offset.value = v
        emit('scroll', v)
      }
    }
    watch(max, (m, old) => {
      if (props.stickToBottom && offset.value >= (old ?? 0) - 1) offset.value = m
      else if (offset.value > m) offset.value = m
    })
    const focus = useFocus({
      disabled: () => !props.focusable || max.value === 0,
      onKey(e) {
        const page = Math.max(1, viewH.value - 1)
        if (matchKey(e, 'up|k')) scrollTo(offset.value - 1)
        else if (matchKey(e, 'down|j')) scrollTo(offset.value + 1)
        else if (matchKey(e, 'pageup|ctrl+u')) scrollTo(offset.value - page)
        else if (matchKey(e, 'pagedown|ctrl+d|space')) scrollTo(offset.value + page)
        else if (matchKey(e, 'home|g')) scrollTo(0)
        else if (matchKey(e, 'end|shift+g')) scrollTo(max.value)
        else return
        e.stopPropagation()
      },
    })
    expose({ scrollTo, scrollToBottom: () => scrollTo(max.value), offset })
    return () => {
      const showBar = props.scrollbar && max.value > 0
      return h(
        'tui-box',
        {
          ref: focus.el,
          flexDirection: 'row',
          flexGrow: 1,
          flexShrink: 1,
          minHeight: 0,
          borderColor: focus.isFocused.value ? 'focus' : undefined,
          onWheel: (e: { direction: string; stopPropagation(): void }) => {
            if (max.value === 0) return
            e.stopPropagation()
            scrollTo(offset.value + (e.direction === 'up' ? -props.step : props.step))
          },
        },
        [
          h(
            'tui-box',
            {
              flexDirection: 'column',
              flexGrow: 1,
              flexShrink: 1,
              overflow: 'hidden',
              scrollTop: offset.value,
              onLayout: (l: LayoutInfo) => (viewport.value = l),
            },
            [h('tui-box', { flexDirection: 'column', flexShrink: 0 }, slots.default?.())],
          ),
          showBar
            ? h(ScrollbarTrack, { total: contentH.value, visible: viewH.value, offset: offset.value, height: viewH.value })
            : null,
        ],
      )
    }
  },
})

/**
 * Tab bar + content. Content comes from a slot named after the tab value or
 * the default slot (receiving `{ active }`).
 *   <Tabs v-model="tab" :tabs="['Overview', 'Logs']">
 *     <template #Overview>…</template>
 *   </Tabs>
 */
export const Tabs = defineComponent({
  name: 'Tabs',
  props: {
    tabs: { type: Array as PropType<unknown[]>, required: true },
    modelValue: { type: null as unknown as PropType<unknown>, default: undefined },
    autoFocus: Boolean,
  },
  emits: ['update:modelValue', 'change'],
  setup(props, { emit, slots }) {
    const opts = computed(() => normalizeOptions(props.tabs))
    const internal = ref<unknown>(props.modelValue ?? opts.value[0]?.value)
    const current = computed(() => props.modelValue ?? internal.value)
    const select = (v: unknown) => {
      internal.value = v
      emit('update:modelValue', v)
      emit('change', v)
    }
    const step = (d: number) => {
      const i = opts.value.findIndex((o) => o.value === current.value)
      const n = opts.value.length
      select(opts.value[(i + d + n) % n].value)
    }
    const focus = useFocus({
      autoFocus: props.autoFocus,
      onKey(e) {
        if (matchKey(e, 'left|h')) step(-1)
        else if (matchKey(e, 'right|l')) step(1)
        else if (/^[1-9]$/.test(e.name) && !e.ctrl && !e.meta && +e.name <= opts.value.length) select(opts.value[+e.name - 1].value)
        else return
        e.stopPropagation()
      },
    })
    return () => {
      const active = focus.isFocused.value
      const bar = h(
        'tui-box',
        { ref: focus.el, flexDirection: 'row', flexShrink: 0, gap: 0, border: 'single', borderTop: false, borderLeft: false, borderRight: false, borderColor: active ? 'focus' : 'border' },
        opts.value.map((o, i) => {
          const sel = o.value === current.value
          return h(
            'tui-text',
            {
              key: i,
              wrap: 'none',
              bold: sel,
              color: sel ? (active ? 'focus' : 'primary') : 'muted',
              bg: sel ? 'selection' : undefined,
              onClick: () => select(o.value),
            },
            ` ${o.label} `,
          )
        }),
      )
      const key = String(current.value)
      const content = slots[key]?.() ?? slots.default?.({ active: current.value })
      return h('tui-box', { flexDirection: 'column', flexGrow: 1, flexShrink: 1 }, [
        bar,
        h('tui-box', { flexDirection: 'column', flexGrow: 1, flexShrink: 1, paddingTop: 1 }, content),
      ])
    }
  },
})

/**
 * Modal dialog rendered on top of everything (teleported to the root).
 *   <Dialog v-model:open="show" title="Confirm">…<template #footer>…</template></Dialog>
 * Focus is trapped inside while open; Escape closes.
 */
export const Dialog = defineComponent({
  name: 'Dialog',
  props: {
    open: Boolean,
    title: String,
    width: { type: [Number, String], default: 50 },
    height: { type: [Number, String], default: undefined },
    closeOnEscape: { type: Boolean, default: true },
    closeOnClickOutside: { type: Boolean, default: true },
    backdrop: { type: Boolean, default: true },
    /** Block global key handlers while open. */
    modal: { type: Boolean, default: true },
    border: { type: String, default: 'round' },
  },
  emits: ['update:open', 'close'],
  setup(props, { emit, slots }) {
    const ctx = useAppContext()
    const panel = shallowRef<TElement | null>(null)
    const overlay = shallowRef<TElement | null>(null)
    let releaseTrap: (() => void) | null = null
    let previous: FocusEntry | null = null
    const close = () => {
      emit('update:open', false)
      emit('close')
    }
    watch(
      () => props.open,
      (open) => {
        if (open) {
          previous = ctx.focus.current.value
          releaseTrap = ctx.focus.pushTrap(() => panel.value)
        } else if (releaseTrap) {
          releaseTrap()
          releaseTrap = null
          const prev = previous
          previous = null
          nextTick(() => queueMicrotask(() => prev && ctx.focus.isEligible(prev) && ctx.focus.focus(prev)))
        }
      },
      { immediate: true, flush: 'post' },
    )
    onBeforeUnmount(() => releaseTrap?.())
    useInput(
      (e) => {
        if (props.closeOnEscape && matchKey(e, 'escape')) close()
        if (props.modal) e.stopPropagation()
      },
      { isActive: () => props.open, priority: 100 },
    )
    return () => {
      if (!props.open) return null
      return h(Teleport, { to: ctx.root }, [
        h(
          'tui-box',
          {
            ref: overlay,
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            zIndex: 100,
            alignItems: 'center',
            justifyContent: 'center',
            backdrop: props.backdrop,
            onClick: (e: { target: TElement | null }) => {
              if (props.closeOnClickOutside && e.target === overlay.value) close()
            },
          },
          [
            h(
              'tui-box',
              {
                ref: panel,
                border: props.border,
                borderColor: 'focus',
                bg: 'surface',
                title: props.title,
                width: props.width,
                height: props.height,
                maxWidth: '100%',
                maxHeight: '100%',
                flexDirection: 'column',
                paddingX: 2,
                paddingY: 1,
                gap: 1,
              },
              [
                h('tui-box', { flexDirection: 'column', flexShrink: 1 }, slots.default?.()),
                slots.footer ? h('tui-box', { flexDirection: 'row', justifyContent: 'flex-end', gap: 1, flexShrink: 0 }, slots.footer()) : null,
              ],
            ),
          ],
        ),
      ])
    }
  },
})

export interface Command {
  id?: string
  label: string
  /** Shortcut hint, also bound globally when `bindShortcuts` is set. */
  key?: string
  group?: string
  description?: string
  action: () => void
}

function fuzzyScore(query: string, text: string): number {
  if (!query) return 1
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (t.includes(q)) return 100 - t.indexOf(q)
  let qi = 0
  let score = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      qi++
      score++
    }
  }
  return qi === q.length ? score : -1
}

/**
 * Searchable command list, opened with ctrl+k (configurable).
 *   <CommandPalette :commands="[{ label: 'Toggle theme', key: 't', action: toggle }]" />
 */
export const CommandPalette = defineComponent({
  name: 'CommandPalette',
  props: {
    commands: { type: Array as PropType<Command[]>, required: true },
    open: { type: Boolean, default: undefined },
    hotkey: { type: String, default: 'ctrl+k|ctrl+p' },
    placeholder: { type: String, default: 'Type a command…' },
    /** Also bind each command's `key` as a global shortcut. */
    bindShortcuts: { type: Boolean, default: false },
  },
  emits: ['update:open'],
  setup(props, { emit }) {
    const internalOpen = ref(false)
    const isOpen = computed(() => props.open ?? internalOpen.value)
    const setOpen = (v: boolean) => {
      internalOpen.value = v
      emit('update:open', v)
    }
    const query = ref('')
    const index = ref(0)
    const filtered = computed(() =>
      props.commands
        .map((c) => ({ c, s: fuzzyScore(query.value, `${c.group ?? ''} ${c.label}`) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.c),
    )
    watch(query, () => (index.value = 0))
    const run = (c: Command | undefined) => {
      if (!c) return
      setOpen(false)
      query.value = ''
      nextTick(() => c.action())
    }
    useInput((e) => {
      if (!isOpen.value && matchKey(e, props.hotkey)) {
        e.stopPropagation()
        query.value = ''
        index.value = 0
        setOpen(true)
        return
      }
      if (!isOpen.value && props.bindShortcuts) {
        const c = props.commands.find((c) => c.key && matchKey(e, c.key))
        if (c) {
          e.stopPropagation()
          c.action()
        }
      }
    })
    useInput(
      (e) => {
        const n = filtered.value.length
        if (matchKey(e, 'up|ctrl+p')) index.value = (index.value - 1 + n) % Math.max(1, n)
        else if (matchKey(e, 'down|ctrl+n')) index.value = (index.value + 1) % Math.max(1, n)
        else return
        e.stopPropagation()
      },
      { isActive: () => isOpen.value, priority: 200 },
    )
    return () =>
      h(
        Dialog,
        {
          open: isOpen.value,
          'onUpdate:open': setOpen,
          width: 60,
          title: 'Commands',
        },
        {
          default: () => [
            h(TextInput, {
              modelValue: query.value,
              'onUpdate:modelValue': (v: string) => (query.value = v),
              placeholder: props.placeholder,
              autoFocus: true,
              onSubmit: () => run(filtered.value[index.value]),
            }),
            h(
              List,
              {
                items: filtered.value.map((c) => ({ label: (c.group ? `${c.group}: ` : '') + c.label, value: c, description: c.key ? formatKey(c.key) : c.description })),
                modelValue: index.value,
                height: Math.min(10, Math.max(1, filtered.value.length)),
                disabled: true,
                onSelect: (_: unknown, i: number) => run(filtered.value[i]),
              },
            ),
            filtered.value.length ? null : h('tui-text', { color: 'muted' }, 'No matching commands'),
          ],
        },
      )
  },
})

/** Built-in overlay (toggle with F12): frame stats, focus and captured console output. */
export const DevTools = defineComponent({
  name: 'DevTools',
  setup() {
    const ctx = useAppContext()
    const tick = useTicker(250)
    return () => {
      if (!ctx.devtools.value) return null
      void tick.value
      const st = ctx.stats
      let nodes = 0
      for (const _ of ctx.root.walk()) nodes++
      const logs = ctx.logs.slice(-200)
      const lines: VNodeChild[] = logs.map((l, i) =>
        h('tui-text', { key: i, color: l.level === 'error' ? 'error' : l.level === 'warn' ? 'warning' : 'text', wrap: 'wrap' }, l.message),
      )
      return h(Teleport, { to: ctx.root }, [
        h(
          'tui-box',
          {
            position: 'absolute',
            top: 0,
            right: 0,
            width: Math.min(56, ctx.size.columns),
            height: '100%',
            zIndex: 1000,
            bg: 'surface',
            border: 'round',
            borderColor: 'accent',
            title: 'vurses devtools · F12',
            flexDirection: 'column',
            paddingX: 1,
          },
          [
            h('tui-text', { wrap: 'none' }, [
              h('tui-text', { color: 'muted' }, 'fps '),
              h('tui-text', { color: 'success', bold: true }, String(st.fps)),
              h('tui-text', { color: 'muted' }, '  frame '),
              h('tui-text', { bold: true }, `${st.lastFrameMs.toFixed(2)}ms`),
              h('tui-text', { color: 'muted' }, '  bytes '),
              h('tui-text', { bold: true }, String(st.lastFrameBytes)),
            ]),
            h('tui-text', { wrap: 'none' }, [
              h('tui-text', { color: 'muted' }, 'frames '),
              String(st.frames),
              h('tui-text', { color: 'muted' }, '  nodes '),
              String(nodes),
              h('tui-text', { color: 'muted' }, '  size '),
              `${ctx.size.columns}×${ctx.size.rows}`,
            ]),
            h('tui-text', { wrap: 'truncate' }, [
              h('tui-text', { color: 'muted' }, 'focus '),
              String(ctx.focus.activeId.value ?? '—'),
              h('tui-text', { color: 'muted' }, '  theme '),
              ctx.theme.value.name,
            ]),
            h('tui-box', { border: 'single', borderLeft: false, borderRight: false, borderBottom: false, height: 1, title: `console (${ctx.logs.length})`, flexShrink: 0 }),
            h(ScrollBox, { stickToBottom: true, focusable: false }, () => (lines.length ? lines : [h('tui-text', { color: 'muted' }, 'console output appears here')])),
          ],
        ),
      ])
    }
  },
})
