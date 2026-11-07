<script lang="ts">
export const metadata = { title: 'Home' }
</script>

<script setup lang="ts">
import { ref } from 'vue'

const count = ref(0)
</script>

<template>
  <Box class="flex-col gap-1">
    <Text bold>This page is a client route: it runs in your browser and renders into the devtools console.</Text>
    <Text color="muted">"/live" and "/stats" are server routes (export const runtime = 'server'): they run on the server and stream row deltas to a tiny frame player.</Text>
    <Box class="gap-1">
      <Button label="-1" @click="count--" />
      <Button label="+1" variant="primary" auto-focus @click="count++" />
      <Text>count = {{ count }}</Text>
    </Box>
    <Text color="muted">Try: curl localhost:3000/api/quotes · curl -H 'accept: text/plain' localhost:3000/live</Text>
  </Box>
</template>
