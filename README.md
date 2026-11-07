# vuecli

**Native Vue 3 apps in the terminal.** Write ordinary Vue components (SFCs, `<script setup>`, TypeScript, `ref`, `computed`, `v-model`, slots, `v-for`, `v-if`, `v-show`, Teleport) and they render as a real terminal UI: flexbox layout, borders, colors, themes, keyboard focus and mouse support.

```vue
<script setup lang="ts">
import { ref } from 'vue'
const count = ref(0)
</script>

<template>
  <Box class="flex-col gap-1 p-1" border="round" title="counter">
    <BigText :text="String(count)" color="primary" />
    <Box class="gap-1">
      <Button label="-1" @click="count--" />
      <Button label="+1" variant="primary" @click="count++" />
    </Box>
  </Box>
</template>
```

```sh
npx vuecli App.vue
```

```
╭─ counter ──────────────────────╮
│                                │
│ █▀█                            │
│ █ █                            │
│ ▀▀▀                            │
│                                │
│ ┏━━━━┓ ╭────╮                  │
│ ┃ -1 ┃ │ +1 │                  │
│ ┗━━━━┛ ╰────╯                  │
│                                │
╰────────────────────────────────╯
```

## Contents

- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Layout and styling](#layout-and-styling)
- [Components](#components)
- [Composables](#composables)
- [Keyboard, focus and mouse](#keyboard-focus-and-mouse)
- [Themes](#themes)
- [Testing](#testing)
- [Plain JavaScript / render functions](#plain-javascript--render-functions)
- [Limitations](#limitations)

## Quick start

```sh
npx vuecli create my-app     # scaffold
cd my-app && npm install
npm start                    # → vuecli App.vue
```

Or in this repository:

```sh
npm install
npm run example:dashboard    # ops dashboard: tabs, tables, charts, logs, dialogs, command palette
npm run example:todo         # todo app with inputs, checkboxes, radio filters
npm run example:counter      # plain JS + runtime-compiled template, no SFC
```

### CLI

```
vuecli <entry>             Run an app (.vue, .js, .ts); its default export is the root component
vuecli create <dir>        Scaffold a new app

--theme <name>             dark | light | dracula
--no-mouse                 Disable mouse tracking
--fps <n>                  Frame rate cap (default 60)
--no-alt-screen            Render in the main screen buffer
```

### Mounting manually

```ts
import { createApp } from 'vuecli'
import App from './App.vue'

const app = createApp(App)           // same API as Vue's createApp: use(), provide(), component()...
app.mount({ theme: 'dracula' })      // takes terminal options instead of a DOM selector
await app.waitUntilExit()
```

To import `.vue` files from your own Node entry point, register the loader:
`node --import vuecli/register main.js`. The `vuecli` CLI does this automatically.

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

**Layout:** `Box`, `Text`, `Newline`, `Spacer`, `Center`, `VStack`, `HStack`, `Divider`, `ScrollBox`, `Tabs`, `Dialog`, `StatusBar`

**Forms:** `Button`, `TextInput`, `Checkbox`, `Switch`, `RadioGroup`, `Select`, `List`

**Data and display:** `Table`, `ProgressBar`, `Spinner`, `Sparkline`, `BarChart`, `Badge`, `Stat`, `BigText`, `Markdown`, `KeyHints`

**Chrome:** `CommandPalette` (ctrl+k), `DevTools` (F12 overlay showing fps, frame time, bytes per frame, focus and captured `console.*` output)

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
| `useKeymap({ 'ctrl+s': save, 'q\|escape': quit })` | Declarative shortcuts |
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

## Testing

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

`template:` strings also work (they are compiled at runtime). See `examples/counter.js`.

## Limitations

- Full-screen apps only (alternate screen). An inline mode for rendering below the prompt is not implemented yet.
- `<style>` blocks in SFCs are ignored. Style with classes or props instead.
- No IME composition, kitty keyboard protocol or image protocols yet.
- Vue `<Transition>` works but nothing animates. Use `useTicker` for animations.

## Development

```sh
npm install
npm run build       # tsc → dist/
npm test            # vitest
npm run typecheck
```

MIT licensed.
