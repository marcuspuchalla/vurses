/** Browser-safe subset of util.format: %s %d %i %f %j %o %O %c %%. */
export function formatArgs(args: unknown[]): string {
  if (!args.length) return ''
  let i = 0
  let out = ''
  const first = args[0]
  if (typeof first === 'string') {
    i = 1
    out = first.replace(/%[sdifjoOc%]/g, (m) => {
      if (m === '%%') return '%'
      if (i >= args.length) return m
      const a = args[i++]
      switch (m) {
        case '%s':
          return typeof a === 'string' ? a : inspect(a)
        case '%d':
        case '%i':
          return String(m === '%i' ? parseInt(String(a), 10) : Number(a))
        case '%f':
          return String(parseFloat(String(a)))
        case '%c':
          return ''
        default:
          return inspect(a)
      }
    })
  } else out = inspect(first), (i = 1)
  for (; i < args.length; i++) out += ' ' + (typeof args[i] === 'string' ? args[i] : inspect(args[i]))
  return out
}

export function inspect(v: unknown, depth = 2): string {
  if (typeof v === 'string') return JSON.stringify(v)
  if (v instanceof Error) return v.stack ?? `${v.name}: ${v.message}`
  if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`
  if (v === null || typeof v !== 'object') return String(v)
  if (depth < 0) return Array.isArray(v) ? '[Array]' : '[Object]'
  if (Array.isArray(v)) return `[ ${v.map((x) => inspect(x, depth - 1)).join(', ')} ]`
  try {
    const entries = Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${inspect(x, depth - 1)}`)
    return `{ ${entries.join(', ')} }`
  } catch {
    return '[Object]'
  }
}
