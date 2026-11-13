import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Command, Flags } from '../shared.js'

/** Finds a node/bun build: the dir itself, or <dir>/.vurses/node|bun. */
function findBuild(dir: string): string | null {
  for (const c of [dir, join(dir, '.vurses', 'node'), join(dir, '.vurses', 'bun')]) if (existsSync(join(c, 'server', 'index.mjs'))) return c
  return null
}

async function start(args: string[], flags: Flags) {
  const dir = findBuild(resolve(args[0] ?? '.'))
  if (!dir) {
    console.error('vurses start: no build found — run `vurses build --adapter node` first')
    process.exit(1)
  }
  const mod = await import(pathToFileURL(join(dir, 'server', 'index.mjs')).href)
  const handler = mod.createServerHandler({ staticDir: join(dir, 'static'), onError: (e: unknown) => console.error('[vurses]', e) })
  const server = await mod.serve(handler, { port: Number(flags.port ?? process.env.PORT ?? 3000), host: typeof flags.host === 'string' ? flags.host : process.env.HOST })
  console.log(`  vurses server listening on ${server.url}`)
  const stop = () => server.close().then(() => process.exit(0))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

const command: Command = {
  summary: 'Serve a production build (node / bun adapter output)',
  usage: 'vurses start [buildDir] [--port 3000] [--host h]',
  run: start,
}
export default command
