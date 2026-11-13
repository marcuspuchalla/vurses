/**
 * MCP server for a running vurses app: lets coding agents navigate routes,
 * press keys and read frames as plain text.
 *
 *   const { server } = await createMcpServer({ component: App })
 *   await server.connect(new StdioServerTransport())
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SubscribeRequestSchema, UnsubscribeRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Component } from 'vue'
import { z } from 'zod'
import type { RouteManifest } from '../router/types.js'
import { isVursesError, vursesError } from '../errors.js'
import { HeadlessSession, type SessionOptions } from './session.js'
import type { RouterLike } from './load.js'

export interface McpServerOptions extends SessionOptions {
  /** Root component to run (or pass an already mounted `session`). */
  component?: Component
  session?: HeadlessSession
  /** App Router mode: the manifest and router accessor (see `loadApp`). */
  manifest?: RouteManifest
  getRouter?: (session: HeadlessSession) => RouterLike | null
  /** Server name / version reported to clients. */
  name?: string
  version?: string
}

export interface VursesMcpServer {
  server: McpServer
  session: HeadlessSession
  close(): Promise<void>
}

const FRAME_URI = 'vurses://frame'
const ANSI_URI = 'vurses://frame.ansi'
const TREE_URI = 'vurses://tree'

const text = (s: string): CallToolResult => ({ content: [{ type: 'text', text: s }] })
const errorResult = (e: unknown): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: isVursesError(e) ? `${e.code}: ${e.reason}\n${e.docsUrl}` : e instanceof Error ? e.message : String(e) }],
})

/** Frame text with a one-line header so agents know the screen size. */
function framed(session: HeadlessSession, prefix = ''): string {
  const { columns, rows } = session.size
  const body = session.text()
  return `${prefix}${prefix ? '\n' : ''}--- frame ${columns}x${rows} ---\n${body}`
}

const frameFlag = z.boolean().optional().describe('Return the resulting frame (default true)')

export async function createMcpServer(options: McpServerOptions): Promise<VursesMcpServer> {
  const session = options.session ?? (options.component ? await HeadlessSession.mount(options.component, options) : null)
  if (!session) throw new TypeError('createMcpServer: pass `component` or `session`')
  const server = new McpServer(
    { name: options.name ?? 'vurses', version: options.version ?? '0.1.0' },
    {
      instructions:
        'Drives a vurses terminal app headlessly. read_frame shows the screen as plain text; ' +
        'press / type / paste / click / scroll send input and return the new frame. ' +
        'Keys are names like "enter", "tab", "shift+tab", "ctrl+s", "up", "escape", "a". ' +
        (options.manifest ? 'This is an App Router app: list_routes, navigate, back, forward.' : ''),
    },
  )

  const router = () => {
    const r = options.getRouter?.(session) ?? null
    if (!r) throw vursesError('VC112', { tool: 'Routing' })
    return r
  }

  const run =
    <A>(fn: (args: A) => Promise<CallToolResult> | CallToolResult) =>
    async (args: A): Promise<CallToolResult> => {
      try {
        if (session.isClosed) return text('The app has exited.')
        return await fn(args)
      } catch (e) {
        return errorResult(e)
      }
    }

  const after = async (prefix: string, frame: boolean | undefined) => text(frame === false ? prefix : framed(session, prefix))

  // ---------------------------------------------------------------- frames

  server.registerTool(
    'read_frame',
    {
      title: 'Read frame',
      description:
        'Returns the current screen as plain text. ansi: include ANSI color escapes instead. ' +
        'with_styles: also return the styled spans (row, col, width, text, fg, bg, bold, ...) as JSON.',
      inputSchema: {
        ansi: z.boolean().optional().describe('Return the frame with ANSI SGR escapes'),
        with_styles: z.boolean().optional().describe('Append a JSON list of styled spans'),
      },
      annotations: { readOnlyHint: true },
    },
    run(async ({ ansi, with_styles }) => {
      await session.settle()
      const content: CallToolResult['content'] = [{ type: 'text', text: ansi ? session.ansi() : framed(session) }]
      if (with_styles) content.push({ type: 'text', text: JSON.stringify({ size: session.size, spans: session.styles() }) })
      return { content }
    }),
  )

  // ---------------------------------------------------------------- input

  server.registerTool(
    'press',
    {
      title: 'Press keys',
      description:
        'Presses one or more keys in order, e.g. ["tab", "enter"] or "ctrl+s". Names: enter, tab, shift+tab, escape, ' +
        'backspace, delete, up, down, left, right, home, end, pageup, pagedown, space, f1-f12, single characters; ' +
        'modifiers ctrl+, alt+ / meta+, shift+.',
      inputSchema: {
        keys: z.union([z.string(), z.array(z.string()).min(1)]).describe('A key or a list of keys'),
        times: z.number().int().min(1).max(100).optional().describe('Repeat the sequence n times'),
        frame: frameFlag,
      },
    },
    run(async ({ keys, times, frame }) => {
      const list = Array.isArray(keys) ? keys : [keys]
      const seq = Array.from({ length: times ?? 1 }, () => list).flat()
      await session.press(seq)
      return after(`pressed ${seq.join(', ')}`, frame)
    }),
  )

  server.registerTool(
    'type',
    {
      title: 'Type text',
      description: 'Types printable text into the focused input, one key at a time ("\\n" presses enter).',
      inputSchema: { text: z.string(), frame: frameFlag },
    },
    run(async ({ text: t, frame }) => {
      await session.type(t)
      return after(`typed ${JSON.stringify(t)}`, frame)
    }),
  )

  server.registerTool(
    'paste',
    {
      title: 'Paste text',
      description: 'Pastes text as a single bracketed-paste event.',
      inputSchema: { text: z.string(), frame: frameFlag },
    },
    run(async ({ text: t, frame }) => {
      await session.paste(t)
      return after(`pasted ${t.length} characters`, frame)
    }),
  )

  server.registerTool(
    'click',
    {
      title: 'Click',
      description: 'Clicks a cell (0-based x, y) or the first occurrence of `text` on screen.',
      inputSchema: {
        x: z.number().int().min(0).optional(),
        y: z.number().int().min(0).optional(),
        text: z.string().optional().describe('Click this text instead of x/y'),
        nth: z.number().int().min(0).optional().describe('Which occurrence of text (0-based)'),
        button: z.enum(['left', 'right', 'middle']).optional(),
        double: z.boolean().optional(),
        frame: frameFlag,
      },
    },
    run(async ({ frame, ...o }) => {
      const p = await session.click(o)
      return after(`clicked ${o.text !== undefined ? JSON.stringify(o.text) + ' ' : ''}at ${p.x},${p.y}`, frame)
    }),
  )

  server.registerTool(
    'scroll',
    {
      title: 'Scroll',
      description: 'Sends mouse-wheel events at a cell, at `text`, or at the screen center.',
      inputSchema: {
        direction: z.enum(['up', 'down', 'left', 'right']),
        amount: z.number().int().min(1).max(100).optional().describe('Wheel steps (default 1)'),
        x: z.number().int().min(0).optional(),
        y: z.number().int().min(0).optional(),
        text: z.string().optional(),
        frame: frameFlag,
      },
    },
    run(async ({ frame, ...o }) => {
      const p = await session.scroll(o)
      return after(`scrolled ${o.direction} x${o.amount ?? 1} at ${p.x},${p.y}`, frame)
    }),
  )

  server.registerTool(
    'resize',
    {
      title: 'Resize',
      description: 'Changes the virtual terminal size.',
      inputSchema: { columns: z.number().int().min(1).max(1000), rows: z.number().int().min(1).max(500), frame: frameFlag },
    },
    run(async ({ columns, rows, frame }) => {
      await session.resize(columns, rows)
      return after(`resized to ${columns}x${rows}`, frame)
    }),
  )

  server.registerTool(
    'wait_for',
    {
      title: 'Wait for text',
      description: 'Waits until `text` is on screen (or gone, with gone: true). Fails after timeout_ms (default 5000).',
      inputSchema: {
        text: z.string().min(1),
        timeout_ms: z.number().int().min(0).max(120000).optional(),
        gone: z.boolean().optional(),
        frame: frameFlag,
      },
      annotations: { readOnlyHint: true },
    },
    run(async ({ text: t, timeout_ms, gone, frame }) => {
      const started = Date.now()
      await session.waitFor(t, { timeout: timeout_ms ?? 5000, gone })
      return after(`${JSON.stringify(t)} ${gone ? 'gone' : 'found'} after ${Date.now() - started}ms`, frame)
    }),
  )

  // ---------------------------------------------------------------- inspection

  server.registerTool(
    'get_tree',
    {
      title: 'Get tree',
      description:
        'Returns the component tree (default) or the element tree, with layout rects [x,y widthxheight] in cells. ' +
        'format: "text" (indented outline, default) or "json".',
      inputSchema: {
        kind: z.enum(['components', 'elements']).optional(),
        format: z.enum(['text', 'json']).optional(),
        depth: z.number().int().min(0).optional().describe('Max depth (elements only)'),
      },
      annotations: { readOnlyHint: true },
    },
    run(async ({ kind, format, depth }) => {
      await session.settle()
      const k = kind ?? 'components'
      if (format === 'json') return text(JSON.stringify(k === 'elements' ? session.elementTree(depth) : session.componentTree(), null, 1))
      return text(session.formatTree(k, depth) || '(empty)')
    }),
  )

  server.registerTool(
    'get_logs',
    {
      title: 'Get logs',
      description: 'Returns console output captured from the app (console.log/info/warn/error/debug and Vue warnings).',
      inputSchema: {
        level: z.array(z.enum(['log', 'info', 'warn', 'error', 'debug'])).optional(),
        since_last: z.boolean().optional().describe('Only entries not returned by a previous since_last call'),
        clear: z.boolean().optional(),
        limit: z.number().int().min(1).max(1000).optional().describe('Most recent n entries (default 200)'),
      },
      annotations: { readOnlyHint: true },
    },
    run(async ({ level, since_last, clear, limit }) => {
      const logs = session.logs({ level, since: since_last ? 'last' : undefined, clear }).slice(-(limit ?? 200))
      if (!logs.length) return text('(no logs)')
      return text(logs.map((l) => `${new Date(l.time).toISOString().slice(11, 23)} ${l.level.padEnd(5)} ${l.message}`).join('\n'))
    }),
  )

  // ---------------------------------------------------------------- router

  if (options.manifest || options.getRouter) {
    server.registerTool(
      'list_routes',
      {
        title: 'List routes',
        description: 'Lists the App Router routes (path, file pattern, params) and the current route.',
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      run(async () => {
        const r = options.getRouter?.(session) ?? null
        const current = r?.currentRoute.value.fullPath
        const lines: string[] = []
        if (current !== undefined) lines.push(`current: ${current}`)
        if (options.manifest) {
          for (const e of options.manifest.routes) {
            const kind = e.page ? 'page' : e.handler ? 'handler' : 'route'
            lines.push(`${e.path}  (${kind}: ${e.pattern}${e.params.length ? `, params: ${e.params.join(', ')}` : ''})`)
          }
        } else if (r?.getRoutes) {
          for (const e of r.getRoutes()) lines.push(e.path)
        }
        return text(lines.join('\n') || '(no routes)')
      }),
    )

    server.registerTool(
      'navigate',
      {
        title: 'Navigate',
        description: 'Navigates to a path, e.g. "/users/42?tab=posts".',
        inputSchema: { path: z.string().min(1), frame: frameFlag },
      },
      run(async ({ path, frame }) => {
        const r = router()
        const failure = await r.push(path)
        await r.waitForIdle?.(5000).catch(() => {})
        await session.settle()
        const now = r.currentRoute.value.fullPath
        if (failure && failure instanceof Error) throw failure
        return after(`navigated to ${now}`, frame)
      }),
    )

    for (const dir of ['back', 'forward'] as const) {
      server.registerTool(
        dir,
        { title: dir === 'back' ? 'Back' : 'Forward', description: `Goes ${dir} in the router history.`, inputSchema: { frame: frameFlag } },
        run(async ({ frame }) => {
          const r = router()
          const before = r.currentRoute.value.fullPath
          r[dir]()
          // history navigation is asynchronous
          for (let i = 0; i < 20 && r.currentRoute.value.fullPath === before; i++) await new Promise((res) => setTimeout(res, 10))
          await r.waitForIdle?.(5000).catch(() => {})
          await session.settle()
          return after(`${dir}: ${r.currentRoute.value.fullPath}`, frame)
        }),
      )
    }
  }

  // ---------------------------------------------------------------- resources

  server.registerResource(
    'frame',
    FRAME_URI,
    { title: 'Current frame', description: 'The current screen as plain text', mimeType: 'text/plain' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/plain', text: session.text() }] }),
  )
  server.registerResource(
    'frame-ansi',
    ANSI_URI,
    { title: 'Current frame (ANSI)', description: 'The current screen with ANSI color escapes', mimeType: 'text/plain' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/plain', text: session.ansi() }] }),
  )
  server.registerResource(
    'tree',
    TREE_URI,
    { title: 'Component tree', description: 'Component tree with layout rects', mimeType: 'text/plain' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/plain', text: session.formatTree('components') }] }),
  )

  // resources/subscribe: notify subscribed clients when the frame changes
  const subscribed = new Set<string>()
  server.server.registerCapabilities({ resources: { subscribe: true, listChanged: true } })
  server.server.setRequestHandler(SubscribeRequestSchema, async (req) => {
    subscribed.add(req.params.uri)
    return {}
  })
  server.server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
    subscribed.delete(req.params.uri)
    return {}
  })
  let notifyTimer: ReturnType<typeof setTimeout> | null = null
  const offFrame = session.onFrame(() => {
    if (notifyTimer || !subscribed.size || !server.isConnected()) return
    notifyTimer = setTimeout(() => {
      notifyTimer = null
      if (!server.isConnected()) return
      for (const uri of subscribed) server.server.sendResourceUpdated({ uri }).catch(() => {})
    }, 100)
  })

  return {
    server,
    session,
    async close() {
      offFrame()
      if (notifyTimer) clearTimeout(notifyTimer)
      session.close()
      await server.close()
    },
  }
}
