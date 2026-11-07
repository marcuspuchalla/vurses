/**
 * Wires the Vue runtime into the fetch handler: live sessions and offscreen
 * first frames for `runtime = 'server'` routes. Portable (no Node built-ins),
 * but pulls in the whole runtime (Vue + Yoga WASM): edge bundles skip it.
 */
import type { LiveRenderer, ServerApp } from './handler.js'
import { createRouteRoot, createRouteRouter } from './router.js'
import { renderShell, SessionManager, type SessionManagerOptions } from './session.js'

export interface LiveOptions extends Partial<Omit<SessionManagerOptions, 'createRoot'>> {
  /** Enable live sessions (SSE). Default: true. */
  sessions?: boolean
}

export function createLive(app: ServerApp, options: LiveOptions = {}): LiveRenderer {
  const createRoot = (path: string, request?: Request) => createRouteRoot({ manifest: app.manifest, load: app.load, path, history: 'memory', request })
  const { sessions = true, ...rest } = options
  return {
    sessions: sessions ? new SessionManager({ createRoot, ...rest }) : undefined,
    renderShell: async (path, size) => {
      const router = createRouteRouter({ manifest: app.manifest, load: app.load, path, history: 'memory' })
      return renderShell(router.component, { ...size, theme: options.theme, maxWait: 2000, ready: () => router.waitForIdle(2000) })
    },
  }
}
