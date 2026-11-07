import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'
import type { FrameSnapshot } from '../../../src/devtools/frame.js'
import { frameMessage, parseWebviewMessage, toPreviewCommand, webviewHtml, type ToWebview } from './webview.js'
import { previewArgs, resolveCli, resolvePreviewTarget, type FsLike, type PreviewTarget } from './target.js'

const fsImpl: FsLike = {
  exists: (p) => existsSync(p),
  readFile: (p) => {
    try {
      return readFileSync(p, 'utf8')
    } catch {
      return null
    }
  },
}

/**
 * A live terminal-frame preview: runs `vuecli mcp <target> --jsonl` in the
 * extension host and renders its frames in a webview beside the editor.
 */
export class PreviewPanel {
  static current: PreviewPanel | null = null
  private proc: ChildProcess | null = null
  private size = { columns: 80, rows: 24 }
  private disposables: vscode.Disposable[] = []
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private stderr = ''

  static show(context: vscode.ExtensionContext, output: vscode.OutputChannel, file: string | null) {
    const root = (file && vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file))?.uri.fsPath) ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null
    const target = resolvePreviewTarget(file, root, fsImpl)
    if (!target) {
      void vscode.window.showErrorMessage('vuecli: open a .vue / .ts / .js entry or a file inside app/ to preview it.')
      return
    }
    if (PreviewPanel.current) {
      PreviewPanel.current.setTarget(target)
      PreviewPanel.current.panel.reveal(vscode.ViewColumn.Beside, true)
      return
    }
    const panel = vscode.window.createWebviewPanel('vuecliPreview', 'vuecli preview', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    })
    PreviewPanel.current = new PreviewPanel(panel, target, output)
    context.subscriptions.push(PreviewPanel.current)
  }

  private constructor(
    readonly panel: vscode.WebviewPanel,
    private target: PreviewTarget,
    private output: vscode.OutputChannel,
  ) {
    const cfg = vscode.workspace.getConfiguration('vuecli')
    this.size = { columns: cfg.get('preview.columns', 80), rows: cfg.get('preview.rows', 24) }
    panel.webview.html = webviewHtml({
      nonce: randomBytes(16).toString('base64'),
      cspSource: panel.webview.cspSource,
      title: 'vuecli preview',
      autoFit: cfg.get('preview.autoFit', true),
    })
    this.disposables.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((raw) => this.onMessage(raw)),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (!vscode.workspace.getConfiguration('vuecli').get('preview.reloadOnSave', true)) return
        if (/\.(vue|[cm]?[jt]sx?|json)$/.test(doc.fileName) && doc.fileName.replace(/\\/g, '/').startsWith(this.target.cwd)) this.scheduleRestart()
      }),
    )
    this.updateTitle()
    this.start()
  }

  private updateTitle() {
    const name = this.target.target.split(/[\\/]/).pop()
    this.panel.title = `vuecli: ${this.target.mode === 'router' ? (this.target.route ?? '/') : name}`
  }

  setTarget(t: PreviewTarget) {
    this.target = t
    this.updateTitle()
    this.restart()
  }

  private post(m: ToWebview) {
    void this.panel.webview.postMessage(m)
  }

  private send(cmd: Record<string, unknown>) {
    if (this.proc?.stdin?.writable) this.proc.stdin.write(JSON.stringify(cmd) + '\n')
  }

  private onMessage(raw: unknown) {
    const m = parseWebviewMessage(raw)
    if (!m) return
    if (m.type === 'restart') return this.restart()
    if (m.type === 'ready') return this.send({ type: 'frame' })
    if (m.type === 'fit') {
      if (m.columns === this.size.columns && m.rows === this.size.rows) return
      this.size = { columns: m.columns, rows: m.rows }
    }
    const cmd = toPreviewCommand(m)
    if (cmd) this.send(cmd)
  }

  private start() {
    const cfg = vscode.workspace.getConfiguration('vuecli')
    const cli = resolveCli(this.target.cwd, fsImpl, cfg.get<string>('cliPath') || null)
    if (!cli) {
      this.post({ type: 'status', level: 'error', text: 'vuecli not found: install it in this project (npm i vuecli) or set "vuecli.cliPath".' })
      return
    }
    const node = cfg.get<string>('nodePath') || 'node'
    const args = previewArgs(cli, this.target, this.size, cfg.get<string>('preview.theme') || undefined)
    this.output.appendLine(`$ ${node} ${args.join(' ')}`)
    this.post({ type: 'status', text: `starting ${this.target.mode === 'router' ? this.target.route : this.target.target.split(/[\\/]/).pop()}…` })
    this.stderr = ''
    const proc = spawn(node, args, { cwd: this.target.cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '0' } })
    this.proc = proc
    let buf = ''
    proc.stdout!.setEncoding('utf8')
    proc.stdout!.on('data', (chunk: string) => {
      buf += chunk
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        this.onLine(line)
      }
    })
    proc.stderr!.setEncoding('utf8')
    proc.stderr!.on('data', (chunk: string) => {
      this.stderr += chunk
      this.output.append(chunk)
    })
    proc.on('error', (err) => this.post({ type: 'status', level: 'error', text: `failed to start ${node}: ${err.message}` }))
    proc.on('exit', (code) => {
      if (this.proc !== proc) return
      this.proc = null
      if (code) this.post({ type: 'status', level: 'error', text: `app exited (${code})\n${this.stderr.trim().split('\n').slice(-6).join('\n')}` })
      else this.post({ type: 'status', text: 'app exited — save a file or press restart' })
    })
  }

  private onLine(line: string) {
    let m: { type: string; frame?: FrameSnapshot; level?: string; message?: string; code?: string; error?: string }
    try {
      m = JSON.parse(line)
    } catch {
      this.output.appendLine(line)
      return
    }
    if (m.type === 'frame' && m.frame) this.post(frameMessage(m.frame))
    else if (m.type === 'log') this.output.appendLine(`[${m.level}] ${m.message}`)
    else if (m.type === 'error') this.output.appendLine(`[error] ${m.code ? m.code + ': ' : ''}${m.message}`)
    else if (m.type === 'exit' && m.error) this.post({ type: 'status', level: 'error', text: `app crashed: ${m.error}` })
  }

  private scheduleRestart() {
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = setTimeout(() => this.restart(), 150)
  }

  private stop() {
    const p = this.proc
    this.proc = null
    if (p && p.exitCode === null) {
      p.stdin?.end()
      p.kill()
    }
  }

  restart() {
    this.stop()
    this.start()
  }

  dispose() {
    if (PreviewPanel.current === this) PreviewPanel.current = null
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.stop()
    for (const d of this.disposables.splice(0)) d.dispose()
    this.panel.dispose()
  }
}
