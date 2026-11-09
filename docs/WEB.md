# Running existing Vue web apps in the terminal (`vuecli web`)

`vuecli web` takes an existing **Vite + Vue 3** web app, the kind you'd scaffold with
`npm create vue@latest`, and runs it in the terminal. You don't need to change any app
code.

```sh
cd my-existing-vue-app
npm install -D vuecli          # or: npm link /path/to/vuecli
npx vuecli web                 # build + run in the terminal
```

Add a script if you use it often:

```json
{ "scripts": { "tui": "vuecli web" } }
```

## What happens

1. **Build:** the app is built with **its own Vite and `vite.config`**, so aliases,
   plugins, `.env` files and CSS imports all work as usual. vuecli adds one plugin:
   - `vue` resolves to a shim. It is the real Vue with `createApp`, `v-model` and
     `<Transition>` replaced by terminal versions.
   - vue-router's `createWebHistory` / `createWebHashHistory` become memory
     histories. Use `--route /path` to deep link.
   - Everything goes into one ES module, in `node_modules/.vuecli-web`.
2. **Run:** the app's `index.html` becomes the page shell (`<html>`, `<body>` and any
   static markup). The Vue app mounts exactly where the browser would mount it (`#app`,
   `.todoapp`, ...).
3. **Style:** CSS comes from the bundle, from `<link rel="stylesheet">` (local or
   remote; remote files are cached) and from `<style>`. A small CSS engine applies it:
   selectors with specificity, `@media` evaluated against the terminal size and the
   theme's colour scheme, `var()`, `::before` / `::after` content, block and inline
   flow, flexbox, simple grids, floats and absolute positioning.

## Units

One cell is treated as **8 CSS px wide and 16 CSS px tall**. `padding: 1rem` becomes
2 columns and 1 row, and a terminal 120 columns wide matches 960 px for media queries.

Pixel *heights* are ignored because they would clip content in a short terminal.
`min-height`, `%` and `vh` are kept.

## Interaction

| Key | Action |
| --- | --- |
| `Tab` / `Shift+Tab` | move focus between links, buttons, inputs and elements with click handlers |
| `Enter` | follow a link, press a button, submit a form (in a text input) |
| `Space` | press a button, toggle a checkbox or radio |
| `↑ ↓ ← →` | cycle `<select>` options, move a range slider; scroll the page otherwise |
| `PgUp` / `PgDn`, mouse wheel | scroll the page |
| mouse click / double click | `click` / `dblclick` on the element under the cursor |
| `Ctrl+C` | quit (`F12` opens vuecli's devtools, with logs) |

Event handlers receive DOM-shaped events, so `@keyup.enter`, `@click.prevent`,
`@submit.prevent`, `event.target.value` and vue-router's `RouterLink` all work as they do
in a browser. `:hover` follows keyboard focus as well as the mouse, so things that only
appear on hover (delete buttons, menus) are reachable by keyboard.

Form controls are drawn with terminal glyphs: text inputs as an underlined field with a
cursor, `[x]` checkboxes, `(•)` radios, `[Option ▾]` selects, and `[ label ]` buttons.
`v-model` works on all of them, including the `.lazy`, `.trim` and `.number` modifiers
and checkbox arrays and sets.

## Browser APIs

The app runs in Node with small browser globals: `window` (which is `globalThis`),
`document` (`title`, `body`, `querySelector`, `activeElement`, `addEventListener`),
`location`, `history`, `matchMedia`, `requestAnimationFrame` and `getComputedStyle`.

`localStorage` is saved to `node_modules/.vuecli-web-cache/localStorage.json`, so it
persists between runs. `IntersectionObserver` reports every element as visible.
`fetch` is Node's own, so apps that call real APIs work.

Elements returned by template refs and `event.target` support the common DOM members:
`value`, `checked`, `focus()`, `blur()`, `click()`, `classList`, `getAttribute`,
`addEventListener`, `getBoundingClientRect()`, `closest()` and `querySelector()`.

## Options

```
vuecli web [dir]
  --route /path          initial route (vue-router apps)
  --theme light|dark     terminal theme; also decides prefers-color-scheme
  --watch                rebuild and restart on every file change
  --no-mouse             no mouse tracking
  --snapshot             print one frame as text and exit (CI, docs)
  --snapshot=html        ... as a standalone HTML page
  --size 100x40          snapshot size
  --keys "tab,type:hello,enter"   scripted input before the snapshot
  --wait 1500            ms to wait before the snapshot (for data fetching)
```

`VUECLI_WEB_DEBUG=1` with `--snapshot` also prints the element tree with layout boxes to
stderr.

## Page colours

A site without dark-mode styles is designed for a white page, so it is shown on white,
like a browser would show it. Sites with `@media (prefers-color-scheme: dark)` follow the
terminal theme (`--theme`). Text colours that would be unreadable on their background are
replaced.

## Limitations

- **Vite + Vue 3 only.** The app needs an `index.html` with a `<script type="module">`
  entry and `vite` installed. Vue CLI (webpack) and Nuxt are not supported.
- **CSS:** no transforms, animations, shadows, background images or `calc()`. Fixed and
  sticky positioning become static. Elements pushed outside their box with negative
  offsets stay in normal flow. Pixel heights are ignored.
- **Images and SVG:** `<img>` shows its `alt` text and inline SVG is hidden. Icon fonts
  (ionicons, font-awesome, bootstrap icons, ...) are mapped to Unicode symbols by class
  name.
- **DOM:** there is no full DOM. Code that builds UI imperatively with
  `document.createElement` / `innerHTML` on elements outside Vue may not render. `v-html`
  works.
- **Libraries** that need real layout measurements (virtual scrollers, positioning
  engines like Popper or Floating UI) get approximate values.
- CSS `v-bind()` (`useCssVars`) is ignored.
