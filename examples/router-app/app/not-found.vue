<script setup lang="ts">
import { usePathname, useRouter } from 'vuecli'
const pathname = usePathname()
const router = useRouter()
</script>

<template>
  <Box class="flex-col gap-1 p-1">
    <Text><Text bold color="warning">404</Text> <Text color="muted">│</Text> Nothing lives at <Text color="accent">{{ pathname }}</Text></Text>
    <Box class="gap-1">
      <Button label="Go back" @click="router.back()" />
      <Button label="Home" variant="primary" @click="router.push('/')" />
    </Box>
  </Box>
</template>
