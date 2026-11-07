/**
 * Control-flow errors thrown by route code and caught by the router
 * (terminal) or the server (HTTP). Browser-safe.
 *
 *   import { notFound, redirect } from 'vuecli'
 *   if (!user) notFound()
 *   if (!session) redirect('/login')
 *
 * The `digest` strings follow Next.js (`NEXT_REDIRECT;…`, `NEXT_HTTP_ERROR_FALLBACK;404`)
 * so code that inspects digests keeps working.
 */

export type RedirectType = 'replace' | 'push'

/** Thrown by {@link redirect} / {@link permanentRedirect}. */
export class RedirectError extends Error {
  readonly digest: string
  constructor(
    readonly url: string,
    readonly type: RedirectType = 'replace',
    /** HTTP status the server should use (307 temporary, 308 permanent). */
    readonly status: 307 | 308 = 307,
  ) {
    super(`NEXT_REDIRECT ${url}`)
    this.name = 'RedirectError'
    this.digest = `NEXT_REDIRECT;${type};${url};${status};`
  }
}

/** Thrown by {@link notFound}. */
export class NotFoundError extends Error {
  readonly digest = 'NEXT_HTTP_ERROR_FALLBACK;404'
  readonly status = 404
  constructor() {
    super('NEXT_HTTP_ERROR_FALLBACK;404')
    this.name = 'NotFoundError'
  }
}

/**
 * Stops rendering the current route and navigates to `url` instead (replacing
 * the history entry by default). Works in page/layout `setup()` (including
 * async setup), in event handlers inside the route tree and on the server.
 */
export function redirect(url: string, type: RedirectType = 'replace'): never {
  throw new RedirectError(url, type, 307)
}

/** Like {@link redirect} but signals a permanent (308) redirect to HTTP clients. */
export function permanentRedirect(url: string, type: RedirectType = 'replace'): never {
  throw new RedirectError(url, type, 308)
}

/** Renders the nearest `not-found.vue` instead of the current route segment. */
export function notFound(): never {
  throw new NotFoundError()
}

function digestOf(e: unknown): string | undefined {
  return e && typeof e === 'object' && typeof (e as { digest?: unknown }).digest === 'string' ? (e as { digest: string }).digest : undefined
}

/** True for errors thrown by `redirect()` / `permanentRedirect()` (also matches Next.js digests). */
export function isRedirectError(e: unknown): e is RedirectError {
  if (e instanceof RedirectError) return true
  return !!digestOf(e)?.startsWith('NEXT_REDIRECT;')
}

/** True for errors thrown by `notFound()` (also matches Next.js digests). */
export function isNotFoundError(e: unknown): e is NotFoundError {
  if (e instanceof NotFoundError) return true
  const d = digestOf(e)
  return d === 'NEXT_NOT_FOUND' || d === 'NEXT_HTTP_ERROR_FALLBACK;404'
}

/** Target URL / type / status of a redirect error (works for foreign digests too). */
export function getRedirectInfo(e: unknown): { url: string; type: RedirectType; status: number } | null {
  if (e instanceof RedirectError) return { url: e.url, type: e.type, status: e.status }
  const d = digestOf(e)
  if (!d?.startsWith('NEXT_REDIRECT;')) return null
  const [, type, url, status] = d.split(';')
  return { url, type: type === 'push' ? 'push' : 'replace', status: Number(status) || 307 }
}
