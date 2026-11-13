import { defineConfig } from 'vitepress'

const repo = 'https://github.com/marcuspuchalla/vurses'

export default defineConfig({
  title: 'vurses',
  description: 'Vue 3 in the terminal: write Vue components, get a terminal app. Runs existing Vite + Vue web apps too.',
  base: '/vurses/',
  cleanUrls: true,
  lastUpdated: true,
  // docs/README.md is the index for browsing the docs on GitHub; the site has its own home page
  srcExclude: ['README.md'],
  head: [
    ['meta', { name: 'theme-color', content: '#142230' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Martian+Mono:wdth,wght@75..112.5,400..800&display=swap' }],
  ],
  markdown: {
    config(md) {
      // links to files outside docs/ (../SECURITY.md, ../packages/...) go to GitHub
      const open = md.renderer.rules.link_open ?? ((t, i, o, _e, s) => s.renderToken(t, i, o))
      md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
        const href = tokens[idx].attrGet('href')
        if (href?.startsWith('../')) tokens[idx].attrSet('href', `${repo}/blob/develop/${href.slice(3)}`)
        return open(tokens, idx, options, env, self)
      }
    },
  },
  themeConfig: {
    nav: [
      { text: 'Getting started', link: '/GETTING-STARTED' },
      { text: 'Guide', link: '/GUIDE' },
      { text: 'Web apps', link: '/WEB' },
      { text: 'Contributing', link: `${repo}/blob/develop/CONTRIBUTING.md` },
    ],
    sidebar: [
      {
        text: 'Using vurses',
        items: [
          { text: 'Getting started', link: '/GETTING-STARTED' },
          { text: 'Building apps', link: '/GUIDE' },
          { text: 'Existing web apps', link: '/WEB' },
          { text: 'Browser, server and deployment', link: '/SERVER' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Compatibility', link: '/COMPATIBILITY' },
          { text: 'Security', link: '/SECURITY' },
          { text: 'Error codes', link: '/errors' },
          { text: 'Architecture', link: '/ARCHITECTURE' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: repo }],
    editLink: { pattern: `${repo}/edit/develop/docs/:path`, text: 'Edit this page on GitHub' },
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    footer: { message: 'Released under the GPL-3.0-or-later license.' },
  },
})
