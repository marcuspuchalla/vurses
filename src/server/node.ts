/**
 * node:http adapter for a fetch handler (also used by `vuecli start` / `vuecli dev`).
 * Streams response bodies (SSE), aborts `request.signal` and cancels the
 * body stream when the client disconnects.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { FetchHandler } from './handler.js'

export function toRequest(req: IncomingMessage, signal?: AbortSignal): Request {
  const host = req.headers.host ?? 'localhost'
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? ((req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http')
  const url = new URL(req.url ?? '/', `${proto}://${host}`)
  const headers = new Headers()
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const k = req.rawHeaders[i]
    if (k.startsWith(':')) continue
    headers.append(k, req.rawHeaders[i + 1])
  }
  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'
  return new Request(url, {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
    signal,
    // @ts-expect-error -- required by undici for streamed request bodies
    duplex: hasBody ? 'half' : undefined,
  })
}

export async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {}
  response.headers.forEach((v, k) => {
    if (k !== 'set-cookie') headers[k] = v
  })
  const cookies = response.headers.getSetCookie?.() ?? []
  if (cookies.length) headers['set-cookie'] = cookies
  res.writeHead(response.status, response.statusText || undefined, headers)
  if (!response.body) {
    res.end()
    return
  }
  res.flushHeaders()
  const reader = response.body.getReader()
  const onClose = () => reader.cancel().catch(() => {})
  res.on('close', onClose)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!res.write(value)) await new Promise<void>((r) => res.once('drain', () => r()).once('close', () => r()))
      if (res.destroyed) break
    }
  } catch {
    /* client went away */
  } finally {
    res.off('close', onClose)
    res.end()
  }
}

/** `(req, res)` listener for node:http / express / connect. */
export function toNodeListener(handler: FetchHandler, onError?: (e: unknown) => void) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const controller = new AbortController()
    res.on('close', () => controller.abort())
    let request: Request
    try {
      request = toRequest(req, controller.signal)
    } catch (e) {
      res.statusCode = 400
      res.end('bad request')
      return
    }
    handler(request)
      .then((r) => writeResponse(res, r))
      .catch((e) => {
        onError?.(e)
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
        res.end('500 — internal server error')
      })
  }
}

export interface ServeOptions {
  port?: number
  host?: string
  onError?(e: unknown): void
}

export interface RunningServer {
  server: Server
  /** e.g. http://localhost:3000 */
  url: string
  port: number
  close(): Promise<void>
}

/** Starts a node:http server for a fetch handler. `port: 0` picks a free port. */
export function serve(handler: FetchHandler & { close?(): void }, options: ServeOptions = {}): Promise<RunningServer> {
  const server = createServer(toNodeListener(handler, options.onError))
  // SSE connections are long-lived
  server.requestTimeout = 0
  server.headersTimeout = 60_000
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 3000, options.host, () => {
      server.off('error', reject)
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : (options.port ?? 3000)
      const shown = !options.host || options.host === '0.0.0.0' || options.host === '::' ? 'localhost' : options.host
      resolve({
        server,
        port,
        url: `http://${shown}:${port}`,
        close: () =>
          new Promise<void>((r) => {
            handler.close?.()
            server.close(() => r())
            server.closeAllConnections?.()
          }),
      })
    })
  })
}
