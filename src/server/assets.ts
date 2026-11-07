/**
 * Static file serving for node / bun (public/ and build output), plus an
 * in-memory variant for the dev server. Node built-ins (fs, path).
 */
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join, normalize, resolve, sep } from 'node:path'

export const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  wasm: 'application/wasm',
  xml: 'application/xml',
  webmanifest: 'application/manifest+json',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
}

export function mimeType(path: string) {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return MIME[ext] ?? 'application/octet-stream'
}

type AssetProvider = (pathname: string, request: Request) => Promise<Response | null>

function respond(body: Uint8Array | string, type: string, etag: string, request: Request, cacheControl: string): Response {
  const headers = { 'content-type': type, etag, 'cache-control': cacheControl }
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
  return new Response(request.method === 'HEAD' ? null : (body as BodyInit), { headers })
}

/**
 * Serves files from `dirs` (first match wins). Rejects path traversal and
 * dot-files. Directories are not listed.
 */
export function fsAssets(dirs: string[], options: { cacheControl?: string } = {}): AssetProvider {
  const roots = dirs.map((d) => resolve(d))
  const cc = options.cacheControl ?? 'public, max-age=0, must-revalidate'
  return async (pathname, request) => {
    let rel: string
    try {
      rel = decodeURIComponent(pathname)
    } catch {
      return null
    }
    if (rel.includes('\0') || rel.split('/').some((s) => s.startsWith('.') && s !== '.well-known')) return null
    for (const root of roots) {
      const file = normalize(join(root, rel))
      if (file !== root && !file.startsWith(root + sep)) continue
      const st = await stat(file).catch(() => null)
      if (!st?.isFile()) continue
      const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`
      if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag } })
      return respond(await readFile(file), mimeType(file), etag, request, cc)
    }
    return null
  }
}

/** Serves in-memory files keyed by URL path (dev server bundles). */
export function memoryAssets(files: Map<string, Uint8Array | string>): AssetProvider {
  const tags = new Map<string, string>()
  return async (pathname, request) => {
    const body = files.get(pathname)
    if (body === undefined) return null
    let etag = tags.get(pathname)
    if (!etag) tags.set(pathname, (etag = `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`))
    return respond(body, mimeType(pathname), etag, request, 'no-cache')
  }
}

/** Tries providers in order. */
export function chainAssets(...providers: (AssetProvider | null | undefined)[]): AssetProvider {
  const list = providers.filter(Boolean) as AssetProvider[]
  return async (pathname, request) => {
    for (const p of list) {
      const r = await p(pathname, request)
      if (r) return r
    }
    return null
  }
}
