<template>
  <Box class="flex-col" :height="size.rows" :width="size.columns">
    <!-- header -->
    <Box class="px-1 shrink-0" bg="surface">
      <Text bold color="primary">▼ vurses</Text>
      <Text color="muted"> · ops dashboard · {{ settings.name }}</Text>
      <Spacer />
      <Text color="muted">{{ theme.name }} · {{ time }}</Text>
    </Box>

    <Box class="flex-1">
      <!-- sidebar -->
      <Box class="flex-col w-26 shrink-0" border="round" title="Services" :padding-x="1">
        <ServiceList :services="services" v-model="selected" />
        <Spacer />
        <Divider />
        <Text color="muted">
          <Text color="success">●</Text> {{ services.filter((s) => s.status === 'healthy').length }} ok
          <Text color="warning">●</Text> {{ services.filter((s) => s.status === 'degraded').length }}
          <Text color="error">●</Text> {{ services.filter((s) => s.status === 'down').length }}
        </Text>
      </Box>

      <!-- main -->
      <Box class="flex-col flex-1 px-1">
        <Tabs v-model="tab" :tabs="tabs">
          <template #Overview>
            <Overview :service="service" />
          </template>

          <template #Deploys>
            <Table
              :rows="deploys"
              :columns="deployColumns"
              selectable
              v-model="deployIndex"
              title="Recent deploys"
              @select="showDeploy = true"
            />
            <Text color="muted">↑↓ select · enter for details</Text>
          </template>

          <template #Logs>
            <Box class="flex-col flex-1" border="round" :title="`Logs (${logs.length})`" :padding-x="1">
              <ScrollBox stick-to-bottom>
                <Text v-for="(l, i) in logs" :key="i" wrap="truncate">
                  <Text color="muted">{{ l.time }} </Text>
                  <Text :color="levelColor(l.level)" bold>{{ l.level.padEnd(5) }}</Text>
                  {{ l.msg }}
                </Text>
              </ScrollBox>
            </Box>
          </template>

          <template #Settings>
            <Box class="flex-col gap-1">
              <TextInput v-model="settings.name" label="Environment name" :width="40" />
              <Switch v-model="settings.notifications" label="Notifications" />
              <Checkbox v-model="settings.autoDeploy" label="Auto-deploy main branch" />
              <Box class="gap-4">
                <Box class="flex-col">
                  <Text bold>Theme</Text>
                  <RadioGroup :model-value="themeName" :options="['dark', 'light', 'dracula']" @update:model-value="switchTheme" />
                </Box>
                <Box class="flex-col">
                  <Text bold>Region</Text>
                  <Select v-model="settings.region" :options="regions" />
                </Box>
              </Box>
            </Box>
          </template>
        </Tabs>
      </Box>
    </Box>

    <StatusBar>
      <KeyHints
        :keys="[
          { key: 'tab', label: 'focus' },
          { key: '1-4', label: 'tabs' },
          { key: 'ctrl+k', label: 'commands' },
          { key: 't', label: 'theme' },
          { key: 'f12', label: 'devtools' },
          { key: 'q', label: 'quit' },
        ]"
      />
      <template #right>
        <Text color="muted">{{ size.columns }}×{{ size.rows }}</Text>
      </template>
    </StatusBar>

    <Dialog v-model:open="showDeploy" :title="`Deploy ${deploy?.id}`" :width="54">
      <Text>
        <Text bold>{{ deploy?.service }}</Text> @ <Text color="accent">{{ deploy?.version }}</Text>
      </Text>
      <Text>
        Status: <Text :color="statusColor(deploy?.status ?? '')" bold>{{ deploy?.status }}</Text> · by {{ deploy?.author }} · {{ deploy?.age }} ago
      </Text>
      <Markdown
        source="Changes:
- **feat:** new caching layer
- **fix:** race condition in `scheduler`
- chore: bump dependencies"
      />
      <template #footer>
        <Button label="Close" @click="showDeploy = false" />
        <Button label="Rollback" variant="danger" @click="(deploy.status = 'rolled back'), (showDeploy = false)" />
      </template>
    </Dialog>

    <Dialog v-model:open="confirmQuit" title="Quit?" :width="36">
      <Text>Really leave the dashboard?</Text>
      <template #footer>
        <Button label="Cancel" @click="confirmQuit = false" />
        <Button label="Quit" variant="primary" auto-focus @click="exit()" />
      </template>
    </Dialog>

    <CommandPalette :commands="commands" />
  </Box>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useApp, useInterval, useKeymap, type Command } from 'vurses'
import ServiceList from './ServiceList.vue'
import Overview from './Overview.vue'

const { exit, setTheme, theme, size } = useApp()

// ------------------------------------------------------------ fake live data
type Status = 'healthy' | 'degraded' | 'down'
interface Service {
  name: string
  status: Status
  cpu: number[]
  rps: number[]
  mem: number
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const mk = (name: string, status: Status = 'healthy'): Service => ({
  name,
  status,
  cpu: Array.from({ length: 40 }, () => rand(10, 60)),
  rps: Array.from({ length: 40 }, () => rand(100, 900)),
  mem: rand(0.2, 0.8),
})
const services = reactive<Service[]>([mk('api-gateway'), mk('web'), mk('worker', 'degraded'), mk('postgres'), mk('redis'), mk('search', 'down')])
const selected = ref(0)
const service = computed(() => services[selected.value])

const levels = ['INFO', 'INFO', 'INFO', 'DEBUG', 'WARN', 'ERROR'] as const
const messages = [
  'GET /api/users 200 12ms',
  'POST /api/login 201 48ms',
  'cache hit ratio 0.93',
  'worker picked job #%d',
  'slow query detected (412ms)',
  'connection reset by peer',
  'GET /healthz 200 1ms',
  'scheduled backup completed',
]
const logs = reactive<{ time: string; level: (typeof levels)[number]; msg: string }[]>([])
let jobs = 1000
const now = ref(new Date())

useInterval(() => {
  now.value = new Date()
  for (const s of services) {
    s.cpu.push(Math.max(1, Math.min(99, s.cpu[s.cpu.length - 1] + rand(-12, 12))))
    s.rps.push(Math.max(0, s.rps[s.rps.length - 1] + rand(-120, 120)))
    if (s.cpu.length > 120) s.cpu.shift()
    if (s.rps.length > 120) s.rps.shift()
    s.mem = Math.max(0.05, Math.min(0.98, s.mem + rand(-0.02, 0.02)))
  }
  const level = levels[Math.floor(Math.random() * levels.length)]
  logs.push({
    time: now.value.toTimeString().slice(0, 8),
    level,
    msg: messages[Math.floor(Math.random() * messages.length)].replace('%d', String(jobs++)),
  })
  if (logs.length > 500) logs.shift()
}, 500)

const deploys = reactive(
  [
    { id: 'd-1042', service: 'web', version: 'v2.14.0', author: 'ana', status: 'success', age: '3m' },
    { id: 'd-1041', service: 'api-gateway', version: 'v5.2.1', author: 'li', status: 'success', age: '41m' },
    { id: 'd-1040', service: 'worker', version: 'v1.9.3', author: 'sam', status: 'failed', age: '2h' },
    { id: 'd-1039', service: 'search', version: 'v0.8.0', author: 'ana', status: 'rolled back', age: '5h' },
    { id: 'd-1038', service: 'web', version: 'v2.13.2', author: 'kim', status: 'success', age: '1d' },
    { id: 'd-1037', service: 'postgres', version: '16.4', author: 'ops', status: 'success', age: '2d' },
    { id: 'd-1036', service: 'redis', version: '7.4.1', author: 'ops', status: 'success', age: '4d' },
  ],
)
const deployIndex = ref(0)
const showDeploy = ref(false)
const deploy = computed(() => deploys[deployIndex.value])
const statusColor = (s: string) => (s === 'success' ? 'success' : s === 'failed' ? 'error' : 'warning')
const deployColumns = [
  { key: 'id', title: 'ID', color: 'muted' },
  { key: 'service', title: 'Service' },
  { key: 'version', title: 'Version', color: 'accent' },
  { key: 'author', title: 'Author' },
  { key: 'status', title: 'Status', format: (v: unknown) => `● ${v}` },
  { key: 'age', title: 'Age', align: 'right' as const },
]

// ------------------------------------------------------------ settings
const settings = reactive({
  name: 'production',
  notifications: true,
  autoDeploy: false,
  region: 'eu-central',
})
const themeName = ref(theme.value.name)
const regions = [
  { label: 'EU Central (Frankfurt)', value: 'eu-central' },
  { label: 'US East (Virginia)', value: 'us-east' },
  { label: 'AP South (Mumbai)', value: 'ap-south' },
]
const switchTheme = (t: unknown) => {
  themeName.value = String(t)
  setTheme(String(t))
}
const cycleTheme = () => {
  const order = ['dark', 'light', 'dracula']
  switchTheme(order[(order.indexOf(themeName.value) + 1) % order.length])
}

// ------------------------------------------------------------ navigation
const tabs = ['Overview', 'Deploys', 'Logs', 'Settings']
const tab = ref('Overview')
const confirmQuit = ref(false)

useKeymap({
  q: () => (confirmQuit.value = true),
  t: cycleTheme,
  '1': () => (tab.value = tabs[0]),
  '2': () => (tab.value = tabs[1]),
  '3': () => (tab.value = tabs[2]),
  '4': () => (tab.value = tabs[3]),
})

const commands: Command[] = [
  ...tabs.map((t, i) => ({ label: `Go to ${t}`, group: 'View', key: String(i + 1), action: () => (tab.value = t) })),
  { label: 'Cycle theme', group: 'Appearance', key: 't', action: cycleTheme },
  { label: 'Theme: Dark', group: 'Appearance', action: () => switchTheme('dark') },
  { label: 'Theme: Light', group: 'Appearance', action: () => switchTheme('light') },
  { label: 'Theme: Dracula', group: 'Appearance', action: () => switchTheme('dracula') },
  { label: 'Clear logs', group: 'Logs', action: () => logs.splice(0) },
  { label: 'Quit', group: 'App', key: 'q', action: () => exit() },
]

const levelColor = (l: string) => (l === 'ERROR' ? 'error' : l === 'WARN' ? 'warning' : l === 'DEBUG' ? 'muted' : 'info')
const time = computed(() => now.value.toTimeString().slice(0, 8))
</script>
