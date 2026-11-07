import { describe, expect, it } from 'vitest'
import { defineComponent, h, onMounted, ref } from 'vue'
import { render } from '../../src/testing.js'
import { tpl } from './helpers.js'

describe('ErrorBoundary', () => {
  const boom = ref(true)
  const Bad = defineComponent({
    setup() {
      return () => {
        if (boom.value) throw new Error('kaboom')
        return h('tui-text', null, 'fine')
      }
    },
  })

  it('renders the default panel and resets with the Retry button', async () => {
    boom.value = true
    const errors: string[] = []
    const r = await render(defineComponent({ components: { Bad }, setup: () => ({ errors }), template: `<ErrorBoundary @error="(e) => errors.push(e.message)"><Bad /></ErrorBoundary>` }), { columns: 40, rows: 7 })
    expect(r.lastFrame()).toBe(
      ['╭─ Something went wrong ───────────────╮', '│ kaboom                               │', '│ in render function                   │', '│                                      │', '│ [ Retry ]                            │', '╰──────────────────────────────────────╯'].join('\n'),
    )
    expect(errors).toEqual(['kaboom'])
    boom.value = false
    await r.press('enter')
    expect(r.lastFrame()).toBe('fine')
  })

  it('renders a custom #fallback with error and reset', async () => {
    boom.value = true
    const r = await render(
      defineComponent({
        components: { Bad },
        template: `<ErrorBoundary><Bad /><template #fallback="{ error, reset }"><Box><Text color="error">Oops: {{ error.message }}</Text><Button label="again" :border="false" @click="reset" /></Box></template></ErrorBoundary>`,
      }),
      { columns: 40, rows: 3 },
    )
    expect(r.lastFrame()).toBe('Oops: kaboom[ again ]')
    boom.value = false
    const at = r.locate('again')!
    await r.click(at.x, at.y)
    expect(r.lastFrame()).toBe('fine')
  })

  it('catches errors from setup and lifecycle hooks, and resets on reset-keys change', async () => {
    const fail = ref(true)
    const SetupBad = defineComponent({
      setup() {
        if (fail.value) throw new Error('setup failed')
        return () => h('tui-text', null, 'setup ok')
      },
    })
    const MountBad = defineComponent({
      setup() {
        onMounted(() => {
          throw new Error('mount failed')
        })
        return () => h('tui-text', null, 'x')
      },
    })
    const key = ref(0)
    const r = await render(
      defineComponent({
        components: { SetupBad, MountBad },
        setup: () => ({ key }),
        template: `<Box flex-direction="column"><ErrorBoundary :reset-keys="[key]"><SetupBad /><template #fallback="{ error }"><Text>A: {{ error.message }}</Text></template></ErrorBoundary><ErrorBoundary><MountBad /><template #fallback="{ error, info }"><Text>B: {{ error.message }} ({{ info }})</Text></template></ErrorBoundary></Box>`,
      }),
      { columns: 50, rows: 3 },
    )
    expect(r.lastFrame()).toBe('A: setup failed\nB: mount failed (mounted hook)')
    fail.value = false
    key.value++
    await r.settle()
    expect(r.lastFrame().split('\n')[0]).toBe('setup ok')
  })

  it('does not affect healthy children', async () => {
    const r = await render(tpl(`<ErrorBoundary><Text>ok</Text><Text>two</Text></ErrorBoundary>`), { columns: 10, rows: 2 })
    expect(r.lastFrame()).toBe('ok\ntwo')
  })
})

describe('Suspense', () => {
  it('shows #fallback until async setup resolves', async () => {
    let resolve!: () => void
    const ready = new Promise<void>((r) => (resolve = r))
    const Async = defineComponent({
      async setup() {
        await ready
        const data = ref('loaded data')
        return () => h('tui-text', null, data.value)
      },
    })
    const r = await render(defineComponent({ components: { Async }, template: `<Suspense><Async /><template #fallback><Text>loading…</Text></template></Suspense>` }), { columns: 30, rows: 2 })
    expect(r.lastFrame()).toBe('loading…')
    resolve()
    await r.settle()
    expect(r.lastFrame()).toBe('loaded data')
  })

  it('works with nested async components and emits resolve', async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const A = defineComponent({ async setup() { await delay(5); return () => h('tui-text', null, 'A') } })
    const B = defineComponent({ async setup() { await delay(15); return () => h('tui-text', null, 'B') } })
    const resolved: number[] = []
    const r = await render(
      defineComponent({ components: { A, B }, setup: () => ({ resolved }), template: `<Suspense @resolve="resolved.push(1)"><Box flex-direction="column"><A /><B /></Box><template #fallback><Text>wait</Text></template></Suspense>` }),
      { columns: 10, rows: 2 },
    )
    await delay(30)
    await r.settle()
    expect(r.lastFrame()).toBe('A\nB')
    expect(resolved).toEqual([1])
  })

  it('async setup errors are caught by an ErrorBoundary', async () => {
    const Fails = defineComponent({
      async setup() {
        await Promise.resolve()
        throw new Error('fetch failed')
      },
    })
    const r = await render(
      defineComponent({
        components: { Fails },
        template: `<ErrorBoundary><Suspense><Fails /><template #fallback><Text>loading</Text></template></Suspense><template #fallback="{ error }"><Text>E: {{ error.message }}</Text></template></ErrorBoundary>`,
      }),
      { columns: 30, rows: 2 },
    )
    await r.settle()
    expect(r.lastFrame()).toBe('E: fetch failed')
  })
})

describe('Suspense in multi-line templates', () => {
  it('ignores formatting whitespace around the slot roots', async () => {
    let resolve!: () => void
    const ready = new Promise<void>((r) => (resolve = r))
    const Slow = defineComponent({
      async setup() {
        await ready
        return () => h('tui-text', null, 'done')
      },
    })
    const r = await render(
      defineComponent({
        components: { Slow },
        template: `<Box flex-direction="column">
          <Suspense>
            <Slow />
            <template #fallback>
              <Text>loading</Text>
            </template>
          </Suspense>
        </Box>`,
      }),
      { columns: 20, rows: 2 },
    )
    expect(r.lastFrame()).toBe('loading')
    resolve()
    await r.settle()
    expect(r.lastFrame()).toBe('done')
  })
})
