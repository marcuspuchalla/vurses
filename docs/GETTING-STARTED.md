# Getting started

- [Requirements](#requirements)
- [Install](#install)
- [Your first app](#your-first-app)
- [A project with routes](#a-project-with-routes)
- [Run an existing Vue web app](#run-an-existing-vue-web-app)
- [Examples](#examples)
- [CLI reference](#cli-reference)
- [Environment variables](#environment-variables)
- [Mounting from your own code](#mounting-from-your-own-code)
- [Troubleshooting](#troubleshooting)
- [Uninstall](#uninstall)

## Requirements

- **Node.js 20.6 or newer** (22 LTS recommended).
- **A terminal** that understands standard escape sequences: macOS Terminal, iTerm2,
  Windows Terminal, GNOME Terminal, Konsole, kitty, WezTerm, Alacritty, the VS Code
  terminal, tmux and screen all work. Truecolor terminals look best; 256 and 16 colors are
  supported, and `NO_COLOR` is respected. See [Compatibility](COMPATIBILITY.md).
- `vue` 3.5 or newer next to vuecli (installed with it below).

## Install

vuecli isn't published to npm yet. Until it is, install it from a checkout:

```sh
git clone https://github.com/marcuspuchalla/vuecli.git
cd vuecli && npm install          # also builds dist/
```

Then, in your project:

```sh
npm install -D /path/to/vuecli vue
npx vuecli --version
```

(`npm link` in the checkout and `npm link vuecli` in your project works too.)

## Your first app

Save this as `App.vue`:

```vue
<template>
  <Box class="flex-col gap-1 p-1" border="round" title="counter">
    <BigText :text="String(count)" color="primary" />
    <Box class="gap-1">
      <Button label="-1" @click="count--" />
      <Button label="+1" variant="primary" @click="count++" />
    </Box>
  </Box>
</template>

<script setup lang="ts">
import { ref } from 'vue'
const count = ref(0)
</script>
```

```sh
npx vuecli App.vue
```

Tab moves the focus, Enter or Space presses a button, the mouse works too, Ctrl+C quits.
Components like `<Box>` and `<Button>` are registered globally, so no imports are needed.
[Building apps](GUIDE.md) lists all of them.

> **`<style>` blocks don't apply in the terminal.** Style with utility classes
> (`class="p-1 bold text-primary"`) or props (`:padding="1"`); vuecli warns when a
> component has a `<style>` block.

## A project with routes

```sh
npx vuecli create my-app       # App Router project: app/page.vue, layouts, a route handler
cd my-app && npm install
npm start                      # vuecli run .
```

`npx vuecli create my-app --single` makes a one-file project instead. Both include a
`tsconfig.json` so editors know the global components.

## Run an existing Vue web app

```sh
cd my-vite-vue-app
npm install -D /path/to/vuecli
npx vuecli web
```

Your app is built with its own Vite config and rendered with its CSS. Read
[what's supported](COMPATIBILITY.md#existing-web-apps-vuecli-web) and the
[security note](SECURITY.md#running-existing-web-apps-vuecli-web) first: the app runs in
Node, outside the browser sandbox. Details: [docs/WEB.md](WEB.md).

## Examples

In the vuecli checkout:

```sh
npm run example:dashboard    # ops dashboard: tabs, tables, charts, logs, dialogs, command palette
npm run example:todo         # todo app with inputs, checkboxes, radio filters
npm run example:counter      # plain JS + runtime-compiled template, no SFC
npm run example:gallery      # every component: layout, tree, code, diff, charts, fonts, inputs, errors
npm run example:canvas       # paint program, particles and an unmodified HTML canvas demo
npm run example:router       # App Router: nested layouts, dynamic routes, loading/error/404, middleware
npm run example:server       # dev server: the app in the browser console + a server-streamed route
```

## CLI reference

```
vuecli <entry>                 shorthand for `vuecli run <entry>`
vuecli run <entry|dir>         run an app in the terminal (.vue/.js/.ts file, or a folder with app/)
vuecli web [dir]               run an existing Vite + Vue 3 web app in the terminal
vuecli create <dir>            scaffold a project (--single: one App.vue)
vuecli dev [dir|entry]         dev server: browser console target + live reload
vuecli build [dir]             production build
vuecli start [buildDir]        serve a node/bun build
vuecli mcp <entry|dir>         MCP server so coding agents can drive and read the app
vuecli help [command]          help (also: --help, -h); --version, -v
```

| Flag | Commands | Meaning |
| --- | --- | --- |
| `--theme <name>` | run, web, mcp | `dark` (default), `light` or `dracula`. In `web`, also decides `prefers-color-scheme` |
| `--route </path>` | run, web, mcp | start at this route (router apps) |
| `--app <dir>` | run, dev | the folder with the routes (default: `app/`, found automatically) |
| `--no-mouse` | run, web | don't capture the mouse (lets the terminal select text) |
| `--fps <n>` | run, web | frame rate cap (default 60) |
| `--no-alt-screen` | run, web | draw in the normal screen buffer instead of a separate one |
| `--no-title` | run | don't set the terminal window title from route metadata |
| `--snapshot[=html]` | run, web | print one frame as text (or HTML) and exit: for CI, docs, pipes |
| `--size <WxH>` | run, web, mcp | frame size for `--snapshot` / `mcp`, e.g. `100x40` |
| `--keys <list>` | run, web | keys to press before the snapshot: `tab,enter,type:hello,down` |
| `--wait <ms>` | run, web | wait before the snapshot (data fetching), default 300 |
| `--watch` | web | rebuild and restart on every change |
| `--port <n>`, `-p` | dev, start | port (default 3000; `dev` picks the next free one) |
| `--host [addr]` | dev, start | `dev`: expose on the network (`--host` alone: all interfaces) |
| `--terminal` | dev | run the app in this terminal instead of the browser console |
| `--adapter <name>` | build | `node` (default), `bun`, `static`, `vercel`, `cloudflare` |
| `--out <dir>` | build | output folder (default `.vuecli/<adapter>`) |
| `--no-minify`, `--no-prerender` | build | keep the output readable / skip prerendering |
| `--jsonl` | mcp | line-delimited JSON instead of MCP framing |

Unknown flags print a warning; impossible values (`--fps abc`) stop with
[VC131](errors.md#vc131-invalid-flag-value).

## Environment variables

| Variable | Effect |
| --- | --- |
| `VUECLI_COLOR` | force the color depth: `none`, `16`, `256` or `truecolor` |
| `NO_COLOR` | no colors (bold, underline, inverse still work), see [no-color.org](https://no-color.org) |
| `FORCE_COLOR` | `0` none, `1` 16 colors, `2` 256, `3` truecolor (overrides `NO_COLOR`) |
| `VUECLI_DEBUG` | print full error objects on failure |
| `VUECLI_WEB_DEBUG` | `web --snapshot`: also print the layout tree to stderr |
| `PORT` | default port for `dev` and `start` |

## Mounting from your own code

```ts
import { createApp } from 'vuecli'
import App from './App.vue'

const app = createApp(App)           // same API as Vue's createApp: use(), provide(), component()...
app.mount({ theme: 'dracula' })      // terminal options instead of a DOM selector
await app.waitUntilExit()
```

To import `.vue` files from your own Node entry point, register the loader:
`node --import vuecli/register main.js`. The `vuecli` CLI does this automatically, and it
also compiles your own `.ts` files.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| The terminal is garbled after a crash or `kill -9` | type `reset` and press Enter. (vuecli restores the terminal on Ctrl+C, errors and normal signals; `kill -9` can't be handled.) |
| `stdout is not a terminal` | the interactive UI needs a terminal. In CI or a pipe, use `--snapshot`. |
| Colors look wrong or too few | set `VUECLI_COLOR=truecolor` (or `256`); check `echo $TERM $COLORTERM` |
| Mouse clicks don't work / I want to select text | some terminals need mouse reporting enabled; `--no-mouse` turns it off so you can select text |
| My `<style>` has no effect | expected in terminal apps, see [Your first app](#your-first-app). (`vuecli web` apps do get their CSS.) |
| `Unknown file extension ".vue"` in my own script | run it with `node --import vuecli/register` |
| Errors mention a `VC###` code | each code is explained, with a fix, in [errors.md](errors.md) |
| A web app looks wrong in `vuecli web` | check [Compatibility](COMPATIBILITY.md#existing-web-apps-vuecli-web); `vuecli web --snapshot` with `VUECLI_WEB_DEBUG=1` prints the layout tree |

## Uninstall

`npm uninstall vuecli`, then delete `node_modules/.vuecli-web*` (left by `vuecli web`)
and `.vuecli/` (build output). vuecli writes nothing outside your project; see
[Files vuecli writes](SECURITY.md#files-vuecli-writes).
