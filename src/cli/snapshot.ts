/**
 * `--snapshot`: render one frame as text (or HTML) and exit. For CI, docs, piping and
 * debugging; shared by `vuecli run` and `vuecli web`.
 *
 *   --snapshot[=html]  --size 100x40  --keys "tab,type:hello,enter"  --wait 300  --keywait 60
 */
import type { MountOptions, Runtime } from '../app/app.js'
import type { Flags } from './shared.js'

/** Mount options for a snapshot run, or null when not snapshotting. */
export function snapshotMount(flags: Flags, theme?: string): MountOptions | null {
  if (!flags.snapshot) return null
  const size = typeof flags.size === 'string' ? flags.size.split('x').map(Number) : []
  const columns = size[0] > 0 ? size[0] : process.stdout.columns || 100
  const rows = size[1] > 0 ? size[1] : process.stdout.rows || 40
  return { theme, manualRender: true, columns, rows, patchConsole: false, colorDepth: 'truecolor' }
}

/** Plays `--keys`, waits, prints the frame and exits the process. */
export async function printSnapshot(runtime: Runtime, flags: Flags, debug?: () => string | Promise<string>): Promise<never> {
  const { keyFromCombo } = await import('../testing.js')
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const settle = async (ms: number) => {
    await wait(ms)
    for (let i = 0; i < 4; i++) {
      runtime.renderFrame()
      await wait(20)
    }
  }
  await settle(Number(flags.wait ?? 300))
  const keys = typeof flags.keys === 'string' ? flags.keys.split(',').map((k) => k.trim()).filter(Boolean) : []
  for (const k of keys) {
    if (k.startsWith('type:')) for (const ch of k.slice(5)) runtime.dispatchKey(keyFromCombo(ch === ' ' ? 'space' : ch))
    else runtime.dispatchKey(keyFromCombo(k))
    await settle(Number(flags.keywait ?? 60))
  }
  await settle(Number(flags.wait ?? 300))
  const frame = runtime.renderFrame()
  if (flags.snapshot === 'html') {
    const { gridToHtml } = await import('../targets/dom-view.js')
    process.stdout.write(gridToHtml(frame))
    process.exit(0)
  }
  if (debug) process.stderr.write(await debug())
  process.stdout.write(frame.toString().replace(/[ \t]+$/gm, '').replace(/\n+$/, '') + '\n')
  process.exit(0)
}

/**
 * The interactive UI needs a terminal. Without one (piped, redirected, CI) it would
 * write escape codes into a file and wait for keys forever: explain and exit instead.
 */
export function requireTerminal(command: string) {
  if (process.stdout.isTTY) return
  process.stderr.write(
    `vuecli ${command}: stdout is not a terminal, so the interactive app can't run here.\n` +
      `  Run it in a terminal, or print one frame as text: vuecli ${command} … --snapshot --size 100x40\n`,
  )
  process.exit(2)
}
