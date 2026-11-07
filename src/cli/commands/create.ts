import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pkg, type Command, type Flags } from '../shared.js'

// ---------------------------------------------------------------- App Router

const ROUTER_FILES: Record<string, string> = {
  'app/layout.vue': `<script lang="ts">
export const metadata = { title: { default: '__NAME__', template: '%s · __NAME__' } }
</script>

<script setup lang="ts">
import { useApp, useMetadata, usePathname } from 'vuecli'

const { size } = useApp()
const pathname = usePathname()
const meta = useMetadata()
</script>

<template>
  <Box class="flex-col" :height="size.rows" :width="size.columns">
    <Box class="px-1 gap-2 shrink-0" bg="surface">
      <Text bold color="primary">◆ __NAME__</Text>
      <Link href="/" exact>Home</Link>
      <Link href="/about">About</Link>
      <Link href="/users/1">User 1</Link>
      <Spacer />
      <Text color="muted">{{ meta.title }}</Text>
    </Box>
    <Box class="flex-col flex-1 p-1" border="round" :title="pathname">
      <slot />
    </Box>
    <StatusBar>
      <KeyHints :keys="[{ key: 'tab', label: 'focus' }, { key: 'enter', label: 'open' }, { key: 'alt+left', label: 'back' }, { key: 'alt+right', label: 'forward' }, { key: 'ctrl+c', label: 'quit' }]" />
    </StatusBar>
  </Box>
</template>
`,
  'app/page.vue': `<script lang="ts">
export const metadata = { title: 'Home' }
</script>

<script setup lang="ts">
import { ref } from 'vue'
const count = ref(0)
</script>

<template>
  <Box class="flex-col gap-1">
    <BigText text="HELLO" color="primary" />
    <Text>Edit <Text color="accent">app/page.vue</Text>. Folders in <Text color="accent">app/</Text> become routes.</Text>
    <Box class="gap-1">
      <Button label="-1" @click="count--" />
      <Button :label="\`+1 (\${count})\`" variant="primary" @click="count++" />
    </Box>
    <Link href="/users/42">→ Open /users/42</Link>
  </Box>
</template>
`,
  'app/about/page.vue': `<script lang="ts">
export const metadata = { title: 'About' }
</script>

<template>
  <Box class="flex-col gap-1">
    <Text bold>About</Text>
    <Text color="muted">This page is app/about/page.vue. Press alt+left to go back.</Text>
  </Box>
</template>
`,
  'app/users/[id]/page.vue': `<script lang="ts">
export function generateMetadata({ params }: { params: { id: string } }) {
  return { title: \`User \${params.id}\` }
}
</script>

<script setup lang="ts">
import { notFound } from 'vuecli'

const props = defineProps<{ params: { id: string } }>()

// Async setup: app/loading.vue is shown until this resolves.
await new Promise((r) => setTimeout(r, 500))
if (!/^\\d+$/.test(props.params.id)) notFound()
</script>

<template>
  <Box class="flex-col gap-1">
    <Text>User <Text bold color="primary">#{{ params.id }}</Text></Text>
    <Box class="gap-2">
      <Link :href="\`/users/\${Number(params.id) + 1}\`">next user →</Link>
      <Link href="/users/nobody">a missing user</Link>
    </Box>
  </Box>
</template>
`,
  'app/loading.vue': `<template>
  <Spinner label="Loading…" />
</template>
`,
  'app/not-found.vue': `<script setup lang="ts">
import { usePathname } from 'vuecli'
const pathname = usePathname()
</script>

<template>
  <Box class="flex-col gap-1">
    <Text><Text bold color="warning">404</Text> Nothing at <Text color="accent">{{ pathname }}</Text></Text>
    <Link href="/">← Home</Link>
  </Box>
</template>
`,
  'app/api/hello/route.ts': `// Route handler (served over HTTP by \`vuecli dev\` / \`vuecli start\`).
export function GET() {
  return Response.json({ hello: 'world' })
}
`,
  'middleware.ts': `import { RouteResponse, type RouteRequest } from 'vuecli'

// Runs before navigations in the terminal and before HTTP requests.
export function middleware(request: RouteRequest) {
  if (request.nextUrl.pathname === '/home') return RouteResponse.redirect(new URL('/', request.url))
  return RouteResponse.next()
}

export const config = { matcher: ['/home'] }
`,
  '.gitignore': 'node_modules\ndist\n',
}

// ------------------------------------------------------------- single file

const TEMPLATE_APP = `<script setup lang="ts">
import { ref } from 'vue'
import { useApp, useKeymap } from 'vuecli'

const { exit } = useApp()
const count = ref(0)
const name = ref('')

useKeymap({
  'q|escape': () => exit(),
  '+|up': () => count.value++,
  '-|down': () => count.value--,
})
</script>

<template>
  <Box class="flex-col p-1 gap-1" border="round" title="__NAME__">
    <BigText text="HELLO" color="primary" />
    <Text>
      Count: <Text bold color="accent">{{ count }}</Text>
      <Text color="muted"> (press +/- or click the buttons)</Text>
    </Text>
    <Box class="gap-1">
      <Button label="-1" @click="count--" />
      <Button label="+1" variant="primary" @click="count++" />
    </Box>
    <TextInput v-model="name" placeholder="What's your name?" label="Name" />
    <Text v-if="name">Hello, <Text bold color="primary">{{ name }}</Text>!</Text>
    <Spacer />
    <KeyHints :keys="[{ key: 'tab', label: 'focus' }, { key: 'q', label: 'quit' }, { key: 'f12', label: 'devtools' }]" />
  </Box>
</template>
`

function create(dir: string, flags: Flags) {
  const target = resolve(dir)
  if (existsSync(target) && existsSync(join(target, 'package.json'))) {
    console.error(`vuecli: ${dir} already contains a package.json`)
    process.exit(1)
  }
  const name = basename(target)
  const single = flags.single === true || flags.template === 'single'
  const files: Record<string, string> = single ? { 'App.vue': TEMPLATE_APP } : ROUTER_FILES
  const scripts = single ? { start: 'vuecli App.vue' } : { start: 'vuecli run .', 'start:about': 'vuecli run . --route /about', dev: 'vuecli dev' }
  mkdirSync(target, { recursive: true })
  writeFileSync(
    join(target, 'package.json'),
    JSON.stringify({ name, private: true, type: 'module', scripts, dependencies: { vue: '^3.5.0', vuecli: `^${pkg.version}` } }, null, 2) + '\n',
  )
  for (const [file, content] of Object.entries(files)) {
    const out = join(target, file)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, content.replaceAll('__NAME__', name))
  }
  const tree = single
    ? '  App.vue'
    : [
        '  app/',
        '    layout.vue          header + status bar around every page',
        '    page.vue            /',
        '    about/page.vue      /about',
        '    users/[id]/page.vue /users/:id (async, uses loading.vue)',
        '    loading.vue         Suspense fallback',
        '    not-found.vue       404',
        '    api/hello/route.ts  GET /api/hello (vuecli dev)',
        '  middleware.ts         redirects /home → /',
      ].join('\n')
  console.log(`\nCreated ${name}:\n\n${tree}\n\n  cd ${dir}\n  npm install\n  npm start\n`)
}

const command: Command = {
  summary: 'Scaffold a new app (App Router project; --single for one App.vue)',
  usage: 'vuecli create <dir> [--single]',
  run(args, flags) {
    if (!args[0]) {
      console.error('Usage: vuecli create <dir> [--single]')
      process.exit(1)
    }
    create(args[0], flags)
  },
}
export default command
