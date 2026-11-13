import { printSnapshot, requireTerminal, snapshotMount } from '../snapshot.js'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { packageRoot, type Command, type Flags } from '../shared.js'

/**
 * `vurses web [dir]`: runs an existing Vite + Vue web app in the terminal.
 * The app is built with its own Vite config, then rendered with real CSS,
 * HTML flow layout and keyboard-operable links and form controls.
 */
async function web(args: string[], flags: Flags) {
  const root = resolve(args[0] ?? '.')
  const problem = checkWebProject(root)
  if (problem) {
    console.error(`vurses web: ${problem}`)
    process.exit(1)
  }
  if (flags.watch) {
    // rebuild + restart on every change
    const { supervise } = await import('../../server/dev.js')
    const rest = process.argv.slice(2).filter((a) => a !== '--watch' && a !== 'web')
    const code = await supervise({ watchDir: root, terminal: true, args: [join(packageRoot, 'bin', 'vurses.js'), 'web', ...rest.filter((a) => resolve(a) !== root), root] })
    process.exit(code)
  }
  const t0 = Date.now()
  const { buildWebApp } = await import('../../web/build.js')
  let build
  try {
    build = await buildWebApp(root, { log: (m) => process.stderr.write(`  vurses web: ${m}\n`) })
  } catch (e) {
    console.error(`vurses web: build failed\n${e instanceof Error ? e.message : e}`)
    process.exit(1)
  }
  process.stderr.write(`  vurses web: built in ${Date.now() - t0} ms — starting\n`)
  const { runWebApp } = await import('../../web/run.js')
  const theme = typeof flags.theme === 'string' ? flags.theme : undefined
  const snap = snapshotMount(flags, theme)
  if (!snap) requireTerminal('web')
  const app = await runWebApp(build, {
    root,
    route: typeof flags.route === 'string' ? flags.route : undefined,
    origin: typeof flags.origin === 'string' ? flags.origin : undefined,
    dark: theme !== 'light',
    mount: snap ?? {
      theme,
      mouse: flags.mouse !== false,
      fps: flags.fps ? Number(flags.fps) : undefined,
      alternateScreen: flags['alt-screen'] !== false,
    },
  })
  if (snap) {
    const debug = process.env.VURSES_WEB_DEBUG
      ? async () => {
          const { current } = await import('../../web/app.js')
          const dump = (n: import('../../dom/nodes.js').TNode, d: number): string => {
            if (n.nodeType === 'text') return /^\s*$/.test(n.text) ? '' : `${'  '.repeat(d)}"${n.text.slice(0, 40)}"\n`
            if (n.nodeType !== 'element') return ''
            const s = n.computedStyle as Record<string, unknown>
            const l = n.layout
            const cls = n.props.class ? '.' + String(n.props.class).split(/\s+/).join('.') : ''
            let out = `${'  '.repeat(d)}<${n.tag}${cls}> ${n.kind} ${s.cssDisplay ?? ''}${s.display === 'none' ? ' NONE' : ''} @${l.x},${l.y} ${l.width}x${l.height}${n.kind === 'text' && n.isLayoutText() ? ' ' + JSON.stringify(n.getGlyphs().map((g) => g.ch).join('').slice(0, 60)) : ''}\n`
            for (const c of n.children) out += dump(c, d + 1)
            return out
          }
          const f = current.scope?.focusedElement()
          return (current.scope ? dump(current.scope.root, 0) : '') + `focused: ${f ? `<${f.tag}> ${JSON.stringify(f.textContent.slice(0, 30))}` : 'none'}\n`
        }
      : undefined
    await printSnapshot(app.runtime!, flags, debug)
  }
  try {
    await app.waitUntilExit()
    process.exit(typeof process.exitCode === "number" ? process.exitCode : 0) // 128+n after a signal
  } catch (e) {
    console.error(e)
    process.exit(1)
  }
}

const command: Command = {
  summary: 'Run an existing Vite + Vue web app in the terminal (real CSS, links, forms)',
  usage: 'vurses web [dir] [--route /path] [--origin https://api.example] [--theme light] [--watch] [--snapshot --size 100x40 --keys tab,enter]',
  run: web,
}
export default command

/** Why `root` can't run with `vurses web`, or null. Checked before building, so the message is specific. */
export function checkWebProject(root: string): string | null {
  const pkgFile = join(root, 'package.json')
  let deps: Record<string, string> = {}
  if (existsSync(pkgFile)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
      deps = { ...pkg.devDependencies, ...pkg.dependencies }
    } catch {
      return `${pkgFile} is not valid JSON`
    }
  }
  if (deps.nuxt || deps['nuxt3']) return 'this is a Nuxt app. Nuxt builds and serves pages its own way; vurses web runs plain Vite + Vue 3 apps (docs/COMPATIBILITY.md).'
  if (deps['@vue/cli-service']) return 'this is a Vue CLI (webpack) app. vurses web needs a Vite + Vue 3 app; migrating to Vite is described at https://vite.dev/guide/migration'
  if (!existsSync(join(root, 'index.html'))) return `no index.html in ${root}: vurses web expects a Vite + Vue 3 app (the folder with index.html and vite.config).`
  let vueVersion: string | null = null
  try {
    vueVersion = JSON.parse(readFileSync(createRequire(pkgFile).resolve('vue/package.json'), 'utf8')).version
  } catch {
    return deps.vue ? 'vue is listed in package.json but not installed: run npm install first.' : 'vue is not a dependency of this app: vurses web runs Vite + Vue 3 apps.'
  }
  if (vueVersion && Number(vueVersion.split('.')[0]) < 3) return `this app uses Vue ${vueVersion}; vurses web needs Vue 3.`
  return null
}
