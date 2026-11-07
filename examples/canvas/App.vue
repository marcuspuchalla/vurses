<script setup lang="ts">
import { ref } from 'vue'
import { fileURLToPath } from 'node:url'
import { useApp, useKeymap, CANVAS_MODES, type CanvasMode } from 'vuecli'
import Paint from './Paint.vue'
import Particles from './Particles.vue'

const { exit, size } = useApp()
const tab = ref<'paint' | 'particles' | 'web page'>('paint')
const mode = ref<CanvasMode>('halfblock')
const status = ref('')
// an unmodified browser canvas demo, rendered by tty-canvas inside the layout
const starfield = fileURLToPath(new URL('./starfield.html', import.meta.url))
const cellModes = CANVAS_MODES.filter((m) => !['kitty', 'sixel', 'iterm2'].includes(m))

useKeymap({ 'ctrl+q|escape': () => exit() })
</script>

<template>
  <Box class="flex-col" :width="size.columns" :height="size.rows">
    <Box class="gap-2" :padding-x="1">
      <Text bold color="primary">tty-canvas × vuecli</Text>
      <RadioGroup v-model="tab" horizontal :options="['paint', 'particles', 'web page']" auto-focus />
    </Box>
    <Box class="gap-1" :padding-x="1">
      <Text color="muted">render mode</Text>
      <RadioGroup v-model="mode" horizontal :options="cellModes" />
    </Box>

    <Paint v-if="tab === 'paint'" :mode="mode" @status="status = $event" />
    <Particles v-else-if="tab === 'particles'" :mode="mode" @status="status = $event" />
    <Box v-else class="grow" border="round" title="starfield.html — plain browser code (mouse steers, wheel / ↑↓ warp)">
      <Canvas :src="starfield" :mode="mode" :fps="30" />
    </Box>

    <Box class="gap-2" :padding-x="1">
      <Text color="muted">tab: focus · arrows/enter: choose · esc: quit</Text>
      <Spacer />
      <Text color="accent">{{ status }}</Text>
    </Box>
  </Box>
</template>
