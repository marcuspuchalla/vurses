import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Flags = Record<string, string | boolean>

export interface Command {
  /** One-line description for `vurses --help`. */
  summary: string
  /** Usage line, e.g. `vurses run <entry> [--theme name]`. */
  usage: string
  run(args: string[], flags: Flags): Promise<void> | void
}

const here = dirname(fileURLToPath(import.meta.url))
/** Package root (contains package.json, dist/, bin/). */
export const packageRoot = join(here, '..', '..')
export const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string; name: string }
/** Absolute URL of the SFC loader hooks module. */
export const hooksUrl = new URL('../sfc/hooks.js', import.meta.url).href
