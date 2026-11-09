/**
 * HTML documents served for page routes. Portable (string templates only).
 *
 * Every page is the same tiny shell: a hint bar, a mount point for the
 * optional DOM view, a JSON boot record and one module script:
 *  - client routes load the app bundle (the app runs in the page and renders
 *    into the devtools console through the browser console target)
 *  - server routes load the frame player (the app runs on the server and
 *    streams row deltas over SSE)
 */
import type { FrameDelta } from '../targets/protocol.js'

export const INTERNAL_PREFIX = '/_vuecli/'

export interface BootData {
  mode: 'client' | 'server'
  /** Path (with search) the app starts at. */
  path: string
  /** Server routes: a live session can be opened (node / bun). */
  live?: boolean
  /** SSE endpoint. */
  stream?: string
  /** Input endpoint (POST). */
  input?: string
  /** First frame rendered on the server / at build time (painted before the stream connects). */
  shell?: FrameDelta | null
  /** Dev live-reload SSE endpoint. */
  reload?: string
  /** Note shown when no live session is possible. */
  note?: string
}

export interface DocumentOptions {
  title?: string
  description?: string
  boot: BootData
  /** Module script URL (app bundle or player). */
  script: string | null
  /** Plain text of the first frame (for `<noscript>` / crawlers). */
  shellText?: string
}

const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
/** JSON safe to embed in a `<script>` element. */
export const embedJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

const CSS = `html,body{margin:0;background:#1e1e1e;color:#d4d4d4;font:14px/1.4 ui-monospace,Menlo,Consolas,monospace}
#vuecli-bar{display:flex;gap:12px;align-items:center;padding:8px 12px;border-bottom:1px solid #333;color:#9a9a9a}
#vuecli-bar b{color:#4fc1ff}#vuecli-bar kbd{border:1px solid #555;border-radius:3px;padding:0 4px;color:#d4d4d4}
#vuecli-bar button{margin-left:auto;background:#2d2d2d;color:#d4d4d4;border:1px solid #555;border-radius:4px;padding:2px 10px;font:inherit;cursor:pointer;white-space:nowrap}
#vuecli-root{padding:12px}#vuecli-status{color:#cca700}`

export function renderDocument(o: DocumentOptions): string {
  const title = escHtml(o.title ?? 'vuecli app')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:,">
<title>${title}</title>${o.description ? `\n<meta name="description" content="${escHtml(o.description)}">` : ''}
<style>${CSS}</style>
</head>
<body data-vuecli="${o.boot.mode}">
<div id="vuecli-bar"><b>vuecli</b><span>This app renders in the devtools console — open it with <kbd>F12</kbd> / <kbd>⌥⌘J</kbd>, click this page and type.</span><span id="vuecli-status"></span><button id="vuecli-toggle" type="button">DOM view</button></div>
<div id="vuecli-root"></div>
${o.shellText !== undefined ? `<noscript><pre>${escHtml(o.shellText)}</pre></noscript>\n` : ''}<script type="application/json" id="vuecli-boot">${embedJson(o.boot)}</script>
${o.script ? `<script type="module" src="${escHtml(o.script)}"></script>` : ''}
</body>
</html>
`
}

/** Reads the boot record in the browser. */
export function readBoot(doc: Document = (globalThis as any).document): BootData | null {
  const el = doc?.getElementById('vuecli-boot')
  if (!el?.textContent) return null
  try {
    return JSON.parse(el.textContent) as BootData
  } catch {
    return null
  }
}
