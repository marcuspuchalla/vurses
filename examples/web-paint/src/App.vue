<template>
  <main class="paint">
    <header class="bar">
      <h1>Paint</h1>
      <div class="group" role="group" aria-label="Tool">
        <button
          v-for="t in tools"
          :key="t.id"
          type="button"
          :class="{ on: tool === t.id && !eraser }"
          @click="pick(t.id)">
          {{ t.label }}
        </button>
        <button type="button" :class="{ on: eraser }" @click="eraser = !eraser">Eraser</button>
      </div>
    </header>

    <div class="bar">
      <div class="group" role="group" aria-label="Color">
        <button
          v-for="c in colors"
          :key="c.value"
          type="button"
          class="swatch"
          :class="{ on: color === c.value && !eraser }"
          :style="{ background: c.value }"
          :aria-label="c.name"
          :title="c.name"
          @click="color = c.value; eraser = false">
          {{ color === c.value && !eraser ? '●' : ' ' }}
        </button>
      </div>
      <div class="group" role="group" aria-label="Brush size">
        <button
          v-for="s in sizes"
          :key="s"
          type="button"
          :class="{ on: size === s }"
          @click="size = s">
          {{ s }}px
        </button>
      </div>
    </div>

    <vue-drawing-canvas
      ref="board"
      class="board"
      :width="624"
      :height="320"
      :stroke-type="tool"
      :eraser="eraser"
      :color="color"
      :line-width="size"
      line-cap="round"
      line-join="round"
      background-color="#fffdf7" />

    <footer class="bar">
      <div class="group">
        <button type="button" @click="board.undo()">Undo</button>
        <button type="button" @click="board.redo()">Redo</button>
        <button type="button" @click="board.reset()">Clear</button>
      </div>
      <p class="hint">Drag on the canvas to draw.</p>
    </footer>
  </main>
</template>

<script setup>
import { ref } from 'vue'
import VueDrawingCanvas from 'vue-drawing-canvas'

const board = ref(null)
const tool = ref('dash')
const eraser = ref(false)
const color = ref('#e4572e')
const size = ref(12)

const tools = [
  { id: 'dash', label: 'Brush' },
  { id: 'line', label: 'Line' },
  { id: 'square', label: 'Box' },
  { id: 'circle', label: 'Circle' },
]
const colors = [
  { name: 'Tomato', value: '#e4572e' },
  { name: 'Sun', value: '#f3a712' },
  { name: 'Leaf', value: '#29bf12' },
  { name: 'Sea', value: '#2e86de' },
  { name: 'Plum', value: '#8e44ad' },
  { name: 'Ink', value: '#1e272e' },
]
const sizes = [3, 6, 12, 24]

function pick(id) {
  tool.value = id
  eraser.value = false
}
</script>
