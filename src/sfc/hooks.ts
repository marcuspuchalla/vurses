/**
 * Node.js module customization hooks: lets `import App from './App.vue'` work.
 * Registered by `vuecli/register` (or automatically by the `vuecli` CLI).
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { compileSFC } from './compile.js'

type Resolve = (specifier: string, context: { parentURL?: string; conditions?: string[] }) => Promise<{ url: string; format?: string | null; shortCircuit?: boolean }>
type Load = (url: string, context: { format?: string | null }) => Promise<{ format: string; source?: string | ArrayBuffer | Uint8Array | null; shortCircuit?: boolean }>

const SELF = import.meta.url

export async function resolve(specifier: string, context: { parentURL?: string; conditions?: string[] }, next: Resolve) {
  // Always resolve `vue` and `vuecli` through this package so that the app and
  // the renderer share a single Vue runtime instance.
  if (specifier === 'vue' || specifier === 'vuecli' || specifier.startsWith('vuecli/')) {
    try {
      return await next(specifier, { ...context, parentURL: SELF })
    } catch {
      // fall through to normal resolution
    }
  }
  return next(specifier, context)
}

export async function load(url: string, context: { format?: string | null }, next: Load) {
  if (url.endsWith('.vue')) {
    const filename = fileURLToPath(url)
    const source = await readFile(filename, 'utf8')
    return { format: 'module', source: compileSFC(source, filename), shortCircuit: true }
  }
  // the app's own TypeScript (route handlers, middleware, stores): compiled here, so every
  // supported Node version runs it the same way (Node's own type stripping arrived in 22.18
  // and doesn't support enums or parameter properties)
  if (/\.[mc]?ts$/.test(url) && url.startsWith('file:') && !url.includes('/node_modules/')) {
    const filename = fileURLToPath(url)
    const source = await readFile(filename, 'utf8')
    const cjs = url.endsWith('.cts')
    const { transform } = await import('esbuild')
    const out = await transform(source, { loader: 'ts', format: cjs ? 'cjs' : 'esm', sourcefile: filename, sourcemap: 'inline', target: 'node20' })
    return { format: cjs ? 'commonjs' : 'module', source: out.code, shortCircuit: true }
  }
  return next(url, context)
}
