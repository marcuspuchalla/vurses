/**
 * End-to-end: a real vuecli app + devtools hook runs in Node; the built
 * extension's panel.html runs in Chromium (loaded as an unpacked MV3
 * extension) with `chrome.devtools.inspectedWindow.eval` bridged to Node.
 * Skipped when Playwright / Chromium are unavailable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineComponent, ref } from 'vue'
import { render, type RenderResult } from '../../../src/testing.js'
import { installDevtoolsHook } from '../../../src/devtools/hook.js'

let playwright: { chromium: { launchPersistentContext(dir: string, o: object): Promise<any> } } | null = null
try {
  playwright = createRequire('/opt/node22/lib/node_modules/')('playwright')
} catch {
  try {
    playwright = createRequire(import.meta.url)('playwright')
  } catch {
    playwright = null
  }
}

const pkgDir = fileURLToPath(new URL('..', import.meta.url))
const dist = join(pkgDir, 'dist')
/** Chrome derives unpacked extension ids from the path. */
const extensionId = (p: string) =>
  [...createHash('sha256').update(p).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('')

const Item = defineComponent({ name: 'Item', props: { label: String }, template: '<Text>• {{ label }}</Text>' })
const App = defineComponent({
  name: 'App',
  components: { Item },
  setup: () => ({ n: ref(0), items: ['one', 'two'] }),
  template: `<Box class="flex-col" border="round" :width="24"><Text bold color="green">Count {{ n }}</Text><Item v-for="i in items" :key="i" :label="i" /><Button label="inc" @click="n++" /></Box>`,
})

describe.skipIf(!playwright)('DevTools panel (Chromium)', () => {
  let ctx: any
  let page: any
  let r: RenderResult
  let off: () => void

  beforeAll(async () => {
    execFileSync(process.execPath, ['build.mjs'], { cwd: pkgDir, stdio: 'ignore' })
    r = await render(App, { columns: 30, rows: 8 })
    off = installDevtoolsHook(r.app.runtime!)
    ctx = await playwright!.chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'vuecli-devtools-')), {
      channel: 'chromium',
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    })
    // evaluate panel expressions against the hook in this Node process
    await ctx.exposeBinding('__evalInApp', (_src: unknown, expr: string) => {
      try {
        const result = new Function('window', `return ${expr}`)(globalThis)
        return { result: JSON.parse(JSON.stringify(result ?? null)) }
      } catch (e) {
        return { exception: { isException: true, value: String(e) } }
      }
    })
    await ctx.addInitScript(() => {
      const w = window as any
      w.chrome = w.chrome || {}
      w.chrome.devtools = {
        inspectedWindow: { eval: (expr: string, cb: (r: unknown, ex?: unknown) => void) => w.__evalInApp(expr).then((o: any) => cb(o.result, o.exception)) },
        network: { onNavigated: { addListener() {} } },
      }
    })
    page = await ctx.newPage()
    await page.goto(`chrome-extension://${extensionId(dist)}/panel.html`)
  }, 60000)

  afterAll(async () => {
    off?.()
    r?.unmount()
    await ctx?.close().catch(() => {})
  })

  it('shows the component tree, frame and status', async () => {
    await page.waitForSelector('.row[data-id]')
    const names = await page.$$eval('.tree .name', (els: Element[]) => els.map((e) => e.textContent))
    expect(names).toEqual(['<App>', '<Box>', '<Text>', '<Item>', '<Text>', '<Item>', '<Text>', '<Button>'])
    expect(await page.textContent('[data-ref=status]')).toMatch(/^30×8 · frame \d+/)
    const frame = await page.textContent('.vuecli-frame')
    expect(frame).toContain('Count 0')
    expect(await page.innerHTML('.vuecli-frame')).toContain('color:#0dbc79;font-weight:bold')
  })

  it('selects a component: details, highlight overlay and in-app highlight', async () => {
    const id = await page.$$eval('.row[data-id]', (rows: HTMLElement[]) => rows.find((r) => r.textContent!.includes('<Item>'))!.dataset.id)
    await page.click(`.row[data-id="${id}"]`)
    await page.waitForSelector('.details h2')
    expect(await page.textContent('.details h2')).toContain('<Item>')
    expect(await page.textContent('.details')).toContain('"one"')
    expect(await page.$('.vuecli-hl')).not.toBeNull()
    // the app itself inverts the component's cells
    r.lastFrame()
    const buf = r.buffer()
    expect(buf.flags[2 * buf.width + 1] & 16).toBe(16)
  })

  it('pauses, steps, resumes and toggles wireframe', async () => {
    await page.click('button[data-action=pause]')
    await page.waitForFunction(() => document.querySelector('button[data-action=pause]')!.textContent!.includes('Resume'))
    expect(r.app.runtime!.isPaused).toBe(true)
    expect(await page.textContent('[data-ref=status]')).toContain('paused')
    const before = r.app.runtime!.ctx.stats.frames
    await page.click('button[data-action=step]')
    await page.waitForTimeout(100)
    expect(r.app.runtime!.ctx.stats.frames).toBeGreaterThan(before)
    await page.click('button[data-action=pause]')
    await page.waitForFunction(() => document.querySelector('button[data-action=pause]')!.textContent!.includes('Pause'))
    expect(r.app.runtime!.isPaused).toBe(false)
    await page.check('input[data-action=wireframe]')
    await page.waitForTimeout(100)
    expect((globalThis as any).__VUECLI_DEVTOOLS_HOOK__.getState().wireframe).toBe(true)
  })

  it('updates when the app changes and shows the timeline', async () => {
    await r.click(...(Object.values(r.locate('inc')!) as [number, number]))
    await page.waitForFunction(() => document.querySelector('.vuecli-frame')?.textContent?.includes('Count 1'), null, { timeout: 5000 })
    expect(await page.$$('svg.timeline rect')).not.toHaveLength(0)
    expect(await page.textContent('[data-ref=summary]')).toMatch(/avg [\d.]+ ms/)
  })

  it('filters the tree', async () => {
    await page.fill('[data-ref=filter]', 'butt')
    const names = await page.$$eval('.tree .name', (els: Element[]) => els.map((e) => e.textContent))
    expect(names).toEqual(['<App>', '<Box>', '<Button>'])
  })

  it('reports a missing hook', async () => {
    off()
    await page.click('button[data-action=refresh]')
    await page.waitForFunction(() => document.querySelector('[data-ref=status]')!.textContent!.includes('VC116'))
  })
})
