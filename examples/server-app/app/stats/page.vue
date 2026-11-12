<template>
  <Box class="flex-col gap-1">
    <Text>render #{{ renderNo }} at {{ renderedAt }}</Text>
    <Text color="muted">The HTML of this page embeds a first frame cached for 10 s (export const revalidate = 10).</Text>
    <ProgressBar :value="0.42" :width="30" show-percent label="cache hit ratio (demo)" />
  </Box>
</template>

<script lang="ts">
// Server-rendered, first frame cached for 10 s (ISR-style): reloading within
// 10 s shows the same render number. POST /api/revalidate?path=/stats refreshes it.
export const runtime = 'server'
export const revalidate = 10
export const metadata = { title: 'Stats' }
</script>

<script lang="ts" setup>
const g = globalThis as { __statsRenders?: number }
g.__statsRenders = (g.__statsRenders ?? 0) + 1
const renderNo = g.__statsRenders
const renderedAt = new Date().toLocaleTimeString('en-GB')
</script>
