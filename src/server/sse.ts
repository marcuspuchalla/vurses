/**
 * Server-Sent Events over a web `ReadableStream` (portable: Node adapter,
 * Bun, Workers). Browser-safe code: only web globals.
 */

export interface SSEChannel {
  readonly stream: ReadableStream<Uint8Array>
  /** Sends `event: <event>\ndata: <data>\n\n` (multi-line data is split). */
  send(event: string, data: string): void
  /** Sends a comment line (keep-alive). */
  comment(text?: string): void
  close(): void
  readonly closed: boolean
}

export function createSSE(options: { onCancel?(): void; keepAlive?: number; retry?: number } = {}): SSEChannel {
  const enc = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let closed = false
  let timer: ReturnType<typeof setInterval> | null = null
  const finish = () => {
    if (closed) return
    closed = true
    if (timer) clearInterval(timer)
  }
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
      if (options.retry) c.enqueue(enc.encode(`retry: ${options.retry}\n\n`))
    },
    cancel() {
      finish()
      options.onCancel?.()
    },
  })
  const write = (s: string) => {
    if (closed) return
    try {
      controller.enqueue(enc.encode(s))
    } catch {
      finish()
      options.onCancel?.()
    }
  }
  const ch: SSEChannel = {
    stream,
    send(event, data) {
      write(`event: ${event}\n` + data.split('\n').map((l) => `data: ${l}\n`).join('') + '\n')
    },
    comment(text = '') {
      write(`: ${text}\n\n`)
    },
    close() {
      if (closed) return
      finish()
      try {
        controller.close()
      } catch {
        /* already closed */
      }
    },
    get closed() {
      return closed
    },
  }
  const ka = options.keepAlive ?? 15000
  if (ka > 0) {
    timer = setInterval(() => ch.comment('ping'), ka)
    ;(timer as { unref?: () => void }).unref?.()
  }
  return ch
}

export const SSE_HEADERS: Record<string, string> = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  'x-accel-buffering': 'no',
}
