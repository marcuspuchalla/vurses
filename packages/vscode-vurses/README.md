# vurses for VS Code

Live terminal-frame preview next to your code, and App Router scaffolding, for
[vurses](../../README.md) apps.

## Preview (`⌘K V` / `Ctrl+K V`)

`vurses: Open Terminal Preview` opens a panel beside the editor that runs the
app headlessly and shows its frames as colored HTML:

- A file inside `app/` (or `src/app/`) runs the **App Router app**, opened at
  that file's route (`app/users/[id]/page.vue` opens `/users/1`).
- Any other `.vue` / `.ts` / `.js` file runs as an **entry** (its default export
  is the root component). Handy for previewing a single component.
- The preview **restarts when you save** a project file.
- **Keyboard, paste, clicks and the mouse wheel** in the panel go to the app.
  The virtual terminal resizes to fit the panel (`vurses.preview.autoFit`).
- App logs and errors go to the **vurses** output channel.

Under the hood the extension spawns
`node <project>/node_modules/vurses/bin/vurses.js mcp <target> --jsonl --size COLSxROWS`
in the extension host. That command speaks a small JSON-lines protocol
(documented in `src/mcp/jsonl.ts` of vurses): frames out as cell snapshots,
keys / clicks / resizes in.

## Scaffolding

| Command | Creates |
| --- | --- |
| `vurses: New Page` | `app/<route>/page.vue` with typed `params` / `searchParams` props and `metadata` |
| `vurses: New Layout` | `app/<route>/layout.vue` rendering `<slot />` |
| `vurses: New Route Handler` | `app/<route>/route.ts` with `GET` and `POST` |

Routes can be typed file-system style (`/users/[id]`, `/docs/[...slug]`,
`/shop/[[...path]]`, `/(marketing)/about`) or vue-router style (`/users/:id`,
`/docs/:slug+`). They are validated as you type (private `_folders`, duplicate
params and misplaced catch-alls are rejected). The commands are also in the
explorer context menu of folders: the route is prefilled from the folder.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `vurses.cliPath` | `""` | Path to `bin/vurses.js` (default: the project's `node_modules/vurses`) |
| `vurses.nodePath` | `"node"` | Node.js executable |
| `vurses.preview.columns` / `rows` | `80` / `24` | Initial size |
| `vurses.preview.autoFit` | `true` | Fit the virtual terminal to the panel |
| `vurses.preview.reloadOnSave` | `true` | Restart on save |
| `vurses.preview.theme` | `""` | `dark`, `light` or `dracula` |

## Development

```sh
npm run build       # esbuild → dist/extension.js
npm run typecheck   # tsc --noEmit
npm test            # vitest: scaffolding, target resolution, key mapping, webview (Chromium via Playwright when available)
```

Press F5 in VS Code with this folder open (add a standard
`extensionHost` launch configuration) to try it. `npm run package` builds a
`.vsix` with `@vscode/vsce`.

The frame → HTML renderer is shared with the Chrome DevTools panel
(`src/devtools/html.ts` in vurses) and bundled into the extension.
