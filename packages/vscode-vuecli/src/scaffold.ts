/**
 * App Router scaffolding: route path parsing and file templates (pure, no
 * VS Code APIs). Conventions follow src/router/types.ts:
 *
 *   app/page.vue                "/"
 *   app/users/[id]/page.vue     "/users/:id"
 *   app/docs/[...slug]/page.vue catch-all (params.slug: string[])
 *   app/(group)/x/page.vue      route group, not part of the URL
 *   app/x/layout.vue            layout (renders <slot />)
 *   app/api/x/route.ts          route handler (GET/POST/... (Request) => Response)
 */

export type ScaffoldKind = 'page' | 'layout' | 'route'

export type Segment =
  | { type: 'static'; name: string }
  | { type: 'group'; name: string }
  | { type: 'dynamic'; name: string }
  | { type: 'catchAll'; name: string }
  | { type: 'optionalCatchAll'; name: string }

const IDENT = /^[A-Za-z_$][\w$]*$/

/**
 * Parses a route as typed by the user into file-system segments. Accepts
 * file-system style (`/users/[id]`, `docs/[...slug]`, `(shop)/cart`) and
 * vue-router style (`/users/:id`, `/docs/:slug*`, `/files/*`).
 * Throws an Error with a user-facing message when invalid.
 */
export function parseRoute(input: string): Segment[] {
  const raw = input.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (raw === '') return []
  const segments: Segment[] = []
  const seen = new Set<string>()
  const parts = raw.split('/')
  parts.forEach((part, i) => {
    if (!part) throw new Error('Route segments must not be empty ("//").')
    let seg: Segment
    let m: RegExpExecArray | null
    if ((m = /^\[\[\.\.\.([^\]]+)\]\]$/.exec(part))) seg = { type: 'optionalCatchAll', name: m[1] }
    else if ((m = /^\[\.\.\.([^\]]+)\]$/.exec(part))) seg = { type: 'catchAll', name: m[1] }
    else if ((m = /^\[([^\]]+)\]$/.exec(part))) seg = { type: 'dynamic', name: m[1] }
    else if ((m = /^:([^(*+?]+)(?:\(.*\))?([*+])$/.exec(part))) seg = { type: m[2] === '*' ? 'optionalCatchAll' : 'catchAll', name: m[1] }
    else if ((m = /^:([^(*+?]+)(?:\(.*\))?$/.exec(part))) seg = { type: 'dynamic', name: m[1] }
    else if (part === '*' || part === '**') seg = { type: 'catchAll', name: 'slug' }
    else if ((m = /^\(([^)]+)\)$/.exec(part))) seg = { type: 'group', name: m[1] }
    else {
      if (/[[\]():*?#<>|"]/.test(part)) throw new Error(`Invalid segment "${part}": use [param], [...param] or (group).`)
      if (part === '.' || part === '..') throw new Error('Relative segments (. and ..) are not allowed.')
      if (part.startsWith('_')) throw new Error(`"${part}": folders starting with _ are private and never routed.`)
      if (part.startsWith('@')) throw new Error(`"${part}": parallel route slots (@name) are not supported.`)
      seg = { type: 'static', name: part }
    }
    if (seg.type !== 'static' && seg.type !== 'group') {
      if (!IDENT.test(seg.name)) throw new Error(`Invalid param name "${seg.name}".`)
      if (seen.has(seg.name)) throw new Error(`Param "${seg.name}" is used twice.`)
      seen.add(seg.name)
      if ((seg.type === 'catchAll' || seg.type === 'optionalCatchAll') && i !== parts.length - 1)
        throw new Error(`Catch-all [...${seg.name}] must be the last segment.`)
    }
    segments.push(seg)
  })
  return segments
}

/** Returns an error message, or null when valid (for `showInputBox` validation). */
export function validateRoute(input: string): string | null {
  try {
    parseRoute(input)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

/** Folder path below the app dir: `users/[id]`, `(shop)/cart`, `docs/[...slug]`. */
export function routeDir(segments: Segment[]): string {
  return segments
    .map((s) =>
      s.type === 'static' ? s.name
      : s.type === 'group' ? `(${s.name})`
      : s.type === 'dynamic' ? `[${s.name}]`
      : s.type === 'catchAll' ? `[...${s.name}]`
      : `[[...${s.name}]]`,
    )
    .join('/')
}

/** URL pattern for display: `/users/[id]` (groups removed). */
export function routeUrl(segments: Segment[]): string {
  const dir = routeDir(segments.filter((s) => s.type !== 'group'))
  return '/' + dir
}

/** A concrete URL to open in the preview: dynamic params become `1`, catch-alls `a/b`. */
export function sampleUrl(segments: Segment[]): string {
  const parts: string[] = []
  for (const s of segments) {
    if (s.type === 'static') parts.push(s.name)
    else if (s.type === 'dynamic') parts.push('1')
    else if (s.type === 'catchAll') parts.push('a', 'b')
  }
  return '/' + parts.join('/')
}

export function fileName(kind: ScaffoldKind): string {
  return kind === 'page' ? 'page.vue' : kind === 'layout' ? 'layout.vue' : 'route.ts'
}

/** Relative path of the file to create inside the app dir. */
export function scaffoldPath(kind: ScaffoldKind, segments: Segment[]): string {
  const dir = routeDir(segments)
  return dir ? `${dir}/${fileName(kind)}` : fileName(kind)
}

function paramsType(segments: Segment[]): string {
  const fields = segments.flatMap((s) =>
    s.type === 'dynamic' ? [`${s.name}: string`]
    : s.type === 'catchAll' ? [`${s.name}: string[]`]
    : s.type === 'optionalCatchAll' ? [`${s.name}?: string[]`]
    : [],
  )
  return fields.length ? `{ ${fields.join('; ')} }` : 'Record<string, never>'
}

/** Human title from the last static segment: `user-settings` → `User settings`. */
export function titleFor(segments: Segment[]): string {
  const last = [...segments].reverse().find((s) => s.type === 'static')
  if (!last) return segments.length ? 'Page' : 'Home'
  const words = last.name.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const params = (segments: Segment[]) => segments.filter((s) => s.type === 'dynamic' || s.type === 'catchAll' || s.type === 'optionalCatchAll')

export function pageTemplate(segments: Segment[]): string {
  const title = titleFor(segments)
  const ps = params(segments)
  const file = `app/${scaffoldPath('page', segments)}`
  const shown = ps.map((p) =>
    p.type === 'dynamic' ? `{{ params.${p.name} }}` : `{{ params.${p.name}${p.type === 'optionalCatchAll' ? '?' : ''}.join('/') }}`,
  )
  return `<template>
  <Box class="flex-col gap-1">
    <Text bold color="primary">${escapeTemplate(title)}${shown.length ? ' ' + shown.join(' / ') : ''}</Text>
    <Text color="muted">Edit ${escapeTemplate(file)}</Text>
  </Box>
</template>

<script lang="ts">
export const metadata = { title: ${JSON.stringify(title)} }
</script>

<script setup lang="ts">
defineProps<{ params: ${paramsType(segments)}; searchParams: Record<string, string> }>()
</script>
`
}

export function layoutTemplate(segments: Segment[]): string {
  const title = segments.length ? titleFor(segments) : 'App'
  return `<template>
  <Box class="flex-col gap-1">
    <Text bold color="accent">${escapeTemplate(title)}</Text>
    <slot />
  </Box>
</template>

<script setup lang="ts">
// Layouts wrap every page below this folder. The page renders in <slot />.
</script>
`
}

export function routeHandlerTemplate(segments: Segment[]): string {
  const ps = params(segments)
  const ctx = ps.length ? `, context?: { params?: ${paramsType(segments)} }` : ''
  const echo = ps.length ? ', params: context?.params' : ''
  return `// Route handler for ${routeUrl(segments)}: served by \`vuecli dev\` / \`vuecli start\`.
export async function GET(request: Request${ctx}) {
  return Response.json({ path: new URL(request.url).pathname${echo} })
}

export async function POST(request: Request${ctx}) {
  const body = await request.json().catch(() => null)
  return Response.json({ received: body${echo} }, { status: 201 })
}
`
}

export function templateFor(kind: ScaffoldKind, segments: Segment[]): string {
  return kind === 'page' ? pageTemplate(segments) : kind === 'layout' ? layoutTemplate(segments) : routeHandlerTemplate(segments)
}

/** Template text is placed inside markup: keep `{{` and `<` literal. */
function escapeTemplate(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!).replace(/\{\{/g, '{ {')
}

/**
 * Route segments for a folder inside the app dir (for "New Page here" from the
 * explorer): `<appDir>/users/[id]` → `users/[id]`.
 */
export function routeFromFolder(appDir: string, folder: string): string {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const a = norm(appDir)
  const f = norm(folder)
  if (f === a) return '/'
  if (!f.startsWith(a + '/')) return '/'
  return '/' + f.slice(a.length + 1)
}

/** Candidate app directories for a workspace root, in priority order. */
export function appDirCandidates(root: string): string[] {
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
  return [`${r}/app`, `${r}/src/app`]
}

/**
 * Finds the route of a file inside an app dir (for previewing a page):
 * `<appDir>/users/[id]/page.vue` → segments of `users/[id]`. Null when the file
 * is not inside the app dir.
 */
export function routeOfFile(appDir: string, file: string): Segment[] | null {
  const a = appDir.replace(/\\/g, '/').replace(/\/+$/, '')
  const f = file.replace(/\\/g, '/')
  if (!f.startsWith(a + '/')) return null
  const dir = f.slice(a.length + 1).split('/').slice(0, -1).join('/')
  try {
    return parseRoute(dir)
  } catch {
    return null
  }
}
