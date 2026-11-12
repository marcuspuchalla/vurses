<template>
  <Box class="flex-1">
    <Box class="flex-col w-18 shrink-0 pr-1">
      <Text bold color="muted">USERS</Text>
      <NavLink v-for="u in users" :key="u.id" :href="`/users/${u.id}`" :label="u.name" />
      <NavLink href="/users/99" label="Ghost (404)" color="muted" />
    </Box>
    <Divider vertical />
    <Box class="flex-col flex-1 pl-1">
      <!-- the child segment: users/page.vue or users/[id]/page.vue -->
      <Outlet />
    </Box>
  </Box>
</template>

<script lang="ts">
export const metadata = { title: { default: 'Users', template: '%s · Users · vuecli router' } }
</script>

<script setup lang="ts">
import { users } from './data.ts'
</script>
