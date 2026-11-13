<template>
  <Box class="flex-col gap-1">
    <Text><Text bold color="primary">{{ user!.name }}</Text> <Badge :label="user!.role" color="accent" /></Text>
    <Text color="muted">📍 {{ user!.city }} · id {{ params.id }}</Text>
    <Box class="flex-col">
      <Text color="muted">Commits (10 weeks)</Text>
      <Sparkline :data="user!.commits" :width="30" color="success" />
    </Box>
    <Box class="gap-2">
      <Link v-if="user!.id > 1" :href="`/users/${user!.id - 1}`">← previous</Link>
      <Link v-if="user!.id < 4" :href="`/users/${user!.id + 1}`">next →</Link>
    </Box>
  </Box>
</template>

<script lang="ts">
import { users } from '../data.ts'

// Titles can depend on params.
export function generateMetadata({ params }: { params: { id: string } }) {
  return { title: users.find((u) => String(u.id) === params.id)?.name ?? 'Unknown user' }
}
</script>

<script setup lang="ts">
import { notFound } from 'vurses'
import { fetchUser } from '../data.ts'

const props = defineProps<{ params: { id: string }; searchParams: Record<string, string> }>()

// async setup: the nearest loading.vue is shown until this resolves
const user = await fetchUser(Number(props.params.id))
if (!user) notFound()
</script>
