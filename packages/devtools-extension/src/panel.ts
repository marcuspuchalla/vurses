/**
 * The "vuecli" DevTools panel: component tree, selected component details,
 * frame inspector and frame timeline, plus pause / resume / step / wireframe.
 */
import { frameToHtml } from '../../../src/devtools/html.js'
import type { FrameSnapshot } from '../../../src/devtools/frame.js'
import type { ComponentInfo } from '../../../src/devtools/tree.js'
import type { ComponentDetails, DevtoolsState, FrameRecord } from '../../../src/devtools/hook.js'
import { HookMissingError, type HookBridge } from './bridge.js'
import { detailsHtml, findNode, formatBytes, summarize, timelineSvg, treeHtml } from './view.js'

export interface PanelOptions {
  /** Poll interval in ms (default 500). 0 disables polling (tests call refresh()). */
  interval?: number
}

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T

export class Panel {
  private tree: ComponentInfo[] = []
  private selected: number | null = null
  private collapsed = new Set<number>()
  private state: DevtoolsState | null = null
  private lastFrame = -1
  private timer: ReturnType<typeof setInterval> | null = null
  private busy = false
  private filter = ''
  connected = false

  constructor(
    private root: HTMLElement,
    private bridge: HookBridge,
    private opts: PanelOptions = {},
  ) {
    root.innerHTML = `
      <header class="toolbar">
        <button data-action="pause" title="Pause / resume presenting frames">⏸ Pause</button>
        <button data-action="step" title="Present one frame">⏭ Step</button>
        <label title="Outline every box"><input type="checkbox" data-action="wireframe"> Wireframe</label>
        <button data-action="refresh" title="Refresh">⟳</button>
        <span class="status" data-ref="status">connecting…</span>
      </header>
      <main>
        <section class="pane tree-pane">
          <input class="filter" type="search" placeholder="Filter components" data-ref="filter">
          <div data-ref="tree"></div>
        </section>
        <section class="pane details" data-ref="details"></section>
        <section class="pane frame-pane">
          <div class="frame-head"><strong>Frame</strong> <span class="muted" data-ref="frameinfo"></span></div>
          <div class="frame" data-ref="frame"></div>
          <div class="frame-head"><strong>Timeline</strong> <span class="muted" data-ref="summary"></span></div>
          <div data-ref="timeline"></div>
        </section>
      </main>`
    root.addEventListener('click', (e) => this.onClick(e))
    root.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement
      if (t.dataset.action === 'wireframe') void this.run('setWireframe', t.checked)
    })
    $<HTMLInputElement>(root, '[data-ref=filter]').addEventListener('input', (e) => {
      this.filter = (e.target as HTMLInputElement).value
      this.renderTree()
    })
  }

  start() {
    void this.refresh()
    const ms = this.opts.interval ?? 500
    if (ms > 0) this.timer = setInterval(() => void this.refresh(), ms)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Clears cached state (after the inspected page navigates). */
  reset() {
    this.tree = []
    this.selected = null
    this.lastFrame = -1
    this.state = null
  }

  private ref(name: string) {
    return $(this.root, `[data-ref=${name}]`)
  }

  private setStatus(text: string, error = false) {
    const el = this.ref('status')
    el.textContent = text
    el.classList.toggle('error', error)
  }

  private async run(method: string, ...args: unknown[]) {
    try {
      await this.bridge.call(method, ...args)
      this.lastFrame = -1
      await this.refresh()
    } catch (e) {
      this.handleError(e)
    }
  }

  private handleError(e: unknown) {
    this.connected = false
    this.root.classList.add('disconnected')
    this.setStatus(e instanceof HookMissingError ? 'No vuecli app on this page (VC116). Reload after the app starts.' : `Error: ${(e as Error).message}`, true)
  }

  private async onClick(e: Event) {
    const t = e.target as HTMLElement
    const toggle = t.closest<HTMLElement>('[data-toggle]')
    if (toggle) {
      const id = Number(toggle.dataset.toggle)
      if (this.collapsed.has(id)) this.collapsed.delete(id)
      else this.collapsed.add(id)
      this.renderTree()
      return
    }
    const row = t.closest<HTMLElement>('.row[data-id]')
    if (row) return this.select(Number(row.dataset.id))
    const action = t.closest<HTMLElement>('button[data-action]')?.dataset.action
    if (action === 'pause') return this.run(this.state?.paused ? 'resume' : 'pause')
    if (action === 'step') return this.run('step')
    if (action === 'refresh') {
      this.lastFrame = -1
      return this.refresh()
    }
  }

  /** Selects a component: shows its details and highlights it in the app. */
  async select(id: number) {
    this.selected = id
    this.renderTree()
    try {
      const [details] = await Promise.all([
        this.bridge.call<ComponentDetails | null>('getComponent', id),
        this.bridge.call('highlight', id, 1500),
      ])
      this.ref('details').innerHTML = detailsHtml(details)
      this.lastFrame = -1
      await this.renderFrame()
    } catch (e) {
      this.handleError(e)
    }
  }

  async refresh() {
    if (this.busy) return
    this.busy = true
    try {
      const state = await this.bridge.call<DevtoolsState>('getState')
      this.state = state
      this.connected = true
      this.root.classList.remove('disconnected')
      this.renderToolbar()
      if (state.frames !== this.lastFrame) {
        const [tree, timeline] = await Promise.all([
          this.bridge.call<ComponentInfo[]>('getComponentTree'),
          this.bridge.call<FrameRecord[]>('getTimeline', 120),
        ])
        this.tree = tree ?? []
        if (this.selected !== null && !findNode(this.tree, this.selected)) {
          this.selected = null
          this.ref('details').innerHTML = detailsHtml(null)
        }
        this.renderTree()
        this.renderTimeline(timeline ?? [])
        await this.renderFrame()
        this.lastFrame = state.frames
      }
    } catch (e) {
      this.handleError(e)
    } finally {
      this.busy = false
    }
  }

  private renderToolbar() {
    const s = this.state!
    const pause = $(this.root, 'button[data-action=pause]')
    pause.textContent = s.paused ? '▶ Resume' : '⏸ Pause'
    $<HTMLInputElement>(this.root, 'input[data-action=wireframe]').checked = s.wireframe
    this.setStatus(`${s.columns}×${s.rows} · frame ${s.frames} · ${s.fps} fps${s.paused ? ' · paused' : ''}${s.apps > 1 ? ` · ${s.apps} apps` : ''}`)
  }

  private renderTree() {
    this.ref('tree').innerHTML = treeHtml(this.tree, this.selected, this.collapsed, this.filter)
    if (!this.ref('details').innerHTML) this.ref('details').innerHTML = detailsHtml(null)
  }

  private renderTimeline(records: FrameRecord[]) {
    this.ref('timeline').innerHTML = timelineSvg(records)
    const s = summarize(records)
    this.ref('summary').textContent = s.frames ? `last ${s.frames}: avg ${s.avgMs} ms (max ${s.maxMs}), avg ${formatBytes(s.avgBytes)}` : ''
  }

  private async renderFrame() {
    const snap = await this.bridge.call<FrameSnapshot | null>('getFrame')
    if (!snap) {
      this.ref('frame').innerHTML = '<div class="empty">No frame</div>'
      return
    }
    const sel = this.selected !== null ? findNode(this.tree, this.selected) : null
    this.ref('frame').innerHTML = frameToHtml(snap, { highlight: sel?.rect ?? null })
    this.ref('frameinfo').textContent = `${snap.width}×${snap.height}${snap.frame !== undefined ? ` · #${snap.frame}` : ''}`
  }
}
