import type { Command, Flags } from '../shared.js'
import { formatError, vuecliError } from '../../errors.js'

function parseSize(v: string | boolean | undefined): { columns: number; rows: number } {
  if (typeof v !== 'string') return { columns: 100, rows: 30 }
  const m = /^(\d+)\s*[x×,]\s*(\d+)$/i.exec(v.trim())
  if (!m) throw vuecliError('VC131', { flag: 'size', value: v, expected: 'COLSxROWS, e.g. 100x30' })
  return { columns: Math.max(1, Number(m[1])), rows: Math.max(1, Number(m[2])) }
}

async function runMcp(args: string[], flags: Flags) {
  // stdout is the protocol channel: keep stray console output off it
  const toStderr = (...a: unknown[]) => process.stderr.write(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n')
  console.log = console.info = console.debug = toStderr

  const target = args[0] ?? (typeof flags.app === 'string' ? flags.app : '.')
  const { columns, rows } = parseSize(flags.size)
  const theme = typeof flags.theme === 'string' ? flags.theme : undefined
  const initialPath = typeof flags.route === 'string' ? flags.route : undefined

  const { loadApp } = await import('../../mcp/load.js')
  const { HeadlessSession } = await import('../../mcp/session.js')
  const loaded = await loadApp(target, { initialPath })
  const session = await HeadlessSession.mount(loaded.component, {
    columns,
    rows,
    theme,
    setup: loaded.setup,
    fps: flags.fps ? Number(flags.fps) : undefined,
  })
  await loaded.afterMount?.()
  await session.settle()

  const shutdown = (code = 0) => {
    session.close()
    process.exit(code)
  }
  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))

  if (flags.jsonl) {
    const { servePreview, lineSplitter } = await import('../../mcp/jsonl.js')
    const handlers = new Set<(l: string) => void>()
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', lineSplitter((l) => handlers.forEach((h) => h(l))))
    // finish queued commands before exiting when the editor closes stdin
    process.stdin.on('end', () => void preview.idle().then(() => shutdown(0)))
    const preview = servePreview(session, {
      send: (line) => process.stdout.write(line + '\n'),
      onLine: (fn) => {
        handlers.add(fn)
        return () => handlers.delete(fn)
      },
    })
    session.onExit(() => setTimeout(() => process.exit(0), 20))
    return
  }

  const { createMcpServer } = await import('../../mcp/server.js')
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
  const { pkg } = await import('../shared.js')
  const { server } = await createMcpServer({
    session,
    manifest: loaded.manifest,
    getRouter: loaded.getRouter ? () => loaded.getRouter!(session.app) : undefined,
    version: pkg.version,
  })
  const transport = new StdioServerTransport()
  transport.onclose = () => shutdown(0)
  process.stdin.on('end', () => shutdown(0))
  await server.connect(transport)
  process.stderr.write(`vuecli mcp: serving ${loaded.target} (${loaded.mode}, ${columns}x${rows}) on stdio\n`)
}

const command: Command = {
  summary: 'MCP server: lets coding agents read frames, press keys and navigate routes',
  usage: 'vuecli mcp <entry|appDir> [--size 100x30] [--theme name] [--route /path] [--jsonl]',
  async run(args, flags) {
    try {
      await runMcp(args, flags)
    } catch (e) {
      process.stderr.write(`vuecli mcp: ${formatError(e)}\n`)
      process.exit(1)
    }
  },
}
export default command
