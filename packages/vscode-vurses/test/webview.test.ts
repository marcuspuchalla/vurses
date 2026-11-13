import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { keyComboFromEvent } from '../src/keys.js'
import { frameMessage, parseWebviewMessage, toPreviewCommand, webviewHtml } from '../src/webview.js'
import { CellBuffer } from '../../../src/render/buffer.js'
import { snapshotFrame } from '../../../src/devtools/frame.js'

describe('key mapping', () => {
  const k = (key: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey', boolean>> = {}) => keyComboFromEvent({ key, ...mods })
  it('maps keyboard events to vurses combos', () => {
    expect(k('Enter')).toBe('enter')
    expect(k('Tab', { shiftKey: true })).toBe('shift+tab')
    expect(k('ArrowUp')).toBe('up')
    expect(k('a')).toBe('a')
    expect(k('A', { shiftKey: true })).toBe('A')
    expect(k('?', { shiftKey: true })).toBe('?')
    expect(k('s', { ctrlKey: true })).toBe('ctrl+s')
    expect(k('S', { ctrlKey: true, shiftKey: true })).toBe('ctrl+s')
    expect(k('ArrowLeft', { altKey: true })).toBe('alt+left')
    expect(k(' ')).toBe('space')
    expect(k('F5')).toBe('f5')
    expect(k('Escape')).toBe('escape')
    expect(k('Shift')).toBeNull()
    expect(k('MediaPlayPause')).toBeNull()
  })
  it('is self-contained (injected into the webview with toString)', () => {
    const fn = new Function(`return (${keyComboFromEvent.toString()})`)() as typeof keyComboFromEvent
    expect(fn({ key: 'Enter', shiftKey: true })).toBe('shift+enter')
  })
})

describe('messages', () => {
  it('validates untrusted webview messages', () => {
    expect(parseWebviewMessage({ type: 'key', key: 'enter' })).toEqual({ type: 'key', key: 'enter' })
    expect(parseWebviewMessage({ type: 'key', key: '' })).toBeNull()
    expect(parseWebviewMessage({ type: 'click', x: 3.7, y: 1, button: 'evil' })).toEqual({ type: 'click', x: 3, y: 1, button: 'left' })
    expect(parseWebviewMessage({ type: 'click', x: -1, y: 1 })).toBeNull()
    expect(parseWebviewMessage({ type: 'wheel', x: 1, y: 1, direction: 'sideways' })).toBeNull()
    expect(parseWebviewMessage({ type: 'fit', columns: 2, rows: 1 })).toEqual({ type: 'fit', columns: 10, rows: 3 })
    expect(parseWebviewMessage({ type: 'nope' })).toBeNull()
    expect(parseWebviewMessage('x')).toBeNull()
  })
  it('converts to preview commands', () => {
    expect(toPreviewCommand({ type: 'key', key: 'tab' })).toEqual({ type: 'key', keys: ['tab'] })
    expect(toPreviewCommand({ type: 'wheel', x: 1, y: 2, direction: 'down' })).toEqual({ type: 'scroll', direction: 'down', x: 1, y: 2 })
    expect(toPreviewCommand({ type: 'fit', columns: 90, rows: 20 })).toEqual({ type: 'resize', columns: 90, rows: 20 })
    expect(toPreviewCommand({ type: 'restart' })).toBeNull()
  })
  it('renders frames as colored HTML', () => {
    const b = new CellBuffer(6, 2)
    b.set(0, 0, 'H', 1, '38;2;255;0;0', '48;2;0;0;255', 1)
    b.set(1, 0, '<', 1, '', null, 0)
    const m = frameMessage(snapshotFrame(b, 3))
    expect(m).toMatchObject({ type: 'frame', columns: 6, rows: 2, frame: 3 })
    expect((m as { html: string }).html).toContain('<span style="color:#ff0000;background:#0000ff;font-weight:bold">H</span>&lt;')
  })
})

describe('webview document', () => {
  const html = webviewHtml({ nonce: 'abc123', cspSource: 'vscode-resource:', title: 'T<1>', autoFit: true })
  it('has a strict CSP with a script nonce', () => {
    expect(html).toContain(`script-src 'nonce-abc123'`)
    expect(html).toContain('<script nonce="abc123">')
    expect(html).toContain('<title>T&lt;1&gt;</title>')
  })
  it('contains a valid script', () => {
    const script = /<script nonce="abc123">([\s\S]*)<\/script>/.exec(html)![1]
    expect(() => new Function(script)).not.toThrow()
  })

  // Runs the document in Chromium with a stubbed VS Code API (skipped without Playwright).
  let chromium: { launch(): Promise<any> } | null = null
  try {
    chromium = createRequire('/opt/node22/lib/node_modules/')('playwright').chromium
  } catch {
    chromium = null
  }
  it.skipIf(!chromium)('forwards keys, clicks and fit; renders frames', async () => {
    const browser = await chromium!.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 400 } })
      const stub = '<script>window.__sent = []; window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__sent.push(m) })</script>'
      await page.setContent(html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '').replace('<script nonce', stub + '<script nonce'))
      const b = new CellBuffer(10, 3)
      'Hello'.split('').forEach((c, i) => b.set(i, 1, c, 1, '31', null, 0))
      const msg = frameMessage(snapshotFrame(b, 1))
      await page.evaluate((m: unknown) => window.postMessage(m, '*'), msg)
      await page.waitForFunction(() => document.querySelector('#screen pre') !== null)
      expect(await page.textContent('#status')).toBe('10×3  frame 1')
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Control+s')
      await page.keyboard.type('x')
      const pre = (await page.$('#screen pre'))!
      const box = await pre.boundingBox()
      // click the "e" of Hello (x=1, y=1)
      const cell = await page.evaluate(() => {
        const p = document.createElement('span'); p.className = 'vurses-frame'; p.style.cssText = 'position:absolute;visibility:hidden;padding:0'; p.textContent = 'MMMMMMMMMM'
        document.body.appendChild(p); const r = p.getBoundingClientRect(); p.remove(); return { w: r.width / 10, h: r.height }
      })
      const pad = 4
      await page.mouse.click(box.x + pad + cell.w * 1.5, box.y + pad + cell.h * 1.5)
      await page.waitForTimeout(200)
      const sent = await page.evaluate(() => (window as any).__sent)
      expect(sent[0]).toEqual({ type: 'ready' })
      expect(sent).toContainEqual({ type: 'key', key: 'shift+tab' })
      expect(sent).toContainEqual({ type: 'key', key: 'ctrl+s' })
      expect(sent).toContainEqual({ type: 'key', key: 'x' })
      expect(sent).toContainEqual({ type: 'click', x: 1, y: 1, button: 'left' })
      expect(sent.find((m: { type: string }) => m.type === 'fit')).toMatchObject({ columns: expect.any(Number), rows: expect.any(Number) })
    } finally {
      await browser.close()
    }
  }, 30000)
})
