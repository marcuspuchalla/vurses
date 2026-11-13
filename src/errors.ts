/**
 * vurses error codes (`VC###`).
 *
 * Every error vurses raises on purpose has a stable code, a one-line message
 * and a link to docs/errors.md, which explains the cause and the fix:
 *
 *   throw vursesError('VC001', { name: 'useApp' })
 *   // VursesError: [VC001] useApp() was called outside a vurses app ...
 *   //   → https://github.com/marcuspuchalla/vurses/blob/HEAD/docs/errors.md#vc001
 *
 * Browser-safe: no Node.js imports.
 */

export const DOCS_BASE = 'https://github.com/marcuspuchalla/vurses/blob/HEAD/docs/errors.md'

type Params = Record<string, unknown>

export interface ErrorDefinition {
  /** Short title (used as the docs heading). */
  title: string
  /** Area of the codebase that raises it. */
  area: 'app' | 'renderer' | 'template' | 'sfc' | 'style' | 'focus' | 'router' | 'server' | 'canvas' | 'tooling' | 'cli'
  /** Builds the message from the parameters passed to `vursesError`. */
  message: (p: Params) => string
}

const s = (v: unknown, fallback = '?') => (v === undefined || v === null || v === '' ? fallback : String(v))

/** The error catalog. Codes are stable: never renumber, only add. */
export const ERRORS = {
  // ------------------------------------------------------------ app (001-009)
  VC001: {
    title: 'Composable used outside a vurses app',
    area: 'app',
    message: (p) =>
      `${s(p.name, 'useApp')}() was called outside a vurses app. Call it from setup() of a component rendered by createApp(...).mount().`,
  },
  VC002: {
    title: 'App is not mounted',
    area: 'app',
    message: (p) => `${s(p.method, 'waitUntilExit')}() was called before app.mount().`,
  },
  VC003: {
    title: 'Invalid mount options',
    area: 'app',
    message: (p) => `Invalid mount option ${s(p.option)}: ${s(p.reason, 'unsupported value')}.`,
  },
  VC004: {
    title: 'App mounted twice',
    area: 'app',
    message: () => 'This app is already mounted. Create a new app with createApp() to mount again.',
  },
  VC005: {
    title: 'App crashed',
    area: 'app',
    message: (p) => `The app crashed${p.component ? ` in <${p.component}>` : ''}: ${s(p.reason, 'unknown error')}`,
  },

  // ------------------------------------------------------- renderer (010-019)
  VC010: {
    title: 'Unsupported static content',
    area: 'renderer',
    message: () =>
      'insertStaticContent is not supported by the terminal renderer. Compile templates with vurses compilerOptions (hoistStatic: false).',
  },
  VC011: {
    title: 'Unknown element',
    area: 'renderer',
    message: (p) =>
      `<${s(p.tag)}> has no terminal meaning and renders as a plain box. Use a vurses component (${s(p.suggestion, 'Box, Text, Button, TextInput, ...')}).`,
  },
  VC012: {
    title: 'Box inside Text',
    area: 'renderer',
    message: (p) => `<${s(p.tag, 'Box')}> inside <Text> is ignored: text elements only lay out inline text.`,
  },

  // ------------------------------------------------------- template (020-029)
  VC020: {
    title: 'Template compile error',
    area: 'template',
    message: (p) => `Template compile error${p.component ? ` in ${p.component}` : ''}: ${s(p.reason)}`,
  },
  VC021: {
    title: 'Runtime compiler unavailable',
    area: 'template',
    message: () => 'A `template:` string needs the runtime compiler. Import from "vurses" (not a bundle without @vue/compiler-dom) or precompile .vue files.',
  },

  // ------------------------------------------------------------ sfc (030-039)
  VC030: {
    title: 'SFC parse error',
    area: 'sfc',
    message: (p) => `${s(p.file, 'component.vue')}: ${s(p.reason)}`,
  },
  VC031: {
    title: 'SFC template compile error',
    area: 'sfc',
    message: (p) => `${s(p.file, 'component.vue')}: template: ${s(p.reason)}`,
  },
  VC032: {
    title: 'SFC script compile error',
    area: 'sfc',
    message: (p) => `${s(p.file, 'component.vue')}: <script${p.lang ? ` lang="${p.lang}"` : ''}>: ${s(p.reason)}`,
  },
  VC033: {
    title: '.vue loader not registered',
    area: 'sfc',
    message: (p) =>
      `Cannot import ${s(p.file, 'a .vue file')}: the loader is not registered. Run with \`vurses <entry>\` or \`node --import vurses/register\`.`,
  },

  // ---------------------------------------------------------- style (040-049)
  VC040: {
    title: 'Invalid style value',
    area: 'style',
    message: (p) => `Invalid value ${JSON.stringify(p.value)} for style property "${s(p.property)}"${p.expected ? ` (expected ${p.expected})` : ''}.`,
  },
  VC041: {
    title: 'Unknown color',
    area: 'style',
    message: (p) => `Unknown color ${JSON.stringify(p.value)}. Use a theme token, an ANSI name, #rgb/#rrggbb, rgb(r,g,b) or ansi256(n).`,
  },
  VC042: {
    title: 'Unknown theme',
    area: 'style',
    message: (p) => `Unknown theme "${s(p.name)}". Built-in themes: ${s(p.available, 'dark, light, dracula')}.`,
  },
  VC043: {
    title: 'Unknown utility class',
    area: 'style',
    message: (p) => `Unknown utility class "${s(p.name)}".`,
  },

  VC044: {
    title: 'Invalid FIGlet font',
    area: 'style',
    message: (p) => `Invalid FIGlet font${p.name ? ` "${p.name}"` : ''}: ${s(p.reason, 'missing "flf2a" signature')}.`,
  },

  // ---------------------------------------------------------- focus (050-059)
  VC050: {
    title: 'Focus composable misuse',
    area: 'focus',
    message: (p) => `${s(p.name, 'useFocus')}() must be called synchronously inside setup().`,
  },
  VC051: {
    title: 'Unknown focus id',
    area: 'focus',
    message: (p) => `focus("${s(p.id)}"): no focusable component with this id is mounted.`,
  },
  VC052: {
    title: 'Duplicate focus id',
    area: 'focus',
    message: (p) => `Two focusable components use the id "${s(p.id)}". Focus ids must be unique.`,
  },

  // --------------------------------------------------------- router (060-079)
  VC060: {
    title: 'Unknown route',
    area: 'router',
    message: (p) => `No route matches "${s(p.path)}".`,
  },
  VC061: {
    title: 'Invalid route params',
    area: 'router',
    message: (p) => `Invalid params for route "${s(p.route)}": ${s(p.reason, 'missing or invalid parameter')}.`,
  },
  VC062: {
    title: 'App directory not found',
    area: 'router',
    message: (p) => `App directory not found: ${s(p.dir, 'app/')}. Create app/page.vue or pass an entry file.`,
  },
  VC063: {
    title: 'Conflicting routes',
    area: 'router',
    message: (p) => `Routes "${s(p.a)}" and "${s(p.b)}" resolve to the same path "${s(p.path)}".`,
  },
  VC064: {
    title: 'Router not installed',
    area: 'router',
    message: (p) => `${s(p.name, 'useRouter')}() was called in an app that has no App Router.`,
  },
  VC065: {
    title: 'Invalid route module',
    area: 'router',
    message: (p) => `${s(p.file)} must ${s(p.reason, 'export default a component')}.`,
  },
  VC066: {
    title: 'Middleware error',
    area: 'router',
    message: (p) => `middleware failed for "${s(p.path)}": ${s(p.reason)}`,
  },

  VC067: {
    title: 'Page and route handler in one segment',
    area: 'router',
    message: (p) => `${s(p.pattern)}: a segment cannot have both a page and a route handler (${s(p.page, 'page')}, ${s(p.handler, 'route')}).`,
  },
  VC068: {
    title: 'Duplicate route param',
    area: 'router',
    message: (p) => `Duplicate param "${s(p.param)}" in ${s(p.dir)}. Param names must be unique along a route.`,
  },
  VC069: {
    title: 'Too many redirects',
    area: 'router',
    message: (p) => `Too many redirects (at ${s(p.path)}). Check middleware and redirect() calls for a loop.`,
  },
  VC070: {
    title: 'Invalid middleware matcher',
    area: 'router',
    message: (p) => `Invalid middleware matcher ${JSON.stringify(p.matcher ?? '')}: ${s(p.reason, 'unbalanced "("')}.`,
  },
  VC071: {
    title: 'Navigation timed out',
    area: 'router',
    message: (p) => `Navigation did not settle within ${s(p.timeout)}ms${p.path ? ` (at ${p.path})` : ''}.`,
  },
  VC072: {
    title: 'External URL in the terminal',
    area: 'router',
    message: (p) => `Cannot open external URL ${s(p.url)} in the terminal; it was ignored.`,
  },

  // --------------------------------------------------------- server (080-099)
  VC080: {
    title: 'Port in use',
    area: 'server',
    message: (p) => `Port ${s(p.port)} is already in use. Pass --port <n>.`,
  },
  VC081: {
    title: 'Route handler failed',
    area: 'server',
    message: (p) => `${s(p.method, 'GET')} ${s(p.path)}: route handler threw: ${s(p.reason)}`,
  },
  VC082: {
    title: 'Invalid route handler response',
    area: 'server',
    message: (p) => `${s(p.method, 'GET')} ${s(p.path)}: route handlers must return a Response (got ${s(p.got, 'undefined')}).`,
  },
  VC083: {
    title: 'Method not allowed',
    area: 'server',
    message: (p) => `${s(p.path)} does not export a ${s(p.method)} handler.`,
  },
  VC084: {
    title: 'Server-only API in the client',
    area: 'server',
    message: (p) => `${s(p.name)} can only be used in server components (export const runtime = 'server').`,
  },
  VC085: {
    title: 'Session limit reached',
    area: 'server',
    message: (p) => `Too many concurrent sessions (${s(p.limit)}).`,
  },

  VC086: {
    title: 'Unknown build adapter',
    area: 'server',
    message: (p) => `Unknown adapter "${s(p.adapter)}" (expected ${s(p.expected, 'node, static')}).`,
  },
  VC087: {
    title: 'Module not bundled',
    area: 'server',
    message: (p) => `Module ${s(p.file)} is not in the browser bundle.`,
  },
  VC088: {
    title: 'Invalid browser boot options',
    area: 'server',
    message: () => 'bootBrowser() needs `root`, or `manifest` + `load`.',
  },

  // --------------------------------------------------------- canvas (100-109)
  VC100: {
    title: 'Unsupported canvas context',
    area: 'canvas',
    message: (p) => `getContext("${s(p.type)}") is not supported. Only "2d" is available.`,
  },
  VC101: {
    title: 'Image decode failed',
    area: 'canvas',
    message: (p) => `Could not decode image ${s(p.src, '')}: ${s(p.reason, 'unsupported format')}.`,
  },
  VC102: {
    title: 'Invalid canvas size',
    area: 'canvas',
    message: (p) => `Invalid canvas size ${s(p.width)}x${s(p.height)}.`,
  },

  // -------------------------------------------------------- tooling (110-129)
  VC110: {
    title: 'Entry not found',
    area: 'tooling',
    message: (p) => `Entry not found: ${s(p.entry)}. Pass a .vue/.js/.ts file or an app directory.`,
  },
  VC111: {
    title: 'Entry has no default export',
    area: 'tooling',
    message: (p) => `${s(p.entry)} has no default export. Export the root component as default.`,
  },
  VC112: {
    title: 'Router mode unavailable',
    area: 'tooling',
    message: (p) => `${s(p.tool, 'This tool')} needs an App Router app (run with an app directory).`,
  },
  VC113: {
    title: 'Text not found on screen',
    area: 'tooling',
    message: (p) => `"${s(p.text)}" is not on screen.`,
  },
  VC114: {
    title: 'Timed out waiting for text',
    area: 'tooling',
    message: (p) => `Timed out after ${s(p.timeout)}ms waiting for "${s(p.text)}"${p.gone ? ' to disappear' : ''}.`,
  },
  VC115: {
    title: 'Invalid key',
    area: 'tooling',
    message: (p) => `Invalid key "${s(p.key)}". Use names like "enter", "tab", "shift+tab", "ctrl+s", "up", "a".`,
  },
  VC116: {
    title: 'Devtools hook not installed',
    area: 'tooling',
    message: () => 'globalThis.__VURSES_DEVTOOLS_HOOK__ is not installed: no vurses app with devtools is running on this page.',
  },

  // ------------------------------------------------------------ cli (130-139)
  VC130: {
    title: 'Unknown command',
    area: 'cli',
    message: (p) => `Unknown command "${s(p.name)}". Run \`vurses --help\`.`,
  },
  VC131: {
    title: 'Invalid flag value',
    area: 'cli',
    message: (p) => `Invalid value for --${s(p.flag)}: ${JSON.stringify(p.value)}${p.expected ? ` (expected ${p.expected})` : ''}.`,
  },
} satisfies Record<string, ErrorDefinition>

export type VursesErrorCode = keyof typeof ERRORS

/** Docs link for a code: `.../docs/errors.md#vc001`. */
export function errorDocsUrl(code: VursesErrorCode | string): string {
  return `${DOCS_BASE}#${code.toLowerCase()}`
}

export interface VursesErrorOptions {
  cause?: unknown
}

export class VursesError extends Error {
  readonly code: VursesErrorCode
  readonly docsUrl: string
  /** The parameters the message was built from. */
  readonly params: Params

  constructor(code: VursesErrorCode, message?: string, params: Params = {}, options: VursesErrorOptions = {}) {
    const def = ERRORS[code] as ErrorDefinition | undefined
    const text = message ?? def?.message(params) ?? 'Unknown error'
    const docsUrl = errorDocsUrl(code)
    super(`[${code}] ${text}\n  → ${docsUrl}`, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'VursesError'
    this.code = code
    this.docsUrl = docsUrl
    this.params = params
  }

  /** The message without the code prefix and docs link. */
  get reason(): string {
    return this.message.replace(/^\[VC\d+\] /, '').replace(/\n {2}→ .*$/, '')
  }

  toJSON() {
    return { name: this.name, code: this.code, message: this.reason, docsUrl: this.docsUrl, params: this.params }
  }
}

/**
 * Creates (does not throw) a `VursesError` from the catalog.
 *
 *   throw vursesError('VC060', { path: '/nope' })
 *   throw vursesError('VC030', { file, reason: e.message }, { cause: e })
 */
export function vursesError(code: VursesErrorCode, params: Params = {}, options: VursesErrorOptions = {}): VursesError {
  return new VursesError(code, undefined, params, options)
}

/** Throws `vursesError(code, params)`. Useful in expression position. */
export function fail(code: VursesErrorCode, params: Params = {}, options: VursesErrorOptions = {}): never {
  throw vursesError(code, params, options)
}

/** Type guard; optionally checks the code. */
export function isVursesError(err: unknown, code?: VursesErrorCode): err is VursesError {
  return (
    !!err &&
    typeof err === 'object' &&
    (err as { name?: unknown }).name === 'VursesError' &&
    typeof (err as { code?: unknown }).code === 'string' &&
    (code === undefined || (err as { code: string }).code === code)
  )
}

const warned = new Set<string>()

/**
 * Logs a coded warning (`console.warn`). With `once` (default true) each
 * code + message combination is only reported once per process.
 */
export function vursesWarn(code: VursesErrorCode, params: Params = {}, { once = true } = {}): void {
  const text = (ERRORS[code] as ErrorDefinition).message(params)
  const key = code + text
  if (once && warned.has(key)) return
  warned.add(key)
  console.warn(`[vurses ${code}] ${text}\n  → ${errorDocsUrl(code)}`)
}

/** Formats any error for terminal output: code, message, docs link and stack. */
export function formatError(err: unknown, { stack = false } = {}): string {
  if (isVursesError(err)) {
    let out = `${err.code}: ${err.reason}\n  → ${err.docsUrl}`
    if (stack && err.stack) out += '\n' + err.stack.split('\n').filter((l) => /^\s+at /.test(l)).join('\n')
    return out
  }
  if (err instanceof Error) return stack && err.stack ? err.stack : `${err.name}: ${err.message}`
  return String(err)
}

/** Lists the catalog (for docs generation and tooling). */
export function listErrors(): { code: VursesErrorCode; title: string; area: ErrorDefinition['area']; docsUrl: string }[] {
  return (Object.keys(ERRORS) as VursesErrorCode[]).map((code) => ({
    code,
    title: ERRORS[code].title,
    area: (ERRORS[code] as ErrorDefinition).area,
    docsUrl: errorDocsUrl(code),
  }))
}
