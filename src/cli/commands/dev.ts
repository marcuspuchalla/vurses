import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { packageRoot, type Command, type Flags } from '../shared.js'

const bin = join(packageRoot, 'bin', 'vuecli.js')

function passthrough(flags: Flags, keys: string[]) {
  const out: string[] = []
  for (const k of keys) {
    const v = flags[k]
    if (v === undefined) continue
    if (v === false) out.push(`--no-${k}`)
    else if (v === true) out.push(`--${k}`)
    else out.push(`--${k}=${v}`)
  }
  return out
}

async function dev(args: string[], flags: Flags) {
  const entry = resolve(args[0] ?? '.')
  if (!existsSync(entry)) {
    console.error(`vuecli dev: not found: ${args[0]}`)
    process.exit(1)
  }
  const { supervise, startDevServer } = await import('../../server/dev.js')
  const port = Number(flags.port ?? process.env.PORT ?? 3000)
  const host = typeof flags.host === 'string' ? flags.host : undefined

  // worker: one build, serve until the supervisor replaces us
  if (flags.worker) {
    const t0 = Date.now()
    const server = await startDevServer({ entry, port, host, appDir: typeof flags.app === 'string' ? flags.app : undefined })
    console.log(`  ready in ${Date.now() - t0} ms — ${server.url}  (open the devtools console)`)
    process.on('SIGTERM', () => server.close().then(() => process.exit(0)))
    return
  }
  const watchDir = statSync(entry).isFile() ? dirname(entry) : entry
  if (flags.terminal) {
    // terminal mode: run the app in this terminal, restart it on changes
    const code = await supervise({ watchDir, terminal: true, args: [bin, 'run', entry, ...passthrough(flags, ['theme', 'fps', 'mouse', 'alt-screen', 'route', 'app'])] })
    process.exit(code)
  }
  console.log(`\n  vuecli dev — ${entry}\n  http://${host && host !== '0.0.0.0' ? host : 'localhost'}:${port}  (watching for changes)\n`)
  await supervise({ watchDir, args: [bin, 'dev', entry, '--worker', `--port=${port}`, ...(host ? [`--host=${host}`] : []), ...passthrough(flags, ['app'])] })
}

const command: Command = {
  summary: 'Dev server: browser console target + server routes, live reload (or --terminal)',
  usage: 'vuecli dev [dir|entry] [--port 3000] [--host h] [--terminal]',
  run: dev,
}
export default command
