import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { compileSFC } from '../../src/sfc/compile.js'
import { render } from '../../src/testing.js'

// compile examples/gallery/App.vue and import it (with 'vuecli' mapped to the sources)
const src = fileURLToPath(new URL('../../examples/gallery/App.vue', import.meta.url))
const out = fileURLToPath(new URL('./.gallery.compiled.tmp.mjs', import.meta.url))
const indexPath = fileURLToPath(new URL('../../src/index.ts', import.meta.url))
afterAll(() => rmSync(out, { force: true }))

describe('examples/gallery', () => {
  it('renders every page', async () => {
    writeFileSync(out, compileSFC(readFileSync(src, 'utf8'), src).replace(/from ["']vuecli["']/g, `from ${JSON.stringify(indexPath)}`))
    const App = (await import(/* @vite-ignore */ out)).default
    const r = await render(App, { columns: 120, rows: 36 })
    const expectations: [string, string][] = [
      ['Layout', 'SplitPane'],
      ['Tree', 'components'],
      ['Code', 'useCounter'],
      ['Diff', 'greet.js'],
      ['Charts', '━━ cpu %'],
      ['Text', 'Unicode bidi'],
      ['Inputs', 'Volume'],
      ['Errors', 'Widget exploded'],
      ['Errors', 'loading data'],
    ]
    for (const [page, text] of expectations) {
      expect(r.lastFrame()).toContain(text)
      expect(r.lastFrame()).toContain(page)
      if (process.env.SHOW_GALLERY) process.stdout.write(r.lastFrame() + '\n=====\n')
      if (text !== 'Widget exploded') await r.press(']')
    }
    await r.press('?')
    expect(r.lastFrame()).toContain('Keyboard shortcuts')
    expect(r.lastFrame()).toContain('Next page')
    r.unmount()
  })
})
