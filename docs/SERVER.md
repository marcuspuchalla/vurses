# Browser, server and deployment

vurses apps can run in three places. The `.vue` code is the same in each:

| where | how | entry |
| --- | --- | --- |
| terminal | `vurses run app/` / `vurses dev --terminal` | `ttyTarget` (ANSI diffs) |
| browser devtools console | client routes (the default) | `browserTarget` ("Turbolog") |
| server, streamed to the browser | routes with `export const runtime = 'server'` | `streamTarget` + frame player |

```sh
vurses dev examples/server-app          # http://localhost:3000, then open the devtools console
vurses dev examples/server-app --terminal
vurses build examples/server-app --adapter node && vurses start examples/server-app
```

## Browser console target (Turbolog)

`src/targets/browser.ts`. The whole app renders inside `console.log`:

```
commit → layout → paint into CellBuffer            (core runtime)
       → dirty gate: per-row FNV hashes; a frame with no changed row stops here
       → encode: runs of cells with the same style (across rows) become one %c span
       → ONE console.log(format, ...css) per changed frame, at least 66 ms apart
```

- Frames are appended. The target never calls `console.clear()`, which would make the console flash blank. If frames arrive faster than the throttle, they are merged and only the latest one is logged.
- A typical full screen (about 3,000 to 4,000 cells) becomes 100 to 250 spans. Every span carries `color:#rrggbb;background:#rrggbb`, plus `font-weight:bold`, `font-style:italic` and `text-decoration` where needed. Dim and inverse are resolved to concrete colors.
- Input arrives through one hidden `<textarea>`. Clicking the page focuses it.
  - `keydown` sends special keys: arrows, Enter, Tab, Escape, F1 to F12, Ctrl and Alt combinations.
  - `input` and `compositionend` send text, so IMEs and dead keys work.
  - `paste` sends a bracketed paste.
- Clickable elements (buttons, links, focusable controls up to 3 rows tall, anything with a click handler) can be clicked **in the console**. The console reports no mouse positions, but it runs page code in two places when the user clicks (`src/targets/console-links.ts`):
  - **One-click links**, when DevTools → Settings → Console → "Enable custom formatters" is on (Vue's devtools asks for it too). Each clickable element is logged as a `%o` object that a custom formatter draws as an underlined label. One click expands it, which calls the formatter's `body()`, which clicks the element.
    - Up to Chrome 145 the links sit **inside the frame**, at the element's place, and cover the console's expand triangle so rows keep their width.
    - Newer DevTools (seen in Chrome 157) wraps every formatted object in a block-level `<div>`, which would break a frame row at each link. There the links form a **list under the frame** (`click:` then one link per line). DevTools ships with the browser, so the user agent's Chrome version picks the layout.
  - **Getters**, the fallback. A `click: {…}` object follows each frame. Expand it and click `(...)` next to `1. [ Save ]` to run the getter, which clicks the element. The numbers keep screen order, since the console sorts keys.
  - Chrome calls a formatter's `header()` synchronously inside `console.log`, and only while DevTools is open with the setting on. Every frame therefore shows which mode works, and the target switches (re-logging that frame once) when it changes.
  - A click is a left mouse down/up at the element's current position, so it behaves exactly like a click in the DOM view or the terminal. Each inline link fires once, so a click that changes nothing on screen logs the frame again with fresh links.
  - Typing still needs the page: keys typed in DevTools never reach it. `consoleLinks: false` turns both modes off.
- The screen size comes from options, then `?cols=` and `?rows=`, then the window size. It follows window resizes unless the size is fixed.
- The DOM view is optional. The page bar's "DOM view" button (or `?view=dom`) mirrors the frames into a `<pre>`. Only rows that changed are rewritten, and mouse clicks, wheel and hover on the `<pre>` are sent to the app as SGR mouse events.
- `window.vurses` (REPL) and `__VURSES_DEVTOOLS_HOOK__` are installed (see `src/devtools`).

```ts
import { createApp, browserTarget } from 'vurses'      // browser builds resolve 'vurses' to src/browser.ts
createApp(App).mount({ target: browserTarget({ dom: true, minInterval: 66 }) })
```

## Server rendering

`export const runtime = 'server'` in a page's plain `<script>` block makes the route run on the server:

```
GET /live                 → HTML shell + boot JSON (+ prerendered/cached first frame) + /_vurses/player.js
GET /_vurses/stream?path=/live&cols=&rows=   (SSE)
    event: hello  {sid, columns, rows, path}
    event: frame  FrameDelta            (row deltas, see below)
    event: bye    {reason}              (app exited / idle / shutdown)
    event: redirect {url}               (middleware redirected the streamed path)
POST /_vurses/input  {sid, data?: "raw terminal input", cols?, rows?}  → 204
```

- Each SSE connection gets its own headless vurses `Runtime` (`SessionManager`, `src/server/session.ts`), which renders through `streamTarget`.
- The session ends on disconnect (stream cancelled or `request.signal` aborted), when the app calls `exit()`, after `idleTimeout` (default 30 minutes) without input, or on shutdown. A 503 is returned above `maxSessions` (default 200).
- Middleware also runs for the streamed path, so auth cannot be bypassed through `/_vurses/stream`. Only `runtime = 'server'` routes can be streamed.
- The frame player (`src/player`) contains no Vue. It is about 13 kB minified and 5.6 kB gzipped.
  - It paints the embedded first frame, applies deltas to a screen model, and presents it with the same Turbolog encoder (and the optional DOM view).
  - It sends input in order, batched into POSTs.
- Text clients get a plain-text snapshot: `curl -H 'accept: text/plain' localhost:3000/live`.

### Frame delta protocol (`src/targets/protocol.ts`)

```jsonc
{ "n": 12, "w": 80, "h": 24,
  "full": 1,                            // optional: clear to blanks first
  "reset": 1,                           // optional: clear the style table
  "s": [[3, "38;2;255;0;0", "", 1]],    // new styles: [id, fg SGR, bg SGR, flags]
  "r": [[4, 10, 3, "hello", 0, " "],    // [y, x, styleId, cells, styleId, cells, ...]
        [5, 0, 1, ["界", "", "!"]]] }    // string: 1 cell per UTF-16 unit; array: explicit cells ('' = wide continuation)
```

- Styles are interned per session: each one is sent once, the first time it is used.
- Only the changed span of each changed row is sent. A full frame skips rows that are entirely blank.
- Round-tripping is exact: the player's model equals the server's `CellBuffer`, including wide glyphs and graphemes (see the tests).

## HTTP server, routes and caching

The server core is the portable fetch handler `createHandler(options): (request: Request) => Promise<Response>` in `src/server/handler.ts`. It processes a request in this order:

1. `/_vurses/*` internal endpoints and assets.
2. `middleware.ts`, filtered by `config.matcher`: redirect, rewrite (same origin re-routes, an external URL is proxied), a response of its own, or `next()` with extra headers.
3. `public/` files, with ETag and 304 responses.
4. Route handlers in `app/**/route.ts` that export `GET POST PUT PATCH DELETE HEAD OPTIONS`, with the signature `(request, { params })`.
   - `params` works both as a plain object and with `await`.
   - HEAD falls back to GET.
   - OPTIONS and 405 responses list the allowed methods in `Allow`.
5. Pages, served as an HTML shell.
6. 404: the client router renders `not-found`.

Caching lives in `src/cache` and is exported from `vurses`:

```ts
const getQuotes = cache(fetchQuotes, ['quotes'], { revalidate: 2, tags: ['quotes'] })   // ≈ unstable_cache
revalidateTag('quotes')            // expire now ('stale' as 2nd arg = serve once more while refreshing)
revalidatePath('/stats')           // route frame cache; revalidatePath('/blog', 'layout') for a subtree
```

- The key is built from `keyParts`, the function source and the arguments.
- `revalidate: N` gives stale-while-revalidate after N seconds. `false` (the default) keeps the value until it is invalidated, and `0` disables caching.
- Concurrent calls for the same key run one computation. A failed background refresh keeps the stale value.
- The default store is in-memory and per process. Use `setCacheStore()` to plug in a shared store.
- Route-level `export const revalidate = N` on a server route caches its server-rendered first frame for N seconds, keyed by path and tagged `_path:<path>`. The page also gets `cache-control: s-maxage=N, stale-while-revalidate`.

### Partial Prerendering

`vurses build` prerenders the first frame (the "static shell") of every server route without dynamic params. It waits for the router's Suspense, so `await` in `<script setup>` is included in the shell.

- The page paints that frame immediately, and the live session then streams the dynamic part.
- To opt out, add `export const dynamic = 'force-dynamic'`.
- Edge adapters serve the shell only (see below).

## CLI

| command | |
| --- | --- |
| `vurses dev [dir\|App.vue] [--port 3000] [--host h]` | Dev server: bundles the browser app in memory with esbuild, runs server routes, and live-reloads the page on any source change. A supervisor restarts the worker, so server modules are always fresh. A build error shows an error page, which reloads once the error is fixed. |
| `vurses dev --terminal [dir\|entry]` | Runs the app in this terminal and restarts it on change. |
| `vurses build [dir] --adapter static\|node\|bun\|vercel\|cloudflare [--out d] [--no-minify] [--no-prerender]` | Builds for deployment. The default adapter is `node`. |
| `vurses start [buildDir\|projectDir] [--port] [--host]` | Serves a node or bun build. |

## Adapters

| adapter | output | live server sessions | limitations |
| --- | --- | --- | --- |
| `node` | `.vurses/node/{server.mjs, server/index.mjs, static/}`. Run it with `vurses start` or `node server.mjs` (`PORT`, `HOST`). | yes | single process: sessions and cache are in memory. Use sticky sessions when load-balancing. |
| `bun` | the node layout plus `bun.mjs` (`Bun.serve({ fetch, idleTimeout: 255 })`) | yes | same as node |
| `static` | `index.html` per static client route, `404.html` (SPA fallback for dynamic routes), `_vurses/app.js`, `public/` | no | Server routes show a notice. Route handlers and middleware are dropped, and the build warns about each. |
| `vercel` | `.vercel/output/` (Build Output API v3): `static/`, `functions/index.func` (Edge), `config.json` | no | Server routes serve their prerendered frame only: functions are short-lived and not sticky, so an SSE session and its input POSTs can land on different instances. Static files bypass middleware. Deploy with `vercel deploy --prebuilt`. |
| `cloudflare` | `worker.js` (`export default { fetch }`), `wrangler.toml` with `[assets]`, `public/` | no | Same as Vercel. In addition, Workers cannot compile Yoga's WASM from bytes, so the worker bundle leaves out the renderer. A Durable Object session host is future work. Assets are served before the worker, so they bypass middleware. |

Edge bundles resolve `import … from 'vurses'` to a request-time subset (`src/server/edge-api.ts`: `RouteResponse`, `NextResponse`, cookies, the matcher, the cache API).

## Limitations

- Browser bundle size: the client app ships Vue, the runtime template compiler and Yoga (WASM inlined), about 200 kB gzipped. The player is only about 5.6 kB.
- Server sessions keep state in memory. A reconnect (for example after a network blip) creates a new session, and the previous UI state is lost.
- Each tab holds one SSE connection, plus one more in dev mode for live reload. Under HTTP/1.1, browsers allow about 6 connections per origin.
- Client-side navigation to a server route does a full page load. Server pages are never bundled for the browser.
- The console's line height leaves small gaps in box-drawing borders, and fonts render CJK at roughly two cells wide. The DOM view is pixel-exact.
- `Ctrl+C` is passed to the app (the app does not exit on it in the browser). Copy works only with the browser's own selection.
