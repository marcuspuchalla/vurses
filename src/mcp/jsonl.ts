/**
 * JSON-lines preview protocol (`vuecli mcp <entry> --jsonl`): a lighter
 * alternative to MCP for editors that want to show live frames.
 *
 * stdin, one JSON object per line:
 *   { "type": "key", "keys": ["tab", "ctrl+s"] }
 *   { "type": "type", "text": "hello" }        { "type": "paste", "text": "..." }
 *   { "type": "input", "data": "\u001b[A" }     raw terminal input
 *   { "type": "click", "x": 3, "y": 1 }         { "type": "scroll", "direction": "down", "x": 3, "y": 1 }
 *   { "type": "resize", "columns": 100, "rows": 30 }
 *   { "type": "frame" }                         request the current frame
 *   { "type": "tree" }                          request the component tree
 *   { "type": "exit" }
 *
 * stdout:
 *   { "type": "ready", "columns": 80, "rows": 24 }
 *   { "type": "frame", "frame": FrameSnapshot }   whenever the screen changes
 *   { "type": "tree", "tree": ComponentInfo[] }
 *   { "type": "log", "level": "warn", "message": "...", "time": 0 }
 *   { "type": "error", "message": "...", "code"?: "VC113" }
 *   { "type": "exit", "error"?: "..." }
 */
import { snapshotFrame } from '../devtools/frame.js'
import { isVuecliError } from '../errors.js'
import type { HeadlessSession } from './session.js'

export type PreviewCommand =
  | { type: 'key'; keys: string | string[] }
  | { type: 'type'; text: string }
  | { type: 'paste'; text: string }
  | { type: 'input'; data: string }
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right' | 'middle' }
  | { type: 'scroll'; direction: 'up' | 'down' | 'left' | 'right'; x?: number; y?: number; amount?: number }
  | { type: 'resize'; columns: number; rows: number }
  | { type: 'frame' }
  | { type: 'tree' }
  | { type: 'exit' }

export interface PreviewIO {
  /** Called with each outgoing message (one JSON line, without newline). */
  send(line: string): void
  /** Registers a handler for incoming lines; returns an unsubscribe function. */
  onLine(fn: (line: string) => void): () => void
}

/** Splits a stream of chunks into lines. */
export function lineSplitter(fn: (line: string) => void) {
  let buf = ''
  return (chunk: string | Buffer) => {
    buf += chunk.toString()
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '')
      buf = buf.slice(i + 1)
      if (line.trim()) fn(line)
    }
  }
}

/**
 * Runs the preview protocol for a session. Returns a stop function; its
 * `idle()` resolves once every command received so far has been handled.
 */
export function servePreview(session: HeadlessSession, io: PreviewIO): (() => void) & { idle(): Promise<void> } {
  const send = (msg: Record<string, unknown>) => io.send(JSON.stringify(msg))
  let lastFrame = ''
  let logCursor = session.runtime.ctx.logs.length
  const flushLogs = () => {
    const logs = session.runtime.ctx.logs
    if (logCursor > logs.length) logCursor = 0
    for (; logCursor < logs.length; logCursor++) send({ type: 'log', ...logs[logCursor] })
  }
  const sendFrame = (force = false) => {
    const snap = snapshotFrame(session.runtime.buffer ?? session.buffer(), session.runtime.ctx.stats.frames)
    const key = JSON.stringify(snap.rows) + snap.width + 'x' + snap.height
    if (!force && key === lastFrame) return
    lastFrame = key
    send({ type: 'frame', frame: snap })
  }

  const offFrame = session.onFrame(() => {
    flushLogs()
    sendFrame()
  })
  const logTimer = setInterval(flushLogs, 250)
  ;(logTimer as { unref?: () => void }).unref?.()

  let queue = Promise.resolve()
  const handle = async (cmd: PreviewCommand) => {
    switch (cmd.type) {
      case 'key':
        return session.press(cmd.keys)
      case 'type':
        return session.type(cmd.text)
      case 'paste':
        return session.paste(cmd.text)
      case 'input':
        return session.write(cmd.data)
      case 'click':
        return void (await session.click({ x: cmd.x, y: cmd.y, button: cmd.button }))
      case 'scroll':
        return void (await session.scroll(cmd))
      case 'resize':
        return session.resize(cmd.columns, cmd.rows)
      case 'frame':
        await session.settle()
        return sendFrame(true)
      case 'tree':
        return send({ type: 'tree', tree: session.componentTree() })
      case 'exit':
        return session.close()
      default:
        throw new Error(`unknown command type ${JSON.stringify((cmd as { type?: unknown }).type)}`)
    }
  }
  const offLine = io.onLine((line) => {
    let cmd: PreviewCommand
    try {
      cmd = JSON.parse(line)
    } catch {
      send({ type: 'error', message: `invalid JSON: ${line.slice(0, 80)}` })
      return
    }
    queue = queue
      .then(() => handle(cmd))
      .catch((e) => send({ type: 'error', message: isVuecliError(e) ? e.reason : e instanceof Error ? e.message : String(e), ...(isVuecliError(e) && { code: e.code }) }))
  })
  const offExit = session.onExit((error) => {
    flushLogs()
    send({ type: 'exit', ...(error !== undefined && { error: error instanceof Error ? error.message : String(error) }) })
    stop()
  })

  send({ type: 'ready', ...session.size })
  sendFrame(true)

  let stopped = false
  return Object.assign(stop, { idle: () => queue })
  function stop() {
    if (stopped) return
    stopped = true
    offFrame()
    offLine()
    offExit()
    clearInterval(logTimer)
  }
}
