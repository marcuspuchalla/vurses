/**
 * Preview webview: the HTML shell and the messages exchanged with the
 * extension host (pure: no VS Code APIs, unit-tested).
 */
import { FRAME_CSS, frameToHtml } from '../../../src/devtools/html.js'
import type { FrameSnapshot } from '../../../src/devtools/frame.js'
import { keyComboFromEvent } from './keys.js'

/** Extension → webview */
export type ToWebview =
  | { type: 'frame'; html: string; columns: number; rows: number; frame?: number }
  | { type: 'status'; text: string; level?: 'info' | 'error' }
  | { type: 'log'; level: string; message: string }

/** Webview → extension */
export type FromWebview =
  | { type: 'key'; key: string }
  | { type: 'paste'; text: string }
  | { type: 'click'; x: number; y: number; button: 'left' | 'right' | 'middle' }
  | { type: 'wheel'; x: number; y: number; direction: 'up' | 'down' }
  | { type: 'fit'; columns: number; rows: number }
  | { type: 'restart' }
  | { type: 'ready' }

export interface PreviewTheme {
  fg: string
  bg: string
}

/** Renders a frame snapshot into the message posted to the webview. */
export function frameMessage(snap: FrameSnapshot): ToWebview {
  return { type: 'frame', html: frameToHtml(snap), columns: snap.width, rows: snap.height, frame: snap.frame }
}

/** Parses / validates a message from the webview (it is untrusted input). */
export function parseWebviewMessage(m: unknown): FromWebview | null {
  if (!m || typeof m !== 'object') return null
  const o = m as Record<string, unknown>
  const int = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? Math.floor(v) : null)
  switch (o.type) {
    case 'key':
      return typeof o.key === 'string' && o.key.length > 0 && o.key.length < 40 ? { type: 'key', key: o.key } : null
    case 'paste':
      return typeof o.text === 'string' ? { type: 'paste', text: o.text.slice(0, 100_000) } : null
    case 'click': {
      const x = int(o.x, 2000)
      const y = int(o.y, 2000)
      const button = o.button === 'right' || o.button === 'middle' ? o.button : 'left'
      return x === null || y === null ? null : { type: 'click', x, y, button }
    }
    case 'wheel': {
      const x = int(o.x, 2000)
      const y = int(o.y, 2000)
      return x === null || y === null || (o.direction !== 'up' && o.direction !== 'down') ? null : { type: 'wheel', x, y, direction: o.direction }
    }
    case 'fit': {
      const columns = int(o.columns, 1000)
      const rows = int(o.rows, 500)
      return columns && rows ? { type: 'fit', columns: Math.max(10, columns), rows: Math.max(3, rows) } : null
    }
    case 'restart':
    case 'ready':
      return { type: o.type }
    default:
      return null
  }
}

/** Converts a webview message into a JSON-lines preview command (see src/mcp/jsonl.ts). */
export function toPreviewCommand(m: FromWebview): Record<string, unknown> | null {
  switch (m.type) {
    case 'key':
      return { type: 'key', keys: [m.key] }
    case 'paste':
      return { type: 'paste', text: m.text }
    case 'click':
      return { type: 'click', x: m.x, y: m.y, button: m.button }
    case 'wheel':
      return { type: 'scroll', direction: m.direction, x: m.x, y: m.y }
    case 'fit':
      return { type: 'resize', columns: m.columns, rows: m.rows }
    default:
      return null
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export interface ShellOptions {
  nonce: string
  cspSource: string
  title: string
  /** Fit the virtual terminal to the panel size. */
  autoFit?: boolean
}

/** The webview document. Frames arrive as `{ type: 'frame', html }` messages. */
export function webviewHtml(o: ShellOptions): string {
  const script = `
const vscode = acquireVsCodeApi();
const keyComboFromEvent = ${keyComboFromEvent.toString()};
const screen = document.getElementById('screen');
const status = document.getElementById('status');
const autoFit = ${o.autoFit ? 'true' : 'false'};
let cell = { w: 8, h: 16 };
function measure() {
  const probe = document.createElement('span');
  probe.className = 'vuecli-frame';
  probe.style.cssText = 'position:absolute;visibility:hidden;padding:0';
  probe.textContent = 'MMMMMMMMMM';
  document.body.appendChild(probe);
  const r = probe.getBoundingClientRect();
  probe.remove();
  cell = { w: r.width / 10 || 8, h: r.height || 16 };
}
function cellAt(ev) {
  const pre = screen.querySelector('pre');
  if (!pre) return null;
  const r = pre.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(pre).paddingLeft) || 0;
  const padTop = parseFloat(getComputedStyle(pre).paddingTop) || 0;
  return { x: Math.max(0, Math.floor((ev.clientX - r.left - pad) / cell.w)), y: Math.max(0, Math.floor((ev.clientY - r.top - padTop) / cell.h)) };
}
let fitTimer = null;
function fit() {
  if (!autoFit) return;
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => {
    const columns = Math.floor((window.innerWidth - 24) / cell.w);
    const rows = Math.floor((window.innerHeight - 40) / cell.h);
    vscode.postMessage({ type: 'fit', columns, rows });
  }, 120);
}
window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type === 'frame') { screen.innerHTML = m.html; status.textContent = m.columns + '×' + m.rows + (m.frame != null ? '  frame ' + m.frame : ''); status.className = ''; }
  else if (m.type === 'status') { status.textContent = m.text; status.className = m.level === 'error' ? 'error' : ''; }
});
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'v' || e.key === 'c')) return; // let paste / copy through
  const combo = keyComboFromEvent(e);
  if (!combo) return;
  e.preventDefault();
  vscode.postMessage({ type: 'key', key: combo });
});
window.addEventListener('paste', (e) => {
  const text = e.clipboardData && e.clipboardData.getData('text/plain');
  if (text) { e.preventDefault(); vscode.postMessage({ type: 'paste', text }); }
});
screen.addEventListener('mousedown', (e) => {
  const p = cellAt(e); if (!p) return;
  e.preventDefault();
  vscode.postMessage({ type: 'click', x: p.x, y: p.y, button: e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left' });
});
screen.addEventListener('wheel', (e) => {
  const p = cellAt(e); if (!p) return;
  e.preventDefault();
  vscode.postMessage({ type: 'wheel', x: p.x, y: p.y, direction: e.deltaY > 0 ? 'down' : 'up' });
}, { passive: false });
document.getElementById('restart').addEventListener('click', () => vscode.postMessage({ type: 'restart' }));
window.addEventListener('resize', fit);
measure();
fit();
vscode.postMessage({ type: 'ready' });
`
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${o.cspSource} 'unsafe-inline'; script-src 'nonce-${o.nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(o.title)}</title>
<style>
:root { --vuecli-fg: var(--vscode-terminal-foreground, #d4d4d4); --vuecli-bg: var(--vscode-terminal-background, var(--vscode-editor-background, #1e1e1e)); }
body { margin: 0; padding: 8px; background: var(--vuecli-bg); color: var(--vuecli-fg); font-family: var(--vscode-font-family); }
${FRAME_CSS}
.vuecli-frame { font-family: var(--vscode-editor-font-family, Menlo, monospace); font-size: var(--vscode-editor-font-size, 13px); cursor: default; user-select: text; }
#bar { display: flex; gap: 8px; align-items: center; font-size: 11px; opacity: .75; margin-bottom: 6px; }
#bar button { font-size: 11px; background: none; color: inherit; border: 1px solid currentColor; border-radius: 3px; cursor: pointer; }
#status.error { color: var(--vscode-errorForeground, #f48771); opacity: 1; white-space: pre-wrap; }
#screen:focus { outline: none; }
</style>
</head>
<body>
<div id="bar"><span id="status">starting…</span><span style="flex:1"></span><button id="restart" title="Restart the app">restart</button></div>
<div id="screen" tabindex="0"></div>
<script nonce="${o.nonce}">${script}</script>
</body>
</html>`
}
