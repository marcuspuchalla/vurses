# Running existing Vue web apps in the terminal (`vurses web`)

`vurses web` takes an existing **Vite + Vue 3** web app, the kind you'd scaffold with
`npm create vue@latest`, and runs it in the terminal. You don't need to change any app
code.

```sh
cd my-existing-vue-app
npm install -D vurses
npx vurses web                 # build + run in the terminal
```

> **The app runs in Node, outside the browser sandbox**, with your user's privileges (files,
> environment variables, network without CORS). Only run apps you'd also run with `node`.
> See [Security](SECURITY.md#running-existing-web-apps-vurses-web).

Add a script if you use it often:

```json
{ "scripts": { "tui": "vurses web" } }
```

## What happens

1. **Build:** the app is built with **its own Vite and `vite.config`**, so aliases,
   plugins, `.env` files and CSS imports all work as usual. vurses adds one plugin:
   - `vue` resolves to a shim. It is the real Vue with `createApp`, `v-model` and
     `<Transition>` replaced by terminal versions.
   - vue-router's `createWebHistory` / `createWebHashHistory` become memory
     histories. Use `--route /path` to deep link.
   - Everything goes into one ES module, in `node_modules/.vurses-web`.
2. **Run:** the app's `index.html` becomes the page shell (`<html>`, `<body>` and any
   static markup). The Vue app mounts exactly where the browser would mount it (`#app`,
   `.todoapp`, ...).
3. **Style:** CSS comes from the bundle, from `<link rel="stylesheet">` (local or
   remote; remote files are cached) and from `<style>`. A small CSS engine applies it:
   selectors with specificity, `@media` evaluated against the terminal size and the
   theme's colour scheme, `var()`, `::before` / `::after` content, block and inline
   flow, flexbox, simple grids, floats and absolute positioning. Inline-block boxes
   and floats share a line with the inline content around them (an avatar, a name
   block and a right-floated button sit side by side, as in a browser).

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
| `Ctrl+C` | quit (`F12` opens vurses's devtools, with logs) |

Event handlers receive DOM-shaped events, so `@keyup.enter`, `@click.prevent`,
`@submit.prevent`, `event.target.value` and vue-router's `RouterLink` all work as they do
in a browser. `:hover` follows keyboard focus as well as the mouse, so things that only
appear on hover (delete buttons, menus) are reachable by keyboard.

Form controls are drawn with terminal glyphs: text inputs as an underlined field with a
cursor, `[x]` checkboxes, `(•)` radios, `[Option ▾]` selects, and `[ label ]` buttons.
`v-model` works on all of them, including the `.lazy`, `.trim` and `.number` modifiers
and checkbox arrays and sets.

## Browser APIs

The app runs in Node with browser globals: `window`, `document`, `location` (navigation
goes through the router), `history`, `localStorage` / `sessionStorage`, `matchMedia`,
`getComputedStyle`, `requestAnimationFrame`, DOM event classes, `navigator`, cookies and
more; elements support the common DOM members. The full list, and what's missing, is in
[Compatibility](COMPATIBILITY.md#browser-apis).

- **`localStorage`** is saved to `node_modules/.vurses-web-cache/localStorage.json`
  (readable only by you), so logins and settings survive restarts.
- **`fetch`** is Node's own, so apps that call real APIs work. Relative URLs
  (`fetch('/api/users')`) go through the app's Vite `server.proxy` rules, otherwise to
  `--origin`.
- **Errors** thrown in timers or handlers are logged and the app keeps running, like in a
  browser tab.

## Options

```
vurses web [dir]
  --route /path          initial route (vue-router apps)
  --origin https://…     where relative fetch('/api/…') URLs go when no Vite proxy rule matches
  --theme light|dark     terminal theme; also decides prefers-color-scheme
  --watch                rebuild and restart on every file change
  --no-mouse             no mouse tracking
  --snapshot             print one frame as text and exit (CI, docs)
  --snapshot=html        ... as a standalone HTML page
  --size 100x40          snapshot size
  --keys "tab,type:hello,enter"   scripted input before the snapshot
  --wait 1500            ms to wait before the snapshot (for data fetching)
```

`VURSES_WEB_DEBUG=1` with `--snapshot` also prints the element tree with layout boxes to
stderr.

## Page colours

A site without dark-mode styles is designed for a white page, so it is shown on white,
like a browser would show it. Sites with `@media (prefers-color-scheme: dark)` follow the
terminal theme (`--theme`). Text colours that would be unreadable on their background are
replaced.

## Limitations

The main ones: `position: fixed` content (modals) is laid out in normal flow, inline SVG is
hidden, images show their alt text, and CSS animations, transforms and shadows are ignored.
Vue CLI (webpack), Nuxt and Vue 2 apps aren't supported. The complete, current list with
workarounds is in [Compatibility → Known gaps](COMPATIBILITY.md#known-gaps).
