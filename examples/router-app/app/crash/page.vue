<script lang="ts">
export const metadata = { title: 'Error demo' }
</script>

<script setup lang="ts">
import { ref } from 'vue'

const broken = ref(false)

// A child that throws while rendering: caught by app/crash/error.vue.
const Bomb = () => {
  throw new Error('The flux capacitor overheated')
}
</script>

<template>
  <Box class="flex-col gap-1">
    <Text bold>Error boundary demo</Text>
    <Text color="muted">Press the button: the page throws, error.vue renders with a reset() button.</Text>
    <Box><Button label="Break it" variant="danger" @click="broken = true" /></Box>
    <Bomb v-if="broken" />
  </Box>
</template>
