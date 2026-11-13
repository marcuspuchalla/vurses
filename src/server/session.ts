/**
 * Server-side sessions: one headless vurses Runtime per connected browser.
 *
 *   browser ──GET /_vurses/stream?path=/live&cols=80&rows=24──▶ session (SSE)
 *           ◀── hello {sid} · frame {FrameDelta} · bye ──────────
 *   browser ──POST /_vurses/input {sid, data | cols/rows}──────▶ runtime.handleInput / resize
 *
 * The runtime renders into a `streamTarget` (row deltas against what the
 * client already has). The session ends when the client disconnects (stream
 * cancelled / request aborted), when the app exits, or after `idleTimeout`
 * without input. Portable: no Node built-ins.
 */
import type { Component } from 'vue'
import { createApp } from '../app/app.js'
import { hashRows, gridText } from '../targets/grid.js'
import { DeltaEncoder, type FrameDelta } from '../targets/protocol.js'
import { streamTarget } from '../targets/stream.js'
import { createSSE, SSE_HEADERS } from './sse.js'

/** Creates the root component for a path (usually the App Router at that path). */
export type RootFactory = (pathname: string, request?: Request) => Promise<Component> | Component

export interface SessionManagerOptions {
  createRoot: RootFactory
  /** Max concurrent sessions (503 above). Default: 200. */
  maxSessions?: number
  /** Max concurrent sessions per client address (429 above), when the adapter knows it. Default: 8. */
  maxSessionsPerClient?: number
  /** End a session after this many ms without input. Default: 30 minutes. 0 = never. */
  idleTimeout?: number
  /** Frame rate cap for streamed sessions. Default: 30. */
  fps?: number
  /** Theme name passed to the runtime. */
  theme?: string
  /** Include error messages in `bye` events. Default: false. */
  exposeErrors?: boolean
  onError?(error: unknown): void
}

export interface Session {
  readonly id: string
  readonly path: string
  readonly createdAt: number
  /** Feed raw terminal input. */
  input(data: string): void
  resize(columns: number, rows: number): void
  close(reason?: string): void
}

const clampSize = (n: number, lo: number, hi: number, d: number) => (Number.isFinite(n) && n > 0 ? Math.max(lo, Math.min(hi, Math.floor(n))) : d)

function randomId() {
  const c = (globalThis as any).crypto
  if (c?.randomUUID) return c.randomUUID() as string
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export class SessionManager {
  private sessions = new Map<string, Session>()
  /** Open session ids per client address. */
  private byClient = new Map<string, Set<string>>()
  constructor(readonly options: SessionManagerOptions) {}

  get size() {
    return this.sessions.size
  }
  get(id: string) {
    return this.sessions.get(id)
  }
  list() {
    return [...this.sessions.values()]
  }

  /**
   * Opens a session for `pathname` and returns the SSE response. `extra`
   * events (e.g. title) can be sent by the caller through `onOpen`.
   */
  async open(pathname: string, opts: { columns?: number; rows?: number; request?: Request; signal?: AbortSignal; client?: string } = {}): Promise<Response> {
    const o = this.options
    if (this.sessions.size >= (o.maxSessions ?? 200)) {
      return new Response('too many sessions', { status: 503, headers: { 'retry-after': '5' } })
    }
    // one client must not be able to take every session (each one is a whole Vue app)
    const mine = opts.client ? (this.byClient.get(opts.client) ?? new Set<string>()) : null
    if (mine && mine.size >= (o.maxSessionsPerClient ?? 8)) {
      return new Response('too many sessions from this client', { status: 429, headers: { 'retry-after': '5' } })
    }
    const columns = clampSize(opts.columns ?? NaN, 10, 500, 80)
    const rows = clampSize(opts.rows ?? NaN, 4, 300, 24)
    const id = randomId()
    let root: Component
    try {
      root = await o.createRoot(pathname, opts.request)
    } catch (e) {
      o.onError?.(e)
      return new Response('failed to create session', { status: 500 })
    }
    let session: Session | null = null
    const sse = createSSE({ onCancel: () => session?.close('disconnect'), retry: 1000 })
    const target = streamTarget({ columns, rows, send: (_d, json) => sse.send('frame', json) })
    const app = createApp(root)
    let ended = false
    app.config.errorHandler = (err) => {
      o.onError?.(err)
      end('error', err)
    }
    let idle: ReturnType<typeof setTimeout> | null = null
    const idleMs = o.idleTimeout ?? 30 * 60_000
    const touch = () => {
      if (!idleMs) return
      if (idle) clearTimeout(idle)
      idle = setTimeout(() => end('idle'), idleMs)
      ;(idle as { unref?: () => void }).unref?.()
    }
    const end = (reason: string, error?: unknown) => {
      if (ended) return
      ended = true
      if (idle) clearTimeout(idle)
      this.sessions.delete(id)
      if (mine && opts.client) {
        mine.delete(id)
        if (!mine.size) this.byClient.delete(opts.client)
      }
      const msg = error && o.exposeErrors ? String((error as Error)?.message ?? error) : undefined
      sse.send('bye', JSON.stringify({ reason, error: msg }))
      sse.close()
      try {
        app.runtime?.exit()
      } catch {
        /* ignore */
      }
    }
    session = {
      id,
      path: pathname,
      createdAt: Date.now(),
      input(data) {
        touch()
        app.runtime?.handleInput(data)
      },
      resize(c, r) {
        touch()
        app.runtime?.resize(clampSize(c, 10, 500, columns), clampSize(r, 4, 300, rows))
      },
      close: (reason = 'closed') => end(reason),
    }
    this.sessions.set(id, session)
    if (mine && opts.client) {
      mine.add(id)
      this.byClient.set(opts.client, mine)
    }
    opts.signal?.addEventListener('abort', () => end('disconnect'), { once: true })
    sse.send('hello', JSON.stringify({ sid: id, columns, rows, path: pathname }))
    touch()
    try {
      app.mount({ target, fps: o.fps ?? 30, exitOnCtrlC: false, patchConsole: false, theme: o.theme })
      app.runtime!.events.on('exit', () => end('exit'))
    } catch (e) {
      o.onError?.(e)
      end('error', e)
    }
    return new Response(sse.stream, { headers: SSE_HEADERS })
  }

  /** Closes every session (server shutdown). */
  closeAll() {
    for (const s of this.list()) s.close('shutdown')
  }
}

export interface Shell {
  /** Full first frame (protocol delta with `full: 1`). */
  frame: FrameDelta
  /** Plain text of the frame (noscript / text clients). */
  text: string
  columns: number
  rows: number
  /** ms epoch. */
  createdAt: number
}

/**
 * Renders the first frame of a root offscreen: mounts headless, waits until
 * async components / data settle (or `maxWait` ms), returns the frame.
 * Used for route-level `revalidate` caching and build-time prerendering (PPR shells).
 */
export async function renderShell(
  root: Component,
  options: { columns?: number; rows?: number; maxWait?: number; theme?: string; ready?: () => Promise<void> } = {},
): Promise<Shell> {
  const columns = options.columns ?? 80
  const rows = options.rows ?? 24
  const app = createApp(root)
  let failure: unknown = null
  app.config.errorHandler = (e) => {
    failure = e
  }
  app.mount({ manualRender: true, columns, rows, autoFocus: true, exitOnCtrlC: false, theme: options.theme })
  const rt = app.runtime!
  const deadline = Date.now() + (options.maxWait ?? 300)
  if (options.ready) await Promise.race([options.ready().catch(() => {}), new Promise((r) => setTimeout(r, options.maxWait ?? 300))])
  let prev = ''
  let stable = 0
  let buf = rt.renderFrame()
  while (Date.now() < deadline && stable < 2) {
    await new Promise((r) => setTimeout(r, 8))
    buf = rt.renderFrame()
    const h = hashRows(buf).join(',')
    stable = h === prev ? stable + 1 : 0
    prev = h
  }
  rt.exit()
  if (failure) throw failure
  const frame = new DeltaEncoder().encode(buf)!
  return { frame, text: gridText(buf), columns, rows, createdAt: Date.now() }
}
