<template>
  <Box class="flex-col gap-1">
    <Text bold color="primary">Folders in app/ become routes and layouts.</Text>
    <Markdown
      source="- `app/layout.vue` is this frame: header, sidebar and status bar
- `app/users/layout.vue` nests a second layout with a user list
- `app/users/[id]/page.vue` is a dynamic route with an async `setup()`
- `app/users/loading.vue` is shown while it loads
- `app/crash/error.vue` catches errors, `app/not-found.vue` handles 404s
- `middleware.ts` redirects `/home` and `/people/:id`"
    />
    <Box class="gap-2">
      <Link href="/users/2">→ Open user 2</Link>
      <Link href="/home">→ /home (middleware redirect)</Link>
      <Link href="/people/3">→ /people/3 (redirect)</Link>
    </Box>
    <Text color="muted">Deep link: vurses run examples/router-app --route /users/3</Text>
  </Box>
</template>

<script lang="ts">
export const metadata = { title: 'Home' }
</script>
