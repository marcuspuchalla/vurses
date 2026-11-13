# vurses devtools (Chrome extension)

A **vurses** panel in Chrome DevTools for vurses apps that run in the browser
(the browser-console target):

- **Component tree** with layout rects (`x,y width×height` in cells), filterable.
  Selecting a component shows its props, setup state, source file and rect,
  and **highlights it in the running app** (its cells flash inverse) and in the
  frame inspector.
- **Frame inspector**: the current frame as a colored HTML cell grid.
- **Timeline**: one bar per presented frame (ms; orange above the 16 ms
  budget, grey for frames that wrote no bytes), with averages.
- **Pause / Resume / Step / Wireframe** controls.

## Install

```sh
npm run build      # → dist/
```

Open `chrome://extensions`, enable *Developer mode*, *Load unpacked* →
`packages/devtools-extension/dist`. Open DevTools on a page running a vurses
app and pick the **vurses** tab.

## How it works

The panel talks to the page through
`chrome.devtools.inspectedWindow.eval`, calling methods of
`globalThis.__VURSES_DEVTOOLS_HOOK__` (installed by vurses's
`installDevtoolsHook(runtime)`, which the browser entry calls). Every hook
method returns JSON, so no content script or message bridge is needed. The
panel polls `getState()` every 500 ms and re-reads the tree, frame and timeline
only when the frame counter changed.

Hook methods used: `getState`, `getComponentTree`, `getComponent(id)`,
`getFrame`, `getTimeline(n)`, `highlight(id, ms)`, `pause`, `resume`, `step`,
`setWireframe(on)`. See `src/devtools/hook.ts` in vurses for the full API
(also usable from the console, together with the `vurses` REPL:
`vurses.pause()`, `vurses.copy()`, `vurses.tree()`, ...).

If the page has no hook the panel shows `VC116` (see `docs/errors.md`).

## Files

| File | |
| --- | --- |
| `static/manifest.json` | MV3 manifest (`devtools_page` only, no permissions) |
| `src/devtools.ts` | registers the panel |
| `src/main.ts` / `src/panel.ts` | panel controller (plain DOM) |
| `src/view.ts` | pure HTML builders (tree, details, timeline) |
| `src/bridge.ts` | `inspectedWindow.eval` bridge to the hook |
| `build.mjs` | esbuild bundle + static files + generated icon → `dist/` |

The frame grid uses `frameToHtml` from vurses (`src/devtools/html.ts`),
shared with the VS Code preview.

## Tests

```sh
npm test
```

`test/view.test.ts` covers the HTML builders and the eval bridge.
`test/panel.test.ts` runs a real vurses app with the real hook in Node, loads
the built extension in Chromium (Playwright, `channel: 'chromium'`) and opens
its `panel.html` with `chrome.devtools.inspectedWindow.eval` bridged to the
Node process: tree, selection + highlight, pause / step / resume, wireframe,
live updates, filtering and the missing-hook state. It is skipped when
Playwright is not installed.
