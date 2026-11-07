# vuecli architecture & extension points

This document is the contract between the parts of the project. Read it before
changing core files.

## Repository layout

```
src/                       vuecli core (published as `vuecli`)
  renderer.ts              Vue custom renderer (nodeOps) + runtime template compiler
  compiler-options.ts      template compiler options shared by SFC + runtime compiler
  dom/nodes.ts             TElement / TTextNode tree, Yoga integration
  render/text.ts           grapheme widths, wrapping, truncation
  render/paint.ts          Painter: layout -> CellBuffer, hit regions, paintCells, graphics
  render/buffer.ts         CellBuffer + diffBuffers (ANSI row/span diff)
  input/keys.ts            raw input parser (keys, paste, SGR mouse), matchKey
  app/app.ts               createApp / Runtime (target-agnostic)
  app/target.ts            RenderTarget interface, runtime events
  app/tty.ts               default terminal target
  app/focus.ts             focus manager
  composables.ts           useInput, useKeymap, useFocus, useApp, ...
  components/*.ts          built-in components (auto-registered, see below)
  router/                  App Router (file-based routes)          [router stream]
  server/                  HTTP server, SSE streaming, handlers    [server stream]
  targets/                 browser console target, frame protocol  [server stream]
  cache/                   cache(), revalidateTag(), ...           [server stream]
  mcp/                     MCP server                              [tooling stream]
  devtools/                devtools hook + window.vuecli REPL      [tooling stream]
  errors.ts                VC### error codes                       [tooling stream]
  sfc/                     .vue loader hooks (compileSFC)
  cli/                     CLI: index.ts registry + commands/*.ts
  testing.ts               offscreen test renderer
packages/
  tty-canvas/              standalone Canvas 2D -> terminal library [canvas stream]
  eslint-plugin-vuecli/    ESLint rules                            [tooling stream]
  vscode-vuecli/           VS Code extension                        [tooling stream]
  devtools-extension/      Chrome DevTools panel                    [tooling stream]
test/                      vitest suites (test/<area>/*.test.ts)
examples/                  runnable examples
```

## Runtime

`createApp(Root).mount(options)` creates a `Runtime` (`app.runtime`):

| API | Purpose |
| --- | --- |
| `runtime.renderFrame()` | layout + paint + present now; returns the `CellBuffer` |
| `runtime.handleInput(raw)` | feed raw terminal input (escape sequences / text) |
| `runtime.dispatch(event)` | feed a parsed `KeyEvent` / `MouseEvent` |
| `runtime.resize(cols, rows)` | change the virtual screen size |
| `runtime.pause()` / `resume()` | stop / restart presenting frames |
| `runtime.setWireframe(bool)` | outline every box (debug) |
| `runtime.invalidate()` | force a full repaint |
| `runtime.events.on('frame' \| 'resize' \| 'input' \| 'exit' \| 'pause', fn)` | observe the runtime |
| `runtime.root` | root `TElement` (walk it for a component/element tree) |
| `runtime.ctx` | the `AppContext` provided to components (`APP_CONTEXT`) |

### Render targets

`MountOptions.target` decides where frames go (`src/app/target.ts`):

```ts
interface RenderTarget {
  columns: number; rows: number
  colorDepth?: 16 | 256 | 'truecolor'
  start?(runtime): void            // wire input, set up the output
  frame(next, prev, { graphics, prevGraphics }): number | void   // present; return bytes written
  stop?(runtime): void
}
```

- default: `ttyTarget()` (stdin/stdout, alternate screen, mouse, ANSI diffs)
- `manualRender: true`: no target; you call `renderFrame()` (tests, MCP, server sessions)
- custom targets: browser console, SSE stream, VS Code webview, ...

`prev === null` means "full repaint". Use `diffBuffers(prev, next)` for ANSI output,
or walk `CellBuffer` (`chars`, `fg`, `bg` as SGR parameter strings, `flags` bitmask:
1 bold, 2 dim, 4 italic, 8 underline, 16 inverse, 32 strike).

## Painting hooks

### `paintCells`: custom cell drawing

Any element can draw its own cells. This is how the canvas, charts and images work:

```ts
h('tui-box', {
  flexGrow: 1,
  paintCells(p: CellPainter, rect) {
    // p.width / p.height = content box in cells, coordinates are relative
    p.set(0, 0, '▀', 0xff0000, 0x0000ff)          // fg / bg as 0xRRGGBB, color string, or null
    p.text(2, 0, 'hello', 'primary', null, { bold: true })
    p.graphic({ key: 'img-1', version: 3, data: kittyEscape, clear: kittyDelete })
  },
})
```

The callback runs on every frame where the tree is painted. Request a new frame
after the pixels change by bumping a reactive value, or by calling `useApp().requestRender()`.

### Graphics

`p.graphic()` queues an out-of-band image (kitty, sixel or iTerm2 escape data)
at the content box. Cells are still painted underneath, so targets that cannot
show images get the cell fallback. The tty target re-emits a graphic only when
its `key`, `version` or position changes, and sends `clear` when it disappears.

## Components

Every **named** Vue component exported from a module listed in
`src/components/index.ts` is registered globally. Its export name must start with
an uppercase letter and it must have a `name` option. To add components, add
them to your module. You don't need to edit `index.ts` unless you create a new
module.

## CLI

`src/cli/index.ts` lazily loads `src/cli/commands/<name>.ts`. Each file exports
`default: Command { summary, usage, run(args, flags) }`. Shared helpers are in
`src/cli/shared.ts` (`packageRoot`, `pkg`, `hooksUrl`).

## Router contract

See `src/router/types.ts` for the file conventions and the `RouteManifest`
shape. The manifest is shared by the router (terminal), the server, the
browser build and MCP.

## Testing

`import { render } from '../src/testing.js'` gives you `press`, `type`, `paste`,
`click`, `wheel`, `lastFrame`, `buffer`, `locate`, `settle` and `unmount`. Put
suites in `test/<area>/*.test.ts` and run them with `npx vitest run test/<area>`.
