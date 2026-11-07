import { pkg, type Command, type Flags } from './shared.js'

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
}

/** Flags that take a value (`--theme dark` as well as `--theme=dark`). */
const VALUE_FLAGS = new Set(['theme', 'fps', 'port', 'host', 'adapter', 'out', 'outDir', 'app', 'route', 'size', 'mode'])

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
  const lines = [`\nvuecli ${pkg.version} — native Vue apps in the terminal\n`, 'Usage']
  for (const name of Object.keys(COMMANDS)) {
    const { default: c } = await COMMANDS[name]()
    lines.push(`  ${c.usage.padEnd(52)} ${c.summary}`)
  }
  lines.push('  vuecli <entry>'.padEnd(54) + ' Shorthand for `vuecli run <entry>`')
  lines.push('\nKeys\n  Tab / Shift+Tab   move focus\n  F12               devtools overlay\n  Ctrl+C            quit\n')
  console.log(lines.join('\n'))
}

export async function main(argv = process.argv.slice(2)) {
  const { args, flags } = parseArgs(argv)
  if (flags.version) return console.log(pkg.version)
  if ((flags.help && !args.length) || args.length === 0) return help()
  let name = args[0]
  if (name in COMMANDS) args.shift()
  else name = 'run'
  const { default: cmd } = await COMMANDS[name]()
  if (flags.help) return console.log(`Usage: ${cmd.usage}\n\n${cmd.summary}`)
  await cmd.run(args, flags)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
