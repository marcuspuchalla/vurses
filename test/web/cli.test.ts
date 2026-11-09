/**
 * End-to-end: builds the fixture web app with Vite (`vuecli web`) and renders
 * it with `--snapshot`, including scripted keys. Needs `npm run build`.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
const built = existsSync(`${root}dist/cli/commands/web.js`) && existsSync(`${root}dist/web/vue-shim.js`)

function snapshot(...args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(process.execPath, ['bin/vuecli.js', 'web', 'test/web/fixtures/shop', '--snapshot', '--size', '70x24', ...args], { cwd: root, timeout: 60_000 }, (err, stdout, stderr) =>
      err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(stdout),
    ),
  )
}

describe.skipIf(!built)('vuecli web (fixture app)', () => {
  it('builds with Vite and renders the page with its CSS', async () => {
    const out = await snapshot()
    expect(out).toContain('Fixture Shop — static header from index.html')
    expect(out).toContain('Welcome to the fixture shop. Prices in euro.')
    expect(out).toMatch(/Apple {2}2 €/)
    expect(out).toContain('Σ Total: 5 €')
    expect(out).toContain('scheme (dark)')
    expect(out).not.toContain('never shown')
    expect(out).toContain('Static footer')
  }, 60_000)

  it('runs scripted keys: form submit, v-model, checkbox', async () => {
    const out = await snapshot('--keys', 'tab,tab,type:Kiwi,enter,tab,tab,space')
    expect(out).toMatch(/Kiwi {2}1 €/)
    expect(out).toContain('[x] Express delivery')
    expect(out).toContain('Σ Total: 11 €')
    expect(out).toContain('Log: added')
    expect(out).toMatch(/New item\s+\[ Add \]/)
  }, 60_000)

  it('evaluates media queries against the terminal width', async () => {
    const narrow = await snapshot('--size', '40x24')
    expect(narrow).not.toContain('wide screens only')
  }, 60_000)
})
