<template>
  <Box class="flex-col gap-1">
    <Text bold>About</Text>
    <Text>
      This demo is a plain directory of <Text color="accent">.vue</Text> files. Run it with
      <Text color="primary">vuecli run examples/router-app</Text>.
    </Text>
    <Text color="muted">Every navigation runs middleware, resolves layouts and updates the window title.</Text>
    <Link href="/">← Home</Link>
  </Box>
</template>

<script lang="ts">
export const metadata = { title: 'About' }
</script>
