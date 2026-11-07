import type { InjectionKey, VNodeChild } from 'vue'
import type { AppRouter } from './router.js'

/** Provides the {@link AppRouter} to the component tree (`useRouter()`). */
export const ROUTER_KEY: InjectionKey<AppRouter> = Symbol('vuecli-app-router')

/** Provided by each layout host: renders the layout's child segment (used by `<Outlet/>`). */
export const OUTLET_KEY: InjectionKey<() => VNodeChild> = Symbol('vuecli-router-outlet')
