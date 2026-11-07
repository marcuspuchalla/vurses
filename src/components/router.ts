/**
 * App Router components: `<Link>`, `<NavLink>` and `<Outlet>` (auto-registered).
 *
 * ```vue
 * <Link href="/about">About</Link>
 * <Link :href="{ pathname: '/search', query: { q } }" replace>Search</Link>
 * <NavLink href="/users" label="Users" />   <!-- sidebar item with an active marker -->
 * <Outlet />                                 <!-- in a layout: renders the child segment -->
 * ```
 */
import { computed, defineComponent, h, inject, ref, type PropType } from 'vue'
import { useFocus } from '../composables.js'
import { matchKey } from '../input/keys.js'
import { OUTLET_KEY, ROUTER_KEY } from '../router/context.js'
import type { Href } from '../router/router.js'

function hrefPath(href: Href): string {
  if (typeof href === 'string') {
    const i = href.search(/[?#]/)
    return i < 0 ? href : href.slice(0, i)
  }
  return href.pathname ?? '/'
}

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)

const linkProps = {
  /** Target: '/about', '/users/42?tab=1', or `{ pathname, query, hash }`. */
  href: { type: [String, Object] as PropType<Href>, required: true as const },
  /** Text (alternatively use the default slot, which receives `{ active, focused }`). */
  label: String,
  /** Replace the current history entry instead of pushing a new one. */
  replace: Boolean,
  /** Load the target's modules when the link is focused or hovered. Default true. */
  prefetch: { type: Boolean, default: true },
  /** Only active on an exact pathname match (default: also active on sub-paths, except for '/'). */
  exact: Boolean,
  /** Classes added while active, e.g. "bold text-primary". */
  activeClass: String,
  /** Text color while active (ignored when `activeClass` is set). Default 'primary'. */
  activeColor: { type: String, default: 'primary' },
  /** Text color while inactive. Default 'info'. */
  color: { type: String, default: undefined },
  disabled: Boolean,
  autoFocus: Boolean,
}

function useLink(props: { href: Href; replace: boolean; prefetch: boolean; exact: boolean; disabled: boolean; autoFocus: boolean }, emit: (e: 'click' | 'navigate') => void) {
  const router = inject(ROUTER_KEY, null)
  const hovered = ref(false)
  const active = computed(() => {
    if (!router) return false
    const target = trimSlash(hrefPath(props.href))
    const current = trimSlash(router.route.pathname)
    if (current === target) return true
    return !props.exact && target !== '/' && current.startsWith(target + '/')
  })
  const prefetch = () => {
    if (props.prefetch && router) void router.prefetch(props.href).catch(() => {})
  }
  const navigate = () => {
    if (props.disabled) return
    emit('click')
    if (!router) {
      console.warn('[vuecli] <Link> used outside of an App Router tree')
      return
    }
    emit('navigate')
    void (props.replace ? router.replace(props.href) : router.push(props.href))
  }
  const focus = useFocus({
    autoFocus: props.autoFocus,
    disabled: () => props.disabled,
    onFocus: prefetch,
    onKey(e) {
      if (matchKey(e, 'enter|space')) {
        e.stopPropagation()
        navigate()
      }
    },
  })
  return { router, hovered, active, prefetch, navigate, focus }
}

/**
 * A focusable link. Enter / space / click navigates; active links (current
 * pathname matches) are bold and colored `activeColor`, or get `activeClass`.
 */
export const Link = defineComponent({
  name: 'Link',
  props: linkProps,
  emits: ['click', 'navigate'],
  setup(props, { slots, emit }) {
    const l = useLink(props, emit as (e: 'click' | 'navigate') => void)
    return () => {
      const focused = l.focus.isFocused.value
      const active = l.active.value
      const content = slots.default?.({ active, focused }) ?? props.label ?? (typeof props.href === 'string' ? props.href : hrefPath(props.href))
      const useClass = active && !!props.activeClass
      const color = props.disabled ? 'muted' : focused ? 'focus' : active ? (useClass ? undefined : props.activeColor) : (props.color ?? 'info')
      return h(
        'tui-box',
        {
          ref: l.focus.el,
          class: useClass ? props.activeClass : undefined,
          flexShrink: 0,
          onClick: l.navigate,
          onMouseEnter: () => {
            l.hovered.value = true
            l.prefetch()
          },
          onMouseLeave: () => (l.hovered.value = false),
        },
        // undefined (not false) so styles from `activeClass` / parents are inherited
        [h('tui-text', { color, bold: active || focused || undefined, underline: focused || l.hovered.value || undefined, wrap: 'none' }, content)],
      )
    }
  },
})

/**
 * Navigation item for sidebars / tab bars: a full-width row with an active
 * marker (`marker`, default '▌') and background highlight when focused.
 */
export const NavLink = defineComponent({
  name: 'NavLink',
  props: {
    ...linkProps,
    /** Marker shown before the active item. */
    marker: { type: String, default: '▌' },
    /** Optional shortcut / badge text shown right-aligned. */
    hint: String,
  },
  emits: ['click', 'navigate'],
  setup(props, { slots, emit }) {
    const l = useLink(props, emit as (e: 'click' | 'navigate') => void)
    return () => {
      const focused = l.focus.isFocused.value
      const active = l.active.value
      const content = slots.default?.({ active, focused }) ?? props.label ?? hrefPath(props.href)
      const useClass = active && !!props.activeClass
      const color = props.disabled ? 'muted' : focused ? 'focus' : active ? (useClass ? undefined : props.activeColor) : props.color
      const pad = ' '.repeat(Math.max(1, [...props.marker].length))
      return h(
        'tui-box',
        {
          ref: l.focus.el,
          class: useClass ? props.activeClass : undefined,
          flexShrink: 0,
          bg: focused ? 'selection' : l.hovered.value ? 'surface' : undefined,
          onClick: l.navigate,
          onMouseEnter: () => {
            l.hovered.value = true
            l.prefetch()
          },
          onMouseLeave: () => (l.hovered.value = false),
        },
        [
          h('tui-text', { color: active ? props.activeColor : 'muted', wrap: 'none' }, active ? props.marker : pad),
          h('tui-text', { color, bold: active || undefined, wrap: 'truncate', flexGrow: 1 }, [' ', content]),
          props.hint ? h('tui-text', { color: 'muted', wrap: 'none' }, ' ' + props.hint) : null,
        ],
      )
    }
  },
})

/**
 * Renders the child segment inside a layout (alternative to the layout's
 * default `<slot/>`). Renders nothing outside of a layout.
 */
export const Outlet = defineComponent({
  name: 'Outlet',
  setup() {
    const render = inject(OUTLET_KEY, null)
    return () => (render ? render() : null)
  },
})
