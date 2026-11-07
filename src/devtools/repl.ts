/**
 * `window.vuecli` / `globalThis.vuecli`: a console REPL for the running app.
 *
 *   vuecli.pause()            freeze presenting frames (state keeps updating)
 *   vuecli.resume()
 *   vuecli.step()             present one frame while paused
 *   vuecli.resize(100, 30)
 *   vuecli.wireframe()        toggle box outlines (or pass true / false)
 *   vuecli.copy()             current frame as plain text (+ clipboard in browsers)
 *   vuecli.frame()            current frame as plain text
 *   vuecli.tree()             print the component tree
 *   vuecli.press('tab', 'enter')
 *   vuecli.stats()
 */
import type { DevtoolsHook } from './hook.js'
import type { ComponentInfo } from './tree.js'

export interface VuecliRepl {
  pause(): string
  resume(): string
  step(): string
  resize(columns: number, rows: number): string
  wireframe(on?: boolean): boolean
  /** Returns the frame as plain text and copies it to the clipboard when available. */
  copy(): string
  frame(): string
  /** Frame with ANSI colors (paste into a terminal). */
  ansi(): string
  /** Prints the component tree (with layout rects) and returns it. */
  tree(): ComponentInfo[]
  /** Prints the element tree and returns it as text. */
  elements(): string
  press(...keys: string[]): Promise<string>
  type(text: string): Promise<string>
  highlight(id: number | null, ms?: number): void
  stats(): ReturnType<DevtoolsHook['stats']>
  help(): string
  readonly hook: DevtoolsHook
}

const HELP = `vuecli REPL
  vuecli.pause() / resume() / step()   freeze, unfreeze or advance one frame
  vuecli.resize(cols, rows)            change the virtual screen size
  vuecli.wireframe(on?)                outline every box (toggles without argument)
  vuecli.copy()                        frame as plain text (copied to the clipboard)
  vuecli.frame() / ansi()              frame as plain / ANSI text
  vuecli.tree() / elements()           component / element tree with layout rects
  vuecli.highlight(id, ms?)            flash a component or element by id
  vuecli.press('tab', 'ctrl+s')        send keys;  vuecli.type('hello')
  vuecli.stats()                       frames, fps, ms and bytes per frame`

export function createRepl(hook: DevtoolsHook): VuecliRepl {
  const log = (s: string) => {
    try {
      console.log(s)
    } catch {
      // ignore
    }
  }
  const repl: VuecliRepl = {
    get hook() {
      return hook
    },
    pause() {
      hook.pause()
      return 'paused'
    },
    resume() {
      hook.resume()
      return 'resumed'
    },
    step() {
      const r = hook.step()
      return r ? `frame ${r.frame}: ${r.ms}ms, ${r.bytes} bytes, ${r.changedRows} rows changed` : 'no app'
    },
    resize(columns, rows) {
      hook.resize(columns, rows)
      const st = hook.getState()
      return `${st.columns}x${st.rows}`
    },
    wireframe(on) {
      const next = on ?? !hook.getState().wireframe
      hook.setWireframe(next)
      return next
    },
    copy() {
      const text = hook.getFrameText()
      const nav = (globalThis as { navigator?: { clipboard?: { writeText?: (s: string) => Promise<void> } } }).navigator
      try {
        const p = nav?.clipboard?.writeText?.(text)
        if (p && typeof p.catch === 'function') p.catch(() => {})
      } catch {
        // clipboard access can throw outside a user gesture
      }
      return text
    },
    frame() {
      return hook.getFrameText()
    },
    ansi() {
      return hook.getFrameAnsi()
    },
    tree() {
      log(hook.formatComponentTree())
      return hook.getComponentTree()
    },
    elements() {
      const s = hook.formatElementTree()
      log(s)
      return s
    },
    async press(...keys) {
      await hook.press(...keys)
      return hook.getFrameText()
    },
    async type(text) {
      await hook.type(text)
      return hook.getFrameText()
    },
    highlight(id, ms) {
      hook.highlight(id, ms)
    },
    stats() {
      return hook.stats()
    },
    help() {
      log(HELP)
      return HELP
    },
  }
  return repl
}
