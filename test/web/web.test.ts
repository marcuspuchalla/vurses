import { describe, expect, it } from 'vitest'
import { h, nextTick, ref, withDirectives, withModifiers, withKeys, type Component } from 'vue'
import { keyFromCombo } from '../../src/testing.js'
import { createWebApp, current, setWebConfig } from '../../src/web/app.js'
import { vModelCheckbox, vModelSelect, vModelText } from '../../src/web/vue-shim.js'
import { StyleSheet, matchMedia, parseSelector, cssColor, resolveVars } from '../../src/web/css.js'
import { length } from '../../src/web/cascade.js'
import { parseHTML } from '../../src/web/html.js'

const tick = () => new Promise((r) => setTimeout(r, 0))

async function page(component: Component, css = '', html = '<body><div id="app"></div></body>', size = { columns: 60, rows: 20 }) {
  setWebConfig({ html, css, dark: true, mount: { manualRender: true, ...size, patchConsole: false, colorDepth: 'truecolor' } })
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
  const frame = () =>
    runtime
      .renderFrame()
      .toString()
      .replace(/[ ]+$/gm, '')
      .replace(/\n+$/, '')
  return {
    app,
    runtime,
    frame,
    async press(...keys: string[]) {
      for (const k of keys) {
        if (k.startsWith('type:')) for (const ch of k.slice(5)) runtime.dispatchKey(keyFromCombo(ch === ' ' ? 'space' : ch))
        else runtime.dispatchKey(keyFromCombo(k))
        await settle()
      }
    },
    focused: () => current.scope?.focusedElement() ?? null,
    unmount: () => runtime.exit(),
  }
}

describe('css engine', () => {
  it('computes specificity', () => {
    expect(parseSelector('#a .b c')!.specificity).toBe(10000 + 100 + 1)
    expect(parseSelector(':where(.x) p')!.specificity).toBe(1)
    expect(parseSelector('a:not(.b)')!.specificity).toBe(101)
  })
  it('parses pseudo-elements and rejects unknown ones', () => {
    expect(parseSelector('.x::before')!.pseudoElement).toBe('before')
    expect(parseSelector('.x:after')!.pseudoElement).toBe('after')
    expect(parseSelector('input::-webkit-input-placeholder')).toBeNull()
  })
  it('evaluates media queries against the terminal', () => {
    const env = { width: 800, height: 400, dark: true }
    expect(matchMedia('(min-width: 640px)', env)).toBe(true)
    expect(matchMedia('screen and (max-width: 600px)', env)).toBe(false)
    expect(matchMedia('(prefers-color-scheme: dark)', env)).toBe(true)
    expect(matchMedia('print', env)).toBe(false)
    expect(matchMedia('(width >= 700px)', env)).toBe(true)
  })
  it('keeps @media rules conditional and detects dark-mode support', () => {
    const sheet = new StyleSheet('a{color:red} @media (max-width: 100px){a{color:blue}} @media (prefers-color-scheme: dark){b{color:#fff}}')
    expect(sheet.activeRules({ width: 800, height: 400, dark: false })).toHaveLength(1)
    expect(sheet.activeRules({ width: 80, height: 400, dark: true })).toHaveLength(3)
    expect(sheet.supportsDark).toBe(true)
  })
  it('parses colors and variables', () => {
    expect(cssColor('#abc')).toBe('#aabbcc')
    expect(cssColor('rgb(255 0 0 / 50%)')).toBe('#ff0000')
    expect(cssColor('hsl(120, 100%, 25%)')).toBe('#008000')
    expect(cssColor('rebeccapurple')).toBe('#663399')
    expect(resolveVars('var(--a, var(--b, 1px))', new Map([['--b', '2px']]))).toBe('2px')
  })
  it('maps lengths to cells', () => {
    const env = { columns: 100, rows: 40 }
    expect(length('16px', 'x', env)).toBe(2)
    expect(length('1rem', 'y', env)).toBe(1)
    expect(length('8px', 'y', env)).toBe(0)
    expect(length('50%', 'x', env)).toBe('50%')
    expect(length('50vh', 'y', env)).toBe(20)
  })
  it('parses HTML fragments', () => {
    const [ul] = parseHTML('<ul class="a"><li>one<li>two &amp; <b>three</b></ul>')
    expect(ul.nodeType === 'element' && ul.children.length).toBe(2)
    expect(ul.nodeType === 'element' && ul.textContent).toBe('onetwo & three')
  })
})

describe('web pages', () => {
  it('flows inline content and blocks like a browser', async () => {
    const p = await page({
      render: () =>
        h('div', [h('h1', 'Title'), 'Some ', h('strong', 'bold'), ' and ', h('a', { href: '/x' }, 'a link'), ' in one line.', h('p', 'Next block')]),
    })
    expect(p.frame()).toBe('Title\n\nSome bold and a link in one line.\nNext block')
    p.unmount()
  })

  it('applies author CSS: display, var(), ::before, flex gap, list markers', async () => {
    const p = await page(
      {
        render: () =>
          h('div', [
            h('p', { class: 'hidden' }, 'gone'),
            h('p', { class: 'note' }, 'note'),
            h('div', { class: 'row' }, [h('span', 'a'), h('span', 'b')]),
            h('ul', [h('li', 'x'), h('li', 'y')]),
          ]),
      },
      ':root{--gap:2rem} .hidden{display:none} .note::before{content:"→ "} .row{display:flex;gap:var(--gap)} ul{margin:0}',
    )
    // <p> keeps its default 1em bottom margin (one row)
    expect(p.frame()).toBe('→ note\n\na    b\n  • x\n  • y')
    p.unmount()
  })

  it('renders the index.html shell around the mount point', async () => {
    const p = await page({ render: () => h('p', 'from vue') }, '', '<html><head><title>T</title></head><body><header>Header</header><main id="app">static</main><footer>Footer</footer><script>x()</script></body></html>')
    expect(p.frame()).toBe('Header\nfrom vue\n\nFooter')
    p.unmount()
  })

  it('edits text inputs with v-model and submits forms with Enter', async () => {
    const name = ref('')
    const submitted: string[] = []
    const p = await page({
      setup: () => () =>
        h('form', { onSubmit: withModifiers(() => (submitted.push(name.value), (name.value = '')), ['prevent']) }, [
          withDirectives(h('input', { placeholder: 'Name', 'onUpdate:modelValue': (v: string) => (name.value = v) }), [[vModelText, name.value]]),
        ]),
    })
    expect(p.frame()).toContain('Name')
    await p.press('tab', 'type:Ada', 'left', 'type:!')
    expect(name.value).toBe('Ad!a')
    await p.press('enter')
    expect(submitted).toEqual(['Ad!a'])
    expect(name.value).toBe('')
    expect(p.frame()).toContain('Name')
    expect(p.frame()).not.toContain('Ad!a')
    p.unmount()
  })

  it('toggles checkboxes, cycles selects and fires keyup handlers', async () => {
    const on = ref(false)
    const fruit = ref('b')
    const keys: string[] = []
    const p = await page({
      setup: () => () =>
        h('div', [
          h('label', [withDirectives(h('input', { type: 'checkbox', 'onUpdate:modelValue': (v: boolean) => (on.value = v) }), [[vModelCheckbox, on.value]]), ' Remember']),
          withDirectives(
            h('select', { 'onUpdate:modelValue': (v: string) => (fruit.value = v) }, [h('option', { value: 'a' }, 'Apple'), h('option', { value: 'b' }, 'Banana')]),
            [[vModelSelect, fruit.value]],
          ),
          h('button', { onKeyup: withKeys((e: { key: string }) => keys.push(e.key), ['enter']) }, 'Go'),
        ]),
    })
    // label, select and button are inline: one line, like a browser
    expect(p.frame()).toBe('[ ] Remember[Banana ▾][ Go ]')
    await p.press('tab', 'space')
    expect(on.value).toBe(true)
    await p.press('tab', 'down')
    expect(fruit.value).toBe('a')
    await p.press('tab', 'enter')
    expect(keys).toEqual(['Enter'])
    expect(p.frame()).toBe('[x] Remember[Apple ▾][ Go ]')
    p.unmount()
  })

  it('activates links and buttons with Enter and :hover follows focus', async () => {
    const clicks: string[] = []
    const p = await page(
      {
        render: () =>
          h('ul', [
            h('li', [h('a', { href: '#', onClick: withModifiers(() => clicks.push('a'), ['prevent']) }, 'one'), h('button', { class: 'x' }, '×')]),
          ]),
      },
      'ul{list-style:none;padding:0;margin:0} .x{display:none} li:hover .x{display:inline}',
    )
    expect(p.frame()).toBe('one')
    await p.press('tab')
    expect(p.frame()).toBe('one[ × ]')
    await p.press('enter')
    expect(clicks).toEqual(['a'])
    p.unmount()
  })

  it('collapses adjacent vertical margins', async () => {
    const p = await page({ render: () => h('div', [h('p', 'a'), h('p', 'b')]) }, 'p{margin:32px 0}')
    // 2 rows between paragraphs, not 4
    expect(p.frame()).toBe('\n\na\n\n\nb')
    p.unmount()
  })

  it('puts inline-block boxes and floats on the line of the inline content around them', async () => {
    const p = await page(
      {
        render: () =>
          h('div', { class: 'meta' }, [
            h('a', { href: '#' }, 'av'),
            h('div', { class: 'info' }, [h('span', { class: 'name' }, 'ada'), h('span', { class: 'date' }, 'today')]),
            h('button', { class: 'like' }, '♥ 1'),
          ]),
      },
      '.info{display:inline-block;margin-left:8px} .name,.date{display:block} .like{float:right}',
      undefined,
      { columns: 30, rows: 4 },
    )
    // avatar, the two-line info box and the right float share the first line, like a browser
    expect(p.frame()).toBe('av ada                 [ ♥ 1 ]\n   today')
    p.unmount()
  })

  it('keeps block-in-inline content on its own line (an inline link around a heading)', async () => {
    const p = await page({ render: () => h('header', [h('a', { href: '#' }, [h('h1', 'todos')]), h('input', { placeholder: 'next' })]) }, 'h1{margin:0}', undefined, { columns: 30, rows: 4 })
    const [first, second] = p.frame().split('\n')
    expect(first.trim()).toBe('todos')
    expect(second).toContain('next')
    p.unmount()
  })

  it('shows an image alt text only when it fits the image box', async () => {
    const p = await page(
      { render: () => h('div', [h('img', { alt: 'ada lovelace', class: 'avatar' }), ' ada', h('p', [h('img', { alt: 'diagram' })])]) },
      '.avatar{width:32px}',
    )
    expect(p.frame()).toBe('▣ ada\n▣ diagram')
    p.unmount()
  })

  it('keeps padding inside bracketed inline boxes and never breaks a pill', async () => {
    const p = await page(
      { render: () => h('p', ['tags: ', ...['machinelearning', 'python', 'react'].map((t) => h('span', { class: 'pill' }, t))]) },
      '.pill{border:1px solid #ccc;padding:0 16px;margin-right:8px;white-space:nowrap} p{margin:0}',
      undefined,
      { columns: 30, rows: 4 },
    )
    expect(p.frame()).toBe('tags: [ machinelearning ]\n[ python ] [ react ]')
    p.unmount()
  })

  it('wraps text at the visible edge of a fractional-width column', async () => {
    const words = 'ab cd ef gh ij kl mn op qr st'
    const p = await page(
      { render: () => h('div', { class: 'row' }, [h('div', { class: 'main' }, 'main'), h('div', { class: 'side' }, [h('p', words)])]) },
      '.row{display:flex} .main{width:75%} .side{width:25%;border-left:1px solid #ccc;padding-left:20px} p{margin:0}',
      undefined,
      { columns: 34, rows: 14 },
    )
    // Yoga rounds the text box up a cell past the column; every word must still be visible
    const seen = p.frame().replace(/[│\s]+/g, ' ')
    for (const w of words.split(' ')) expect(seen).toContain(` ${w}`)
    p.unmount()
  })
})
