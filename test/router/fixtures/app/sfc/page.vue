<script lang="ts">
export const metadata = { title: 'SFC' }
</script>

<script setup lang="ts">
import { ref } from 'vue'
const props = defineProps<{ searchParams?: Record<string, string> }>()
const n = ref(Number(props.searchParams?.n ?? 1))
</script>

<template>
  <Box>
    <Text>SFC page n={{ n * 2 }}</Text>
  </Box>
</template>
