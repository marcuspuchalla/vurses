# tty-canvas

**The HTML Canvas 2D API, rendered in the terminal.** Code that draws on a
`<canvas>` — your own, or an existing browser demo — runs unmodified in Node
and shows up on the command line as colored Unicode cells (or as a real image
on terminals with kitty / sixel / iTerm2 graphics).

```sh
npx tty-canvas examples/bouncing.html          # an ordinary browser page
npx tty-canvas examples/clock.js --mode braille
```

- **Spec-faithful Canvas 2D** in pure TypeScript: anti-aliased paths (nonzero /
  evenodd), strokes with caps, joins, miter limits and dashes, transforms,
  clipping, gradients (linear / radial / conic), patterns, 26 composite and
  blend modes, shadows, `Path2D` (including SVG path data), hit testing,
  `drawImage`, `getImageData` / `putImageData`, text with a built-in scalable
  vector font, PNG encode / decode. No native dependencies.
- **Terminal encoders**: `halfblock` (▀, 1×2 px per cell), `quadrant` (2×2),
  `sextant` (2×3), `braille` (2×4), `ascii`, plus `kitty`, `sixel` and
  `iterm2` pixel protocols, with ANSI diffing for animation.
- **A browser-like runtime**: `window`, `document`, `requestAnimationFrame`,
  `Image`, timers, storage and DOM events (mouse, wheel, keyboard, resize), so
  existing canvas pages and sketches run as-is.

The core (`tty-canvas`) is browser-safe and has no Node dependencies; Node-only
features (running pages with `node:vm`, the full-screen player) live in
`tty-canvas/node`.

## Contents

- [CLI](#cli)
- [Library](#library)
- [Running existing canvas code](#running-existing-canvas-code)
- [Terminal output](#terminal-output)
- [API coverage](#api-coverage)
- [Limitations](#limitations)

## CLI

```
tty-canvas <page.html | sketch.js | sketch.ts | image.png> [options]

  -m, --mode <mode>    halfblock (default) | quadrant | sextant | braille | ascii
                       | kitty | sixel | iterm2 | auto
  -f, --fps <n>        frame rate cap (default 30)
  -b, --background <c> color behind transparent pixels (default black)
      --no-mouse       disable mouse reporting
      --status         show a status line (mode, size, fps)
      --size <WxH>     fixed viewport size in canvas pixels
      --print          render one frame to stdout and exit
```

The page fills the terminal: `window.innerWidth` / `innerHeight` are the
terminal size in canvas pixels for the chosen mode (e.g. 160×96 for an 80×24
terminal in halfblock mode), and a `resize` event fires when the terminal is
resized. The player uses the alternate screen, rewrites only the cells that
changed, delivers mouse input (SGR mouse reporting) as `pointer*` / `mouse*` /
`click` / `wheel` events in canvas pixel coordinates and keys as `keydown` /
`keyup` (real key releases with the kitty keyboard protocol, otherwise
synthesized). <kbd>ctrl+c</kbd> quits and restores the terminal; anything the
page logged is printed afterwards.

`--print` (or a non-TTY stdout) prints a single frame, which is handy for
scripts and CI: `tty-canvas chart.html --print > chart.ans`.

## Library

```ts
import { Canvas, Path2D, toAnsi } from 'tty-canvas'

const canvas = new Canvas(120, 60)
const ctx = canvas.getContext('2d')

const sky = ctx.createLinearGradient(0, 0, 0, 60)
sky.addColorStop(0, '#1d2b53')
sky.addColorStop(1, '#7e2553')
ctx.fillStyle = sky
ctx.fillRect(0, 0, 120, 60)

ctx.fillStyle = '#008751'
ctx.fill(new Path2D('M0 60 L0 42 L22 26 L38 40 L58 22 L84 46 L102 34 L120 44 L120 60 Z'))

ctx.font = 'bold 13px sans-serif'
ctx.fillStyle = '#fff1e8'
ctx.fillText('tty-canvas', 6, 16)

console.log(toAnsi(canvas))                      // halfblock, 120 columns × 30 rows
console.log(toAnsi(canvas, { mode: 'braille', columns: 40, rows: 10 }))
await fs.promises.writeFile('out.png', canvas.toBuffer())
```

`Canvas` behaves like an `HTMLCanvasElement` (`width` / `height` reset the
bitmap, `getContext('2d')`, `toDataURL()`, `toBuffer()`, `toBlob()`,
`addEventListener`, `getBoundingClientRect()`, `style`). Two non-standard
helpers make it easy to integrate: `canvas.data` (the live RGBA pixels) and
`canvas.subscribe(fn)` (called after every change; `canvas.version` counts
changes).

Images:

```ts
import { loadImage } from 'tty-canvas'
const img = await loadImage('photo.png')          // path, file:/http(s):/data: URL or bytes
ctx.drawImage(img, 0, 0, 64, 48)
```

See [`examples/api.mjs`](examples/api.mjs) for a complete script
(`node examples/api.mjs braille`).

### Playing a canvas full-screen

```ts
import { Canvas } from 'tty-canvas'
import { play } from 'tty-canvas/node'

const canvas = new Canvas(160, 96)
const ctx = canvas.getContext('2d')
setInterval(() => { /* draw */ }, 16)
canvas.addEventListener('mousemove', (e) => { /* e.offsetX / e.offsetY in canvas pixels */ })
await play(canvas, { mode: 'halfblock', fps: 30 }).done
```

## Running existing canvas code

```ts
import { runHtml, runScript, play } from 'tty-canvas/node'

const page = await runHtml('demo/index.html', { width: 160, height: 96 })
page.canvas            // the page's <canvas> (the largest one)
page.env.frame()       // run one requestAnimationFrame tick
page.env.pointer({ action: 'down', x: 10, y: 20 })     // mouse in canvas pixels
page.env.key('down', { key: 'ArrowUp', code: 'ArrowUp' })
await play(page).done  // or show it full-screen
page.dispose()
```

`runHtml` parses the page, creates its elements (canvases honor their `width` /
`height` attributes, `<img>` loads), binds inline `on*` attributes and runs
the scripts in document order:

- classic scripts (inline and `src`) run in a `node:vm` context whose global
  object is the browser shim, so top-level `var` / `function` declarations
  become `window` properties exactly like in a browser;
- `type="module"` scripts run as ES modules — inside the vm context when Node
  runs with `--experimental-vm-modules`, otherwise via `import()` with the
  browser globals temporarily installed on `globalThis`;
- other script types (`x-shader/x-fragment`, templates, JSON) are left in the
  DOM so `textContent` works; TypeScript files are type-stripped.

After the scripts, `DOMContentLoaded` and `load` fire. `runScript(file)` does the
same for a single `.js` / `.ts` file and provides a full-viewport `<canvas>`
(`document.querySelector('canvas')`) when the script doesn't create its own.

The environment (`createEnvironment()` in the browser-safe core) provides:
`window` / `self` / `document` (`getElementById`, `querySelector(All)` with
compound / descendant / child selectors, `createElement`, `body`, `head`,
`readyState`, `activeElement`, `fonts`), `innerWidth` / `innerHeight`,
`devicePixelRatio`, `requestAnimationFrame` / `cancelAnimationFrame`,
`performance.now()`, timers, `Image` / `HTMLImageElement`, `OffscreenCanvas`,
`createImageBitmap`, `localStorage` / `sessionStorage`, `matchMedia`,
`getComputedStyle`, `ResizeObserver`, `Event`, `MouseEvent`, `PointerEvent`,
`WheelEvent`, `KeyboardEvent`, `CustomEvent` and friends. Events bubble from
the canvas through `body` and `document` to `window`; `preventDefault()`,
`stopPropagation()`, `{ once }`, capture listeners and `on<event>` properties
work as in browsers.

## Terminal output

```ts
import { encodeCells, toAnsi, diffCells, encodeKitty, encodeSixel, encodeIterm2, detectGraphics } from 'tty-canvas'

const { columns, rows, cells } = encodeCells(rgba, width, height, {
  mode: 'sextant',       // halfblock | quadrant | sextant | braille | ascii
  columns: 80, rows: 24, // output size (area-average resampling); default: native size
  background: '#000',    // composite transparent pixels; null keeps them transparent
})
cells[0] // { ch: '🬗', fg: 0xff8800, bg: 0x101010 }  (colors are 0xRRGGBB or null)
```

| mode        | pixels / cell | notes |
| ----------- | ------------- | ----- |
| `halfblock` | 1 × 2 | two exact colors per cell; best color fidelity, square pixels |
| `quadrant`  | 2 × 2 | ▘▝▀▖▌▞▛▗▚▐▜▄▙▟ |
| `sextant`   | 2 × 3 | Unicode 13 block sextants (needs a recent font) |
| `braille`   | 2 × 4 | highest resolution; dots in the color that stands out |
| `ascii`     | 1 × 2 | luminance ramp `" .:-=+*#%@"` (option `ramp`) |

For multi-pixel cells the two colors are chosen by a 2-means split of the
cell's pixels (seeded with the most distant pair), which keeps edges sharp.

- `toAnsi(source, { mode, columns, rows, background, colorDepth })` — a
  printable string (truecolor, 256 or 16 colors), or the escape sequence for
  `kitty` / `sixel` / `iterm2`.
- `diffCells(prev, next, { x, y })` — the minimal update between two frames.
- `encodeKitty(rgba, w, h, { id, columns, rows })`, `kittyDelete(id)`,
  `encodeSixel(rgba, w, h, { colors })` (median-cut palette),
  `encodeIterm2(rgba, w, h, { columns, rows })`.
- `detectGraphics(env)` — `{ kitty, iterm2, sixel, truecolor, best }` from
  environment variables (pixel protocols are disabled inside tmux / screen).
- `fitCells(w, h, columns, rows, 'contain' | 'cover' | 'fill' | 'none', mode)` — aspect-correct placement in cells.

## API coverage

`CanvasRenderingContext2D`: `fillRect` / `strokeRect` / `clearRect`;
`beginPath`, `moveTo`, `lineTo`, `closePath`, `bezierCurveTo`,
`quadraticCurveTo`, `arc`, `arcTo`, `ellipse`, `rect`, `roundRect`; `fill` /
`stroke` / `clip` (with `Path2D` and fill rules); `isPointInPath` /
`isPointInStroke`; `lineWidth`, `lineCap`, `lineJoin`, `miterLimit`,
`setLineDash` / `getLineDash` / `lineDashOffset`; `translate`, `rotate`,
`scale`, `transform`, `setTransform` (numbers or a `DOMMatrix`-like object),
`getTransform`, `resetTransform`; `save` / `restore` / `reset`; `fillStyle` /
`strokeStyle` (CSS colors: hex, `rgb[a]()`, `hsl[a]()`, `hwb()`, 148 named
colors, `transparent`; `CanvasGradient`; `CanvasPattern` with `repeat`,
`repeat-x`, `repeat-y`, `no-repeat` and `setTransform`); `globalAlpha`;
`globalCompositeOperation` (all Porter-Duff operators, `lighter`, `copy`,
`xor` and the W3C blend modes incl. `multiply`, `screen`, `overlay`, `hue`,
`luminosity`, ...); `shadowColor` / `shadowBlur` / `shadowOffsetX/Y`;
`fillText` / `strokeText` / `measureText` with `font`, `textAlign`,
`textBaseline`, `direction`, `letterSpacing`, `wordSpacing`, `maxWidth`;
`drawImage` (3 / 5 / 9 arguments) from canvases, images, `ImageData`-like
objects and bitmaps; `createImageData` / `getImageData` / `putImageData` (with
dirty rect); `imageSmoothingEnabled`; `createLinearGradient`,
`createRadialGradient` (two-circle), `createConicGradient`, `createPattern`.
Invalid values are ignored and errors (`IndexSizeError`, `SyntaxError`,
`TypeError`) are thrown where browsers throw them.

**Text** uses "TTY Sans", a single-stroke vector font authored for this
package (ASCII, Latin-1 letters via combining accents, common symbols and
arrows). It scales to any size; `bold` / weights change the stroke width,
`italic` / `oblique` slant it, generic `monospace` families get fixed advances,
`small-caps` is supported. `strokeText` strokes the outline of the glyph strokes.

## Limitations

- Only the 2D context (`getContext('webgl')` returns `null`).
- Only PNG images are decoded (no JPEG / GIF / SVG); `toDataURL()` always
  produces PNG.
- One built-in font: `font-family` is parsed but every family renders with
  TTY Sans (monospace families get monospaced advances). No complex text
  shaping / RTL reordering.
- `ctx.filter` is stored but not applied. Shadows use a 3-pass box blur
  (a close Gaussian approximation).
- The DOM is a small subset aimed at canvas apps: no layout engine, CSS is not
  applied (only `style.width` / `height` affect a canvas' client size), no
  `fetch` for relative URLs, no WebAudio (an `Audio` stub exists).
- Terminals report mouse positions per cell, so pointer events have cell
  resolution (mapped to the cell's center in canvas pixels).
- Pixel protocols assume the cell size reported by the terminal (or 8×16 px)
  and re-send the whole image on every change.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later), see [LICENSE](LICENSE). The built-in font is original work, licensed with the rest of the package.
