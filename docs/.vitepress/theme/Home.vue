<template>
  <div class="vh">
    <section class="vh-hero">
      <div class="vh-wrap vh-hero-grid">
        <div class="vh-intro">
          <h1 class="vh-title">Write Vue.<br />Get a terminal app.</h1>
          <p class="vh-lede">
            vurses renders ordinary Vue 3 components as a real terminal UI: flexbox, borders,
            colours, focus and mouse. It also runs the Vite + Vue app you already have,
            unchanged.
          </p>

          <div class="vh-install">
            <code><span class="vh-prompt">$</span> npm install vurses vue</code>
            <button type="button" class="vh-copy" :aria-label="copied ? 'Copied' : 'Copy the install command'" @click="copy">
              {{ copied ? 'copied' : 'copy' }}
            </button>
          </div>

          <div class="vh-actions">
            <a class="vh-btn vh-btn-main" :href="withBase('/GETTING-STARTED')">Get started</a>
            <a class="vh-btn" :href="withBase('/WEB')">Run an existing app</a>
            <a class="vh-btn" href="https://github.com/marcuspuchalla/vurses">GitHub</a>
          </div>
        </div>

        <div class="vh-term" role="region" aria-label="Recorded terminal sessions">
          <div class="vh-term-bar">
            <span class="vh-dots" aria-hidden="true"><i></i><i></i><i></i></span>
            <div class="vh-tabs" role="tablist">
              <button
                v-for="d in demos"
                :key="d.id"
                type="button"
                role="tab"
                class="vh-tab"
                :aria-selected="d.id === active"
                @click="active = d.id">
                {{ d.label }}
              </button>
            </div>
          </div>
          <div class="vh-term-cmd"><span class="vh-prompt">$</span> {{ current.cmd }}</div>
          <div v-show="current.cast" ref="playerEl" class="vh-player"></div>
          <img
            v-if="!current.cast"
            class="vh-gif"
            :src="withBase(current.gif!)"
            :alt="current.alt" />
          <p class="vh-term-note">{{ current.note }}</p>
        </div>
      </div>
    </section>

    <section class="vh-wrap vh-section">
      <h2 class="vh-h2">Your component, rendered by the terminal</h2>
      <p class="vh-p">
        No new framework. Components, <code>ref</code>, <code>v-model</code>, slots and
        <code>&lt;script setup&gt;</code> work the way they do in the browser. The right side
        is the actual output of the file on the left.
      </p>
      <div class="vh-pair">
        <figure class="vh-box">
          <figcaption class="vh-box-title">App.vue</figcaption>
          <pre class="vh-code"><code v-html="sfc"></code></pre>
        </figure>
        <figure class="vh-box vh-box-term">
          <figcaption class="vh-box-title">npx vurses App.vue</figcaption>
          <pre class="vh-snap" v-html="snapshot"></pre>
        </figure>
      </div>
    </section>

    <section class="vh-band">
      <div class="vh-wrap vh-section">
        <h2 class="vh-h2">The web app you already have, in a terminal</h2>
        <p class="vh-p">
          <code>vurses web</code> builds your Vite + Vue 3 app with its own config and renders it
          with its CSS, router, forms and fetch calls. This is Conduit, an unmodified
          open-source app, talking to its live API.
        </p>
        <div class="vh-pair">
          <figure class="vh-box">
            <figcaption class="vh-box-title">npm run dev</figcaption>
            <img :src="withBase('/conduit-browser.png')" alt="Conduit in Chrome: the global feed with article previews, tag pills and a Popular Tags sidebar" loading="lazy" />
          </figure>
          <figure class="vh-box vh-box-term">
            <figcaption class="vh-box-title">npx vurses web</figcaption>
            <img :src="withBase('/conduit-terminal.png')" alt="The same Conduit feed in a terminal: articles, like buttons, tag pills in brackets and the Popular Tags sidebar" loading="lazy" />
          </figure>
        </div>
        <p class="vh-p vh-small">
          Tailwind v3 and v4, vue-router, Pinia, VueUse and vue-i18n work.
          <a :href="withBase('/COMPATIBILITY')">See what works and what doesn't.</a>
        </p>
      </div>
    </section>

    <section class="vh-wrap vh-section">
      <h2 class="vh-h2">What comes with it</h2>
      <dl class="vh-list">
        <div v-for="f in features" :key="f.name" class="vh-item">
          <dt>{{ f.name }}</dt>
          <dd>{{ f.text }}</dd>
        </div>
      </dl>
    </section>

    <section class="vh-wrap vh-section vh-end">
      <h2 class="vh-h2">Try it in a minute</h2>
      <pre class="vh-code vh-end-code"><code><span class="vh-c">// App.vue, then run:  npx vurses App.vue</span>
&lt;template&gt;
  &lt;Box border="round" title="hello"&gt;
    &lt;Text color="primary"&gt;Hello from Vue&lt;/Text&gt;
  &lt;/Box&gt;
&lt;/template&gt;</code></pre>
      <div class="vh-actions">
        <a class="vh-btn vh-btn-main" :href="withBase('/GETTING-STARTED')">Read the getting started guide</a>
        <a class="vh-btn" :href="withBase('/GUIDE')">Browse the components</a>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { withBase } from 'vitepress'
import snapshot from './counter-snapshot.html?raw'

interface Demo { id: string; label: string; cmd: string; note: string; cast?: string; gif?: string; alt?: string }

const demos: Demo[] = [
  { id: 'dashboard', label: 'dashboard', cmd: 'npm run example:dashboard', cast: '/casts/dashboard.cast', note: 'Live data, keyboard navigation, theme switching and a command palette (examples/dashboard).' },
  { id: 'todomvc', label: 'todomvc', cmd: 'npx vurses web', cast: '/casts/todomvc.cast', note: "TodoMVC's Vue example, unmodified, running with vurses web." },
  { id: 'mouse', label: 'mouse', cmd: 'npm run example:gallery', gif: '/gallery-mouse.gif', alt: 'The component gallery driven with the mouse: dragging a split pane, opening tree folders, flipping a switch and dragging sliders', note: 'Click, drag and hover: the component gallery driven with the mouse.' },
]

const features = [
  { name: 'About 50 components', text: 'Layout, text, inputs, tables, trees, code with syntax highlighting, diffs, charts, dialogs and more.' },
  { name: 'Flexbox layout', text: 'The same mental model as CSS, computed by Yoga, with borders, padding, gaps and Tailwind-style classes.' },
  { name: 'Keyboard and mouse', text: 'Focus management, key bindings, clicks, drags, hover and the wheel.' },
  { name: 'App Router', text: 'File-based routes with layouts, loading states and not-found pages.' },
  { name: 'Canvas and images', text: 'A Canvas 2D API with real pixels on kitty, iTerm2 and sixel terminals, and character art elsewhere.' },
  { name: 'Themes', text: 'Built-in themes, your own palettes, truecolor down to 16 colours and NO_COLOR.' },
  { name: 'Beyond the terminal', text: 'Render the same components into the browser devtools console, or stream them from a server.' },
  { name: 'Testing', text: 'Render offscreen, send keys and compare frames as plain text in vitest.' },
]

const sfc = `<span class="t">&lt;template&gt;</span>
  <span class="t">&lt;Box</span> <span class="a">border</span>=<span class="s">"round"</span> <span class="a">title</span>=<span class="s">"counter"</span><span class="t">&gt;</span>
    <span class="t">&lt;BigText</span> <span class="a">:text</span>=<span class="s">"String(count)"</span> <span class="t">/&gt;</span>
    <span class="t">&lt;Box</span> <span class="a">class</span>=<span class="s">"gap-1"</span><span class="t">&gt;</span>
      <span class="t">&lt;Button</span> <span class="a">label</span>=<span class="s">"-1"</span> <span class="a">@click</span>=<span class="s">"count--"</span> <span class="t">/&gt;</span>
      <span class="t">&lt;Button</span> <span class="a">label</span>=<span class="s">"+1"</span> <span class="a">@click</span>=<span class="s">"count++"</span> <span class="t">/&gt;</span>
    <span class="t">&lt;/Box&gt;</span>
  <span class="t">&lt;/Box&gt;</span>
<span class="t">&lt;/template&gt;</span>

<span class="t">&lt;script setup&gt;</span>
<span class="k">import</span> { ref } <span class="k">from</span> <span class="s">'vue'</span>
<span class="k">const</span> count = ref(<span class="n">42</span>)
<span class="t">&lt;/script&gt;</span>`

const active = ref('dashboard')
const current = computed(() => demos.find((d) => d.id === active.value)!)
const playerEl = ref<HTMLElement>()
const copied = ref(false)
let player: { dispose(): void } | undefined
let createPlayer: ((src: string, el: HTMLElement, opts: object) => { dispose(): void }) | undefined

async function mountPlayer() {
  player?.dispose()
  player = undefined
  const cast = current.value.cast
  if (!cast || !playerEl.value) return
  if (!createPlayer) {
    const mod = await import('asciinema-player')
    createPlayer = mod.create as typeof createPlayer
  }

  await nextTick()
  player = createPlayer!(withBase(cast), playerEl.value, {
    autoPlay: true,
    loop: true,
    fit: 'width',
    idleTimeLimit: 2,
    controls: false,
    theme: 'vurses',
    terminalFontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace",
  })
}

async function copy() {
  try {
    await navigator.clipboard.writeText('npm install vurses vue')
    copied.value = true
    setTimeout(() => (copied.value = false), 1600)
  } catch {
    copied.value = false // clipboard blocked: the command stays visible to copy by hand
  }
}

onMounted(() => void mountPlayer())

watch(active, () => void mountPlayer())

onBeforeUnmount(() => player?.dispose())
</script>
