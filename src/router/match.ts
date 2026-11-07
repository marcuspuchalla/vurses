/**
 * Route pattern parsing, specificity sorting and URL matching.
 *
 * Browser-safe (no Node imports). Shared by `discoverRoutes`, the terminal
 * router and the HTTP server so that every target resolves URLs identically.
 */
import type { RouteEntry, RouteManifest } from './types.js'

/** One URL segment of a route pattern. */
export type PatternSegment =
  | { kind: 'static'; value: string }
  | { kind: 'dynamic'; name: string }
  | { kind: 'catchAll'; name: string }
  | { kind: 'optionalCatchAll'; name: string }

/** Route params: dynamic segments are strings, catch-alls are string arrays. */
export type RouteParams = Record<string, string | string[]>

/** Result of {@link matchRoute}. */
export interface RouteMatch {
  route: RouteEntry
  params: RouteParams
}

/**
 * Parses a file-system pattern (`/users/[id]`, `/docs/[...slug]`, `/[[...all]]`)
 * into URL segments. Route groups `(x)` are dropped.
 */
export function parsePattern(pattern: string): PatternSegment[] {
  const out: PatternSegment[] = []
  for (const raw of pattern.split('/')) {
    if (!raw || isGroupSegment(raw)) continue
    let m: RegExpMatchArray | null
    if ((m = raw.match(/^\[\[\.\.\.([^\]]+)\]\]$/))) out.push({ kind: 'optionalCatchAll', name: m[1] })
    else if ((m = raw.match(/^\[\.\.\.([^\]]+)\]$/))) out.push({ kind: 'catchAll', name: m[1] })
    else if ((m = raw.match(/^\[([^\]]+)\]$/))) out.push({ kind: 'dynamic', name: m[1] })
    else out.push({ kind: 'static', value: raw })
  }
  return out
}

/** `(marketing)` style route group folder name. */
export function isGroupSegment(name: string): boolean {
  return /^\([^)]*\)$/.test(name) && !/^\(\.{1,3}\)/.test(name)
}

/** vue-router style path for a pattern: `/users/:id`, `/docs/:slug(.*)+`, `/:all(.*)*`. */
export function toRouterPath(segments: PatternSegment[]): string {
  if (!segments.length) return '/'
  return segments
    .map((s) => {
      if (s.kind === 'static') return '/' + s.value
      if (s.kind === 'dynamic') return `/:${s.name}`
      if (s.kind === 'catchAll') return `/:${s.name}(.*)+`
      return `/:${s.name}(.*)*`
    })
    .join('')
}

const RANK = { static: 0, dynamic: 1, catchAll: 2, optionalCatchAll: 3 } as const

/**
 * Compares two patterns by specificity (negative = `a` is more specific).
 * Static segments beat dynamic ones, which beat catch-alls, which beat
 * optional catch-alls; at equal rank the shorter pattern wins.
 */
export function compareSpecificity(a: string, b: string): number {
  const sa = parsePattern(a)
  const sb = parsePattern(b)
  const n = Math.max(sa.length, sb.length)
  for (let i = 0; i < n; i++) {
    const x = sa[i]
    const y = sb[i]
    if (!x) return -1
    if (!y) return 1
    const d = RANK[x.kind] - RANK[y.kind]
    if (d) return d
  }
  return a < b ? -1 : a > b ? 1 : 0
}

/** Sorts routes in place, most specific first. Returns the array. */
export function sortRoutes<T extends { pattern: string }>(routes: T[]): T[] {
  return routes.sort((a, b) => compareSpecificity(a.pattern, b.pattern))
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Splits a pathname into decoded segments (empty segments and trailing slashes are ignored). */
export function splitPath(pathname: string): string[] {
  return pathname.split('/').filter(Boolean).map(decode)
}

const compiled = new WeakMap<RouteEntry, PatternSegment[]>()
function segmentsOf(route: RouteEntry): PatternSegment[] {
  let s = compiled.get(route)
  if (!s) compiled.set(route, (s = parsePattern(route.pattern)))
  return s
}

/** Matches a pathname against one pattern; returns the params or null. */
export function matchPattern(pattern: string | PatternSegment[], pathname: string): RouteParams | null {
  const segs = typeof pattern === 'string' ? parsePattern(pattern) : pattern
  return matchSegments(segs, splitPath(pathname))
}

function matchSegments(segs: PatternSegment[], parts: string[]): RouteParams | null {
  const params: RouteParams = {}
  let i = 0
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k]
    if (s.kind === 'static') {
      if (parts[i] !== s.value) return null
      i++
    } else if (s.kind === 'dynamic') {
      if (i >= parts.length) return null
      params[s.name] = parts[i++]
    } else {
      // catch-alls consume the rest (they are always the last segment)
      const rest = parts.slice(i)
      if (s.kind === 'catchAll' && !rest.length) return null
      if (rest.length) params[s.name] = rest
      i = parts.length
    }
  }
  return i === parts.length ? params : null
}

export interface MatchRouteOptions {
  /** `page` (default): routes with a page; `handler`: route.ts handlers; `any`: both. */
  kind?: 'page' | 'handler' | 'any'
}

/**
 * Finds the first (most specific) route matching `pathname`.
 * `manifest.routes` is expected to be sorted (as returned by `discoverRoutes`).
 */
export function matchRoute(manifest: Pick<RouteManifest, 'routes'>, pathname: string, options: MatchRouteOptions = {}): RouteMatch | null {
  const kind = options.kind ?? 'page'
  const parts = splitPath(pathname)
  for (const route of manifest.routes) {
    if (kind === 'page' && !route.page) continue
    if (kind === 'handler' && !route.handler) continue
    const params = matchSegments(segmentsOf(route), parts)
    if (params) return { route, params }
  }
  return null
}

/**
 * Builds a URL path from a pattern and params:
 * `buildPath('/users/[id]', { id: '42' })` → `/users/42`.
 */
export function buildPath(pattern: string, params: RouteParams = {}): string {
  const out: string[] = []
  for (const s of parsePattern(pattern)) {
    if (s.kind === 'static') out.push(s.value)
    else {
      const v = params[s.name]
      if (v === undefined || (Array.isArray(v) && !v.length)) {
        if (s.kind === 'optionalCatchAll') continue
        throw new Error(`[vuecli router] missing param "${s.name}" for ${pattern}`)
      }
      out.push(...(Array.isArray(v) ? v : [v]).map((x) => encodeURIComponent(x)))
    }
  }
  return '/' + out.join('/')
}
