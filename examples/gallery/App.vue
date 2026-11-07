<script setup lang="ts">
import { defineComponent, h, ref } from 'vue'
import { useApp, useInterval, useKeymap, type TreeNode } from 'vuecli'

const { exit, size } = useApp()

// ------------------------------------------------------------ navigation
const tabs = ['Layout', 'Tree', 'Code', 'Diff', 'Charts', 'Text', 'Inputs', 'Errors']
const tab = ref('Layout')
const step = (d: number) => (tab.value = tabs[(tabs.indexOf(tab.value) + d + tabs.length) % tabs.length])

useKeymap(
  {
    ']': { handler: () => step(1), description: 'Next page' },
    '[': { handler: () => step(-1), description: 'Previous page' },
    'ctrl+q': { handler: () => exit(), description: 'Quit' },
  },
  { group: 'Gallery' },
)

// ------------------------------------------------------------ layout
const sidebar = ref<number | string>('30%')
const collapsed = ref(false)

// ------------------------------------------------------------ tree
const files: TreeNode[] = [
  {
    label: 'src',
    icon: '📁',
    value: 'src',
    expanded: true,
    children: [
      {
        label: 'components',
        icon: '📁',
        value: 'src/components',
        expanded: true,
        children: [
          { label: 'tree.ts', icon: '📄', value: 'src/components/tree.ts' },
          { label: 'code.ts', icon: '📄', value: 'src/components/code.ts' },
          { label: 'diff.ts', icon: '📄', value: 'src/components/diff.ts' },
          { label: 'charts.ts', icon: '📄', value: 'src/components/charts.ts' },
        ],
      },
      { label: 'fonts', icon: '📁', value: 'src/fonts', children: [{ label: 'figlet.ts', icon: '📄', value: 'src/fonts/figlet.ts' }] },
      { label: 'index.ts', icon: '📄', value: 'src/index.ts' },
    ],
  },
  { label: 'package.json', icon: '📦', value: 'package.json' },
  { label: 'README.md', icon: '📝', value: 'README.md' },
]
const selectedFile = ref<unknown>('src/components/tree.ts')

// ------------------------------------------------------------ code / diff
const tsSample = `import { ref, computed } from 'vue'

/** A tiny counter store. */
export function useCounter(start = 0) {
  const count = ref(start)
  const double = computed(() => count.value * 2)
  const inc = (by: number = 1) => (count.value += by)
  return { count, double, inc } // reactive!
}
`
// (the closing script tag below is escaped so it doesn't end this SFC's own script block)
const vueSample = `<template>
  <Box border="round" :padding="1">
    <Text color="primary">Hello {{ name }}</Text>
  </Box>
</template>

<script setup lang="ts">
const name = 'vuecli'
<\/script>`
const before = `function greet(name) {
  console.log("Hello " + name)
  return true
}

greet("world")
`
const after = `function greet(name, punctuation = "!") {
  console.log(\`Hello \${name}\${punctuation}\`)
  return true
}

greet("world")
greet("vuecli", "?")
`
const splitDiff = ref(false)

// ------------------------------------------------------------ charts
const cpu = ref(Array.from({ length: 60 }, (_, i) => 40 + Math.sin(i / 6) * 25 + Math.random() * 8))
const mem = ref(Array.from({ length: 60 }, (_, i) => 30 + i * 0.6 + Math.random() * 4))
useInterval(() => {
  const t = cpu.value.length
  cpu.value = [...cpu.value.slice(1), 40 + Math.sin(t / 6) * 25 + Math.random() * 8]
  mem.value = [...mem.value.slice(1), Math.max(10, Math.min(95, mem.value[mem.value.length - 1] + (Math.random() - 0.48) * 4))]
}, 500)

// ------------------------------------------------------------ inputs
const volume = ref(60)
const ratio = ref(0.5)
const level = ref(3)

// ------------------------------------------------------------ errors / suspense
const broken = ref(true)
const Flaky = defineComponent({
  setup() {
    return () => {
      if (broken.value) throw new Error('Widget exploded while rendering')
      return h('tui-text', { color: 'success' }, '✓ The widget recovered')
    }
  },
})
const suspenseKey = ref(0)
const SlowData = defineComponent({
  async setup() {
    await new Promise((r) => setTimeout(r, 1500))
    const loadedAt = new Date().toTimeString().slice(0, 8)
    return () => h('tui-text', { color: 'success' }, `✓ data loaded at ${loadedAt}`)
  },
})
</script>

<template>
  <Box class="flex-col" :height="size.rows" :width="size.columns">
    <Box class="px-1 shrink-0" bg="surface">
      <Gradient text="vuecli component gallery" colors="vue" bold />
      <Spacer />
      <Text color="muted">[ ] pages · ? keys · ^Q quit</Text>
    </Box>

    <Box class="flex-col flex-1 px-1">
      <Tabs v-model="tab" :tabs="tabs">
        <!-- ------------------------------------------------ Layout -->
        <template #Layout>
          <SplitPane v-model:size="sidebar" v-model:collapsed="collapsed" collapsible min="12" max="70%">
            <template #first>
              <Box class="flex-col" border="round" title="SplitPane" :padding-x="1" flex-grow="1">
                <Text>size: <Text color="accent">{{ sidebar }}</Text></Text>
                <Text color="muted">Drag the divider, or focus it (tab) and use ←/→, enter collapses.</Text>
              </Box>
            </template>
            <template #second>
              <Box class="flex-col gap-1" :padding-x="1" flex-grow="1">
                <Text bold>Grid columns="1fr 2fr 12"</Text>
                <Grid columns="1fr 2fr 12" :gap="1">
                  <Box border="round" :padding-x="1"><Text>1fr</Text></Box>
                  <Box border="round" :padding-x="1"><Text>2fr</Text></Box>
                  <Box border="round" :padding-x="1"><Text>12</Text></Box>
                  <Box border="round" :padding-x="1" :col-span="2"><Text>col-span 2</Text></Box>
                  <Box border="round" :padding-x="1"><Text>…</Text></Box>
                </Grid>
                <Text bold>Stack direction="row"</Text>
                <Stack direction="row" :gap="2">
                  <Badge color="primary">one</Badge>
                  <Badge color="accent">two</Badge>
                  <Badge color="warning">three</Badge>
                </Stack>
              </Box>
            </template>
          </SplitPane>
        </template>

        <!-- ------------------------------------------------ Tree -->
        <template #Tree>
          <Box class="gap-2 flex-1">
            <Box class="flex-col w-40 shrink-0" border="round" title="Tree" :padding-x="1">
              <Tree :nodes="files" v-model="selectedFile" auto-focus />
            </Box>
            <Box class="flex-col">
              <Text color="muted">selected</Text>
              <Text bold color="primary">{{ selectedFile }}</Text>
              <Text color="muted">↑↓ move · → expand · ← collapse · enter select · * expand siblings</Text>
            </Box>
          </Box>
        </template>

        <!-- ------------------------------------------------ Code -->
        <template #Code>
          <Box class="gap-1 flex-1">
            <Code :code="tsSample" lang="ts" line-numbers title="counter.ts" :highlight="[6]" flex-grow="1" />
            <Code :code="vueSample" lang="vue" title="Hello.vue" flex-grow="1" />
          </Box>
        </template>

        <!-- ------------------------------------------------ Diff -->
        <template #Diff>
          <Box class="flex-col gap-1">
            <Switch v-model="splitDiff" label="Side by side" />
            <Diff :old="before" :new="after" filename="greet.js" word-diff :split="splitDiff" />
          </Box>
        </template>

        <!-- ------------------------------------------------ Charts -->
        <template #Charts>
          <Box class="flex-col" border="round" title="LineChart (braille)" :padding-x="1">
            <LineChart
              :series="[
                { name: 'cpu %', data: cpu },
                { name: 'memory %', data: mem, color: 'warning' },
              ]"
              :height="14"
              :min="0"
              :max="100"
            />
          </Box>
        </template>

        <!-- ------------------------------------------------ Text -->
        <template #Text>
          <Box class="flex-col gap-1">
            <AsciiFont text="vuecli" font="slant" :gradient="['primary', 'accent']" />
            <Box class="gap-4">
              <AsciiFont text="small" font="small" color="warning" />
              <AsciiFont text="mini font" font="mini" color="info" />
            </Box>
            <Gradient text="Gradient text across every character ✨" colors="rainbow" />
            <Gradient bar text="gradient background bar" :colors="['#42b883', '#35495e']" />
            <Box class="flex-col" border="round" title="Unicode bidi" :padding-x="1" :width="48">
              <Text>שלום עולם! (Hebrew, RTL, right aligned)</Text>
              <Text>مرحبا بالعالم 2024</Text>
              <Text>Mixed: price מחיר 120 ₪ (incl. tax)</Text>
            </Box>
          </Box>
        </template>

        <!-- ------------------------------------------------ Inputs -->
        <template #Inputs>
          <Box class="flex-col gap-1" :width="60">
            <Slider v-model="volume" label="Volume   " :step="5" auto-focus />
            <Slider v-model="ratio" label="Ratio    " :min="0" :max="1" :step="0.05" color="accent" />
            <Box class="gap-4">
              <Slider v-model="level" vertical :min="0" :max="10" :length="6" color="warning" />
              <Text color="muted">←/→ step · shift ×10 · PgUp/PgDn · Home/End · click or drag the track</Text>
            </Box>
          </Box>
        </template>

        <!-- ------------------------------------------------ Errors -->
        <template #Errors>
          <Box class="flex-col gap-1">
            <Text bold>ErrorBoundary</Text>
            <Checkbox v-model="broken" label="Widget is broken (uncheck, then press Retry)" />
            <ErrorBoundary title="Widget crashed">
              <Flaky />
            </ErrorBoundary>
            <Text bold>Suspense (async setup)</Text>
            <Button label="Reload" :border="false" @click="suspenseKey++" />
            <Suspense :key="suspenseKey">
              <SlowData />
              <template #fallback>
                <Box class="gap-1"><Spinner /><Text color="muted">loading data…</Text></Box>
              </template>
            </Suspense>
          </Box>
        </template>
      </Tabs>
    </Box>

    <KeyHelp :extra="[{ keys: 'tab|shift+tab', description: 'Move focus', group: 'Navigation' }]" />
  </Box>
</template>
