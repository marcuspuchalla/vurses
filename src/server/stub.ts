/**
 * Placeholder that the client bundle uses for `runtime = 'server'` pages: the
 * page's code is not shipped to the browser, so navigating to it from a
 * client route loads the server-rendered page (frame player) instead.
 */
import { defineComponent, h, onMounted } from 'vue'
import { buildPath, matchPattern } from '../router/match.js'

export function serverRouteStub(pattern: string, mode: 'navigate' | 'unsupported') {
  return defineComponent({
    name: 'VursesServerRoute',
    props: { params: { type: Object, default: () => ({}) } },
    setup(props) {
      onMounted(() => {
        if (mode !== 'navigate' || typeof location === 'undefined') return
        // web history: the URL already points at the route; memory history: rebuild it from params
        const here = matchPattern(pattern, location.pathname) ? location.pathname + location.search : null
        let target = here
        if (!target) {
          try {
            target = buildPath(pattern, props.params as Record<string, string | string[]>)
          } catch {
            target = null
          }
        }
        if (target) location.assign(target)
      })
      return () =>
        h('tui-text', { color: 'muted' }, mode === 'navigate' ? 'Loading server-rendered route…' : `This route (${pattern}) is server-rendered and needs the node or bun adapter.`)
    },
  })
}
