import type { Runtime } from '../app/app.js'

/**
 * Installs the devtools hook for a running app:
 *  - `globalThis.__VUECLI_DEVTOOLS_HOOK__` for the DevTools extension / VS Code preview
 *  - `globalThis.vuecli` console REPL (pause, resume, resize, wireframe, copy, frame, tree)
 * Placeholder — implemented by the tooling work stream. Safe to call in any environment.
 */
export function installDevtoolsHook(_runtime: Runtime, _options: { repl?: boolean } = {}): () => void {
  return () => {}
}
