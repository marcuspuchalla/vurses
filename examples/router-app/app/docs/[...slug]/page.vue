<template>
  <Box class="flex-col gap-1">
    <Text bold>Catch-all route <Text color="accent">app/docs/[...slug]</Text></Text>
    <Text>params.slug = <Text color="primary">{{ JSON.stringify(params.slug) }}</Text></Text>
    <Box class="gap-2">
      <Link href="/docs/getting-started/install">install</Link>
      <Link href="/docs/guides/routing/layouts">guides/routing/layouts</Link>
      <Link href="/docs/api">api</Link>
    </Box>
  </Box>
</template>

<script lang="ts">
export function generateMetadata({ params }: { params: { slug: string[] } }) {
  return { title: `Docs: ${params.slug.join(' / ')}` }
}
</script>

<script setup lang="ts">
defineProps<{ params: { slug: string[] } }>()
</script>
