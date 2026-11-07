import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pkg, type Command } from '../shared.js'

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


const command: Command = {
  summary: 'Scaffold a new app',
  usage: 'vuecli create <dir>',
  run(args) {
    if (!args[0]) {
      console.error('Usage: vuecli create <dir>')
      process.exit(1)
    }
    create(args[0])
  },
}
export default command
