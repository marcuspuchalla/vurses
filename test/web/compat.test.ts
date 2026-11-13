/**
 * Compatibility with what existing web apps and their libraries do (found by running real
 * apps: PrimeVue, Element Plus, Naive UI, VueUse, Tailwind v4).
 */
import { describe, expect, it } from 'vitest'
import { h, nextTick, onMounted, ref, type Component } from 'vue'
import { createWebApp, current, setWebConfig } from '../../src/web/app.js'
import { installGlobals, resolveFetchUrl } from '../../src/web/globals.js'
import { cssColor } from '../../src/web/css.js'
import { length } from '../../src/web/cascade.js'
import { TElement, TTextNode } from '../../src/dom/nodes.js'

const tick = () => new Promise((r) => setTimeout(r, 0))

async function page(component: Component, css = '', size = { columns: 60, rows: 12 }) {
  setWebConfig({ html: '<body><div id="app"></div></body>', css, dark: true, mount: { manualRender: true, ...size, patchConsole: false, colorDepth: 'truecolor' } })
  const app = createWebApp(component)
  app.mount('#app')
  const runtime = app.runtime!
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await nextTick()
      await tick()
      runtime.renderFrame()
    }
  }
  await settle()
  return {
    settle,
    frame: () => runtime.renderFrame().toString().replace(/[ ]+$/gm, '').replace(/\n+$/, ''),
    unmount: () => runtime.exit(),
  }
}

describe('DOM surface used by libraries', () => {
  it('template refs held in ref() are the elements themselves', async () => {
    const input = ref<TElement | null>(null)
    let same = false
    const p = await page({
      setup() {
        onMounted(() => {
          same = input.value === (globalThis as { document?: { querySelector?(s: string): unknown } }).document?.querySelector?.('input') || input.value?.tag === 'input'
          ;(input.value as unknown as { value: string }).value = 'typed'
        })
        return () => h('input', { ref: input })
      },
    })
    expect(same).toBe(true)
    expect((input.value as unknown as { value: string }).value).toBe('typed')
    expect(Object.getPrototypeOf(input.value)).toBe(TElement.prototype) // not a reactive proxy
    p.unmount()
  })

  it('has the node relationships, writable id / textContent and an iterable classList', () => {
    const parent = new TElement('div')
    const a = new TElement('span')
    const b = new TTextNode('x')
    parent.insertBefore(a, null)
    parent.insertBefore(b, null)
    const el = a as unknown as Record<string, unknown> & { classList: string[] & { add(...c: string[]): void } }
    expect(el.parentNode).toBe(parent)
    expect(el.nextSibling).toBe(b)
    expect((b as unknown as { previousSibling: unknown }).previousSibling).toBe(a)
    expect((parent as unknown as { firstChild: unknown }).firstChild).toBe(a)
    el.id = 'one'
    expect(a.props.id).toBe('one')
    el.classList.add('p', 'q')
    expect(Array.from((a as unknown as { classList: Iterable<string> }).classList)).toEqual(['p', 'q'])
    ;(parent as unknown as { textContent: string }).textContent = 'replaced'
    expect(parent.children).toHaveLength(1)
    expect(parent.textContent).toBe('replaced')
    expect((parent as unknown as { innerHTML: string }).innerHTML).toBe('replaced')
    ;(parent as unknown as { innerHTML: string }).innerHTML = '<b class="k">bold</b> text'
    expect(parent.children).toHaveLength(2)
    expect((parent as unknown as { innerHTML: string }).innerHTML).toBe('<b class="k">bold</b> text')
  })

  it('refuses to insert an element into its own descendant (no infinite loops)', () => {
    const outer = new TElement('div')
    const inner = new TElement('div')
    outer.insertBefore(inner, null)
    expect(() => inner.insertBefore(outer, null)).toThrow(/HierarchyRequestError/)
  })

  it('supports once listeners and removing handleEvent objects', () => {
    const el = new TElement('div') as unknown as {
      addEventListener(t: string, f: unknown, o?: unknown): void
      removeEventListener(t: string, f: unknown): void
      __listeners: Map<string, Set<(e: unknown) => void>>
    }
    let n = 0
    el.addEventListener('ping', () => n++, { once: true })
    const obj = { handleEvent: () => n++ }
    el.addEventListener('ping', obj)
    for (const f of [...el.__listeners.get('ping')!]) f({})
    for (const f of [...el.__listeners.get('ping')!]) f({})
    expect(n).toBe(3) // once listener ran once, the object twice
    el.removeEventListener('ping', obj)
    expect(el.__listeners.get('ping')!.size).toBe(0)
  })

  it('el.style is a CSSStyleDeclaration: writes, setProperty and custom properties apply', async () => {
    const box = ref<TElement | null>(null)
    const p = await page(
      {
        setup() {
          onMounted(() => {
            const st = (box.value as unknown as { style: Record<string, unknown> & { setProperty(n: string, v: string): void } }).style
            st.setProperty('--pad', '16px')
            st.paddingTop = '16px'
          })
          return () => h('div', { ref: box, class: 'b' }, 'x')
        },
      },
      '.b { padding-left: var(--pad, 0) }',
    )
    await p.settle()
    expect(p.frame()).toBe('\n  x') // padding-top 1 row, padding-left from the custom property: 2 columns
    p.unmount()
  })

  it('applies <style> elements added at runtime (component libraries inject CSS)', async () => {
    const show = ref(false)
    const p = await page({ setup: () => () => h('div', [show.value ? h('style', '.t { padding-left: 32px }') : null, h('p', { class: 't' }, 'styled')]) })
    expect(p.frame()).toBe('styled')
    show.value = true
    await p.settle()
    expect(p.frame()).toBe('    styled')
    p.unmount()
  })
})

describe('browser globals', () => {
  it('provides Storage, DOM event classes, cookies, navigator and guarded rAF', async () => {
    installGlobals({ scope: () => current.scope, size: () => ({ columns: 80, rows: 24 }), dark: true })
    const g = globalThis as unknown as Record<string, any>
    expect(g.localStorage instanceof g.Storage).toBe(true)
    const e = new g.KeyboardEvent('keydown', { key: 'a' })
    expect(e.key).toBe('a')
    expect(e instanceof g.Event).toBe(true)
    expect(new g.InputEvent('input', { data: 'x' }) instanceof g.UIEvent).toBe(true)
    g.document.cookie = 'a=1; path=/'
    g.document.cookie = 'b=2'
    expect(g.document.cookie).toBe('a=1; b=2')
    g.document.cookie = 'a=; max-age=0'
    expect(g.document.cookie).toBe('b=2')
    expect(g.navigator.onLine).toBe(true)
    await g.navigator.clipboard.writeText('copied')
    expect(await g.navigator.clipboard.readText()).toBe('copied')
    expect(g.document.getElementById(undefined)).toBeNull()
    let fired = 0
    g.addEventListener('t1', () => fired++, { once: true })
    g.dispatchEvent(new g.Event('t1'))
    g.dispatchEvent(new g.Event('t1'))
    expect(fired).toBe(1)
    let ran = false
    g.requestAnimationFrame(() => {
      ran = true
      throw new Error('ignored')
    })
    await new Promise((r) => setTimeout(r, 40))
    expect(ran).toBe(true) // and the process is still alive
  })

  it('resolves relative fetch URLs through the Vite proxy, then --origin', () => {
    const proxy = { '/api': { target: 'http://localhost:8080', rewrite: (p: string) => p.replace(/^\/api/, '') }, '^/auth/.*': 'https://auth.example' }
    expect(resolveFetchUrl('/api/users?x=1', proxy, undefined)).toBe('http://localhost:8080/users?x=1')
    expect(resolveFetchUrl('/auth/login', proxy, undefined)).toBe('https://auth.example/auth/login')
    expect(resolveFetchUrl('/other', proxy, 'https://site.example/')).toBe('https://site.example/other')
    expect(resolveFetchUrl('/other', proxy, undefined)).toBeNull()
    expect(resolveFetchUrl('https://x.example/a', proxy, undefined)).toBe('https://x.example/a')
  })
})

describe('modern CSS (Tailwind v4)', () => {
  it('parses oklch(), oklab() and color-mix()', () => {
    expect(cssColor('oklch(63.7% 0.237 25.331)')).toBe('#fb2c36') // red-500
    expect(cssColor('oklch(0.985 0 0)')).toBe('#fafafa')
    const a = { a: 1 }
    expect(cssColor('color-mix(in oklab, #fb2c36 50%, transparent)', a)).toBe('#fb2c36')
    expect(a.a).toBe(0.5)
    expect(cssColor('color-mix(in srgb, red, blue)')).toBe('#800080')
  })

  it('evaluates calc(), min(), max() and clamp() lengths', () => {
    const env = { columns: 100, rows: 40 }
    expect(length('calc(0.25rem * 4)', 'x', env)).toBe(2) // Tailwind p-4: 16px
    expect(length('calc(0.25rem * 8)', 'y', env)).toBe(2)
    expect(length('calc(100% / 3)', 'x', env)).toBe('33.333%')
    expect(length('max(8px, 2rem)', 'x', env)).toBe(4)
    expect(length('clamp(1rem, 50vw, 4rem)', 'x', env)).toBe(8)
    expect(length('calc(100% - 16px)', 'x', env)).toBeUndefined()
  })

  it('unlayered rules beat layered ones; later layers beat earlier ones', async () => {
    const css = '@layer base, utilities; @layer utilities { #x { padding-left: 16px } } @layer base { #x.y { padding-left: 8px } }'
    const layered = await page({ render: () => h('p', { id: 'x', class: 'y' }, 'z') }, css)
    expect(layered.frame()).toBe('  z') // utilities (later layer) beats base, despite base's higher specificity
    layered.unmount()
    const unlayered = await page({ render: () => h('p', { id: 'x', class: 'y' }, 'z') }, css + ' p { padding-left: 32px }')
    expect(unlayered.frame()).toBe('    z') // an unlayered type selector beats every layer
    unlayered.unmount()
  })
})

describe('<canvas> in web pages', () => {
  it('sizes the element from its width / height attributes and paints the bitmap', async () => {
    const el = ref<TElement | null>(null)
    const p = await page(
      {
        setup() {
          onMounted(() => {
            const ctx = (el.value as unknown as { getContext(t: string): CanvasRenderingContext2D }).getContext('2d')
            ctx.fillStyle = '#ff0000'
            ctx.fillRect(0, 0, 80, 32) // the left half: 10 x 2 cells
          })
          return () => h('canvas', { ref: el, width: 160, height: 32 })
        },
      },
      '',
      { columns: 30, rows: 4 },
    )
    await p.settle()
    const buf = current.runtime!.renderFrame()
    const bgAt = (x: number, y: number) => String(buf.bg[y * buf.width + x])
    expect(bgAt(0, 0)).toContain('255;0;0') // a solid red cell
    expect(bgAt(9, 1)).toContain('255;0;0')
    expect(bgAt(15, 0)).not.toContain('255;0;0') // the right half stays empty
    expect(bgAt(0, 2)).not.toContain('255;0;0') // 32 px tall: 2 rows
    expect((el.value as unknown as { width: number }).width).toBe(160)
    p.unmount()
  })

  it('supports drawImage(canvasElement) and toDataURL', () => {
    const a = new TElement('canvas') as unknown as { width: number; height: number; getContext(t: string): CanvasRenderingContext2D; toDataURL(): string }
    const b = new TElement('canvas') as unknown as typeof a
    a.width = b.width = 4
    a.height = b.height = 4
    a.getContext('2d').fillStyle = '#00ff00'
    a.getContext('2d').fillRect(0, 0, 4, 4)
    b.getContext('2d').drawImage(a as unknown as CanvasImageSource, 0, 0)
    expect(Array.from(b.getContext('2d').getImageData(1, 1, 1, 1).data)).toEqual([0, 255, 0, 255])
    expect(a.toDataURL()).toMatch(/^data:image\/png;base64,/)
  })

  it('sends pointer and mouse events with offsetX / offsetY in CSS pixels', async () => {
    const seen: string[] = []
    const log = (e: { type: string; offsetX: number; offsetY: number; buttons: number }) => seen.push(`${e.type} ${e.offsetX},${e.offsetY} b${e.buttons}`)
    const p = await page(
      {
        render: () => h('canvas', { width: 160, height: 64, onPointerdown: log, onMousedown: log, onPointermove: log, onMouseup: log }),
      },
      '',
      { columns: 30, rows: 6 },
    )
    const runtime = current.runtime!
    runtime.handleInput('\x1b[<0;3;2M') // press at column 3, row 2 (1-based)
    runtime.handleInput('\x1b[<32;5;3M') // drag
    runtime.handleInput('\x1b[<0;5;3m') // release
    await new Promise((r) => setImmediate(r)) // moves are coalesced until the page is idle
    await p.settle()
    expect(seen).toEqual(['pointerdown 20,24 b1', 'mousedown 20,24 b1', 'pointermove 36,40 b1', 'mouseup 36,40 b0'])
    p.unmount()
  })
})

