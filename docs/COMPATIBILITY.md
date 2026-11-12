# Compatibility

What vuecli runs on, which terminals it supports, and how well existing web apps and
libraries work with `vuecli web`. Everything listed as working is covered by tests or was
checked against real apps.

- [Runtime](#runtime)
- [Terminals](#terminals)
- [Existing web apps (`vuecli web`)](#existing-web-apps-vuecli-web)
  - [Supported projects](#supported-projects)
  - [CSS](#css)
  - [Libraries](#libraries)
  - [Browser APIs](#browser-apis)
  - [Known gaps](#known-gaps)
- [Reporting a compatibility problem](#reporting-a-compatibility-problem)

## Runtime

| | Supported |
| --- | --- |
| Node.js | 20.6 or newer (22 LTS recommended). Your `.ts` files are compiled by vuecli, so every supported version runs them the same way. |
| Vue | 3.5 or newer |
| Operating systems | macOS and Linux are tested. Windows should work (paths go through Node's path APIs, no shell commands) but has no CI yet. |
| Package managers | npm, pnpm, yarn, bun (vuecli is a normal dependency) |

## Terminals

Anything that understands standard (xterm-style) escape sequences works: macOS Terminal,
iTerm2, Windows Terminal, GNOME Terminal, Konsole, kitty, WezTerm, Alacritty, foot, the
VS Code / JetBrains terminals, tmux and screen.

| Feature | Behaviour |
| --- | --- |
| Colors | truecolor when the terminal says so (`COLORTERM=truecolor`, iTerm2, Windows Terminal), otherwise 256 colors, 16 for basic `TERM`s (`xterm`, `linux`, `vt100`), none with `NO_COLOR` or `TERM=dumb`. Override with `VUECLI_COLOR`. Colors are downsampled, so every app stays readable. |
| Mouse | SGR mouse reporting (clicks, wheel, hover). `--no-mouse` turns it off so the terminal can select text. |
| Alternate screen | the app gets its own screen and your scrollback comes back on exit; `--no-alt-screen` draws in the normal buffer. |
| Synchronized output | frames are wrapped in synchronized-update sequences; terminals without support simply ignore them. |
| Images and `<Canvas>` | true pixels on kitty, iTerm2 and sixel terminals; block or braille characters elsewhere. |
| Window title | set from route metadata / `document.title`, restored on exit on terminals with a title stack. |
| Wide characters, emoji, RTL | grapheme- and width-aware; right-to-left text uses the Unicode bidi algorithm. |
| Small terminals | layouts clip cleanly instead of garbling; there's no minimum size. |
| No terminal (CI, pipes) | the interactive UI refuses to start with a clear message; `--snapshot` prints a frame instead. |
| Signals | Ctrl+C, `kill`, closing the terminal (SIGHUP), SIGQUIT and crashes all restore the terminal. Only `kill -9` can't be handled (type `reset`). |

## Existing web apps (`vuecli web`)

### Supported projects

| Project | Status |
| --- | --- |
| Vite + Vue 3 (`npm create vue@latest`, `npm create vite -- --template vue`) | ✅ supported, built with the app's own Vite config and plugins |
| Vue CLI (webpack) | ❌ not supported (vuecli builds with Vite); `vuecli web` says so |
| Nuxt | ❌ not supported (Nuxt has its own build and server); `vuecli web` says so |
| Vue 2 | ❌ not supported; `vuecli web` says so |

### CSS

| Works | Notes |
| --- | --- |
| selectors (classes, ids, attributes, `:is()`, `:where()`, `:not()`, `:hover` (follows focus), `:focus`, `:checked`, `:first-child`, …), specificity | |
| `@media` (width, height, `prefers-color-scheme`, range syntax `width >= 48rem`) | evaluated against the terminal size, 8×16 px per cell |
| `@layer` precedence | unlayered beats layered, later layers beat earlier ones |
| `var()` with fallbacks, `calc()`, `min()`, `max()`, `clamp()` | percentages and pixels can't be mixed (`calc(100% - 16px)` is dropped) |
| colors: hex, names, `rgb()`, `hsl()`, `oklch()`, `oklab()`, `color-mix()` | |
| block and inline flow, inline-block, floats beside inline content, flexbox, simple grids, absolute positioning | |
| `<style scoped>`, `:deep()`, CSS modules, SCSS / Less (through Vite) | |
| `<style>` elements added at runtime (component libraries, `useStyleTag`) | |
| `el.style.x = …`, `style.setProperty('--var', …)` | |
| Tailwind CSS v3 and v4 | colors, spacing, breakpoints, `dark:` work |

### Libraries

Checked with real apps:

| Library | Status |
| --- | --- |
| vue-router 4/5 | ✅ lazy routes, guards, params, `RouterLink`, `location.href = '/x'` navigation |
| Pinia | ✅ |
| vue-i18n | ✅ |
| VueUse | ✅ most composables (`useMouse`, `useStorage`, `useMediaQuery`, `useEventListener`, `onKeyStroke`, `useTitle`, `useDark`, `useOnline`, …) |
| Tailwind CSS v3 / v4 | ✅ (see [CSS](#css)) |
| PrimeVue, Element Plus, Naive UI | ⚠️ render and are usable, with approximate layouts (they position overlays with pixel measurements) |

### Browser APIs

`window`, `document` (`querySelector`, `getElementById`, `activeElement`, `cookie` jar,
`title`, events), `location` (navigation goes through the router), `history`,
`localStorage` / `sessionStorage` (persisted, see [Security](SECURITY.md#files-vuecli-writes)),
`matchMedia`, `getComputedStyle` (including custom properties),
`requestAnimationFrame`, `requestIdleCallback`, `ResizeObserver` / `MutationObserver` /
`IntersectionObserver` (simplified), `navigator` (`onLine`, `language`, an in-memory
`clipboard`), DOM event classes (`KeyboardEvent`, `MouseEvent`, `InputEvent`, …),
`structuredClone`, `crypto`, `URL`, `fetch`.

Elements support the common DOM members: `value`, `checked`, `focus()`, `click()`,
`classList`, `dataset`, attributes, `addEventListener` (with `once`), node relationships
(`parentNode`, `nextSibling`, `firstChild`, …), `innerHTML` / `textContent` (read and
write), `getBoundingClientRect()` (in CSS pixels), `closest()`, `matches()`,
`querySelector()`, `append()`, `before()`, `after()`, `attachShadow()`.

**`fetch` with relative URLs** (`fetch('/api/users')`) goes where the app's dev server
would send it: through the Vite `server.proxy` rules (including `rewrite`), otherwise to
`--origin https://your-site.example`. Without either it fails with a message saying so.

Errors thrown in timers or event handlers are logged and the app keeps running, like in a
browser tab.

### Known gaps

| Gap | Effect | Workaround |
| --- | --- | --- |
| `position: fixed` / `sticky` | laid out in normal flow: a modal teleported to `body` appears after the page content | scroll down (PgDn) to reach it |
| grid `gap` | emulated with padding; bordered grid cards can touch | |
| `px + %` arithmetic in `calc()` | the declaration is dropped | |
| `element.nodeType` | the string `'element'` instead of `1` | |
| `DOMParser`, `Image`, `elementFromPoint`, `getSelection` | not available | |
| Shadow DOM | `attachShadow()` works, but content inside a shadow root isn't displayed | |
| images, `<svg>` | `<img>` shows `▣` and its alt text; inline SVG is hidden; icon fonts become Unicode symbols | |
| axios with a relative `baseURL` | axios uses Node's HTTP module in Node, so the relative URL fails | set an absolute `baseURL` (`import.meta.env.VITE_API_URL`) |
| CSS animations, transforms, shadows, background images | ignored | |
| Pixel heights | ignored (they'd clip content in a short terminal); `min-height`, `%` and `vh` are kept | |

## Reporting a compatibility problem

Run the app with `vuecli web --snapshot --size 100x40` (and `VUECLI_WEB_DEBUG=1` for the
layout tree on stderr), and open an issue with the output, the library versions, and a
small reproduction if you can.
