import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as { version: string }

const HELP = `
vuecli ${pkg.version} — native Vue apps in the terminal

Usage
  vuecli <entry>             Run an app (.vue, .js, .ts). The entry's default
                             export is mounted as the root component.
  vuecli create <dir>        Scaffold a new app
  vuecli --help | --version

Options
  --theme <name>             dark | light | dracula      (default: dark)
  --no-mouse                 Disable mouse tracking
  --fps <n>                  Frame rate cap             (default: 60)
  --no-alt-screen            Render in the main screen buffer

Keys
  Tab / Shift+Tab            Move focus
  F12                        Toggle devtools overlay
  Ctrl+C                     Quit
`

function parseArgs(argv: string[]) {
  const args: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--no-')) flags[a.slice(5)] = false
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      if (v !== undefined) flags[k] = v
      else if (['theme', 'fps'].includes(k)) flags[k] = argv[++i]
      else flags[k] = true
    } else if (a === '-h') flags.help = true
    else if (a === '-v') flags.version = true
    else args.push(a)
  }
  return { args, flags }
}

async function runEntry(entry: string, flags: Record<string, string | boolean>) {
  const file = resolve(entry)
  if (!existsSync(file)) {
    console.error(`vuecli: file not found: ${entry}`)
    process.exit(1)
  }
  register('./sfc/hooks.js', import.meta.url)
  const mod = (await import(pathToFileURL(file).href)) as { default?: unknown }
  const component = mod.default
  if (!component) return // the module mounted itself
  const { createApp } = await import('./index.js')
  const app = createApp(component as never).mount({
    theme: typeof flags.theme === 'string' ? flags.theme : undefined,
    mouse: flags.mouse !== false,
    fps: flags.fps ? Number(flags.fps) : undefined,
    alternateScreen: flags['alt-screen'] !== false,
  })
  try {
    await app.waitUntilExit()
    process.exit(0)
  } catch {
    process.exit(1)
  }
}

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

function create(dir: string) {
  const target = resolve(dir)
  if (existsSync(target) && existsSync(join(target, 'package.json'))) {
    console.error(`vuecli: ${dir} already contains a package.json`)
    process.exit(1)
  }
  const name = basename(target)
  mkdirSync(target, { recursive: true })
  writeFileSync(
    join(target, 'package.json'),
    JSON.stringify(
      {
        name,
        private: true,
        type: 'module',
        scripts: { start: 'vuecli App.vue' },
        dependencies: { vue: '^3.5.0', vuecli: `^${pkg.version}` },
      },
      null,
      2,
    ) + '\n',
  )
  writeFileSync(join(target, 'App.vue'), TEMPLATE_APP.replace('__NAME__', name))
  console.log(`\nCreated ${name}.\n\n  cd ${dir}\n  npm install\n  npm start\n`)
}

async function main() {
  const { args, flags } = parseArgs(process.argv.slice(2))
  if (flags.version) return console.log(pkg.version)
  if (flags.help || args.length === 0) return console.log(HELP)
  if (args[0] === 'create') {
    if (!args[1]) {
      console.error('Usage: vuecli create <dir>')
      process.exit(1)
    }
    return create(args[1])
  }
  if (args[0] === 'run') args.shift()
  await runEntry(args[0], flags)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
