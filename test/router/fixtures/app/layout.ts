import { defineComponent, h } from 'vue'
import { Link } from '../../../../src/components/router.js'

export const metadata = { title: { default: 'Fixture', template: '%s · Fixture' } }

export default defineComponent({
  name: 'RootLayout',
  setup(_, { slots }) {
    return () =>
      h('tui-box', { flexDirection: 'column' }, [
        h('tui-box', { flexDirection: 'row', gap: 1 }, [
          h('tui-text', null, 'ROOT'),
          h(Link, { href: '/' }, () => 'Home'),
          h(Link, { href: '/about' }, () => 'About'),
          h(Link, { href: '/users/1' }, () => 'User1'),
        ]),
        slots.default?.(),
      ])
  },
})
