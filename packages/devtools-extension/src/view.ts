/**
 * Pure rendering helpers for the DevTools panel (strings in, strings out;
 * unit-tested in Node).
 */
import { escapeHtml } from '../../../src/devtools/html.js'
import type { ComponentInfo, Rect } from '../../../src/devtools/tree.js'
import type { ComponentDetails, FrameRecord } from '../../../src/devtools/hook.js'

export const rectText = (r: Rect | null | undefined) => (r ? `${r.x},${r.y} ${r.width}×${r.height}` : '—')

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/** Component tree as nested `<ul>` with `data-id` on each row. */
export function treeHtml(nodes: ComponentInfo[], selected: number | null, collapsed: Set<number>, filter = ''): string {
  const f = filter.trim().toLowerCase()
  const matches = (n: ComponentInfo): boolean => !f || n.name.toLowerCase().includes(f) || n.children.some(matches)
  const item = (n: ComponentInfo): string => {
    if (!matches(n)) return ''
    const open = !collapsed.has(n.id) || !!f
    const kids = n.children.length
    const toggle = kids ? `<span class="toggle" data-toggle="${n.id}">${open ? '▾' : '▸'}</span>` : '<span class="toggle"></span>'
    const row =
      `<div class="row${n.id === selected ? ' selected' : ''}" data-id="${n.id}">${toggle}` +
      `<span class="name">&lt;${escapeHtml(n.name)}&gt;</span>` +
      `<span class="rect">${escapeHtml(rectText(n.rect))}</span></div>`
    const children = kids && open ? `<ul>${n.children.map(item).join('')}</ul>` : ''
    return `<li>${row}${children}</li>`
  }
  const body = nodes.map(item).join('')
  return body ? `<ul class="tree">${body}</ul>` : '<div class="empty">No components</div>'
}

function valueHtml(v: unknown): string {
  if (v === null || v === undefined) return '<span class="v-null">null</span>'
  if (typeof v === 'string') return `<span class="v-str">${escapeHtml(JSON.stringify(v))}</span>`
  if (typeof v === 'number' || typeof v === 'boolean') return `<span class="v-num">${String(v)}</span>`
  return `<span class="v-obj">${escapeHtml(JSON.stringify(v))}</span>`
}

function tableHtml(title: string, o: Record<string, unknown>): string {
  const keys = Object.keys(o)
  const rows = keys.length
    ? keys.map((k) => `<tr><th>${escapeHtml(k)}</th><td>${valueHtml(o[k])}</td></tr>`).join('')
    : '<tr><td class="empty">none</td></tr>'
  return `<h3>${escapeHtml(title)}</h3><table class="kv">${rows}</table>`
}

/** Details pane for the selected component. */
export function detailsHtml(d: ComponentDetails | null): string {
  if (!d) return '<div class="empty">Select a component</div>'
  return (
    `<h2>&lt;${escapeHtml(d.name)}&gt; <span class="muted">#${d.id}</span></h2>` +
    (d.file ? `<div class="muted file">${escapeHtml(d.file)}</div>` : '') +
    `<table class="kv"><tr><th>rect</th><td>${escapeHtml(rectText(d.rect))}</td></tr>` +
    `<tr><th>elements</th><td>${d.elements.length}</td></tr><tr><th>children</th><td>${d.childCount}</td></tr></table>` +
    tableHtml('props', d.props) +
    tableHtml('state', d.setupState)
  )
}

export interface TimelineSummary {
  frames: number
  avgMs: number
  maxMs: number
  avgBytes: number
  totalBytes: number
}

export function summarize(records: FrameRecord[]): TimelineSummary {
  const n = records.length
  const sum = (f: (r: FrameRecord) => number) => records.reduce((a, r) => a + f(r), 0)
  return {
    frames: n,
    avgMs: n ? Math.round((sum((r) => r.ms) / n) * 100) / 100 : 0,
    maxMs: n ? Math.max(...records.map((r) => r.ms)) : 0,
    avgBytes: n ? Math.round(sum((r) => r.bytes) / n) : 0,
    totalBytes: sum((r) => r.bytes),
  }
}

/** Per-frame bars: height = ms (scaled to the slowest frame, min 16ms scale), title = details. */
export function timelineSvg(records: FrameRecord[], width = 600, height = 60): string {
  if (!records.length) return '<div class="empty">No frames yet</div>'
  const scale = Math.max(16, ...records.map((r) => r.ms))
  const bw = width / Math.max(records.length, 60)
  const budget = height - (16 / scale) * height
  const bars = records
    .map((r, i) => {
      const h = Math.max(1, (r.ms / scale) * height)
      const cls = r.ms > 16 ? 'slow' : r.bytes === 0 ? 'idle' : 'ok'
      const title = `frame ${r.frame}: ${r.ms} ms, ${formatBytes(r.bytes)}, ${r.changedRows} rows changed`
      return `<rect class="${cls}" x="${(i * bw).toFixed(1)}" y="${(height - h).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${h.toFixed(1)}"><title>${escapeHtml(title)}</title></rect>`
    })
    .join('')
  return `<svg class="timeline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" width="100%" height="${height}">` +
    `<line class="budget" x1="0" x2="${width}" y1="${budget.toFixed(1)}" y2="${budget.toFixed(1)}"><title>16 ms (60 fps)</title></line>${bars}</svg>`
}

/** Finds a component by id in a tree. */
export function findNode(nodes: ComponentInfo[], id: number): ComponentInfo | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const c = findNode(n.children, id)
    if (c) return c
  }
  return null
}
