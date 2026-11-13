---
layout: home

hero:
  name: vurses
  text: Vue 3 in the terminal
  tagline: Write ordinary Vue components and get a real terminal app. Or run your existing Vite + Vue web app in the terminal, unchanged.
  actions:
    - theme: brand
      text: Get started
      link: /GETTING-STARTED
    - theme: alt
      text: Run an existing web app
      link: /WEB
    - theme: alt
      text: GitHub
      link: https://github.com/marcuspuchalla/vurses

features:
  - title: Just Vue
    details: SFCs, &lt;script setup&gt;, TypeScript, ref, computed, v-model, slots, Teleport and Suspense. No new framework to learn.
  - title: Real layout
    details: Flexbox, borders, colors and themes, keyboard focus and mouse support, wide characters and emoji.
  - title: Batteries included
    details: About 50 components, a file-based App Router, a Canvas 2D API with true pixels on kitty, iTerm2 and sixel terminals, and testing utilities.
  - title: Existing web apps
    details: vurses web builds a Vite + Vue 3 app with its own config and runs it in the terminal with its CSS, router, forms and fetch calls.
  - title: Beyond the terminal
    details: The same components render into the browser devtools console with clickable buttons, or stream from a server.
  - title: Safe by default
    details: Untrusted text can't control your terminal, the dev server only listens on localhost, and your terminal is always restored.
---

## Your existing web app, in the terminal

TodoMVC's Vue example, unmodified, running with `vurses web`:

![TodoMVC running in a terminal: adding todos, completing one, switching filters](/todomvc-terminal.gif)

## Or build a terminal app with Vue

![The examples/dashboard app running in a terminal](/dashboard.png)
