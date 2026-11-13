import { describe, expect, it } from 'vitest'
import {
  appDirCandidates, parseRoute, routeDir, routeFromFolder, routeOfFile, routeUrl, sampleUrl,
  scaffoldPath, templateFor, titleFor, validateRoute,
} from '../src/scaffold.js'

describe('route parsing', () => {
  it('parses file-system and vue-router style routes', () => {
    expect(parseRoute('/')).toEqual([])
    expect(parseRoute('')).toEqual([])
    expect(routeDir(parseRoute('/users/[id]'))).toBe('users/[id]')
    expect(routeDir(parseRoute('users/:id/'))).toBe('users/[id]')
    expect(routeDir(parseRoute('/docs/[...slug]'))).toBe('docs/[...slug]')
    expect(routeDir(parseRoute('/docs/:slug+'))).toBe('docs/[...slug]')
    expect(routeDir(parseRoute('/docs/:slug(.*)*'))).toBe('docs/[[...slug]]')
    expect(routeDir(parseRoute('/files/*'))).toBe('files/[...slug]')
    expect(routeDir(parseRoute('/shop/[[...path]]'))).toBe('shop/[[...path]]')
    expect(routeDir(parseRoute('(marketing)/about'))).toBe('(marketing)/about')
    expect(routeDir(parseRoute('\\win\\style'))).toBe('win/style')
  })
  it('validates', () => {
    expect(validateRoute('/ok/[id]')).toBeNull()
    expect(validateRoute('/a//b')).toMatch(/empty/)
    expect(validateRoute('/[...a]/b')).toMatch(/last segment/)
    expect(validateRoute('/[id]/[id]')).toMatch(/twice/)
    expect(validateRoute('/[1x]')).toMatch(/Invalid param/)
    expect(validateRoute('/_private')).toMatch(/private/)
    expect(validateRoute('/@slot')).toMatch(/slots/)
    expect(validateRoute('/a?b')).toMatch(/Invalid segment/)
    expect(validateRoute('/../x')).toMatch(/Relative/)
  })
  it('builds urls and titles', () => {
    expect(routeUrl(parseRoute('(g)/users/[id]'))).toBe('/users/[id]')
    expect(sampleUrl(parseRoute('(g)/users/[id]/posts'))).toBe('/users/1/posts')
    expect(sampleUrl(parseRoute('docs/[...slug]'))).toBe('/docs/a/b')
    expect(sampleUrl(parseRoute('docs/[[...slug]]'))).toBe('/docs')
    expect(titleFor(parseRoute('/user-settings'))).toBe('User settings')
    expect(titleFor([])).toBe('Home')
    expect(titleFor(parseRoute('/[id]'))).toBe('Page')
  })
})

describe('scaffold files', () => {
  it('computes paths', () => {
    expect(scaffoldPath('page', [])).toBe('page.vue')
    expect(scaffoldPath('page', parseRoute('/users/[id]'))).toBe('users/[id]/page.vue')
    expect(scaffoldPath('layout', parseRoute('/users'))).toBe('users/layout.vue')
    expect(scaffoldPath('route', parseRoute('/api/hello'))).toBe('api/hello/route.ts')
  })

  it('renders a page with typed params and metadata', () => {
    const s = templateFor('page', parseRoute('/users/[id]/files/[...path]'))
    expect(s).toContain('export const metadata = { title: "Files" }')
    expect(s).toContain('defineProps<{ params: { id: string; path: string[] }; searchParams: Record<string, string> }>()')
    expect(s).toContain("{{ params.id }} / {{ params.path.join('/') }}")
    expect(s).toContain('Edit app/users/[id]/files/[...path]/page.vue')
    expect(s).toMatch(/<template>\n {2}<Box class="flex-col gap-1">/)
    const home = templateFor('page', [])
    expect(home).toContain('params: Record<string, never>')
    expect(home).toContain('<Text bold color="primary">Home</Text>')
    expect(templateFor('page', parseRoute('/[[...slug]]'))).toContain("params.slug?.join('/')")
  })

  it('renders layouts with a slot', () => {
    const s = templateFor('layout', parseRoute('/dashboard'))
    expect(s).toContain('<slot />')
    expect(s).toContain('Dashboard')
    expect(templateFor('layout', [])).toContain('>App<')
  })

  it('renders route handlers', () => {
    const s = templateFor('route', parseRoute('/api/users/[id]'))
    expect(s).toContain('// Route handler for /api/users/[id]')
    expect(s).toContain('export async function GET(request: Request, context?: { params?: { id: string } })')
    expect(s).toContain('export async function POST(')
    expect(templateFor('route', parseRoute('/api/hello'))).toContain('export async function GET(request: Request) {')
  })

  it('escapes template-breaking titles', () => {
    expect(templateFor('page', parseRoute('/a{{b'))).toContain('A{ {b')
  })
})

describe('folders', () => {
  it('maps folders and files to routes', () => {
    expect(routeFromFolder('/p/app', '/p/app')).toBe('/')
    expect(routeFromFolder('/p/app', '/p/app/users/[id]/')).toBe('/users/[id]')
    expect(routeFromFolder('/p/app', '/elsewhere')).toBe('/')
    expect(routeFromFolder('C:\\p\\app', 'C:\\p\\app\\x')).toBe('/x')
    expect(appDirCandidates('/p/')).toEqual(['/p/app', '/p/src/app'])
    expect(routeDir(routeOfFile('/p/app', '/p/app/users/[id]/page.vue')!)).toBe('users/[id]')
    expect(routeOfFile('/p/app', '/p/app/page.vue')).toEqual([])
    expect(routeOfFile('/p/app', '/p/other.vue')).toBeNull()
  })
})
