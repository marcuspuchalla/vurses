import { Fragment, defineComponent, h, onErrorCaptured, ref, shallowRef, watch, type PropType } from 'vue'
import { Button } from './inputs.js'

export interface ErrorBoundaryInfo {
  error: unknown
  /** Vue's error source description (e.g. 'render function', 'setup function'). */
  info: string
  /** Clears the error and re-mounts the default slot. */
  reset: () => void
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Catches errors thrown by descendants (setup, render, lifecycle hooks,
 * watchers, event handlers) and renders a fallback instead.
 *   <ErrorBoundary>
 *     <RiskyWidget />
 *     <template #fallback="{ error, reset }">
 *       <Text color="error">{{ error.message }}</Text> <Button label="Retry" @click="reset" />
 *     </template>
 *   </ErrorBoundary>
 * Without a fallback slot a red panel with a Retry button is shown.
 * `reset-keys`: the boundary resets automatically when any of these values change.
 */
export const ErrorBoundary = defineComponent({
  name: 'ErrorBoundary',
  props: {
    title: { type: String, default: 'Something went wrong' },
    /** Show the first lines of the stack trace in the default fallback. */
    showStack: Boolean,
    /** Let the error continue to propagate to parent boundaries / app error handler. */
    propagate: Boolean,
    resetKeys: { type: Array as PropType<unknown[]>, default: undefined },
  },
  emits: ['error', 'reset'],
  setup(props, { slots, emit, expose }) {
    const error = shallowRef<unknown>(null)
    const info = ref('')
    const failed = ref(false)
    const generation = ref(0)
    onErrorCaptured((err, _instance, where) => {
      error.value = err
      info.value = where
      failed.value = true
      emit('error', err, where)
      return props.propagate ? undefined : false
    })
    const reset = () => {
      error.value = null
      info.value = ''
      failed.value = false
      generation.value++
      emit('reset')
    }
    watch(
      () => props.resetKeys,
      (a, b) => {
        if (failed.value && a && b && (a.length !== b.length || a.some((v, i) => !Object.is(v, b[i])))) reset()
      },
    )
    expose({ reset, error })
    return () => {
      if (!failed.value) return h(Fragment, { key: generation.value }, slots.default?.() ?? [])
      const payload: ErrorBoundaryInfo = { error: error.value, info: info.value, reset }
      if (slots.fallback) return h(Fragment, { key: `fallback-${generation.value}` }, slots.fallback(payload))
      const stack = props.showStack && error.value instanceof Error && error.value.stack ? error.value.stack.split('\n').slice(1, 6).map((l) => l.trim()) : []
      return h(
        'tui-box',
        { key: `fallback-${generation.value}`, border: 'round', borderColor: 'error', title: props.title, titleColor: 'error', flexDirection: 'column', paddingX: 1, flexShrink: 0 },
        [
          h('tui-text', { color: 'error', bold: true, wrap: 'wrap' }, messageOf(error.value)),
          info.value ? h('tui-text', { color: 'muted', wrap: 'truncate' }, `in ${info.value}`) : null,
          ...stack.map((l, i) => h('tui-text', { key: i, color: 'muted', dim: true, wrap: 'truncate' }, l)),
          h('tui-box', { flexDirection: 'row', marginTop: 1 }, [h(Button, { label: 'Retry', variant: 'danger', border: false, onClick: reset })]),
        ],
      )
    }
  },
})
