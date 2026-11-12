/**
 * Runs existing browser canvas code in Node: `runHtml(file)` parses a page,
 * creates its <canvas> elements and executes its scripts (classic scripts in
 * a `node:vm` context whose globals are the browser shim; module scripts via
 * vm.SourceTextModule when Node runs with --experimental-vm-modules, otherwise
 * via import() with the shim installed on globalThis).
 */
import { readFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import * as vm from 'node:vm'
import * as nodeModule from 'node:module'
import type { Canvas } from '../canvas.js'
import { BrowserEnvironment, type EnvironmentOptions } from '../dom.js'
import type { Element } from '../element.js'
import { parseHtml } from './html.js'

/**
 * Pages run with the privileges of the Node process (a `vm` context is not a sandbox):
 * only run pages you trust, as you would any script. By default a page can't reach
 * beyond itself, though: scripts load from the page's own files only (`file:`), and
 * module scripts can't import Node built-ins or npm packages.
 */
export interface RunOptions extends EnvironmentOptions {
  /** Load `https:` scripts and modules (never plain `http:`). Default: false. */
  allowRemote?: boolean
  /** Let module scripts import Node built-ins (`node:fs`) and installed packages. Default: false. */
  allowHostImports?: boolean
  /** Reuse an existing environment instead of creating one. */
  env?: BrowserEnvironment
  /** Fire DOMContentLoaded / load after the scripts ran (default true). */
  fireLoad?: boolean
}

export interface Page {
  env: BrowserEnvironment
  window: BrowserEnvironment['window']
  document: BrowserEnvironment['document']
  /** The canvas to display (first/largest <canvas>, or the first one scripts created). */
  readonly canvas: Canvas | null
  /** Errors thrown by scripts while loading (also logged to the page console). */
  errors: unknown[]
  dispose(): void
}

type VmModule = {
  link(linker: (spec: string, ref: VmModule) => Promise<VmModule>): Promise<void>
  evaluate(): Promise<unknown>
  status: string
  namespace: Record<string, unknown>
}
type VmWithModules = {
  SourceTextModule?: new (code: string, opts: { context: vm.Context; identifier?: string; initializeImportMeta?: (m: { url: string }) => void; importModuleDynamically?: unknown }) => VmModule
  SyntheticModule?: new (exports: string[], init: (this: { setExport(n: string, v: unknown): void }) => void, opts: { context: vm.Context; identifier?: string }) => VmModule
}

function isFile(p: string) {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

function makePage(env: BrowserEnvironment, ctx: Ctx): Page {
  return {
    env, window: env.window, document: env.document, errors: ctx.errors,
    get canvas() { return env.primaryCanvas() },
    dispose() {
      env.dispose()
      ctx.restoreGlobals?.()
    },
  }
}

interface Ctx {
  env: BrowserEnvironment
  context: vm.Context
  errors: unknown[]
  restoreGlobals?: () => void
  allowRemote: boolean
  allowHostImports: boolean
}

/** Checks a script / module URL against the page's policy; throws when it isn't allowed. */
function checkSource(ctx: Ctx, href: string) {
  const u = new URL(href)
  if (u.protocol === 'file:' || u.protocol === 'data:') return
  if (u.protocol === 'https:' && ctx.allowRemote) return
  throw new Error(
    u.protocol === 'https:' ? `tty-canvas: blocked remote script ${href} (pass allowRemote: true to load it)` : `tty-canvas: blocked script ${href} (only file: and, with allowRemote, https: scripts load)`,
  )
}

/** Bare imports (`node:fs`, `lodash`) reach the host process: only with allowHostImports. */
function checkHostImport(ctx: Ctx, spec: string) {
  if (!ctx.allowHostImports) throw new Error(`tty-canvas: blocked import of "${spec}" (pages can't import Node built-ins or packages unless allowHostImports: true)`)
}

const STATIC_IMPORT = /(?:\bimport\s*(?:[\w*{][^'"]*?\bfrom\s*)?|\bexport\s*[^'"]*?\bfrom\s*|\bimport\s*\(\s*)(['"])([^'"]+)\1/g

/** Specifiers of a module's imports that aren't relative or absolute URLs. */
function hostImports(code: string): string[] {
  const out: string[] = []
  for (const m of code.matchAll(STATIC_IMPORT)) if (!/^(\.{0,2}\/|file:|https?:|data:)/.test(m[2])) out.push(m[2])
  return out
}

function createContext(env: BrowserEnvironment, options: RunOptions = {}): Ctx {
  const sandbox = env.window as Record<string, unknown>
  const context = vm.createContext(sandbox, { name: 'tty-canvas page' })
  // `window`, `self`, `globalThis` should all be the global object inside the page
  vm.runInContext('globalThis.window = globalThis; globalThis.self = globalThis; globalThis.top = globalThis; globalThis.parent = globalThis; globalThis.frames = globalThis;', context)
  // window-level EventTarget methods must keep working when called unbound (`addEventListener(...)`)
  for (const k of ['addEventListener', 'removeEventListener', 'dispatchEvent']) {
    const f = (env.window as unknown as Record<string, (...a: unknown[]) => unknown>)[k]
    sandbox[k] = f.bind(env.window)
  }
  // the vm global is a proxy to `sandbox`; make window/self refer to it for identity checks
  return { env, context, errors: [], allowRemote: !!options.allowRemote, allowHostImports: !!options.allowHostImports }
}

function report(ctx: Ctx, err: unknown) {
  ctx.errors.push(err)
  ;(ctx.env.window.console as Console).error(err)
}

/** TypeScript → JavaScript via Node's built-in type stripping (Node ≥ 22.13), else unchanged. */
function stripTypes(code: string, file: string): string {
  if (!/\.[mc]?tsx?$/.test(file)) return code
  const strip = (nodeModule as unknown as { stripTypeScriptTypes?: (c: string, o?: object) => string }).stripTypeScriptTypes
  return strip ? strip(code, { mode: 'strip' }) : code
}

function runClassic(ctx: Ctx, code: string, filename: string, el?: Element) {
  const doc = ctx.env.document as unknown as { currentScript: Element | null }
  doc.currentScript = el ?? null
  try {
    new vm.Script(stripTypes(code, filename), { filename }).runInContext(ctx.context)
  } catch (err) {
    report(ctx, err)
  } finally {
    doc.currentScript = null
  }
}

const looksLikeModule = (code: string) => /^\s*(import\s*[\w{*'"]|export\s+(default|const|let|var|function|class|async|\{|\*))/m.test(code)

async function runModule(ctx: Ctx, code: string, url: string) {
  const v = vm as unknown as VmWithModules
  if (v.SourceTextModule && v.SyntheticModule) {
    const cache = new Map<string, VmModule>()
    const load = async (src: string, id: string): Promise<VmModule> => {
      const mod = new v.SourceTextModule!(stripTypes(src, id), {
        context: ctx.context, identifier: id,
        initializeImportMeta: (meta) => { meta.url = id },
      })
      cache.set(id, mod)
      return mod
    }
    const linker = async (spec: string, ref: VmModule & { identifier?: string }): Promise<VmModule> => {
      if (/^(\.{0,2}\/|file:|https?:)/.test(spec)) {
        const id = new URL(spec, ref.identifier ?? url).href
        const hit = cache.get(id)
        if (hit) return hit
        checkSource(ctx, id)
        const text = id.startsWith('https:') ? await (await fetch(id)).text() : await readFile(fileURLToPath(id), 'utf8')
        return load(text, id)
      }
      // bare specifier / node builtin: import from the host realm
      checkHostImport(ctx, spec)
      const ns = (await import(spec)) as Record<string, unknown>
      const names = Object.keys(ns)
      return new v.SyntheticModule!(names, function () {
        for (const n of names) this.setExport(n, ns[n])
      }, { context: ctx.context, identifier: spec })
    }
    try {
      const root = await load(code, url)
      await root.link(linker)
      await root.evaluate()
    } catch (err) {
      report(ctx, err)
    }
    return
  }
  // fallback: run in the main realm with the browser globals installed
  ctx.restoreGlobals ??= ctx.env.installGlobals()
  try {
    // the main realm resolves imports itself: apply the policy to the module's imports up front
    for (const spec of hostImports(code)) checkHostImport(ctx, spec)
    if (url.startsWith('file:') && isFile(fileURLToPath(url)) && (await readFile(fileURLToPath(url), 'utf8')) === code) {
      await import(url)
    } else {
      // inline module: make relative imports absolute and import a data: URL
      const fixed = code.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"]+)\2/g, (_m, kw, q, spec) => `${kw}${q}${new URL(spec, url).href}${q}`)
      await import('data:text/javascript;base64,' + Buffer.from(fixed).toString('base64'))
    }
  } catch (err) {
    report(ctx, err)
  }
}

async function fetchText(ctx: Ctx, src: string, base: string): Promise<{ code: string; url: string }> {
  const u = new URL(src, base)
  checkSource(ctx, u.href)
  if (u.protocol === 'file:') return { code: await readFile(fileURLToPath(u), 'utf8'), url: u.href }
  const res = await fetch(u)
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${u.href}`)
  return { code: await res.text(), url: u.href }
}

function bindInlineHandlers(ctx: Ctx, els: Element[]) {
  for (const el of [ctx.env.document.body, ...els]) {
    for (const name of el.getAttributeNames()) {
      if (!name.startsWith('on')) continue
      const code = el.getAttribute(name)!
      try {
        const fn = vm.runInContext(`(function(event){\n${code}\n})`, ctx.context)
        const target = el === ctx.env.document.body && (name === 'onload' || name === 'onresize') ? ctx.env.window : el
        ;(target as unknown as Record<string, unknown>)[name] = fn
      } catch (err) {
        report(ctx, err)
      }
    }
  }
}

/**
 * Loads an HTML page (file path, file: URL, or `{ html }` source) and runs its scripts.
 * Pass `options.width/height` for the viewport (window.innerWidth/innerHeight).
 */
export async function runHtml(file: string | URL | { html: string; url?: string }, options: RunOptions = {}): Promise<Page> {
  let html: string
  let pageUrl: string
  if (typeof file === 'object' && 'html' in file) {
    html = file.html
    pageUrl = file.url ?? pathToFileURL(resolve('index.html')).href
  } else {
    const path = file instanceof URL ? fileURLToPath(file) : resolve(String(file))
    html = await readFile(path, 'utf8')
    pageUrl = pathToFileURL(path).href
  }
  const baseDir = pageUrl.startsWith('file:') ? dirname(fileURLToPath(pageUrl)) : pageUrl
  const env = options.env ?? new BrowserEnvironment({ ...options, url: options.url ?? pageUrl, baseURL: options.baseURL ?? baseDir })
  const ctx = createContext(env, options)
  const els = parseHtml(html, env.document)
  bindInlineHandlers(ctx, els)
  for (const el of els) {
    if (el.localName !== 'script') continue
    const type = (el.getAttribute('type') ?? '').trim().toLowerCase()
    const isModule = type === 'module'
    if (!isModule && type && !/^(text|application)\/(javascript|ecmascript|typescript)$|^text\/babel$/.test(type)) continue // data blocks, shaders, templates
    const src = el.getAttribute('src')
    let code = el.textContent
    let url = pageUrl
    if (src) {
      try {
        ;({ code, url } = await fetchText(ctx, src, pageUrl))
      } catch (err) {
        report(ctx, err)
        el.dispatchEvent(new (env.window.Event as typeof import('../events.js').Event)('error'))
        continue
      }
    }
    if (isModule) await runModule(ctx, code, src ? url : pageUrl + '#inline-module')
    else runClassic(ctx, code, src ? url : pageUrl, el)
    if (src) el.dispatchEvent(new (env.window.Event as typeof import('../events.js').Event)('load'))
  }
  if (options.fireLoad !== false) env.load()
  return makePage(env, ctx)
}

/**
 * Runs a JavaScript/TypeScript file (or `{ code }`) as a page script. If the
 * script never creates a canvas, a full-viewport `<canvas>` is provided as
 * `document.querySelector('canvas')` so `getElementById`-free sketches work.
 */
export async function runScript(file: string | URL | { code: string; url?: string; module?: boolean }, options: RunOptions & { createCanvas?: boolean } = {}): Promise<Page> {
  let code: string
  let url: string
  let forceModule: boolean | undefined
  if (typeof file === 'object' && 'code' in file) {
    code = file.code
    url = file.url ?? pathToFileURL(resolve('script.js')).href
    forceModule = file.module
  } else {
    const path = file instanceof URL ? fileURLToPath(file) : resolve(String(file))
    if (!existsSync(path)) throw new Error(`File not found: ${path}`)
    code = await readFile(path, 'utf8')
    url = pathToFileURL(path).href
  }
  const baseDir = url.startsWith('file:') ? dirname(fileURLToPath(url)) : url
  const env = options.env ?? new BrowserEnvironment({ ...options, url: options.url ?? url, baseURL: options.baseURL ?? baseDir })
  const ctx = createContext(env, options)
  if (options.createCanvas !== false) {
    // a page with one canvas filling the viewport, like a typical sketch template
    const c = env.document.createElement('canvas') as Canvas
    c.id = 'canvas'
    c.width = env.window.innerWidth
    c.height = env.window.innerHeight
    env.document.body.appendChild(c)
  }
  const ext = extname(new URL(url).pathname)
  const isModule = forceModule ?? (ext === '.mjs' || ext === '.mts' || looksLikeModule(code))
  if (isModule) await runModule(ctx, code, url)
  else runClassic(ctx, code, url.startsWith('file:') ? fileURLToPath(url) : url)
  if (options.fireLoad !== false) env.load()
  return makePage(env, ctx)
}
