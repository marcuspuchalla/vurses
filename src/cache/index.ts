/**
 * Data cache (Next.js `unstable_cache` semantics) and on-demand revalidation.
 *
 * ```ts
 * import { cache, revalidateTag } from 'vurses'
 *
 * const getPrices = cache(async (symbol: string) => (await fetch(`https://api/x/${symbol}`)).json(),
 *   ['prices'], { revalidate: 30, tags: ['prices'] })
 *
 * await getPrices('VUE')      // miss: runs the function
 * await getPrices('VUE')      // fresh hit
 * // 30 s later: returns the stale value immediately and refreshes in the background
 * revalidateTag('prices')     // next call recomputes (blocking)
 * ```
 *
 * - key = keyParts + the function source + the JSON of the arguments
 * - `revalidate: N` seconds: stale-while-revalidate after N s; `false` (default) = until invalidated;
 *   `0` = never cache
 * - concurrent calls for the same key share one in-flight computation
 * - a failed background refresh keeps serving the stale value
 *
 * Route-level `export const revalidate = N` (server-rendered routes) caches the
 * first frame through the same store, tagged with `pathTag(pathname)`, so
 * `revalidatePath('/live')` refreshes it.
 *
 * The default store is in-memory and per process (per isolate on edge
 * platforms). Plug a shared one with `setCacheStore()`.
 * Browser-safe: no Node built-ins.
 */

export interface CacheEntry<T = unknown> {
  value: T
  /** ms epoch when the value was computed. */
  createdAt: number
  /** Seconds until stale, or false (never time-based). */
  revalidate: number | false
  tags: string[]
  /** Marked stale by `revalidateTag(tag, 'stale')`: serve it once more while refreshing. */
  stale?: boolean
}

export interface CacheStore {
  get(key: string): CacheEntry | undefined
  set(key: string, entry: CacheEntry): void
  delete(key: string): void
  keys(): Iterable<string>
}

export interface CacheOptions {
  /** Seconds before the entry becomes stale (SWR). `false`: until invalidated. `0`: do not cache. */
  revalidate?: number | false
  /** Tags for `revalidateTag()`. */
  tags?: string[]
}

class MemoryStore implements CacheStore {
  private map = new Map<string, CacheEntry>()
  constructor(private max = 5000) {}
  get(key: string) {
    return this.map.get(key)
  }
  set(key: string, entry: CacheEntry) {
    this.map.delete(key)
    this.map.set(key, entry)
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!)
  }
  delete(key: string) {
    this.map.delete(key)
  }
  keys() {
    return this.map.keys()
  }
}

interface CacheState {
  store: CacheStore
  inflight: Map<string, Promise<unknown>>
}

const STATE = Symbol.for('vurses.cache')
function state(): CacheState {
  const g = globalThis as any
  return (g[STATE] ??= { store: new MemoryStore(), inflight: new Map() })
}

/** Replace the cache store (e.g. a shared KV / Redis adapter). */
export function setCacheStore(store: CacheStore) {
  state().store = store
}
export function getCacheStore(): CacheStore {
  return state().store
}

/** Creates an in-memory LRU store (default: 5000 entries). */
export function createMemoryStore(maxEntries?: number): CacheStore {
  return new MemoryStore(maxEntries)
}

function isFresh(e: CacheEntry, now: number) {
  if (e.stale) return false
  return e.revalidate === false || now - e.createdAt < e.revalidate * 1000
}

/**
 * Low-level: get a cached value for `key`, computing it with `compute` on a
 * miss (blocking) or after it went stale (background, the stale value is returned).
 */
export async function cached<T>(key: string, compute: () => T | Promise<T>, options: CacheOptions = {}): Promise<T> {
  const revalidate = options.revalidate ?? false
  if (revalidate === 0) return compute()
  const { store, inflight } = state()
  const tags = options.tags ?? []
  const run = (): Promise<T> => {
    const existing = inflight.get(key)
    if (existing) return existing as Promise<T>
    const p = (async () => {
      try {
        const value = await compute()
        store.set(key, { value, createdAt: Date.now(), revalidate, tags })
        return value
      } finally {
        inflight.delete(key)
      }
    })()
    inflight.set(key, p)
    return p
  }
  const hit = store.get(key) as CacheEntry<T> | undefined
  if (!hit) return run()
  if (isFresh(hit, Date.now())) return hit.value
  // stale-while-revalidate
  run().catch(() => {
    /* keep serving the stale value */
  })
  return hit.value
}

/**
 * Wraps an async function with the data cache (≈ Next.js `unstable_cache`).
 */
export function cache<A extends unknown[], R>(
  fn: (...args: A) => R | Promise<R>,
  keyParts: string[] = [],
  options: CacheOptions = {},
): (...args: A) => Promise<Awaited<R>> {
  const base = JSON.stringify(keyParts) + '\u0000' + fn.toString()
  return (...args: A) => cached(base + '\u0000' + JSON.stringify(args), () => fn(...args), options) as Promise<Awaited<R>>
}

/** Alias for code ported from Next.js. */
export const unstable_cache = cache

/**
 * Invalidates every entry tagged `tag`.
 * - `'expire'` (default): entries are dropped; the next call recomputes (blocking).
 * - `'stale'`: entries are served once more while they refresh in the background.
 */
export function revalidateTag(tag: string, mode: 'expire' | 'stale' = 'expire') {
  const { store } = state()
  for (const key of [...store.keys()]) {
    const e = store.get(key)
    if (!e || !e.tags.includes(tag)) continue
    if (mode === 'stale') store.set(key, { ...e, stale: true })
    else store.delete(key)
  }
}

/** Expire immediately (Next 16 name). */
export const updateTag = (tag: string) => revalidateTag(tag, 'expire')

/** Normalizes a pathname for tags: no trailing slash, leading slash. */
function normalizePath(p: string) {
  let s = p.split('?')[0] || '/'
  if (!s.startsWith('/')) s = '/' + s
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1)
  return s
}

/** Tag attached to everything cached for a route path (server-rendered frames). */
export function pathTag(pathname: string) {
  return '_path:' + normalizePath(pathname)
}

/**
 * Invalidates the cached output of a path. `type: 'layout'` also invalidates
 * every path below it (`revalidatePath('/', 'layout')` = everything).
 */
export function revalidatePath(path: string, type: 'page' | 'layout' = 'page') {
  const p = normalizePath(path)
  if (type === 'page') return revalidateTag(pathTag(p))
  const { store } = state()
  const prefix = pathTag(p)
  for (const key of [...store.keys()]) {
    const e = store.get(key)
    if (!e) continue
    if (e.tags.some((t) => t === prefix || (t.startsWith('_path:') && (p === '/' || t.startsWith(prefix + '/'))))) store.delete(key)
  }
}

/** Drops everything (tests, dev reloads). */
export function clearCache() {
  const { store, inflight } = state()
  for (const key of [...store.keys()]) store.delete(key)
  inflight.clear()
}
