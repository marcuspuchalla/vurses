import { cache } from 'vuecli'

export interface Quote {
  symbol: string
  price: number
  change: number
}

const SYMBOLS = ['VUE', 'YOGA', 'TTY', 'ANSI', 'SSE']
let tick = 0
let fetches = 0

/**
 * Stands in for a slow upstream API (`await fetch('https://…')`): ~120 ms
 * latency, new prices on every call.
 */
async function fetchQuotes(): Promise<{ quotes: Quote[]; fetchedAt: number; fetches: number }> {
  await new Promise((r) => setTimeout(r, 120))
  tick++
  fetches++
  const quotes = SYMBOLS.map((symbol, i) => {
    const base = 50 + i * 37
    const price = base + Math.sin(tick / 3 + i) * (5 + i) + Math.cos(tick / 7 + i * 2) * 3
    const prev = base + Math.sin((tick - 1) / 3 + i) * (5 + i) + Math.cos((tick - 1) / 7 + i * 2) * 3
    return { symbol, price: Math.round(price * 100) / 100, change: Math.round(((price - prev) / prev) * 10000) / 100 }
  })
  return { quotes, fetchedAt: Date.now(), fetches }
}

/**
 * Cached fetch: at most one upstream call every 2 s, shared by every server
 * session and by the /api/quotes route handler (stale-while-revalidate).
 * `POST /api/revalidate?tag=quotes` expires it on demand.
 */
export const getQuotes = cache(fetchQuotes, ['quotes'], { revalidate: 2, tags: ['quotes'] })
