<template>
  <Box class="grow gap-1">
    <Box class="flex-col gap-1" border="round" title="particles" :width="22" :padding-x="1">
      <Checkbox v-model="gravity" label="gravity" />
      <Checkbox v-model="trails" label="trails" />
      <Text color="muted" wrap="wrap">click: burst, drag: attract</Text>
      <Spacer />
      <Button label="burst!" variant="primary" @click="canvas && burst(canvas.width / 2, canvas.height / 3, 200)" />
    </Box>
    <Box class="grow" border="round" title="@frame animation">
      <Canvas :mode="mode" :fps="30" @ready="onReady" @frame="onFrame" @pointer="onPointer" />
    </Box>
  </Box>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { CanvasPointerEvent, CanvasMode } from 'vurses'
import type { Canvas as PixelCanvas, CanvasRenderingContext2D } from 'tty-canvas'

defineProps<{ mode: CanvasMode }>()
const emit = defineEmits<{ status: [text: string] }>()

interface P { x: number; y: number; vx: number; vy: number; life: number; hue: number }
const gravity = ref(true)
const trails = ref(true)
let canvas: PixelCanvas | null = null
const parts: P[] = []
const mouse = { x: -1, y: -1, active: false }

function burst(x: number, y: number, n = 80) {
  const hue = Math.random() * 360
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const v = Math.random() * 60 + 20
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, hue: hue + Math.random() * 40 })
  }
  if (parts.length > 1500) parts.splice(0, parts.length - 1500)
}

function onReady(c: PixelCanvas) {
  canvas = c
  burst(c.width / 2, c.height / 2, 150)
}

let auto = 0
function onFrame(ctx: CanvasRenderingContext2D, dt: number) {
  const c = canvas!
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = trails.value ? 'rgba(8, 10, 20, 0.25)' : '#080a14'
  ctx.fillRect(0, 0, c.width, c.height)
  auto -= dt
  if (auto <= 0) {
    burst(Math.random() * c.width, Math.random() * c.height * 0.6, 60)
    auto = 0.9
  }
  ctx.globalCompositeOperation = 'lighter'
  for (const p of parts) {
    if (mouse.active) {
      const dx = mouse.x - p.x, dy = mouse.y - p.y
      const d2 = dx * dx + dy * dy + 30
      p.vx += (dx / d2) * 900 * dt
      p.vy += (dy / d2) * 900 * dt
    }
    if (gravity.value) p.vy += 30 * dt
    p.vx *= 0.99
    p.vy *= 0.99
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.life -= dt * 0.35
    ctx.fillStyle = `hsla(${p.hue}, 90%, 60%, ${Math.max(0, p.life)})`
    ctx.fillRect(p.x - 0.5, p.y - 0.5, 1.5, 1.5)
  }
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) parts.splice(i, 1)
  ctx.globalCompositeOperation = 'source-over'
  emit('status', `${parts.length} particles · ${Math.round(1 / Math.max(dt, 1e-3))} fps`)
}

function onPointer(e: CanvasPointerEvent) {
  mouse.x = e.x
  mouse.y = e.y
  mouse.active = e.type === 'move' && e.button !== 'none' ? true : e.type === 'down' ? true : e.type === 'up' ? false : mouse.active
  if (e.type === 'down') burst(e.x, e.y)
}
</script>
