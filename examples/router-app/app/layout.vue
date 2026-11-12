<template>
  <Box class="flex-col" :height="size.rows" :width="size.columns">
    <!-- header -->
    <Box class="px-1 shrink-0 gap-1" bg="surface">
      <Text bold color="primary">◆ vuecli</Text>
      <Text color="muted">App Router</Text>
      <Spacer />
      <Text color="accent">{{ meta.title }}</Text>
    </Box>

    <Box class="flex-1">
      <!-- sidebar -->
      <Box class="flex-col w-24 shrink-0" border="round" title="Navigate">
        <NavLink href="/" label="Home" exact />
        <NavLink href="/users" label="Users" hint="[id]" />
        <NavLink href="/docs/getting-started/install" label="Docs" hint="[...]" />
        <NavLink href="/about" label="About" />
        <NavLink href="/crash" label="Error demo" />
        <NavLink href="/terms" label="Terms" hint="(group)" />
        <NavLink href="/nowhere" label="Broken link" color="muted" />
        <Spacer />
        <Text color="muted" wrap="truncate">
          <Text :color="router.canGoBack.value ? 'accent' : 'muted'">◀</Text>
          <Text :color="router.canGoForward.value ? 'accent' : 'muted'"> ▶</Text>
          history
        </Text>
      </Box>

      <!-- page -->
      <Box class="flex-col flex-1 px-1" border="round" :title="pathname">
        <slot />
      </Box>
    </Box>

    <StatusBar>
      <KeyHints
        :keys="[
          { key: 'tab', label: 'focus' },
          { key: 'enter', label: 'open' },
          { key: 'alt+left', label: 'back' },
          { key: 'alt+right', label: 'forward' },
          { key: 'ctrl+c', label: 'quit' },
        ]"
      />
      <template #right>
        <Text color="muted">{{ router.route.href }}</Text>
      </template>
    </StatusBar>
  </Box>
</template>

<script lang="ts">
// Named exports go in a plain <script> block. Child titles are rendered through the template.
export const metadata = { title: { default: 'vuecli router', template: '%s · vuecli router' } }
</script>

<script setup lang="ts">
import { useApp, useMetadata, usePathname, useRouter } from 'vuecli'

const { size } = useApp()
const router = useRouter()
const pathname = usePathname()
const meta = useMetadata()
</script>
