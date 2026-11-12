<template>
  <List :items="services.map((s) => s.name)" v-model="model">
    <template #item="{ index, selected, active }">
      <Text :color="color(services[index].status)">● </Text>
      <Text :bold="selected" :color="selected && active ? 'focus' : undefined" class="flex-1" wrap="truncate">
        {{ services[index].name }}
      </Text>
      <Text color="muted">{{ Math.round(services[index].cpu.at(-1) ?? 0) }}%</Text>
    </template>
  </List>
</template>

<script setup lang="ts">
defineProps<{ services: { name: string; status: string; cpu: number[] }[] }>()
const model = defineModel<number>({ default: 0 })
const color = (s: string) => (s === 'healthy' ? 'success' : s === 'degraded' ? 'warning' : 'error')
</script>
