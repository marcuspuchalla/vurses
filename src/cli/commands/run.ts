import { existsSync } from 'node:fs'
import { register } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { hooksUrl, type Command, type Flags } from '../shared.js'

async function runEntry(entry: string, flags: Flags) {
  const file = resolve(entry)
  if (!existsSync(file)) {
    console.error(`vuecli: file not found: ${entry}`)
    process.exit(1)
  }
  register(hooksUrl)
  const mod = (await import(pathToFileURL(file).href)) as { default?: unknown }
  const component = mod.default
  if (!component) return // the module mounted itself
  const { createApp } = await import('../../index.js')
  const app = createApp(component as never).mount({
    theme: typeof flags.theme === 'string' ? flags.theme : undefined,
    mouse: flags.mouse !== false,
    fps: flags.fps ? Number(flags.fps) : undefined,
    alternateScreen: flags['alt-screen'] !== false,
  })
  try {
    await app.waitUntilExit()
    process.exit(0)
  } catch {
    process.exit(1)
  }
}


const command: Command = {
  summary: 'Run an app in the terminal (.vue / .js / .ts entry)',
  usage: 'vuecli run <entry> [--theme name] [--no-mouse] [--fps n] [--no-alt-screen]',
  run: (args, flags) => runEntry(args[0], flags),
}
export default command
