<template>
  <Box class="flex-col gap-1" border="round" border-color="error" title="app/crash/error.vue" :padding-x="1">
    <Text color="error" bold>Something went wrong: {{ error.message }}</Text>
    <Text color="muted">The layout around this segment kept working. Reset re-mounts the page.</Text>
    <Box><Button label="Try again" variant="primary" auto-focus @click="reset()" /></Box>
  </Box>
</template>

<script setup lang="ts">
defineProps<{ error: Error; reset: () => void }>()
</script>
