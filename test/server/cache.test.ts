import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cache, cached, clearCache, pathTag, revalidatePath, revalidateTag, unstable_cache } from '../../src/cache/index.js'

beforeEach(() => {
  clearCache()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

const flush = () => vi.advanceTimersByTimeAsync(0)

describe('cache()', () => {
  it('memoizes by key parts + arguments', async () => {
    const fn = vi.fn(async (x: number) => x * 2)
    const c = cache(fn, ['double'])
    expect(await c(2)).toBe(4)
    expect(await c(2)).toBe(4)
    expect(await c(3)).toBe(6)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(unstable_cache).toBe(cache)
  })

  it('dedupes concurrent calls', async () => {
    let resolve!: (v: number) => void
    const fn = vi.fn(() => new Promise<number>((r) => (resolve = r)))
    const c = cache(fn, ['slow'])
    const a = c()
    const b = c()
    resolve(1)
    expect(await a).toBe(1)
    expect(await b).toBe(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('revalidate: N serves stale while revalidating', async () => {
    let n = 0
    const c = cache(async () => ++n, ['swr'], { revalidate: 10 })
    expect(await c()).toBe(1)
    vi.advanceTimersByTime(9_000)
    expect(await c()).toBe(1) // fresh
    vi.advanceTimersByTime(2_000)
    expect(await c()).toBe(1) // stale: returned immediately, refresh in background
    await flush()
    expect(await c()).toBe(2)
  })

  it('keeps the stale value when a background refresh fails', async () => {
    let fail = false
    const c = cache(async () => {
      if (fail) throw new Error('down')
      return 'ok'
    }, ['flaky'], { revalidate: 1 })
    expect(await c()).toBe('ok')
    fail = true
    vi.advanceTimersByTime(2000)
    expect(await c()).toBe('ok')
    await flush()
    expect(await c()).toBe('ok')
  })

  it('revalidateTag expires tagged entries only', async () => {
    let a = 0
    let b = 0
    const ca = cache(async () => ++a, ['a'], { tags: ['posts'] })
    const cb = cache(async () => ++b, ['b'], { tags: ['users'] })
    await ca()
    await cb()
    revalidateTag('posts')
    expect(await ca()).toBe(2)
    expect(await cb()).toBe(1)
  })

  it("revalidateTag(tag, 'stale') serves once more, then refreshes", async () => {
    let a = 0
    const ca = cache(async () => ++a, ['a2'], { tags: ['t'] })
    await ca()
    revalidateTag('t', 'stale')
    expect(await ca()).toBe(1)
    await flush()
    expect(await ca()).toBe(2)
  })

  it('revalidate: 0 never caches; false caches until invalidated', async () => {
    let n = 0
    const never = cache(async () => ++n, ['n0'], { revalidate: 0 })
    await never()
    await never()
    expect(n).toBe(2)
    let m = 0
    const forever = cache(async () => ++m, ['f'])
    await forever()
    vi.advanceTimersByTime(1e9)
    expect(await forever()).toBe(1)
  })

  it('revalidatePath (page and layout)', async () => {
    let n = 0
    const k = (p: string) => cached(`frame:${p}`, async () => ++n, { tags: [pathTag(p)] })
    await k('/blog/a')
    await k('/blog/b')
    await k('/about')
    revalidatePath('/blog/a/')
    expect(await k('/blog/a')).toBe(4)
    expect(await k('/blog/b')).toBe(2)
    revalidatePath('/blog', 'layout')
    expect(await k('/blog/b')).toBe(5)
    expect(await k('/about')).toBe(3)
    revalidatePath('/', 'layout')
    expect(await k('/about')).toBe(6)
  })
})
