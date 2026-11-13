import { describe, expect, it } from 'vitest'
import { previewArgs, projectRoot, resolveCli, resolvePreviewTarget, type FsLike } from '../src/target.js'

const fakeFs = (files: Record<string, string>): FsLike => ({
  exists: (p) => p in files || Object.keys(files).some((f) => f.startsWith(p.replace(/\/$/, '') + '/')),
  readFile: (p) => files[p] ?? null,
})

describe('preview target', () => {
  const fs = fakeFs({
    '/w/package.json': '{"name":"my-app"}',
    '/w/app/page.vue': '',
    '/w/app/users/[id]/page.vue': '',
    '/w/components/Card.vue': '',
    '/w/node_modules/vurses/bin/vurses.js': '',
  })

  it('previews files inside app/ through the router at their route', () => {
    expect(resolvePreviewTarget('/w/app/users/[id]/page.vue', '/w', fs)).toEqual({ target: '/w/app', cwd: '/w', mode: 'router', route: '/users/1' })
    expect(resolvePreviewTarget('/w/app/page.vue', '/w', fs)).toMatchObject({ mode: 'router', route: '/' })
  })
  it('previews other files as entries', () => {
    expect(resolvePreviewTarget('/w/components/Card.vue', '/w', fs)).toEqual({ target: '/w/components/Card.vue', cwd: '/w', mode: 'entry' })
  })
  it('falls back to the workspace app', () => {
    expect(resolvePreviewTarget('/w/README.md', '/w', fs)).toMatchObject({ target: '/w/app', mode: 'router' })
    expect(resolvePreviewTarget(null, '/x', fakeFs({ '/x/src/App.vue': '' }))).toEqual({ target: '/x/src/App.vue', cwd: '/x', mode: 'entry' })
    expect(resolvePreviewTarget(null, null, fs)).toBeNull()
  })
  it('finds the project root and the CLI', () => {
    expect(projectRoot('/w/components/Card.vue', '/w', fs)).toBe('/w')
    expect(resolveCli('/w/components', fs)).toBe('/w/node_modules/vurses/bin/vurses.js')
    expect(resolveCli('/r/examples', fakeFs({ '/r/package.json': '{"name":"vurses"}', '/r/bin/vurses.js': '' }))).toBe('/r/bin/vurses.js')
    expect(resolveCli('/w', fs, '/custom/vurses.js')).toBeNull()
    expect(resolveCli('/nowhere', fakeFs({}))).toBeNull()
  })
  it('builds CLI arguments', () => {
    expect(previewArgs('/c.js', { target: '/w/app', cwd: '/w', mode: 'router', route: '/users/1' }, { columns: 90, rows: 30 }, 'light')).toEqual([
      '/c.js', 'mcp', '/w/app', '--jsonl', '--size', '90x30', '--route', '/users/1', '--theme', 'light',
    ])
    expect(previewArgs('/c.js', { target: '/w/A.vue', cwd: '/w', mode: 'entry' }, { columns: 80, rows: 24 })).toEqual(['/c.js', 'mcp', '/w/A.vue', '--jsonl', '--size', '80x24'])
  })
})
