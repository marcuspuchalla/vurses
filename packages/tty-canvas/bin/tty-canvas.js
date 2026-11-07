#!/usr/bin/env node
// tty-canvas CLI: run an HTML page or a canvas script full-screen in the terminal.
import { parseArgs } from 'node:util'
import { extname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

const HELP = `tty-canvas — run HTML canvas code in the terminal

Usage:
  tty-canvas <page.html | sketch.js | sketch.ts | image.png> [options]

Options:
  -m, --mode <mode>    halfblock (default) | quadrant | sextant | braille | ascii
                       | kitty | sixel | iterm2 | auto
  -f, --fps <n>        frame rate cap (default 30)
  -b, --background <c> color behind transparent pixels (default black)
      --no-mouse       disable mouse reporting
      --status         show a status line (mode, size, fps)
      --size <WxH>     fixed viewport size in canvas pixels
      --print          render one frame to stdout and exit (no full-screen)
  -h, --help           show this help

Mouse and keys are delivered to the page as DOM events. Press ctrl+c to quit.`

let parsed
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      mode: { type: 'string', short: 'm', default: 'halfblock' },
      fps: { type: 'string', short: 'f', default: '30' },
      background: { type: 'string', short: 'b' },
      'no-mouse': { type: 'boolean' },
      status: { type: 'boolean' },
      size: { type: 'string' },
      print: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
} catch (err) {
  console.error(String(err.message ?? err))
  process.exit(2)
}
const { values: flags, positionals } = parsed
if (flags.help || !positionals.length) {
  console.log(HELP)
  process.exit(flags.help ? 0 : 1)
}

const MODES = ['halfblock', 'quadrant', 'sextant', 'braille', 'ascii', 'kitty', 'sixel', 'iterm2', 'auto']
if (!MODES.includes(flags.mode)) {
  console.error(`Unknown mode "${flags.mode}". Use one of: ${MODES.join(', ')}`)
  process.exit(2)
}

const file = resolve(positionals[0])
if (!existsSync(file)) {
  console.error(`File not found: ${file}`)
  process.exit(1)
}

const lib = await import('../dist/node/index.js')
const ext = extname(file).toLowerCase()
const columns = process.stdout.columns ?? 80
const rows = process.stdout.rows ?? 24
const cellRes = lib.MODE_RESOLUTION[flags.mode] ?? [1, 2]
let width = columns * cellRes[0]
let height = (rows - (flags.status ? 1 : 0)) * cellRes[0] * 2
if (flags.size) {
  const m = /^(\d+)x(\d+)$/i.exec(flags.size)
  if (!m) {
    console.error('--size expects WIDTHxHEIGHT, e.g. 320x200')
    process.exit(2)
  }
  width = +m[1]
  height = +m[2]
}
const background = flags.background ?? '#000000'

if (ext === '.png') {
  const img = await lib.loadImage(file)
  const canvas = new lib.Canvas(img.width, img.height)
  canvas.getContext('2d').drawImage(img, 0, 0)
  if (flags.print || !process.stdout.isTTY) {
    const fit = lib.fitCells(img.width, img.height, columns, rows - 1, 'contain', lib.isCellMode(flags.mode) ? flags.mode : 'halfblock')
    const mode = flags.mode === 'auto' ? lib.detectGraphics().best ?? 'halfblock' : flags.mode
    process.stdout.write(lib.toAnsi(canvas, { mode, columns: fit.columns, rows: fit.rows, background: null }) + '\n')
    process.exit(0)
  }
  const player = lib.play(canvas, { mode: flags.mode, fps: 10, mouse: !flags['no-mouse'], status: flags.status, background })
  await player.done
  process.exit(0)
}

const isHtml = ext === '.html' || ext === '.htm'
const logs = []
const pageConsole = new Proxy(console, {
  get(target, k) {
    if (['log', 'info', 'warn', 'error', 'debug'].includes(k)) return (...a) => logs.push([k, a])
    return target[k]
  },
})
const page = isHtml
  ? await lib.runHtml(file, { width, height, console: flags.print ? console : pageConsole })
  : await lib.runScript(file, { width, height, console: flags.print ? console : pageConsole })

if (flags.print || !process.stdout.isTTY) {
  // let a few frames run, then print one
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 16))
    page.env.frame()
  }
  const c = page.canvas
  if (!c) {
    console.error('The page did not create a canvas.')
    process.exit(1)
  }
  const mode = flags.mode === 'auto' ? lib.detectGraphics().best ?? 'halfblock' : flags.mode
  const fit = lib.fitCells(c.width, c.height, columns, rows - 1, 'contain', lib.isCellMode(mode) ? mode : 'halfblock')
  process.stdout.write(lib.toAnsi(c, { mode, columns: fit.columns, rows: fit.rows, background }) + '\n')
  page.dispose()
  process.exit(0)
}

const player = lib.play(page, {
  mode: flags.mode,
  fps: Number(flags.fps) || 30,
  mouse: !flags['no-mouse'],
  status: flags.status,
  background,
  fitViewport: !flags.size,
})
await player.done
page.dispose()
// replay what the page logged while the terminal was in use
for (const [level, args] of logs) console[level](...args)
process.exit(0)
