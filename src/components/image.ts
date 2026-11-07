/**
 * `<Image>` — shows a PNG image in the terminal.
 *
 *   <Image src="./logo.png" :width="40" />                  <!-- 40 columns, height from the aspect ratio -->
 *   <Image src="./photo.png" class="flex-grow" fit="cover" mode="sextant" />
 *
 * `width` / `height` are in cells. Without them the image takes its natural
 * size (one pixel per half cell in halfblock mode). Pixel protocols (`kitty`,
 * `sixel`, `iterm2`) show the real image and paint cells as a fallback.
 */
import { defineComponent, h, markRaw, onBeforeUnmount, ref, shallowRef, watch, type PropType } from 'vue'
import {
  encodeCells, encodeIterm2, encodeKitty, encodeSixel, fitCells, kittyDelete, loadImage, MODE_RESOLUTION, toRgbNumber,
  type CellMode, type EncodedCells, type ImageSource,
} from 'tty-canvas'
import { useApp, useTheme } from '../composables.js'
import type { CellPainter } from '../render/paint.js'
import type { CanvasMode } from './canvas.js'

export type ImageFit = 'contain' | 'cover' | 'fill' | 'none'

interface Pixels {
  width: number
  height: number
  data: Uint8ClampedArray
}

/** Crops pixels to a rectangle. */
function crop(src: Pixels, sx: number, sy: number, sw: number, sh: number): Pixels {
  const data = new Uint8ClampedArray(sw * sh * 4)
  for (let y = 0; y < sh; y++) data.set(src.data.subarray(((sy + y) * src.width + sx) * 4, ((sy + y) * src.width + sx + sw) * 4), y * sw * 4)
  return { width: sw, height: sh, data }
}

let imageIds = 0

export const Image = defineComponent({
  name: 'Image',
  props: {
    /** File path, file:/http(s):/data: URL, or encoded PNG bytes. */
    src: { type: [String, Object] as PropType<ImageSource>, required: true },
    /** Width in cells. */
    width: Number,
    /** Height in cells. */
    height: Number,
    mode: { type: String as PropType<CanvasMode>, default: 'halfblock' },
    fit: { type: String as PropType<ImageFit>, default: 'contain' },
    /** Color behind transparent pixels (CSS color). Defaults to the theme background. */
    background: String,
    /** Text shown while loading / if the image fails to load. */
    alt: { type: String, default: '' },
  },
  emits: ['load', 'error'],
  setup(props, { emit, expose }) {
    const app = useApp()
    const theme = useTheme()
    const id = ++imageIds
    const kittyId = 0x7d000000 + id
    const pixels = shallowRef<Pixels | null>(null)
    const failed = ref<string | null>(null)
    let token = 0
    let disposed = false

    const load = async () => {
      const t = ++token
      failed.value = null
      try {
        const img = await loadImage(props.src)
        if (t !== token || disposed) return
        pixels.value = markRaw({ width: img.width, height: img.height, data: img.data! })
        emit('load', { width: img.width, height: img.height })
      } catch (err) {
        if (t !== token || disposed) return
        pixels.value = null
        failed.value = (err as Error)?.message ?? String(err)
        emit('error', err)
      }
      app.requestRender()
    }
    watch(() => props.src, load, { immediate: true })
    onBeforeUnmount(() => (disposed = true))

    const cellMode = (): CellMode => (props.mode in MODE_RESOLUTION ? (props.mode as CellMode) : 'halfblock')
    const backgroundColor = (): number | null => {
      if (props.background) return toRgbNumber(props.background)
      let bg: string | undefined = theme.value.background
      for (let i = 0; i < 4 && bg && theme.value[bg] !== undefined; i++) bg = theme.value[bg]
      return bg ? toRgbNumber(bg) : null
    }

    let cache: { key: string; cells: EncodedCells; box: { x: number; y: number }; graphic: string | null } | null = null

    const paintCells = (p: CellPainter) => {
      const img = pixels.value
      if (!img) {
        const msg = failed.value ? `${props.alt || 'image'}: ${failed.value}` : props.alt
        if (msg) p.text(0, 0, msg.slice(0, p.width), failed.value ? 'error' : 'muted')
        return
      }
      if (p.width <= 0 || p.height <= 0) return
      const mode = cellMode()
      const bg = backgroundColor()
      const key = `${p.width}x${p.height}|${props.fit}|${props.mode}|${bg}`
      if (!cache || cache.key !== key) {
        let src: Pixels = img
        let box: { x: number; y: number; columns: number; rows: number }
        if (props.fit === 'cover') {
          // crop the image to the box' aspect ratio (cells are 1:2), then fill
          const boxAspect = p.width / (p.height * 2)
          const imgAspect = img.width / img.height
          if (imgAspect > boxAspect) {
            const sw = Math.max(1, Math.round(img.height * boxAspect))
            src = crop(img, Math.floor((img.width - sw) / 2), 0, sw, img.height)
          } else {
            const sh = Math.max(1, Math.round(img.width / boxAspect))
            src = crop(img, 0, Math.floor((img.height - sh) / 2), img.width, sh)
          }
          box = { x: 0, y: 0, columns: p.width, rows: p.height }
        } else box = fitCells(img.width, img.height, p.width, p.height, props.fit, mode)
        box.columns = Math.min(box.columns, p.width)
        box.rows = Math.min(box.rows, p.height)
        box.x = Math.max(0, box.x)
        box.y = Math.max(0, box.y)
        const cells = encodeCells(src.data, src.width, src.height, { mode, columns: box.columns, rows: box.rows, background: bg })
        let graphic: string | null = null
        if (props.mode === 'kitty') graphic = encodeKitty(src.data, src.width, src.height, { id: kittyId, columns: box.columns, rows: box.rows })
        else if (props.mode === 'iterm2') graphic = encodeIterm2(src.data, src.width, src.height, { columns: box.columns, rows: box.rows, preserveAspectRatio: false })
        else if (props.mode === 'sixel') graphic = encodeSixel(src.data, src.width, src.height, { background: bg })
        cache = { key, cells, box, graphic }
      }
      const { cells, box } = cache
      for (let y = 0; y < cells.rows; y++) {
        for (let x = 0; x < cells.columns; x++) {
          const c = cells.cells[y * cells.columns + x]
          p.set(box.x + x, box.y + y, c.ch, c.fg, c.bg)
        }
      }
      if (cache.graphic) {
        p.graphic({
          key: `tty-image-${id}`, version: token * 65536 + cells.columns * 256 + cells.rows, data: cache.graphic,
          clear: props.mode === 'kitty' ? kittyDelete(kittyId) : undefined,
          x: box.x, y: box.y, width: cells.columns, height: cells.rows,
        })
      }
    }

    watch(pixels, () => (cache = null))
    expose({
      /** Decoded pixels `{ width, height, data }` (null while loading). */
      get pixels() { return pixels.value },
      reload: load,
    })

    return () => {
      const img = pixels.value
      const [cw] = MODE_RESOLUTION[cellMode()]
      // natural size: square pixels, cw pixels per column, 2·cw per row
      let width = props.width
      let height = props.height
      if (img) {
        const natCols = Math.max(1, Math.round(img.width / cw))
        const natRows = Math.max(1, Math.round(img.height / (cw * 2)))
        if (width === undefined && height === undefined) {
          width = natCols
          height = natRows
        } else if (width === undefined) width = Math.max(1, Math.round((height! * natCols) / natRows))
        else if (height === undefined) height = Math.max(1, Math.round((width * natRows) / natCols))
      } else {
        width ??= Math.max(1, props.alt.length)
        height ??= 1
      }
      void failed.value
      return h('tui-box', { width, height, maxWidth: '100%', maxHeight: '100%', flexShrink: 1, paintCells })
    }
  },
})
