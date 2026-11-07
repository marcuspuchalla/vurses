# vuecli MCP server

`vuecli mcp` lets coding agents (Claude Code, Cursor, ...) run a vuecli app
headlessly, navigate its routes, press keys and read frames as plain text.

```sh
vuecli mcp App.vue                       # an entry file (.vue / .js / .ts)
vuecli mcp .                             # an App Router project (app/ or src/app/)
vuecli mcp ./my-app --size 120x40 --theme light --route /users/1
```

Register it with your agent, e.g. Claude Code:

```sh
claude mcp add my-app -- npx vuecli mcp ./my-app
```

or in an `.mcp.json` / client config:

```json
{ "mcpServers": { "my-app": { "command": "npx", "args": ["vuecli", "mcp", "./my-app"] } } }
```

The app runs at a fixed size (`--size`, default `100x30`) without a terminal.
It re-renders on its own when state changes (timers, async data), and console
output is captured (`get_logs`) instead of being written to stdout, which is
the protocol channel.

## Tools

Every input tool returns the resulting frame (pass `frame: false` to skip it).
Errors are tool errors with a `VC###` code and docs link.

| Tool | Arguments | |
| --- | --- | --- |
| `read_frame` | `ansi?`, `with_styles?` | Screen as plain text (`--- frame 100x30 ---` header). `ansi`: with SGR colors. `with_styles`: plus JSON spans `{row, col, width, text, fg, bg, bold, …}` |
| `press` | `keys` (string or list), `times?` | `"enter"`, `["tab", "tab", "space"]`, `"shift+tab"`, `"ctrl+s"`, `"alt+left"`, `"up"`, `"pagedown"`, `"f5"`, `"a"`, `"A"` |
| `type` | `text` | Types characters into the focused input (`\n` = enter) |
| `paste` | `text` | One bracketed-paste event |
| `click` | `x`,`y` or `text` (+`nth`), `button?`, `double?` | Clicks a cell or the first occurrence of text |
| `scroll` | `direction`, `amount?`, `x`/`y` or `text` | Mouse wheel (default: screen center) |
| `resize` | `columns`, `rows` | Virtual terminal size |
| `wait_for` | `text`, `timeout_ms?`, `gone?` | Waits for text to appear / disappear |
| `get_tree` | `kind?` (`components` / `elements`), `format?` (`text` / `json`), `depth?` | Tree with layout rects `[x,y WxH]` |
| `get_logs` | `level?`, `since_last?`, `clear?`, `limit?` | Captured `console.*` and Vue warnings |
| `list_routes` | | App Router only: routes, patterns, params, current route |
| `navigate` | `path` | App Router only: `"/users/42?tab=posts"` |
| `back` / `forward` | | App Router only: history |

Resources: `vuecli://frame` (plain text), `vuecli://frame.ansi`,
`vuecli://tree`. `vuecli://frame` supports `resources/subscribe`: subscribed
clients get `notifications/resources/updated` when the screen changes.

Example session:

```
→ read_frame
--- frame 100x30 ---
 ╭─ 1 left ──────────╮
 │ [ ] Write the docs│ ...
→ type { "text": "Ship it" }   → press { "keys": "enter" }
→ get_tree
<App#1> [0,0 64x18]
  <TextInput#6> [1,5 62x3] modelValue="" placeholder="What needs to be done?" ...
```

## Programmatic use

```ts
import { createMcpServer, HeadlessSession, loadApp } from 'vuecli/dist/mcp/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const { server, session } = await createMcpServer({ component: App, columns: 80, rows: 24 })
await server.connect(new StdioServerTransport())

// or drive an app directly
const s = await HeadlessSession.mount(App, { columns: 80, rows: 24 })
await s.press(['tab', 'enter'])
await s.waitFor('Saved')
console.log(s.text(), s.formatTree())
s.close()
```

`HeadlessSession` options: `columns`, `rows`, `theme`, `props`, `setup(app)`
(install plugins), `live` (auto re-render, default true), `fps` (default 30),
`captureConsole` (default true).

## JSON-lines preview protocol

`vuecli mcp <target> --jsonl` speaks a smaller line protocol used by the VS
Code preview (see `jsonl.ts`): frames are pushed as `{"type":"frame","frame":FrameSnapshot}`
whenever the screen changes; commands are `key`, `type`, `paste`, `input`,
`click`, `scroll`, `resize`, `frame`, `tree`, `exit`.

## Files

| File | |
| --- | --- |
| `session.ts` | `HeadlessSession`, key parsing (`parseKey`) |
| `server.ts` | `createMcpServer`: tools and resources |
| `load.ts` | entry / App Router loading (`discoverRoutes`, `createAppRouter`, `getAppRouter`) |
| `jsonl.ts` | JSON-lines preview protocol |
| `../cli/commands/mcp.ts` | the `vuecli mcp` command |
