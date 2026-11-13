<template>
  <Box class="flex-col" :height="size.rows" :width="size.columns">
    <Box class="px-1 shrink-0 gap-1" bg="surface">
      <Text bold color="primary">◆ vurses</Text>
      <Text color="muted">server app</Text>
      <Spacer />
      <Text color="accent">{{ meta.title }}</Text>
    </Box>
    <Box class="flex-1">
      <Box class="flex-col w-22 shrink-0" border="round" title="Routes">
        <NavLink href="/" label="Home" hint="client" exact />
        <NavLink href="/live" label="Live" hint="server" />
        <NavLink href="/stats" label="Stats" hint="ISR" />
      </Box>
      <Box class="flex-col flex-1 px-1" border="round" :title="pathname">
        <slot />
      </Box>
    </Box>
    <StatusBar>
      <KeyHints :keys="[{ key: 'tab', label: 'focus' }, { key: 'enter', label: 'open' }, { key: 'alt+left', label: 'back' }]" />
    </StatusBar>
  </Box>
</template>

<script lang="ts">
export const metadata = { title: { default: 'vurses server app', template: '%s · vurses server app' } }
</script>

<script setup lang="ts">
import { useApp, useMetadata, usePathname } from 'vurses'

const { size } = useApp()
const pathname = usePathname()
const meta = useMetadata()
</script>
