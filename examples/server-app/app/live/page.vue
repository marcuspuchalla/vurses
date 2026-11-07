<script lang="ts">
// Rendered on the server: one headless vuecli runtime per browser session,
// frames stream over SSE as row deltas, keys come back via POST.
export const runtime = 'server'
export const metadata = { title: 'Live' }
</script>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useInput, useInterval } from 'vuecli'
import { getQuotes, type Quote } from '../../lib/quotes.ts'

const quotes = ref<Quote[]>([])
const history = ref<number[]>([])
const fetchedAt = ref(0)
const upstreamCalls = ref(0)
const now = ref(new Date())
const started = Date.now()
const typed = ref('')

async function refresh() {
  const r = await getQuotes()
  quotes.value = r.quotes
  fetchedAt.value = r.fetchedAt
  upstreamCalls.value = r.fetches
  history.value = [...history.value, r.quotes[0].price].slice(-40)
}
// async setup: the route's Suspense boundary (and the prerendered shell) waits for the first data
await refresh()
useInterval(() => {
  now.value = new Date()
  void refresh()
}, 500)

useInput((e) => {
  if (e.name === 'backspace') typed.value = typed.value.slice(0, -1)
  else if (e.char && !e.ctrl && !e.meta) typed.value = (typed.value + e.char).slice(-40)
})

const uptime = computed(() => Math.floor((now.value.getTime() - started) / 1000))
const rows = computed(() => quotes.value.map((q) => ({ symbol: q.symbol, price: q.price.toFixed(2), change: `${q.change >= 0 ? '▲' : '▼'} ${q.change.toFixed(2)}%` })))
</script>

<template>
  <Box class="flex-col gap-1">
    <Box class="gap-2">
      <Stat label="server time" :value="now.toLocaleTimeString('en-GB')" color="accent" />
      <Stat label="session uptime" :value="`${uptime}s`" />
      <Stat label="upstream calls" :value="upstreamCalls" />
    </Box>
    <Box class="gap-2">
      <Table :rows="rows" :columns="['symbol', 'price', 'change']" title="quotes · cache()" />
      <Box class="flex-col" border="round" title="VUE" :width="44">
        <Sparkline :data="history" :width="40" color="primary" />
        <Text color="muted">fetched {{ new Date(fetchedAt).toLocaleTimeString('en-GB') }}</Text>
      </Box>
    </Box>
    <Box class="gap-1">
      <Text color="muted">type here →</Text>
      <Text bold color="primary">{{ typed }}▏</Text>
    </Box>
  </Box>
</template>
