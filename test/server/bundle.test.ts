import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { bundleClient, bundlePlayer, clientEntrySource, relativeManifest } from '../../src/server/bundle.js'
import { loadProject } from '../../src/server/project.js'
import { FIXTURE } from './helpers.js'

describe('bundles', () => {
  it('player is small and Vue-free', async () => {
    const js = await bundlePlayer()
    const gz = gzipSync(js).length
    expect(gz).toBeLessThan(25 * 1024)
    expect(js).not.toMatch(/createRenderer|__VUE_OPTIONS/)
    expect(js.length).toBeLessThan(40_000)
    console.log(`player: ${js.length} bytes, ${gz} gzipped`)
  })

  it('client bundle builds for the browser without Node built-ins and excludes server code', async () => {
    const project = await loadProject(FIXTURE)
    const src = clientEntrySource(project)
    expect(src).toContain('vurses:server:/live')
    expect(src).not.toContain('route.ts')
    expect(src).not.toContain('middleware')
    expect(src).not.toContain(FIXTURE + '/app/live/page.ts')
    const js = await bundleClient(project, { minify: true })
    expect(js).toContain('home page')
    expect(js).not.toContain('typed: ') // server page code is not shipped
    expect(js).not.toMatch(/from\s*"node:/)
    console.log(`client: ${js.length} bytes, ${gzipSync(js).length} gzipped`)
  }, 30000)

  it('relativizes manifest paths', async () => {
    const project = await loadProject(FIXTURE)
    const { manifest } = relativeManifest(project.manifest, project.root)
    expect(manifest.appDir).toBe('app')
    expect(manifest.middleware).toBe('middleware.ts')
    expect(JSON.stringify(manifest)).not.toContain(FIXTURE)
  })
})
