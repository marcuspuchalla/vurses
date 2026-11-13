import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import Home from './Home.vue'
import 'asciinema-player/dist/bundle/asciinema-player.css'
import './custom.css'
import './home.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('VursesHome', Home)
  },
} satisfies Theme
