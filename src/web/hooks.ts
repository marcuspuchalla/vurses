/**
 * Node module hooks for `vurses web`: every `vue` / `@vue/*` import (from
 * vurses itself, the shim and the app bundle) resolves to the app's own Vue,
 * so the renderer, the compiled templates and libraries share one runtime.
 */
type Resolve = (specifier: string, context: { parentURL?: string; conditions?: string[] }) => Promise<{ url: string; format?: string | null; shortCircuit?: boolean }>

let appParent: string | undefined
let vueParent: string | undefined

export async function initialize(data: { appParent: string; vueParent: string }) {
  appParent = data.appParent
  vueParent = data.vueParent
}

export async function resolve(specifier: string, context: { parentURL?: string; conditions?: string[] }, next: Resolve) {
  if (specifier === 'vue' && appParent) {
    try {
      return await next(specifier, { ...context, parentURL: appParent })
    } catch {
      /* fall through */
    }
  }
  if (specifier.startsWith('@vue/') && vueParent) {
    try {
      return await next(specifier, { ...context, parentURL: vueParent })
    } catch {
      /* fall through */
    }
  }
  return next(specifier, context)
}
