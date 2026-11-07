# vuecli error codes

Errors that vuecli raises on purpose carry a stable `VC###` code and link to this page:

```
VuecliError: [VC001] useApp() was called outside a vuecli app. Call it from setup() of a component rendered by createApp(...).mount().
  → https://github.com/marcuspuchalla/vuecli/blob/main/docs/errors.md#vc001
```

In code:

```ts
import { VuecliError, isVuecliError, vuecliError } from 'vuecli'

try {
  await router.push('/nope')
} catch (e) {
  if (isVuecliError(e, 'VC060')) console.log(e.code, e.reason, e.docsUrl, e.params)
}

throw vuecliError('VC061', { route: '/users/[id]', reason: 'id is required' })
```

`VuecliError` has `code`, `reason` (the message without the prefix and link),
`docsUrl`, `params` (the values the message was built from) and `cause`.
`vuecliWarn(code, params)` logs a coded warning once. `formatError(err)` prints
any error for a terminal. Codes are never renumbered.

| Range | Area |
| --- | --- |
| VC001–009 | App lifecycle |
| VC010–019 | Renderer |
| VC020–029 | Templates |
| VC030–039 | Single-file components |
| VC040–049 | Styles, colors, themes |
| VC050–059 | Focus |
| VC060–079 | App Router |
| VC080–099 | Server |
| VC100–109 | Canvas and images |
| VC110–129 | Tooling (MCP, devtools) |
| VC130–139 | CLI |

---

## App lifecycle

<a id="vc001"></a>
## VC001 Composable used outside a vuecli app

`useApp()`, `useInput()`, `useFocus()`, `useTerminalSize()` and the other vuecli
composables read the app context that `createApp(...).mount()` provides. They
were called somewhere that context does not exist: outside `setup()`, after an
`await` in `setup()`, in a plain module, or in a component mounted by a
different Vue app (for example two copies of `vue` in `node_modules`).

**Fix:** call the composable synchronously at the top of `setup()` /
`<script setup>`. If you run your own Node entry point, make sure there is one
copy of `vue` (`npm ls vue`). The `vuecli` CLI and `vuecli/register` resolve
`vue` through vuecli for you.

<a id="vc002"></a>
## VC002 App is not mounted

`app.waitUntilExit()` (or another runtime method) was called before
`app.mount()`.

**Fix:** call `mount()` first: `const app = createApp(App).mount(); await app.waitUntilExit()`.

<a id="vc003"></a>
## VC003 Invalid mount options

A `mount()` option has an unsupported value, for example a negative `fps`,
`columns: 0` or an unknown `colorDepth`.

**Fix:** see `MountOptions` in the README. Sizes are positive integers in
cells; `colorDepth` is `16`, `256` or `'truecolor'`.

<a id="vc004"></a>
## VC004 App mounted twice

An app instance can be mounted once.

**Fix:** create a new app with `createApp()` for each mount, or unmount first.

<a id="vc005"></a>
## VC005 App crashed

An error escaped a component (render, watcher, lifecycle hook or event
handler) and the app exited to keep the terminal usable. The original error is
the `cause`.

**Fix:** read the stack trace printed after exit. Use `<ErrorBoundary>` (or
`onErrorCaptured`) to recover from errors in part of the tree.

## Renderer

<a id="vc010"></a>
## VC010 Unsupported static content

Vue's compiler can stringify large static subtrees into HTML strings
(`insertStaticContent`). That only works with a DOM, so the terminal renderer
cannot insert them.

**Fix:** compile templates with vuecli's `compilerOptions` (they set
`hoistStatic: false`). `.vue` files loaded through the vuecli CLI,
`vuecli/register` or the vuecli build already do this. If you use your own
bundler plugin, pass `compilerOptions` from `vuecli` to it.

<a id="vc011"></a>
## VC011 Unknown element

An HTML tag with no terminal meaning (`<input>`, `<button>`, `<img>`, `<a>`,
`<ul>`, `<table>`, ...) was rendered. It is laid out as a plain box and loses its
HTML behavior.

**Fix:** use the vuecli component: `TextInput`, `Button`, `Image`, `List`,
`Table`, `Select`, `Checkbox`, ... `div` / `span` / `p` / `box` / `text` are
valid aliases. The ESLint rule `vuecli/no-dom-elements` catches these at edit time.

<a id="vc012"></a>
## VC012 Box inside Text

A layout box (`<Box>`, `<box>`, `<div>`) is nested inside `<Text>` / `<span>`.
Text elements lay out inline text only, so the box's size, border and padding
are ignored.

**Fix:** put the box next to the text, or wrap both in a `<Box>`. Nested
`<Text>` elements (inline spans) are fine. See ESLint rule `vuecli/no-box-in-text`.

## Templates

<a id="vc020"></a>
## VC020 Template compile error

A `template:` string could not be compiled at runtime. The message contains the
compiler error (unclosed tag, invalid expression, ...).

**Fix:** fix the template. Errors include the offending source location when
available.

<a id="vc021"></a>
## VC021 Runtime compiler unavailable

A component uses a `template:` string but the build in use has no runtime
compiler (for example a browser bundle built without `@vue/compiler-dom`).

**Fix:** precompile components (`.vue` files or render functions), or import
from the full `vuecli` entry.

## Single-file components

<a id="vc030"></a>
## VC030 SFC parse error

A `.vue` file could not be parsed: unbalanced blocks, two `<script setup>`
blocks, invalid attributes on a block.

**Fix:** check the file and line in the message.

<a id="vc031"></a>
## VC031 SFC template compile error

The `<template>` of a `.vue` file failed to compile.

**Fix:** check the template expression or tag in the message.

<a id="vc032"></a>
## VC032 SFC script compile error

`<script>` / `<script setup>` failed to compile or to strip TypeScript (for
example invalid `defineProps` usage or a syntax error).

**Fix:** check the message. vuecli strips types with esbuild; it does not type
check. Run `vue-tsc` for type errors.

<a id="vc033"></a>
## VC033 .vue loader not registered

Node tried to import a `.vue` file without the vuecli loader hooks.

**Fix:** run the app with `vuecli <entry>`, or start Node with
`node --import vuecli/register main.js`.

## Styles, colors, themes

<a id="vc040"></a>
## VC040 Invalid style value

A style property got a value it does not accept, for example
`flexDirection: 'sideways'` or `width: '10px'`. Units are terminal cells: use a
number or a percentage string.

**Fix:** see the property table in the README.

<a id="vc041"></a>
## VC041 Unknown color

A color string could not be parsed.

**Fix:** use a theme token (`primary`, `muted`, ...), an ANSI name (`red`,
`brightCyan`), `#rgb` / `#rrggbb`, `rgb(r, g, b)` or `ansi256(n)`.

<a id="vc042"></a>
## VC042 Unknown theme

`--theme`, `mount({ theme })` or `setTheme()` got a name that is not registered.

**Fix:** use `dark`, `light` or `dracula`, or pass a theme object made with `defineTheme()`.

<a id="vc043"></a>
## VC043 Unknown utility class

A `class` contains a name vuecli does not recognize. It is ignored.

**Fix:** see the list of utility classes in the README.

<a id="vc044"></a>
## VC044 Invalid FIGlet font

A font passed to `<BigText>` / the ASCII font renderer is not a valid FIGlet
(`.flf`) file: the `flf2a` signature or the header line is missing or malformed.

**Fix:** use one of the bundled fonts or a valid `.flf` file.

## Focus

<a id="vc050"></a>
## VC050 Focus composable misuse

`useFocus()` / `useFocusManager()` must run synchronously during `setup()`,
because they register the component with the focus manager and unregister it
on unmount.

**Fix:** move the call to the top level of `setup()`.

<a id="vc051"></a>
## VC051 Unknown focus id

`focus(id)` was called with an id that no mounted focusable component uses.

**Fix:** check the `id` passed to `useFocus({ id })` and that the component is
mounted (not hidden by `v-if`) when you focus it.

<a id="vc052"></a>
## VC052 Duplicate focus id

Two mounted focusable components use the same id, so `focus(id)` is ambiguous.

**Fix:** give each focusable component a unique id.

## App Router

<a id="vc060"></a>
## VC060 Unknown route

Navigation (or a server request) targeted a path that matches no route, and
there is no `not-found.vue` to render.

**Fix:** check the path, add the page (`app/<path>/page.vue`) or add
`app/not-found.vue`.

<a id="vc061"></a>
## VC061 Invalid route params

A named navigation is missing a dynamic parameter, or a catch-all param is not
an array.

**Fix:** pass every `[param]` of the route; `[...slug]` takes a string array.

<a id="vc062"></a>
## VC062 App directory not found

`vuecli dev`, `vuecli mcp <dir>` or the router could not find an app directory
(`app/`, `src/app/`, or a directory with `page.vue` / `layout.vue`).

**Fix:** create `app/page.vue`, or pass an entry file instead of a directory.

<a id="vc063"></a>
## VC063 Conflicting routes

Two files resolve to the same URL, usually through route groups:
`app/(a)/about/page.vue` and `app/(b)/about/page.vue`.

**Fix:** remove or rename one of them.

<a id="vc064"></a>
## VC064 Router not installed

`useRouter()` / `useRoute()` / `<Link>` was used in an app that was not started
with the App Router.

**Fix:** run the app directory (`vuecli dev`) or install the router with
`app.use(createAppRouter(...))`.

<a id="vc065"></a>
## VC065 Invalid route module

A `page`, `layout`, `loading`, `error` or `not-found` module does not export a
component as default, or a router factory returned something unexpected.

**Fix:** `export default` the component (a `.vue` file does this automatically).

<a id="vc066"></a>
## VC066 Middleware error

`middleware.ts` threw while handling a navigation or request.

**Fix:** see the cause. Middleware must return `NextResponse.next()`,
`redirect()`, `rewrite()`, a `Response`, or nothing.

<a id="vc067"></a>
## VC067 Page and route handler in one segment

A folder contains both `page.vue` and `route.ts`. A URL is either a page or an
API endpoint.

**Fix:** move the handler, e.g. to `app/api/<path>/route.ts`.

<a id="vc068"></a>
## VC068 Duplicate route param

The same dynamic param name appears twice along a route
(`app/[id]/items/[id]/page.vue`), so `params.id` would be ambiguous.

**Fix:** rename one of them (`[id]` / `[itemId]`).

<a id="vc069"></a>
## VC069 Too many redirects

Middleware or `redirect()` kept redirecting (more than 10 hops), usually a loop
such as `/a → /b → /a`.

**Fix:** check the `matcher` of `middleware.ts` excludes the redirect target.

<a id="vc070"></a>
## VC070 Invalid middleware matcher

A `config.matcher` pattern of `middleware.ts` could not be compiled (for
example an unbalanced `(`).

**Fix:** use path-to-regexp style patterns: `/dashboard/:path*`, `/((?!api).*)`.

<a id="vc071"></a>
## VC071 Navigation timed out

`router.waitForIdle()` gave up: a navigation or an async page (Suspense) did
not settle in time.

**Fix:** check for an async `setup()` that never resolves; raise the timeout.

<a id="vc072"></a>
## VC072 External URL in the terminal

A `<Link>`, `router.push()` or middleware redirect pointed to another origin.
The terminal router cannot open it, so it was ignored (warning).

**Fix:** open external URLs with your own handler (for example the `open`
package), or keep links internal.

## Server

<a id="vc080"></a>
## VC080 Port in use

`vuecli dev` / `vuecli start` could not listen on the port.

**Fix:** stop the other process or pass `--port <n>`.

<a id="vc081"></a>
## VC081 Route handler failed

A `route.ts` handler threw. The server answered with status 500.

**Fix:** see the cause and stack trace in the server log.

<a id="vc082"></a>
## VC082 Invalid route handler response

A `route.ts` handler returned something that is not a `Response`.

**Fix:** `return Response.json(data)` / `new Response(body, init)`.

<a id="vc083"></a>
## VC083 Method not allowed

A request used an HTTP method that the `route.ts` does not export. The server
answers with 405 and an `Allow` header.

**Fix:** export a function named after the method (`export async function POST(req) {}`).

<a id="vc084"></a>
## VC084 Server-only API in the client

A server-only API (request cookies/headers, `cache()`, `revalidateTag()`, ...)
was used in a page that runs on the client.

**Fix:** add `export const runtime = 'server'` to the page module, or move the
call into a route handler.

<a id="vc085"></a>
## VC085 Session limit reached

The server refused a new streamed terminal session because the configured
maximum number of concurrent sessions is reached.

**Fix:** raise the limit in the server options or close idle sessions.

<a id="vc086"></a>
## VC086 Unknown build adapter

`vuecli build --adapter <name>` got an adapter that does not exist.

**Fix:** use one of the adapters listed in the message.

<a id="vc087"></a>
## VC087 Module not bundled

The browser build was asked for a route module that is not in its module map,
usually because the file was added after the build.

**Fix:** rebuild (`vuecli build`), or restart `vuecli dev`.

<a id="vc088"></a>
## VC088 Invalid browser boot options

`bootBrowser()` was called without a root component and without a route
manifest + module loader.

**Fix:** pass `{ root: App }` or `{ manifest, load }`.

## Canvas and images

<a id="vc100"></a>
## VC100 Unsupported canvas context

`canvas.getContext()` was called with a type other than `'2d'`.

**Fix:** use `getContext('2d')`. WebGL is not available in the terminal.

<a id="vc101"></a>
## VC101 Image decode failed

An image passed to `<Image>` or `drawImage()` could not be decoded.

**Fix:** use PNG (or raw RGBA `ImageData`) and check the file path / URL.

<a id="vc102"></a>
## VC102 Invalid canvas size

A canvas was created or resized with a non-positive or non-finite size.

**Fix:** pass positive integer widths and heights.

## Tooling

<a id="vc110"></a>
## VC110 Entry not found

`vuecli mcp` (or another command) was given a path that does not exist.

**Fix:** pass a `.vue` / `.js` / `.ts` entry file or an app directory.

<a id="vc111"></a>
## VC111 Entry has no default export

The entry module does not `export default` a component.

**Fix:** export the root component as default (a `.vue` file does this automatically).

<a id="vc112"></a>
## VC112 Router mode unavailable

A routing tool (`list_routes`, `navigate`, `back`, `forward`) was called, or an
app directory was run, but the app has no App Router (or the router module is
not available in this build).

**Fix:** start the MCP server with the app directory (`vuecli mcp ./my-app`)
instead of a single entry file.

<a id="vc113"></a>
## VC113 Text not found on screen

`click` / `scroll` with `text` could not find the text in the current frame,
or neither `x`/`y` nor `text` was given.

**Fix:** call `read_frame` and use text that is visible on screen, or pass
cell coordinates.

<a id="vc114"></a>
## VC114 Timed out waiting for text

`wait_for` did not see the text appear (or disappear with `gone: true`) within
`timeout_ms`.

**Fix:** raise `timeout_ms`, or check `get_logs` for errors that kept the app
from getting there.

<a id="vc115"></a>
## VC115 Invalid key

A key combo could not be parsed. Combos are `modifier+…+key` with the
modifiers `ctrl`, `alt` (`meta`, `cmd`, `option`) and `shift`.

**Fix:** use names like `enter`, `tab`, `shift+tab`, `escape`, `backspace`,
`up`, `pagedown`, `f5`, `ctrl+s` or single characters (`a`, `A`, `?`).

<a id="vc116"></a>
## VC116 Devtools hook not installed

A devtools client (the Chrome extension, the REPL) could not find
`globalThis.__VUECLI_DEVTOOLS_HOOK__`.

**Fix:** reload the page after the vuecli app has started, and make sure the
app is mounted with devtools enabled (the browser entry installs the hook).

## CLI

<a id="vc130"></a>
## VC130 Unknown command

**Fix:** run `vuecli --help` for the list of commands.

<a id="vc131"></a>
## VC131 Invalid flag value

A flag got a value of the wrong shape, for example `--size 80` instead of
`--size 80x24`.

**Fix:** see `vuecli <command> --help`.
