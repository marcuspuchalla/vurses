<template>
  <Box class="flex-col gap-1">
    <Text bold>Pick a user</Text>
    <Text color="muted">The list on the left is a nested layout (app/users/layout.vue).</Text>
    <Text color="muted">Opening a user awaits a fake fetch inside an async setup(),</Text>
    <Text color="muted">so app/users/loading.vue is shown in the meantime.</Text>
  </Box>
</template>

<script lang="ts">
export const metadata = { title: 'Users' }
</script>
