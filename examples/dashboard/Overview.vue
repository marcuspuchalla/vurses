<template>
  <Box class="flex-col gap-1">
    <Box class="gap-1">
      <Text bold color="primary">{{ service.name }}</Text>
      <Badge :color="service.status === 'healthy' ? 'success' : service.status === 'degraded' ? 'warning' : 'error'">
        {{ service.status.toUpperCase() }}
      </Badge>
      <Spinner v-if="service.status !== 'down'" type="dots" color="muted" label="live" />
    </Box>

    <Box class="gap-4">
      <Stat label="CPU" :value="`${cpu.toFixed(1)}%`" :color="cpuColor" />
      <Stat label="Requests/s" :value="rps.toFixed(0)" color="accent" />
      <Stat label="Memory" :value="`${Math.round(service.mem * 100)}%`" />
      <Stat label="Uptime" value="14d 3h" color="muted" />
    </Box>

    <Box class="gap-1">
      <Box class="flex-col flex-1" border="round" title="CPU" :padding-x="1">
        <Sparkline :data="service.cpu" :width="40" :min="0" :max="100" :color="cpuColor" />
      </Box>
      <Box class="flex-col flex-1" border="round" title="Requests/s" :padding-x="1">
        <Sparkline :data="service.rps" :width="40" :min="0" color="accent" />
      </Box>
    </Box>

    <Box class="flex-col" border="round" title="Traffic by region" :padding-x="1">
      <BarChart :data="regions" />
    </Box>

    <Box class="flex-col gap-0">
      <ProgressBar :value="service.mem" show-percent label="Memory " :color="service.mem > 0.85 ? 'error' : 'primary'" />
      <ProgressBar :value="0.62" show-percent label="Disk   " color="accent" />
    </Box>
  </Box>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  service: { name: string; status: string; cpu: number[]; rps: number[]; mem: number }
}>()

const cpu = computed(() => props.service.cpu.at(-1) ?? 0)
const rps = computed(() => props.service.rps.at(-1) ?? 0)
const cpuColor = computed(() => (cpu.value > 80 ? 'error' : cpu.value > 60 ? 'warning' : 'success'))
const regions = computed(() => [
  { label: 'eu-central', value: Math.round(rps.value * 0.46) },
  { label: 'us-east', value: Math.round(rps.value * 0.31) },
  { label: 'ap-south', value: Math.round(rps.value * 0.16), color: 'accent' },
  { label: 'sa-east', value: Math.round(rps.value * 0.07), color: 'warning' },
])
</script>
