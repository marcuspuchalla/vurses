/**
 * Decides what the preview runs for a file, and where the vurses CLI is
 * (pure: file-system access is injected, unit-tested).
 */
import { appDirCandidates, routeOfFile, sampleUrl } from './scaffold.js'

export interface FsLike {
  exists(path: string): boolean
  readFile(path: string): string | null
}

export interface PreviewTarget {
  /** What to pass to `vurses mcp`: an entry file or an app directory. */
  target: string
  /** Working directory (the project root). */
  cwd: string
  mode: 'entry' | 'router'
  /** Initial route for router mode. */
  route?: string
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
const dirname = (p: string) => {
  const n = norm(p)
  const i = n.lastIndexOf('/')
  return i <= 0 ? '/' : n.slice(0, i)
}
const join = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/')

/** Walks up from `start` (inclusive) to `stop` (inclusive) or the filesystem root. */
function* ancestors(start: string, stop?: string): Generator<string> {
  let d = norm(start)
  const end = stop ? norm(stop) : null
  for (;;) {
    yield d
    if (d === end || d === '/' || /^[A-Za-z]:$/.test(d)) return
    const up = dirname(d)
    if (up === d) return
    d = up
  }
}

/**
 * Resolves the preview target for an open file:
 *  - a file inside an App Router app dir (`app/`, `src/app/`) → the app, opened at that file's route
 *  - a .vue / .js / .ts file elsewhere → that file as the entry
 *  - otherwise the workspace's app dir, then `App.vue` / `src/App.vue` / `main.ts`
 */
export function resolvePreviewTarget(file: string | null, workspaceRoot: string | null, fs: FsLike): PreviewTarget | null {
  const root = workspaceRoot ? norm(workspaceRoot) : null
  if (file) {
    const f = norm(file)
    for (const dir of ancestors(dirname(f), root ?? undefined)) {
      for (const appDir of appDirCandidates(dir)) {
        if (f.startsWith(appDir + '/') && fs.exists(appDir)) {
          const segs = routeOfFile(appDir, f)
          return { target: appDir, cwd: dir, mode: 'router', route: segs ? sampleUrl(segs) : '/' }
        }
      }
    }
    if (/\.(vue|[cm]?[jt]sx?)$/.test(f)) return { target: f, cwd: projectRoot(f, root, fs), mode: 'entry' }
  }
  if (root) {
    for (const appDir of appDirCandidates(root)) if (fs.exists(appDir)) return { target: appDir, cwd: root, mode: 'router', route: '/' }
    for (const e of ['App.vue', 'src/App.vue', 'main.ts', 'main.js', 'src/main.ts']) {
      const p = join(root, e)
      if (fs.exists(p)) return { target: p, cwd: root, mode: 'entry' }
    }
  }
  return null
}

/** Nearest directory with a package.json (falls back to the file's directory). */
export function projectRoot(file: string, stop: string | null, fs: FsLike): string {
  for (const d of ancestors(dirname(file), stop ?? undefined)) if (fs.exists(join(d, 'package.json'))) return d
  return dirname(file)
}

/**
 * Finds `bin/vurses.js`: an explicit setting, `node_modules/vurses` in the
 * project or any parent, or the vurses repository itself.
 */
export function resolveCli(fromDir: string, fs: FsLike, setting?: string | null): string | null {
  if (setting) return fs.exists(setting) ? setting : null
  for (const d of ancestors(fromDir)) {
    const p = join(d, 'node_modules/vurses/bin/vurses.js')
    if (fs.exists(p)) return p
    const pkg = fs.readFile(join(d, 'package.json'))
    if (pkg) {
      try {
        if ((JSON.parse(pkg) as { name?: string }).name === 'vurses' && fs.exists(join(d, 'bin/vurses.js'))) return join(d, 'bin/vurses.js')
      } catch {
        // ignore invalid package.json
      }
    }
  }
  return null
}

/** Arguments for `node <cli> ...`. */
export function previewArgs(cli: string, t: PreviewTarget, size: { columns: number; rows: number }, theme?: string): string[] {
  const args = [cli, 'mcp', t.target, '--jsonl', '--size', `${size.columns}x${size.rows}`]
  if (t.mode === 'router' && t.route && t.route !== '/') args.push('--route', t.route)
  if (theme) args.push('--theme', theme)
  return args
}
