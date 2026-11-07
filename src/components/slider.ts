import { computed, defineComponent, h, ref, type PropType } from 'vue'
import { useFocus } from '../composables.js'
import { matchKey } from '../input/keys.js'
import { textWidth } from '../render/text.js'
import { useLayout } from './primitives.js'

/**
 * Numeric slider.
 *   <Slider v-model="volume" :min="0" :max="100" :step="5" label="Volume" />
 * Keys: ←/→ (↓/↑) by `step` (shift: ×10), pgup/pgdn by 10% of the range,
 * home/end for min/max. Click or drag the track with the mouse.
 */
export const Slider = defineComponent({
  name: 'Slider',
  props: {
    modelValue: { type: Number, default: 0 },
    min: { type: Number, default: 0 },
    max: { type: Number, default: 100 },
    step: { type: Number, default: 1 },
    label: String,
    showValue: { type: Boolean, default: true },
    /** Format the displayed value. */
    format: { type: Function as PropType<(v: number) => string>, default: undefined },
    vertical: Boolean,
    /** Track length in cells (default: fill the available space; vertical: 8). */
    length: { type: Number, default: undefined },
    color: { type: String, default: 'primary' },
    disabled: Boolean,
    autoFocus: Boolean,
  },
  emits: ['update:modelValue', 'change'],
  setup(props, { emit }) {
    const { layout, onLayout } = useLayout()
    const dragging = ref(false)
    const decimals = computed(() => {
      const s = String(props.step)
      return s.includes('.') ? s.split('.')[1].length : 0
    })
    const clamp = (v: number) => {
      const lo = Math.min(props.min, props.max)
      const hi = Math.max(props.min, props.max)
      const step = props.step > 0 ? props.step : 1
      const snapped = Math.round((v - lo) / step) * step + lo
      return +Math.max(lo, Math.min(hi, snapped)).toFixed(decimals.value)
    }
    const value = computed(() => clamp(props.modelValue))
    const set = (v: number) => {
      if (props.disabled) return
      const c = clamp(v)
      if (c === value.value) return
      emit('update:modelValue', c)
      emit('change', c)
    }
    const focus = useFocus({
      autoFocus: props.autoFocus,
      disabled: () => props.disabled,
      onKey(e) {
        const range = Math.abs(props.max - props.min)
        const step = props.step * (e.shift ? 10 : 1)
        const page = Math.max(props.step, Math.round(range / 10 / props.step) * props.step)
        if (matchKey(e, 'left|down|h|j|shift+left|shift+down')) set(value.value - step)
        else if (matchKey(e, 'right|up|l|k|shift+right|shift+up')) set(value.value + step)
        else if (matchKey(e, 'pagedown')) set(value.value - page)
        else if (matchKey(e, 'pageup')) set(value.value + page)
        else if (matchKey(e, 'home')) set(props.min)
        else if (matchKey(e, 'end')) set(props.max)
        else return
        e.stopPropagation()
      },
    })
    const trackLen = () => {
      if (props.length) return props.length
      const l = layout.value
      if (props.vertical) return Math.max(2, l?.innerHeight ?? 8)
      return Math.max(2, l?.innerWidth ?? 20)
    }
    const fromPointer = (e: { x: number; y: number }) => {
      const l = layout.value
      if (!l) return
      const len = trackLen()
      const pos = props.vertical ? len - 1 - (e.y - l.y) : e.x - l.x
      const t = Math.max(0, Math.min(1, pos / Math.max(1, len - 1)))
      set(props.min + t * (props.max - props.min))
    }
    const display = () => (props.format ? props.format(value.value) : value.value.toFixed(decimals.value))

    return () => {
      const active = focus.isFocused.value || dragging.value
      const len = trackLen()
      const range = props.max - props.min || 1
      const t = Math.max(0, Math.min(1, (value.value - props.min) / range))
      const thumb = Math.round(t * (len - 1))
      const fillColor = props.disabled ? 'muted' : props.color
      const thumbChar = active ? '◆' : '●'
      const thumbColor = props.disabled ? 'muted' : active ? 'focus' : props.color
      let track
      if (props.vertical) {
        const cells = []
        for (let i = len - 1; i >= 0; i--) {
          if (i < len - 1) cells.push('\n')
          if (i === thumb) cells.push(h('tui-text', { color: thumbColor, bold: true }, thumbChar))
          else cells.push(h('tui-text', { color: i < thumb ? fillColor : 'border' }, i < thumb ? '┃' : '│'))
        }
        track = h('tui-text', { wrap: 'none' }, cells)
      } else {
        track = h('tui-text', { wrap: 'none' }, [
          h('tui-text', { color: fillColor }, '━'.repeat(thumb)),
          h('tui-text', { color: thumbColor, bold: true }, thumbChar),
          h('tui-text', { color: 'border' }, '─'.repeat(Math.max(0, len - thumb - 1))),
        ])
      }
      const trackBox = h(
        'tui-box',
        {
          [props.vertical ? 'height' : 'width']: props.length,
          [props.vertical ? 'width' : 'height']: 1,
          flexGrow: props.length ? 0 : 1,
          flexShrink: 1,
          minWidth: props.vertical ? 1 : 2,
          overflow: 'hidden',
          onLayout,
          onMouseDown: (e: { x: number; y: number; button: string }) => {
            if (props.disabled || e.button !== 'left') return
            dragging.value = true
            fromPointer(e)
          },
        },
        [track],
      )
      const label = props.label ? h('tui-text', { wrap: 'none', flexShrink: 0, color: active ? 'focus' : undefined, bold: active }, props.label) : null
      const valueText = props.showValue
        ? h('tui-text', { wrap: 'none', flexShrink: 0, color: 'muted' }, props.vertical ? display() : display().padStart(Math.max(textWidth(String(props.max)), textWidth(String(props.min)))))
        : null
      return h(
        'tui-box',
        {
          ref: focus.el,
          flexDirection: props.vertical ? 'column' : 'row',
          alignItems: props.vertical ? 'center' : undefined,
          gap: props.vertical ? 0 : 1,
          flexShrink: 0,
          flexGrow: props.vertical ? 0 : 1,
          onMouseMove: (e: { action: string; x: number; y: number }) => {
            if (!dragging.value) return
            if (e.action !== 'drag') dragging.value = false
            else fromPointer(e)
          },
          onMouseUp: () => (dragging.value = false),
        },
        props.vertical ? [valueText, trackBox, label] : [label, trackBox, valueText],
      )
    }
  },
})
