import { pkg, type Command, type Flags } from './shared.js'
import { existsSync } from 'node:fs'
import { formatError, isVursesError, vursesError } from '../errors.js'

/**
 * Subcommands are lazy-loaded modules in ./commands. Each exports a default
 * `Command`. Add a new one by adding a file and an entry here.
 */
const COMMANDS: Record<string, () => Promise<{ default: Command }>> = {
  run: () => import('./commands/run.js'),
  dev: () => import('./commands/dev.js'),
  build: () => import('./commands/build.js'),
  start: () => import('./commands/start.js'),
  mcp: () => import('./commands/mcp.js'),
  create: () => import('./commands/create.js'),
  web: () => import('./commands/web.js'),
}

/** Flags that take a value (`--theme dark` as well as `--theme=dark`). */
const VALUE_FLAGS = new Set(['origin', 'theme', 'fps', 'port', 'host', 'adapter', 'out', 'outDir', 'app', 'route', 'size', 'mode', 'keys', 'wait', 'keywait'])

export function parseArgs(argv: string[]) {
  const args: string[] = []
  const flags: Flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--no-')) flags[a.slice(5)] = false
    else if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1)
      else {
        const k = a.slice(2)
        if (VALUE_FLAGS.has(k) && i + 1 < argv.length) flags[k] = argv[++i]
        else flags[k] = true
      }
    } else if (a === '-h') flags.help = true
    else if (a === '-v') flags.version = true
    else if (a === '-p' && i + 1 < argv.length) flags.port = argv[++i]
    else args.push(a)
  }
  return { args, flags }
}

async function help() {
  const lines = [`\nvurses ${pkg.version} — native Vue apps in the terminal\n`, 'Usage']
  for (const name of Object.keys(COMMANDS)) {
    const { default: c } = await COMMANDS[name]()
    lines.push(`  ${c.usage.padEnd(52)} ${c.summary}`)
  }
  lines.push('  vurses <entry>'.padEnd(54) + ' Shorthand for `vurses run <entry>`')
  lines.push('\nKeys\n  Tab / Shift+Tab   move focus\n  F12               devtools overlay\n  Ctrl+C            quit\n')
  console.log(lines.join('\n'))
}

export async function main(argv = process.argv.slice(2)) {
  // stack traces point at the app's sources (esbuild emits inline source maps)
  process.setSourceMapsEnabled?.(true)
  const { args, flags } = parseArgs(argv)
  checkFlags(flags)
  if (flags.version) return console.log(pkg.version)
  if ((flags.help && !args.length) || args.length === 0 || (args[0] === 'help' && args.length === 1)) return help()
  if (args[0] === 'help') return main([args[1], '--help'])
  let name = args[0]
  if (name in COMMANDS) args.shift()
  else if (looksLikeCommand(name)) {
    const near = Object.keys(COMMANDS).find((c) => editDistance(c, name) <= 2)
    console.error(formatError(vursesError('VC130', { name })) + (near ? `\n  Did you mean \`vurses ${near}\`?` : ''))
    process.exit(2)
  } else name = 'run'
  const { default: cmd } = await COMMANDS[name]()
  if (flags.help) return console.log(`Usage: ${cmd.usage}\n\n${cmd.summary}`)
  await cmd.run(args, flags)
}

/** Every flag some command reads. */
const KNOWN_FLAGS = new Set([
  'adapter', 'alt-screen', 'app', 'origin', 'fps', 'help', 'host', 'jsonl', 'keys', 'keywait', 'minify', 'mode', 'mouse', 'out', 'outDir',
  'port', 'prerender', 'route', 'single', 'size', 'snapshot', 'template', 'terminal', 'theme', 'title', 'version', 'wait', 'watch', 'worker',
])
const NUMERIC_FLAGS = ['fps', 'port', 'wait', 'keywait']

/** Typos are warned about (and ignored); impossible values stop with VC131. */
function checkFlags(flags: Flags) {
  for (const k of Object.keys(flags)) if (!KNOWN_FLAGS.has(k)) console.error(`vurses: unknown flag --${k} (ignored); see \`vurses --help\``)
  const bad = (flag: string, value: unknown, expected: string) => {
    console.error(formatError(vursesError('VC131', { flag, value: String(value), expected })))
    process.exit(2)
  }
  for (const k of NUMERIC_FLAGS) {
    const v = flags[k]
    if (v !== undefined && !(typeof v === 'string' && /^\d+$/.test(v))) bad(k, v, 'a whole number')
  }
  if (flags.size !== undefined && !(typeof flags.size === 'string' && /^\d+x\d+$/.test(flags.size))) bad('size', flags.size, 'COLUMNSxROWS, e.g. 100x40')
}

/** A bare word that isn't a file: a mistyped command rather than an entry file. */
function looksLikeCommand(arg: string) {
  return /^[a-z][a-z-]*$/.test(arg) && !existsSync(arg)
}

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

main().catch((err) => {
  // readable errors: `VC### reason → docs` for our own, the message plus the app's frames otherwise
  if (isVursesError(err) || !(err instanceof Error)) console.error(formatError(err))
  else {
    const frames = (err.stack ?? '').split('\n').filter((l) => /^\s+at /.test(l) && !/node:internal|node_modules[\\/](@babel|@vue[\\/]compiler)/.test(l))
    console.error(`${err.name}: ${err.message}${frames.length ? '\n' + frames.slice(0, 8).join('\n') : ''}`)
  }
  if (process.env.VURSES_DEBUG) console.error(err)
  process.exit(1)
})
