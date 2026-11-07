/**
 * Calls methods of `__VUECLI_DEVTOOLS_HOOK__` in the inspected page via
 * `chrome.devtools.inspectedWindow.eval`. Every hook method returns JSON data.
 */
export interface HookBridge {
  /** Resolves with the method's result, or rejects with `HookMissingError`. */
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T>
}

export class HookMissingError extends Error {
  readonly code = 'VC116'
  constructor() {
    super('No vuecli app with devtools on this page (globalThis.__VUECLI_DEVTOOLS_HOOK__ is missing).')
  }
}

/** The expression evaluated in the page for `call(method, ...args)`. */
export function callExpression(method: string, args: unknown[]): string {
  return (
    '(function(){var h=window.__VUECLI_DEVTOOLS_HOOK__;if(!h||typeof h[' + JSON.stringify(method) + "]!=='function')return {__vuecliMissing:true};" +
    'var r=h[' + JSON.stringify(method) + '].apply(h,' + JSON.stringify(args) + ');' +
    "if(r&&typeof r.then==='function')return null;return r===undefined?null:r})()"
  )
}

type Eval = (expr: string, cb: (result: unknown, exception?: { isException?: boolean; value?: string; description?: string }) => void) => void

export function evalBridge(evaluate: Eval): HookBridge {
  return {
    call<T>(method: string, ...args: unknown[]) {
      return new Promise<T>((resolve, reject) => {
        evaluate(callExpression(method, args), (result, ex) => {
          if (ex && (ex.isException || ex.description || ex.value)) return reject(new Error(ex.value ?? ex.description ?? 'eval failed'))
          if (result && typeof result === 'object' && (result as { __vuecliMissing?: boolean }).__vuecliMissing) return reject(new HookMissingError())
          resolve(result as T)
        })
      })
    },
  }
}

/** Bridge for the real DevTools panel. */
export function chromeBridge(): HookBridge {
  const c = (globalThis as { chrome?: { devtools?: { inspectedWindow?: { eval: Eval } } } }).chrome
  const ev = c?.devtools?.inspectedWindow?.eval
  if (!ev) throw new Error('chrome.devtools.inspectedWindow is not available: open this page as a DevTools panel.')
  return evalBridge((expr, cb) => ev.call(c!.devtools!.inspectedWindow, expr, cb))
}
