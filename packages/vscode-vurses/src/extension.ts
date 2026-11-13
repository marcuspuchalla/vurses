import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as vscode from 'vscode'
import { PreviewPanel } from './preview.js'
import { appDirCandidates, parseRoute, routeFromFolder, routeUrl, scaffoldPath, templateFor, validateRoute, type ScaffoldKind } from './scaffold.js'

let output: vscode.OutputChannel

export function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel('vurses')
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('vurses.preview', (uri?: vscode.Uri) => {
      const file = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath ?? null
      PreviewPanel.show(context, output, file)
    }),
    vscode.commands.registerCommand('vurses.restartPreview', () => PreviewPanel.current?.restart()),
    vscode.commands.registerCommand('vurses.newPage', (uri?: vscode.Uri) => scaffold('page', uri)),
    vscode.commands.registerCommand('vurses.newLayout', (uri?: vscode.Uri) => scaffold('layout', uri)),
    vscode.commands.registerCommand('vurses.newRouteHandler', (uri?: vscode.Uri) => scaffold('route', uri)),
  )
}

export function deactivate() {
  PreviewPanel.current?.dispose()
}

/** The app dir of the workspace folder containing `hint` (or the first folder). Creates `app/` if missing. */
function findAppDir(hint?: vscode.Uri): string | null {
  const folder = (hint && vscode.workspace.getWorkspaceFolder(hint)) ?? vscode.workspace.workspaceFolders?.[0]
  if (!folder) return null
  const root = folder.uri.fsPath
  if (hint) {
    // an explicit folder inside an app dir wins
    for (let d = hint.fsPath; d.startsWith(root); d = dirname(d)) {
      for (const c of appDirCandidates(d)) if (hint.fsPath.replace(/\\/g, '/').startsWith(c) && existsSync(c)) return c
      if (d === dirname(d)) break
    }
  }
  return appDirCandidates(root).find((c) => existsSync(c)) ?? join(root, 'app')
}

const LABEL: Record<ScaffoldKind, string> = { page: 'page', layout: 'layout', route: 'route handler' }

async function scaffold(kind: ScaffoldKind, uri?: vscode.Uri) {
  const appDir = findAppDir(uri)
  if (!appDir) {
    void vscode.window.showErrorMessage('vurses: open a folder first.')
    return
  }
  const initial = uri ? routeFromFolder(appDir, uri.fsPath) : kind === 'route' ? '/api/' : '/'
  const input = await vscode.window.showInputBox({
    title: `New ${LABEL[kind]}`,
    prompt: 'Route path: /about, /users/[id], /docs/[...slug], /(group)/x (or vue-router style /users/:id)',
    value: initial,
    valueSelection: [initial.length, initial.length],
    validateInput: validateRoute,
  })
  if (input === undefined) return
  const segments = parseRoute(input)
  const rel = scaffoldPath(kind, segments)
  const file = join(appDir, rel)
  if (existsSync(file)) {
    void vscode.window.showWarningMessage(`vurses: ${rel} already exists.`)
  } else {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, templateFor(kind, segments))
    output.appendLine(`created app/${rel} (${routeUrl(segments)})`)
  }
  const doc = await vscode.workspace.openTextDocument(file)
  await vscode.window.showTextDocument(doc)
}
