# Building apps

How vuecli renders Vue in the terminal, and everything you use to build an app with it:
layout, components, composables, input, themes, routing, canvas and testing. New here? Start
with [Getting started](GETTING-STARTED.md).

- [How it works](#how-it-works)
- [Layout and styling](#layout-and-styling)
- [Components](#components)
- [Composables](#composables)
- [Keyboard, focus and mouse](#keyboard-focus-and-mouse)
- [Themes](#themes)
- [App Router](#app-router)
- [Canvas and images](#canvas-and-images)
- [Plain JavaScript / render functions](#plain-javascript--render-functions)
- [Tooling and testing](#tooling-and-testing)

## How it works

```
Vue component tree
   │  custom renderer (createRenderer → terminal node tree)
   ▼
TElement / TTextNode tree ──► Yoga flexbox layout (integer cells)
   │
   ▼
Painter ──► CellBuffer (grapheme + fg + bg + attrs per cell, wide-char aware)
   │
   ▼
diff(prev, next) ──► only changed spans of changed rows, wrapped in synchronized-update
                     escapes, written to stdout at most `fps` times per second
```

- **Renderer.** `src/renderer.ts` implements Vue's `RendererOptions`. Components render to `tui-box` and `tui-text` elements, which are also usable directly as `<box>` / `<text>`.
- **Layout.** Each box is a [Yoga](https://yogalayout.dev) node. Text is a measured leaf that wraps or truncates to the width it is given. Nested `<Text>` elements are inline spans.
- **Paint and diff.** Frames are painted into a cell buffer and compared with the previous frame. A frame where no cell changed writes nothing. A one-character change writes one cursor move and one character.
- **Templates.** `.vue` files are compiled by `@vue/compiler-sfc` in a Node loader hook, with TypeScript stripped by esbuild. `template:` strings are compiled at runtime. Both use terminal-aware compiler options: whitespace that contains a newline is formatting, while plain spaces are kept.
- **Input.** Raw stdin is parsed into key, paste and SGR-mouse events. These go to the focused component first, then to global `useInput` handlers. Mouse events are hit-tested against painted regions and bubble like DOM events.

## Layout and styling

Every element is a flexbox container. You can set style in three ways (later wins):

```vue
<!-- 1. utility classes -->
<Box class="flex-col gap-1 p-1 border-round border-primary bg-surface" />

<!-- 2. style object -->
<Box :style="{ flexDirection: 'column', padding: 1 }" />

<!-- 3. props -->
<Box flex-direction="column" :padding="1" border="round" title="Panel" />
```

Units are terminal cells. Supported properties:

| Group  | Properties |
| ------ | ---------- |
| Flex   | `flexDirection`, `flexWrap`, `flexGrow`, `flexShrink`, `flexBasis`, `alignItems`, `alignSelf`, `alignContent`, `justifyContent`, `gap`, `rowGap`, `columnGap` |
| Size   | `width`, `height`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight` (number or `'50%'`) |
| Spacing | `padding`, `paddingX/Y/Top/Right/Bottom/Left`, `margin`, `marginX/Y/…` |
| Position | `position: 'absolute'`, `top`, `left`, `right`, `bottom`, `zIndex`, `display: 'none'`, `overflow: 'hidden'` |
| Border | `border` (`single`, `round`, `double`, `bold`, `dashed`, `ascii`), `borderColor`, `borderTop/Right/Bottom/Left: false`, `title`, `titleAlign` |
| Ink (inherited) | `color`, `bg`, `bold`, `dim`, `italic`, `underline`, `inverse`, `strikethrough` |
| Text   | `wrap` (`wrap`, `truncate`, `truncate-start`, `truncate-middle`, `none`), `textAlign` |

Utility classes include `flex-row`, `flex-col`, `flex-1`, `grow`, `shrink-0`, `items-*`, `justify-*`, `self-*`, `gap-N`, `gap-x-N`, `p-N`, `px-N`, `pt-N`, `m-N`, `w-N`, `w-full`, `w-1/2`, `h-N`, `min-w-N`, `border`, `border-round`, `border-{color}`, `bg-{color}`, `text-{color}`, `text-[#ff8800]`, `bold`, `dim`, `italic`, `underline`, `inverse`, `strike`, `text-center`, `truncate`, `hidden`, `absolute`, `inset-0`, `top-N`, `overflow-hidden` and `z-N`.

Colors can be theme tokens (`primary`, `accent`, `muted`, `surface`, `border`, `focus`, `success`, `warning`, `error`, `info`, `selection`, `text`), ANSI names (`red`, `brightCyan`, `gray`), `#rgb` or `#rrggbb`, `rgb(r,g,b)` or `ansi256(n)`. Truecolor is downsampled automatically on 256- and 16-color terminals.

## Components

All components are registered globally, so you can use them in templates without importing them. You can also import them from `vuecli`.

| Group | Components |
| ----- | ---------- |
| Layout | `Box`, `Text`, `Newline`, `Spacer`, `Center`, `Stack`, `VStack`, `HStack`, `Grid` (track templates like `'1fr 2fr 20'`), `SplitPane` (drag or keyboard resize, collapsible), `Divider`, `ScrollBox`, `Tabs`, `Dialog`, `StatusBar` |
| Forms | `Button`, `TextInput`, `Checkbox`, `Switch`, `RadioGroup`, `Select`, `List`, `Slider` |
| Data | `Table`, `Tree` (virtualized), `Code` (syntax highlighting for js/ts/json/vue/html/css/bash/python/markdown), `Diff` (unified or side-by-side, word-level highlights) |
| Charts | `LineChart` (braille resolution, axes, legend), `BarChart`, `Sparkline` |
| Status | `ProgressBar`, `Spinner`, `Badge`, `Stat` |
| Text | `BigText`, `AsciiFont` (real FIGlet fonts), `Gradient`, `Markdown` |
| Graphics | `Canvas` (the HTML Canvas 2D API), `Image` (PNG). See [Canvas and images](#canvas-and-images) |
| Navigation | `Link`, `NavLink`, `Outlet`. See [App Router](#app-router) |
| Robustness | `ErrorBoundary` (`#fallback="{ error, reset }"`). Vue's built-in `<Suspense>` works too |
| Chrome | `CommandPalette` (ctrl+k), `KeyHelp` (`?`: lists every `useKeymap` binding that has a description), `KeyHints`, `DevTools` (F12 overlay: fps, frame time, bytes per frame, focus and captured `console.*` output) |

Right-to-left text (Hebrew, Arabic) is laid out with the Unicode Bidirectional Algorithm (`dir="auto|ltr|rtl"`).

```vue
<TextInput v-model="name" label="Name" placeholder="Your name" @submit="save" />
<Checkbox v-model="agree" label="I agree" />
<Switch v-model="wifi" label="Wi-Fi" />
<RadioGroup v-model="size" :options="['S', 'M', 'L']" horizontal />
<Select v-model="lang" :options="[{ label: 'Vue', value: 'vue' }, { label: 'React', value: 'react' }]" />

<List :items="files" v-model="index" :height="10" @select="open">
  <template #item="{ item, selected }"><Text :bold="selected">{{ item }}</Text></template>
</List>

<Table :rows="rows" :columns="[{ key: 'name', title: 'Name' }, { key: 'cpu', align: 'right' }]" selectable v-model="row" />

<Tabs v-model="tab" :tabs="['Overview', 'Logs']">
  <template #Overview>…</template>
  <template #Logs><ScrollBox stick-to-bottom>…</ScrollBox></template>
</Tabs>

<Dialog v-model:open="confirm" title="Delete?">
  <Text>This cannot be undone.</Text>
  <template #footer><Button label="Cancel" @click="confirm = false" /><Button label="Delete" variant="danger" @click="del" /></template>
</Dialog>

<CommandPalette :commands="[{ label: 'Toggle theme', key: 't', action: toggleTheme }]" />
<ProgressBar :value="0.42" show-percent />  <Spinner label="Loading…" />  <Sparkline :data="history" :width="30" />
<Markdown source="# Hello\n- **bold** and `code`" />
```

## Composables

| Composable | Purpose |
| ---------- | ------- |
| `useApp()` | `{ exit, theme, setTheme, size, requestRender, toggleDevtools }` |
| `useInput(handler, { isActive, priority })` | Global key handler (`e.name`, `e.char`, `e.ctrl`, `e.meta`, `e.shift`, `e.paste`, `e.stopPropagation()`) |
| `useKeymap({ 'ctrl+s': save, 'q\|escape': quit })` | Declarative shortcuts; a value can also be `{ handler, description, group }` (shown by `<KeyHelp>`) |
| `useFocus({ autoFocus, disabled, onKey })` | Makes a custom component focusable. Bind `ref: focus.el` to its root element |
| `useFocusManager()` | `focusNext`, `focusPrevious`, `focus(id)`, `activeId` |
| `useTerminalSize()` | Reactive `{ columns, rows }` |
| `useTheme()` | Current theme (reactive) |
| `useInterval(fn, ms)` / `useTicker(ms)` | Timers bound to the component lifecycle |
| `useLogs()` | Captured `console.*` output (it is printed to the terminal again after the app exits) |
| `useLayout()` | `{ layout, onLayout }`. Bind `onLayout` to an element to get its size and position reactively |

A custom focusable component:

```ts
import { defineComponent, h, ref } from 'vue'
import { useFocus, matchKey } from 'vuecli'

export const Counter = defineComponent({
  setup() {
    const n = ref(0)
    const focus = useFocus({
      onKey(e) {
        if (matchKey(e, 'up|k')) n.value++
        else if (matchKey(e, 'down|j')) n.value--
        else return
        e.stopPropagation()
      },
    })
    return () => h('tui-box', { ref: focus.el, border: 'round', borderColor: focus.isFocused.value ? 'focus' : 'border' },
      [h('tui-text', null, `n = ${n.value}`)])
  },
})
```

## Keyboard, focus and mouse

- **Tab / Shift+Tab** moves focus between focusable components in layout order. Focus stays inside open dialogs.
- Keys go to the **focused component first**. Anything it does not stop then goes to `useInput` / `useKeymap` handlers (higher `priority` first).
- **Mouse**: clicking focuses the component and fires `@click` (bubbling). The wheel fires `@wheel`, and `@mouse-down`, `@mouse-up`, `@mouse-move`, `@mouse-enter` and `@mouse-leave` work on any element. Handlers receive `{ x, y, localX, localY, button, target, stopPropagation() }`.
- Key combos: `ctrl+`, `alt+`/`meta+`, `shift+`, named keys (`enter`, `escape`, `tab`, `space`, `backspace`, `delete`, `up`, `down`, `left`, `right`, `home`, `end`, `pageup`, `pagedown`, `f1`–`f12`). Use `|` for alternatives.
- Bracketed paste arrives as one `paste` event. **Ctrl+C** exits (pass `exitOnCtrlC: false` to turn this off). **F12** toggles devtools.

## Themes

Built-in themes: `dark` (default), `light` and `dracula`. To switch at runtime, call `useApp().setTheme('light')`. To define your own theme:

```ts
import { defineTheme, darkTheme } from 'vuecli'
const ocean = defineTheme(darkTheme, { name: 'ocean', primary: '#4fc3f7', background: '#0b1622', surface: '#132232' })
createApp(App).mount({ theme: ocean })
```

## App Router

Folders in `app/` become routes and nested layouts (Next.js conventions):

```
app/layout.vue            root layout (renders <Outlet/> or its default slot)
app/page.vue              /
app/users/[id]/page.vue   /users/:id          app/docs/[...slug]/page.vue  catch-all
app/(group)/x/page.vue    route group         app/x/loading.vue / error.vue / not-found.vue
app/api/hello/route.ts    route handler (GET/POST/… → Response)
middleware.ts             redirects / rewrites, with `export const config = { matcher }`
```

```sh
vuecli run my-app --route /users/42     # deep link
```

- **Navigation:** `<Link href="/about">`, `useRouter()` (`push`, `replace`, `back`, `forward`, `refresh`) and alt+←/→ for history.
- **Route state:** `useParams()`, `useSearchParams()` and `usePathname()`.
- **Control flow:** `redirect()` and `notFound()`.
- **Pages** can export `metadata` (sets the terminal title), `runtime = 'server'` and `revalidate`.

The full API is documented at the top of `src/router/index.ts`.

## Canvas and images

`<Canvas>` gives you a real `CanvasRenderingContext2D`: paths, gradients, transforms, text, images and composite modes. It is drawn in the terminal with block or braille characters, or as true pixels on kitty, sixel and iTerm2 terminals.

```vue
<Canvas mode="sextant" @ready="(canvas, ctx) => { ctx.fillStyle = 'tomato'; ctx.fillRect(10, 10, 80, 40) }"
        @frame="(ctx, dt) => draw(ctx, dt)" />
<Canvas src="./starfield.html" />          <!-- run existing browser canvas code, unmodified -->
<Image src="logo.png" :width="40" fit="contain" />
```

The engine is a standalone library, **[`tty-canvas`](../packages/tty-canvas/README.md)**, with no dependencies. It works without vuecli:

```sh
npx tty-canvas index.html            # run an HTML page with a <canvas> + scripts in the terminal
npx tty-canvas sketch.js -m braille  # or a script that uses document/requestAnimationFrame
```

## Plain JavaScript / render functions

You don't need a build step:

```js
import { ref, h } from 'vue'
import { createApp, Box, Text } from 'vuecli'

createApp({
  setup() {
    const n = ref(0)
    setInterval(() => n.value++, 1000)
    return () => h(Box, { border: 'round', padding: 1 }, () => h(Text, { color: 'primary' }, () => `tick ${n.value}`))
  },
}).mount()
```

`template:` strings also work (they are compiled at runtime). See [`examples/counter.js`](../examples/counter.js).

## Tooling and testing

| Tool | What it does |
|------|--------------|
| `vuecli mcp <app>` ([docs](../src/mcp/README.md)) | MCP server for coding agents: `read_frame`, `press`, `type`, `click`, `wait_for`, `get_tree`, `navigate`, … |
| `window.vuecli` REPL ([docs](../src/devtools/README.md)) | `pause()`, `step()`, `resize()`, `wireframe()`, `copy()`, `tree()`, `stats()` in Node or the browser |
| [Chrome DevTools panel](../packages/devtools-extension/README.md) | component tree, frame inspector, per-frame timeline, pause/step/wireframe |
| [VS Code extension](../packages/vscode-vuecli/README.md) | live frame preview next to the code (⌘K V), App Router scaffolding |
| [eslint-plugin-vuecli](../packages/eslint-plugin-vuecli/README.md) | `no-dom-elements`, `no-box-in-text`, `no-unsupported-glyphs` |
| [Error codes](errors.md) | every error is `VC###` with an explanation and fix |

`vuecli/testing` renders offscreen, so you can drive the app and assert on frames:

```ts
import { render } from 'vuecli/testing'

const r = await render(App, { columns: 60, rows: 20 })
await r.press('tab', 'enter')        // key combos: 'ctrl+s', 'shift+tab', 'down', ...
await r.type('hello')
const { x, y } = r.locate('Save')!   // find text on screen
await r.click(x, y)
expect(r.lastFrame()).toContain('Saved!')
r.buffer()                            // cell buffer with colors and attributes
r.unmount()
```

This repo's own suite (`npm test`) covers layout, wrapping, input parsing, diffing and every interactive component.
