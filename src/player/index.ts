/**
 * vuecli frame player: the browser half of server-rendered routes
 * (`export const runtime = 'server'`). No Vue in here — it only
 *
 *  1. paints the server-rendered first frame (shell) embedded in the page,
 *  2. opens the session stream (SSE) and applies row deltas to a screen model,
 *  3. presents the screen in the devtools console (Turbolog: dirty-gated,
 *     run-length `%c` spans, one `console.log` per changed frame >= 66 ms apart)
 *     and optionally in a DOM `<pre>` view,
 *  4. sends keys / paste / IME text (hidden textarea), mouse (DOM view) and
 *     resizes back with POST requests, in order.
 *
 * Built with esbuild into `/_vuecli/player.js` (a few kB gzipped).
 */
import { readBoot, type BootData } from '../server/html.js'
import { DomView } from '../targets/dom-view.js'
import { attachHiddenInput } from '../targets/input.js'
import { setupPageChrome } from '../targets/page.js'
import { ScreenState, type FrameDelta } from '../targets/protocol.js'
import { liveReload } from '../targets/reload.js'
import { resolveScreenSize } from '../targets/size.js'
import { Turbolog } from '../targets/turbolog.js'

export interface PlayerHandle {
  readonly state: ScreenState
  readonly turbolog: Turbolog
  readonly sid: string | null
  send(data: string): void
  close(): void
}

export function startPlayer(boot: BootData): PlayerHandle {
  const state = new ScreenState()
  const turbolog = new Turbolog()
  let view: DomView | null = null
  let sid: string | null = null
  let es: EventSource | null = null
  const queue: string[] = []
  let sending = false
  let resizeMsg: { cols: number; rows: number } | null = null

  const present = () => {
    if (!state.screen.width) return
    turbolog.present(state.screen)
    view?.paint(state.screen)
  }
  const chrome = setupPageChrome((on) => {
    if (on && !view) {
      view = new DomView(chrome.root, { onMouse: send })
      view.paint(state.screen)
    } else if (!on && view) {
      view.dispose()
      view = null
    }
  })
  if (chrome.dom) view = new DomView(chrome.root, { onMouse: send })

  // ordered, batched input posting
  async function pump() {
    if (sending || !sid || !boot.input) return
    sending = true
    try {
      while (sid && (queue.length || resizeMsg)) {
        const data = queue.splice(0).join('')
        const body: Record<string, unknown> = { sid }
        if (data) body.data = data
        if (resizeMsg) Object.assign(body, resizeMsg)
        resizeMsg = null
        const res = await fetch(boot.input, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true })
        if (res.status === 404) {
          sid = null // session gone; the stream reconnects and creates a new one
          break
        }
      }
    } catch {
      /* network error: drop */
    } finally {
      sending = false
    }
  }
  function send(data: string) {
    queue.push(data)
    void pump()
  }

  if (boot.shell) {
    state.apply(boot.shell)
    present()
  }
  const size = resolveScreenSize({ fit: true })
  if (boot.live && boot.stream) {
    const url = new URL(boot.stream, location.href)
    url.searchParams.set('path', boot.path)
    url.searchParams.set('cols', String(size.columns))
    url.searchParams.set('rows', String(size.rows))
    es = new EventSource(url)
    chrome.status('connecting…')
    es.addEventListener('hello', (e) => {
      sid = JSON.parse((e as MessageEvent).data).sid
      chrome.status('')
      void pump()
    })
    es.addEventListener('frame', (e) => {
      state.apply(JSON.parse((e as MessageEvent).data) as FrameDelta)
      present()
    })
    es.addEventListener('redirect', (e) => {
      es?.close()
      location.assign(JSON.parse((e as MessageEvent).data).url)
    })
    es.addEventListener('bye', (e) => {
      const { reason } = JSON.parse((e as MessageEvent).data)
      es?.close()
      sid = null
      chrome.status(`session ended (${reason}) — reload to restart`)
      console.info(`[vuecli] session ended (${reason})`)
    })
    es.addEventListener('error', () => {
      sid = null
      chrome.status('reconnecting…')
    })
  } else if (boot.note) chrome.status(boot.note)

  const input = attachHiddenInput({ onData: send })
  let t: ReturnType<typeof setTimeout> | null = null
  const onResize = () => {
    if (t) clearTimeout(t)
    t = setTimeout(() => {
      const s = resolveScreenSize({ fit: true, cell: view?.cellSize() })
      resizeMsg = { cols: s.columns, rows: s.rows }
      void pump()
    }, 150)
  }
  if (!size.fixed) addEventListener('resize', onResize)
  const stopReload = boot.reload ? liveReload(boot.reload) : () => {}

  return {
    state,
    turbolog,
    get sid() {
      return sid
    },
    send,
    close() {
      es?.close()
      input.dispose()
      stopReload()
      removeEventListener('resize', onResize)
      turbolog.dispose()
    },
  }
}

const boot = typeof document !== 'undefined' ? readBoot() : null
if (boot?.mode === 'server') {
  ;(globalThis as any).__VUECLI_PLAYER__ = startPlayer(boot)
}
