import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { CellBuffer } from '../src/render/buffer.js'
import { safeLogText, safeTitle } from '../src/render/sanitize.js'
import { decodeEntities } from '../src/web/html.js'
import { allowedHost } from '../src/server/dev.js'
import { SessionManager } from '../src/server/session.js'

const OSC52 = '\x1b]52;c;aGk=\x07'

describe('terminal output hygiene', () => {
  it('never stores control characters in cells, whoever paints them', () => {
    const b = new CellBuffer(10, 1)
    let x = 0
    for (const ch of `a${OSC52}\x9bz`) b.set(x++, 0, ch, 1, '', null, 0)
    const row = Array.from({ length: 10 }, (_, i) => b.chars[i]).join('')
    expect(row).not.toMatch(/[\x00-\x1f\x7f-\x9f]/)
    expect(row).toBe('a ]52;c;aG') // ESC became a space; the rest is harmless text
  })

  it('shows control characters in replayed logs as visible escapes', () => {
    expect(safeLogText(`token ${OSC52} done\n`)).toBe('token \\x1b]52;c;aGk=\\x07 done\n')
    expect(safeLogText('tab\tkept')).toBe('tab\tkept')
    expect(safeLogText('c1 \u009d here')).toBe('c1 \\x9d here')
  })

  it('strips every control character from window titles and caps them', () => {
    expect(safeTitle('A\u009c\x1b]0;evil\x07B\nC')).toBe('A]0;evilBC')
    expect(safeTitle('x'.repeat(500)).length).toBe(200)
  })
})

describe('v-html entities', () => {
  it('decodes hostile character references without throwing', () => {
    expect(decodeEntities('&#99999999;')).toBe('�')
    expect(decodeEntities('&#xD800;')).toBe('�')
    expect(decodeEntities('&#0;')).toBe('�')
    expect(decodeEntities('a&#27;]52;c;x&#7;b')).toBe('a]52;c;xb')
    expect(decodeEntities('&#x1F600; &amp; &#65;')).toBe('😀 & A')
  })
})

describe('dev server Host check (DNS rebinding)', () => {
  it('answers to localhost, IP addresses and the configured host only', () => {
    for (const ok of ['localhost:3000', 'LOCALHOST', 'app.localhost:3000', '127.0.0.1:3000', '192.168.1.20', '[::1]:3000', null]) expect(allowedHost(ok)).toBe(true)
    for (const bad of ['attacker.example', 'attacker.example:3000', 'localhost.attacker.example']) expect(allowedHost(bad)).toBe(false)
    expect(allowedHost('dev.box:3000', 'dev.box')).toBe(true)
  })
})

describe('live sessions', () => {
  it('limits sessions per client address', async () => {
    const App = defineComponent(() => () => h('tui-text', 'x'))
    const m = new SessionManager({ createRoot: () => App, maxSessionsPerClient: 2 })
    const open = (client: string) => m.open('/', { client })
    expect((await open('10.0.0.1')).status).toBe(200)
    expect((await open('10.0.0.1')).status).toBe(200)
    expect((await open('10.0.0.1')).status).toBe(429)
    expect((await open('10.0.0.2')).status).toBe(200)
    for (const s of m.list()) s.close()
    expect((await open('10.0.0.1')).status).toBe(200)
    for (const s of m.list()) s.close()
  })
})
