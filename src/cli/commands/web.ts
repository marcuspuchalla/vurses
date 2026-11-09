import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { packageRoot, type Command, type Flags } from '../shared.js'

/**
 * `vuecli web [dir]`: runs an existing Vite + Vue web app in the terminal.
 * The app is built with its own Vite config, then rendered with real CSS,
 * HTML flow layout and keyboard-operable links and form controls.
 */
async function web(args: string[], flags: Flags) {
  const root = resolve(args[0] ?? '.')
  if (!existsSync(join(root, 'index.html'))) {
    console.error(`vuecli web: no index.html in ${root} (expected a Vite + Vue app)`)
    process.exit(1)
  }
  if (flags.watch) {
    // rebuild + restart on every change
    const { supervise } = await import('../../server/dev.js')
    const rest = process.argv.slice(2).filter((a) => a !== '--watch' && a !== 'web')
    const code = await supervise({ watchDir: root, terminal: true, args: [join(packageRoot, 'bin', 'vuecli.js'), 'web', ...rest.filter((a) => resolve(a) !== root), root] })
    process.exit(code)
  }
  const t0 = Date.now()
  const { buildWebApp } = await import('../../web/build.js')
  let build
  try {
    build = await buildWebApp(root, { log: (m) => process.stderr.write(`  vuecli web: ${m}\n`) })
  } catch (e) {
    console.error(`vuecli web: build failed\n${e instanceof Error ? e.message : e}`)
    process.exit(1)
  }
  process.stderr.write(`  vuecli web: built in ${Date.now() - t0} ms — starting\n`)
  const { runWebApp } = await import('../../web/run.js')
  const theme = typeof flags.theme === 'string' ? flags.theme : undefined
  const snapshot = !!flags.snapshot
  const [columns, rows] = typeof flags.size === 'string' ? flags.size.split('x').map(Number) : [process.stdout.columns || 100, process.stdout.rows || 40]
  const app = await runWebApp(build, {
    root,
    route: typeof flags.route === 'string' ? flags.route : undefined,
    dark: theme !== 'light',
    mount: snapshot
      ? { theme, manualRender: true, columns, rows, patchConsole: false, colorDepth: 'truecolor' }
      : {
          theme,
          mouse: flags.mouse !== false,
          fps: flags.fps ? Number(flags.fps) : undefined,
          alternateScreen: flags['alt-screen'] !== false,
        },
  })
  if (snapshot) {
    // print one frame as text (docs, CI, debugging): --keys "tab,tab,enter" --wait 1500
    const runtime = app.runtime!
    const { keyFromCombo } = await import('../../testing.js')
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const settle = async (ms: number) => {
      await wait(ms)
      for (let i = 0; i < 4; i++) {
        runtime.renderFrame()
        await wait(20)
      }
    }
    await settle(Number(flags.wait ?? 300))
    const keys = typeof flags.keys === 'string' ? flags.keys.split(',').map((k) => k.trim()).filter(Boolean) : []
    for (const k of keys) {
      if (k.startsWith('type:')) for (const ch of k.slice(5)) runtime.dispatchKey(keyFromCombo(ch === ' ' ? 'space' : ch))
      else runtime.dispatchKey(keyFromCombo(k))
      await settle(Number(flags.keywait ?? 60))
    }
    await settle(Number(flags.wait ?? 300))
    const frame = runtime.renderFrame()
    if (flags.snapshot === 'html') {
      const { gridToHtml } = await import('../../targets/dom-view.js')
      process.stdout.write(gridToHtml(frame))
      process.exit(0)
    }
    const text = frame.toString()
    if (process.env.VUECLI_WEB_DEBUG) {
      const { current } = await import('../../web/app.js')
      const dump = (n: import('../../dom/nodes.js').TNode, d: number): string => {
        if (n.nodeType === 'text') return /^\s*$/.test(n.text) ? '' : `${'  '.repeat(d)}"${n.text.slice(0, 40)}"\n`
        if (n.nodeType !== 'element') return ''
        const s = n.computedStyle as Record<string, unknown>
        const l = n.layout
        const cls = n.props.class ? '.' + String(n.props.class).split(/\s+/).join('.') : ''
        let out = `${'  '.repeat(d)}<${n.tag}${cls}> ${n.kind} ${s.cssDisplay ?? ''}${s.display === 'none' ? ' NONE' : ''} @${l.x},${l.y} ${l.width}x${l.height}${n.kind === 'text' && n.isLayoutText() ? ' ' + JSON.stringify(n.getGlyphs().map((g) => g.ch).join('').slice(0, 60)) + (n.tag === 'input' ? ' ' + JSON.stringify([n.getGlyphs()[0]?.ink, n.computedStyle.bg, n.computedStyle.color, n.computedStyle.inverse]) : '') : ''}\n`
        for (const c of n.children) out += dump(c, d + 1)
        return out
      }
      if (current.scope) process.stderr.write(dump(current.scope.root, 0))
      const f = current.scope?.focusedElement()
      process.stderr.write(`focused: ${f ? `<${f.tag}> ${JSON.stringify(f.textContent.slice(0, 30))}` : 'none'}\n`)
    }
    process.stdout.write(text.replace(/[ \t]+$/gm, '').replace(/\n+$/, '') + '\n')
    process.exit(0)
  }
  try {
    await app.waitUntilExit()
    process.exit(0)
  } catch (e) {
    console.error(e)
    process.exit(1)
  }
}

const command: Command = {
  summary: 'Run an existing Vite + Vue web app in the terminal (real CSS, links, forms)',
  usage: 'vuecli web [dir] [--route /path] [--theme light] [--watch] [--snapshot --size 100x40 --keys tab,enter]',
  run: web,
}
export default command
