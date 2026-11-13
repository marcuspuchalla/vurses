# Security

What each part of vurses trusts, what it protects you from by default, and what you need
to do yourself. To report a vulnerability, see [SECURITY.md](../SECURITY.md).

- [The short version](#the-short-version)
- [Terminal output](#terminal-output)
- [Running existing web apps (`vurses web`)](#running-existing-web-apps-vurses-web)
- [Canvas pages (`<Canvas src>`, `tty-canvas`)](#canvas-pages-canvas-src-tty-canvas)
- [The dev server (`vurses dev`)](#the-dev-server-vurses-dev)
- [Production servers (`vurses start`, adapters)](#production-servers-vurses-start-adapters)
- [Browser console target and the REPL](#browser-console-target-and-the-repl)
- [MCP server (`vurses mcp`)](#mcp-server-vurses-mcp)
- [Files vurses writes](#files-vurses-writes)

## The short version

| You run | It runs with | Protected by default | Your job |
| --- | --- | --- | --- |
| `vurses run` / `vurses App.vue` | your user's privileges (it's a Node program) | untrusted text can't control your terminal | treat it like any Node code you run |
| `vurses web` | your user's privileges: **no browser sandbox** | terminal output; HTTPS-only remote CSS; private localStorage file | only run apps (and dependencies) you'd run with `node` |
| `<Canvas src>` / `tty-canvas page.html` | your user's privileges | page can't load remote scripts or import Node modules unless allowed | only run pages you trust |
| `vurses dev` | your user's privileges | localhost only; DNS-rebinding check | don't expose it with `--host` on untrusted networks |
| `vurses start` / deploy adapters | the server's privileges | no stack traces; session limits | TLS, rate limiting and auth in front of it |
| `vurses mcp` | your user's privileges | stdio only, no file or shell tools | review what the agent does with app output |

## Terminal output

A terminal interprets control characters: escape sequences can set the clipboard
(OSC 52), change the window title, create hyperlinks or repaint the screen. Apps show
untrusted text all the time (API responses, user input, `v-html`), so vurses makes sure
none of it reaches the terminal as a control sequence:

- **Rendered text:** control characters (C0, DEL, C1) and bidi overrides are removed when
  text is laid out, and the cell buffer replaces any control character a custom painter
  (`paintCells`) writes with a space. Nothing an app draws can emit an escape sequence.
- **Logs replayed after exit:** `console.*` output is captured while the app runs and
  printed when it exits; control characters in it are shown as visible escapes (`\x1b`)
  instead of being executed. The same applies to crash output.
- **Window titles** (route `metadata`, `document.title` in web apps): every control
  character is removed and the length is capped.
- **HTML entities** in `v-html` content decode like a browser's: out-of-range code points
  become `�`, control characters are dropped.

## Running existing web apps (`vurses web`)

A web app normally runs inside the browser sandbox. `vurses web` builds it and runs it **in
Node**, with the privileges of your user. The app and every dependency in its bundle can:

- read and write files, start processes, read every environment variable (`process.env`);
- make network requests without CORS, including to services on `localhost`.

So only run apps you would also run with `node`, for example your own project or a
reviewed open-source app. In particular, don't point `vurses web` at an untrusted
download "to see what it looks like".

What vurses adds on top:

- **Scripts in `index.html` aren't fetched from other hosts.** Only the app's module entry
  is built, from the project folder, with the app's own Vite config, so the build runs
  exactly what `vite build` runs.
- **Remote stylesheets** (`<link rel="stylesheet" href="https://…">`) are fetched over
  HTTPS only (`http://` is upgraded), capped at 2 MB, cached for a week. They are only
  ever parsed as CSS.
- **Local stylesheet links** never read files outside the project folder.
- **`localStorage`** is saved to `node_modules/.vurses-web-cache/localStorage.json` so it
  survives restarts. Web apps often keep auth tokens there, so the file is created with
  mode `0600` (only you can read it) and the folder with `0700`. Delete it to log out of
  everything.
- **`import.meta.env`** follows Vite's rules: only `VITE_`-prefixed variables are put into
  the bundle.

## Canvas pages (`<Canvas src>`, `tty-canvas`)

`<Canvas src="page.html">` and `npx tty-canvas page.html` run an existing browser canvas
page in Node. Its scripts run in a `vm` context, which is **not a security boundary**: a
script can reach the Node process. Treat a page like a script you run.

By default a page can't reach beyond itself:

- scripts and modules load from `file:` URLs only. Remote scripts need `allowRemote`
  (`--allow-remote`), and even then only `https:`;
- module scripts can't import Node built-ins (`node:fs`) or installed packages unless
  `allowHostImports` (`--allow-host-imports`) is set.

## The dev server (`vurses dev`)

The dev server shows stack traces and source paths and runs your route handlers, so it
is meant for you only:

- **It listens on `localhost` by default.** `--host` exposes it on every network
  interface (`--host 192.168.1.20` on one); then anyone on that network can open it.
- **DNS rebinding is blocked.** A web page on some domain could point that domain at
  `127.0.0.1` and read the dev server's responses from your browser. Requests must name
  the server by `localhost`, an IP address, or the `--host` you gave, otherwise they get
  `403`.

## Production servers (`vurses start`, adapters)

- **Errors:** production responses never contain stack traces or file paths; errors go to
  the server log.
- **Live server routes** (`runtime = 'server'`) run one Vue app per connected client.
  There are limits: 200 sessions in total and 8 per client address (node adapter), idle
  sessions end after 30 minutes. Configure them with `maxSessions`,
  `maxSessionsPerClient` and `idleTimeout`.
- **Streams** check the request origin, and middleware runs for streamed routes too, so
  authentication in middleware can't be bypassed through the stream endpoint.
- **Static files** are served from the public folder only (no `..`, no dot-files).
- **Your job:** put TLS, rate limiting and request-size limits in front of it (a reverse
  proxy or your platform), and authenticate in middleware where needed.

## Browser console target and the REPL

Apps built for the browser console install `window.vurses`, a console REPL to inspect and
drive the app (pause, step, press keys). It only gives the page's own console access to
the page's own app, so it adds nothing an attacker on the page couldn't already do. To
leave it out, mount with `devtools: false`.

## MCP server (`vurses mcp`)

`vurses mcp` lets a coding agent drive your app over **stdio** only (no network port). Its
tools read frames and send input; none reads files or runs commands. The frames it returns
contain whatever the app shows, which may include untrusted text: an agent should treat
it as data, not instructions.

## Files vurses writes

| Path | What | Written by |
| --- | --- | --- |
| `node_modules/.vurses-web/` | the bundled web app | `vurses web` |
| `node_modules/.vurses-web-cache/localStorage.json` | the web app's localStorage (mode 0600) | `vurses web` |
| `node_modules/.vurses-web-cache/remote-css/` | cached remote stylesheets | `vurses web` |
| `.vurses/<adapter>/` | production build output | `vurses build` |

Nothing is written outside the project folder. Deleting these folders is always safe.
