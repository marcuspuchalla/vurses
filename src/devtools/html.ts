/**
 * Renders a `FrameSnapshot` as HTML (a monospace grid of styled spans). Used
 * by the Chrome DevTools panel and the VS Code preview. Pure and browser-safe.
 */
import type { FrameRun, FrameSnapshot } from './frame.js'

export interface FrameHtmlOptions {
  /** Default foreground / background (used for inverse cells without colors). */
  defaultFg?: string
  defaultBg?: string
  /** Class of the outer `<pre>`. Default `vuecli-frame`. */
  className?: string
  /** Highlight rectangle (cell coordinates), drawn as an outline overlay. */
  highlight?: { x: number; y: number; width: number; height: number } | null
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c])
}

/** Inline CSS for one run. */
export function runStyle(r: FrameRun, opts: FrameHtmlOptions = {}): string {
  const f = r.f ?? 0
  let fg = r.fg
  let bg = r.bg
  if (f & 16) {
    const dfg = opts.defaultFg ?? 'var(--vuecli-fg, #d4d4d4)'
    const dbg = opts.defaultBg ?? 'var(--vuecli-bg, #1e1e1e)'
    ;[fg, bg] = [bg ?? dbg, fg ?? dfg]
  }
  const css: string[] = []
  if (fg) css.push(`color:${fg}`)
  if (bg) css.push(`background:${bg}`)
  if (f & 1) css.push('font-weight:bold')
  if (f & 2) css.push('opacity:.6')
  if (f & 4) css.push('font-style:italic')
  const deco = [f & 8 ? 'underline' : '', f & 32 ? 'line-through' : ''].filter(Boolean).join(' ')
  if (deco) css.push(`text-decoration:${deco}`)
  return css.join(';')
}

function runHtml(r: FrameRun, opts: FrameHtmlOptions, extraClass = ''): string {
  const style = runStyle(r, opts)
  const text = escapeHtml(r.t)
  if (!style && !extraClass) return text
  return `<span${extraClass ? ` class="${extraClass}"` : ''}${style ? ` style="${style}"` : ''}>${text}</span>`
}

/** One row as HTML. */
export function rowToHtml(runs: FrameRun[], opts: FrameHtmlOptions = {}): string {
  return runs.map((r) => runHtml(r, opts)).join('')
}

/**
 * The whole frame as HTML: a `<pre>` grid, wrapped in a relatively positioned
 * `<div>` when a highlight overlay is requested.
 */
export function frameToHtml(snap: FrameSnapshot, opts: FrameHtmlOptions = {}): string {
  const cls = opts.className ?? 'vuecli-frame'
  const body = snap.rows.map((runs) => rowToHtml(runs, opts)).join('\n')
  const pre = `<pre class="${escapeHtml(cls)}" data-cols="${snap.width}" data-rows="${snap.height}">${body}</pre>`
  const hl = opts.highlight
  if (!hl || hl.width <= 0 || hl.height <= 0) return pre
  const overlay =
    `<div class="vuecli-hl" style="left:calc(var(--vuecli-pad,4px) + ${hl.x}ch);top:calc(var(--vuecli-pad,4px) + ${hl.y * 1.2}em);` +
    `width:${hl.width}ch;height:${hl.height * 1.2}em"></div>`
  return `<div class="vuecli-frame-wrap">${pre}${overlay}</div>`
}

/** Default stylesheet for `frameToHtml` output. */
export const FRAME_CSS = `
.vuecli-frame{margin:0;padding:var(--vuecli-pad,4px);font:13px/1.2 Menlo,Monaco,Consolas,"DejaVu Sans Mono",monospace;
color:var(--vuecli-fg,#d4d4d4);background:var(--vuecli-bg,#1e1e1e);white-space:pre;display:inline-block;tab-size:1}
.vuecli-frame-wrap{position:relative;display:inline-block}
.vuecli-frame-wrap .vuecli-hl{position:absolute;pointer-events:none;outline:1px solid #ff5ea8;background:rgba(255,94,168,.25);font:13px/1.2 Menlo,Monaco,Consolas,"DejaVu Sans Mono",monospace}
`.trim()
