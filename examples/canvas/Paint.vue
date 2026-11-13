<template>
  <Box class="grow gap-1">
    <Box class="flex-col" border="round" title="paint" :width="22" :padding-x="1">
      <Text color="muted">tool</Text>
      <RadioGroup v-model="tool" :options="tools" />
      <Text color="muted">color</Text>
      <Box :height="2"><Canvas :focusable="false" @ready="onSwatchesReady" @resize="drawSwatches" @pointer="pickColor" /></Box>
      <Text color="muted">size {{ size }}px (wheel)</Text>
      <RadioGroup v-model="size" horizontal :options="[1, 2, 4, 8]" />
      <Spacer />
      <Box class="gap-1">
        <Button label="clear" variant="danger" @click="clear" />
        <Button label="save" @click="save" />
      </Box>
    </Box>
    <Box class="grow" border="round" title="left: draw · right: erase">
      <Canvas :mode="mode" @ready="onReady" @resize="onResize" @pointer="onPointer" />
    </Box>
  </Box>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CanvasPointerEvent, CanvasMode } from 'vurses'
import type { Canvas as PixelCanvas, CanvasRenderingContext2D, ImageData } from 'tty-canvas'

defineProps<{ mode: CanvasMode }>()
const emit = defineEmits<{ status: [text: string] }>()

const PAPER = '#14161f'
const palette = ['#ff5c57', '#ffb86c', '#f3f99d', '#5af78e', '#9aedfe', '#57c7ff', '#ff6ac1', '#f1f1f0']
const tools = ['brush', 'line', 'rect', 'ellipse', 'spray']
const color = ref(palette[0])
const tool = ref('brush')
const size = ref(2)

let canvas: PixelCanvas
let ctx: CanvasRenderingContext2D
let start: { x: number; y: number } | null = null
let last: { x: number; y: number } | null = null
let snapshot: ImageData | null = null
let erasing = false

function onReady(c: PixelCanvas, context: CanvasRenderingContext2D) {
  canvas = c
  ctx = context
  clear()
  // a little welcome drawing
  ctx.font = 'bold 12px sans-serif'
  ctx.fillStyle = '#6272a4'
  ctx.fillText('draw with the mouse', 6, 16)
}

function clear() {
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, canvas.width, canvas.height)
}

function onResize() {
  // the canvas keeps its pixels when it grows; paint the new area
  ctx.globalCompositeOperation = 'destination-over'
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.globalCompositeOperation = 'source-over'
}

function ink() {
  return erasing ? PAPER : color.value
}

function shape(a: { x: number; y: number }, b: { x: number; y: number }) {
  ctx.strokeStyle = ink()
  ctx.lineWidth = size.value
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  if (tool.value === 'line') {
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
  } else if (tool.value === 'rect') {
    ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
  } else if (tool.value === 'ellipse') {
    ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2)
  }
  ctx.stroke()
}

function spray(p: { x: number; y: number }) {
  ctx.fillStyle = ink()
  const r = size.value * 3
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2
    const d = Math.random() * r
    ctx.fillRect(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 1, 1)
  }
}

function stroke(a: { x: number; y: number }, b: { x: number; y: number }) {
  ctx.strokeStyle = ink()
  ctx.lineWidth = size.value
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
}

function onPointer(e: CanvasPointerEvent) {
  const p = { x: e.x, y: e.y }
  emit('status', `${Math.floor(e.x)},${Math.floor(e.y)} px · ${tool.value} ${size.value}px${erasing && last ? ' · erasing' : ''}`)
  if (e.type === 'down') {
    erasing = e.button === 'right'
    start = last = p
    snapshot = tool.value === 'brush' || tool.value === 'spray' ? null : ctx.getImageData(0, 0, canvas.width, canvas.height)
    if (tool.value === 'brush') stroke(p, p)
    if (tool.value === 'spray') spray(p)
  } else if (e.type === 'move') {
    if (!last || e.button === 'none') {
      last = null
      return
    }
    if (tool.value === 'brush') stroke(last, p)
    else if (tool.value === 'spray') spray(p)
    else {
      ctx.putImageData(snapshot!, 0, 0)
      shape(start!, p)
    }
    last = p
  } else if (e.type === 'up') {
    last = null
    snapshot = null
  } else if (e.type === 'wheel') {
    size.value = Math.max(1, Math.min(16, size.value + (e.direction === 'up' ? 1 : -1)))
  }
}

// the color picker is a tiny canvas too
let swatches: CanvasRenderingContext2D | null = null
function drawSwatches() {
  const c = swatches!.canvas
  const w = c.width / palette.length
  palette.forEach((col, i) => {
    swatches!.fillStyle = col
    swatches!.fillRect(Math.round(i * w), 0, Math.ceil(w), c.height)
    if (col === color.value) {
      swatches!.strokeStyle = '#000'
      swatches!.lineWidth = 1
      swatches!.strokeRect(Math.round(i * w) + 0.5, 0.5, Math.ceil(w) - 1, c.height - 1)
    }
  })
}
function onSwatchesReady(_c: PixelCanvas, context: CanvasRenderingContext2D) {
  swatches = context
  drawSwatches()
}
function pickColor(e: CanvasPointerEvent) {
  if (e.type !== 'down') return
  const i = Math.floor((e.x / swatches!.canvas.width) * palette.length)
  color.value = palette[Math.max(0, Math.min(palette.length - 1, i))]
  drawSwatches()
}

function save() {
  const file = resolve('drawing.png')
  writeFileSync(file, canvas.toBuffer())
  emit('status', `saved ${file}`)
}
</script>
