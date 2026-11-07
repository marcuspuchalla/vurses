# vuecli devtools hook and REPL

`installDevtoolsHook(runtime, { repl })` exposes a running app to tools. It is
browser- and Node-safe (no DOM / Node APIs) and returns an uninstall function
(it also uninstalls itself when the app exits). The browser entry calls it
with `{ repl: true }`.

```ts
import { createApp, installDevtoolsHook } from 'vuecli'
const app = createApp(App).mount()
installDevtoolsHook(app.runtime!, { repl: true })
```

## `globalThis.__VUECLI_DEVTOOLS_HOOK__`

Every method returns JSON-serializable data, so it can be called through
`chrome.devtools.inspectedWindow.eval` (the Chrome extension does this).

| Method | Returns |
| --- | --- |
| `getState()` | `{ paused, wireframe, columns, rows, frames, fps, highlight, apps }` |
| `getFrame()` | `FrameSnapshot`: `{ width, height, frame, lines[], rows: [{ t, w, fg?, bg?, f? }][] }` (CSS colors, `f` = attribute bits) |
| `getFrameText()` / `getFrameAnsi()` | the frame as plain / ANSI text |
| `getComponentTree(opts?)` | `ComponentInfo[]`: `{ id, name, file?, props, rect, elements, children }` |
| `getComponent(id)` | details: props, setup state, rect, child count |
| `getElementTree(opts?)` | `ElementInfo`: `{ id, tag, kind, rect, props, listeners, text?, children }` |
| `formatComponentTree()` / `formatElementTree()` | indented text outlines |
| `getTimeline(n?)` | last frames: `{ frame, time, ms, bytes, changedRows }` (600 kept) |
| `onFrame(fn)` | subscribe in-page (returns unsubscribe) |
| `highlight(id \| rect \| null, ms = 1500)` | flashes a component / element (cells drawn inverse) |
| `pause()` / `resume()` / `step()` | stop presenting / restart / present one frame |
| `setWireframe(on)` / `resize(cols, rows)` | debug outlines / virtual size |
| `press(...keys)` / `type(text)` | input |
| `stats()` | frames, fps, last and average ms / bytes |

`runtimes` lists every registered app; methods act on the most recent one.

## `vuecli` console REPL

```
vuecli.pause()           vuecli.resume()        vuecli.step()
vuecli.resize(100, 30)   vuecli.wireframe()     // toggles; or wireframe(true)
vuecli.copy()            // frame as plain text, also to the clipboard in browsers
vuecli.frame()           vuecli.ansi()
vuecli.tree()            // prints the component tree with rects, returns it
vuecli.elements()        vuecli.highlight(5)
vuecli.press('tab', 'enter')   vuecli.type('hello')
vuecli.stats()           vuecli.help()
```

## Building blocks

- `frame.ts`: `snapshotFrame`, `frameToAnsi`, `styleSpans`, `sgrToCss`, `locateText`, `changedRows`
- `html.ts`: `frameToHtml(snapshot, { highlight })` + `FRAME_CSS` (Chrome panel, VS Code preview)
- `tree.ts`: `componentTree`, `elementTree`, `formatComponentTree`, `serializeValue`, stable ids
