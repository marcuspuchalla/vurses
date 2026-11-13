# Contributing to vurses

Welcome, and thanks for taking a look. vurses has a simple goal: write Vue, get a
terminal app. Whether that's a component you build for the terminal or an existing
Vite + Vue web app you run with `vurses web`. Contributions that move it closer to
that goal are very welcome, from a one-line typo fix to a new component.

## The most useful thing you can contribute

**A web app that doesn't look right in the terminal.** `vurses web` runs real Vue
apps through its own DOM, CSS cascade and layout engine, and every app finds a
corner nobody has tested yet. A report with what you ran and what you saw is
valuable even if you never write a line of code:

```sh
vurses web --snapshot --size 100x40                      # the frame as text
VURSES_WEB_DEBUG=1 vurses web --snapshot --size 100x40   # plus the layout tree on stderr
```

Open an issue with that output, the versions of Vue and the libraries involved
(Tailwind, PrimeVue, …) and, if you can, a small public repository or a minimal
component that reproduces it. Bonus points for a screenshot of the same page in a
browser. [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) lists the gaps we already
know about; a fix for one of those is just as welcome.

Other good places to start:

- **Terminal reports.** If something renders wrong in your terminal (colors, wide
  characters, mouse, images), tell us which terminal, its version, `TERM` and
  `COLORTERM`.
- **Components and examples.** Built-in components live in `src/components/`, one
  file each, and are registered automatically. A small example in `examples/` that
  shows off something real is a great first PR.
- **Docs.** If something in [Getting started](docs/GETTING-STARTED.md) didn't work
  the way it says, that's a bug.

## Getting set up

```sh
git clone https://github.com/marcuspuchalla/vurses
cd vurses
npm install          # also builds
npm test             # root test suite (vitest)
```

You need **Node.js 20.6 or newer** (22 LTS recommended) and any modern terminal.
macOS and Linux are tested; Windows reports are especially welcome.

To try your change in a real app:

```sh
npm run example:gallery                      # every component, page by page
npm run build && node bin/vurses.js App.vue  # any .vue file
cd ../some-vite-vue-app && node ../vurses/bin/vurses.js web
```

You don't need a terminal for most of the work: the renderer, layout, CSS engine and
components are all tested offscreen (`vurses/testing`, `manualRender: true`), and
`--snapshot` prints a frame without one.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the parts fit together.
Read it before changing core files.

## Before you open a pull request

Run these locally first:

```sh
npm run typecheck
npm run test:all     # root suite plus every package
```

- **Add a test for what you changed.** For a rendering or layout fix, a test that
  compares the rendered frame as text (see `test/web/compat.test.ts`) is the
  easiest kind to write and review.
- **Keep the showcase stable.** If you touch layout or CSS, check that the examples
  and a real web app still render the same, or explain in the PR why they changed.
- **User-visible changes update the docs** in the same PR: the CLI reference in
  Getting started, the component docs in the Guide, the tables in Compatibility.
- One topic per PR. Small PRs get reviewed faster.

## Things worth knowing about the codebase

- **Untrusted text never reaches the terminal raw.** App data, API responses, log
  lines and titles can contain escape sequences that would control the user's
  terminal (set the clipboard, rewrite the title, move the cursor). Everything that
  is written out goes through `src/render/sanitize.ts`. If you add a new output
  path, use it, and add a case to `test/security.test.ts`.
- **Safe defaults stay safe.** The dev server listens on localhost only, canvas pages
  can't load remote code unless allowed, stored data is private to the user.
  Changes that loosen a default need an opt-in flag and a line in
  [docs/SECURITY.md](docs/SECURITY.md).
- **Errors have stable codes.** Errors raised on purpose use a `VC###` code from
  `src/errors.ts`, and every code has an entry with a fix in
  [docs/errors.md](docs/errors.md). Don't reuse or renumber codes; add new ones.
- **`vurses web` runs apps unchanged.** Compatibility fixes go into vurses (the DOM
  facade, browser globals, CSS engine), never into instructions telling people to
  change their app. When something can't work in a terminal, it should degrade
  quietly and be listed in Compatibility.
- **The terminal is always restored.** Every exit path (Ctrl+C, signals, crashes)
  must leave the user's terminal usable. If you add a mode or a sequence, undo it on
  exit.
- **Output is the app.** Nothing prints to stdout while an app is running except
  frames; use the devtools log or stderr for diagnostics.

## Style

Match the code around you. TypeScript everywhere, no new runtime dependencies
without a good reason. `.vue` files put `<template>` first, then `<script>`, then
`<style>`. Comments explain *why* something is the way it is, especially where the
reason is a terminal quirk or browser behaviour that isn't obvious from the code.

Working with an AI coding assistant is fine (a lot of vurses was built that way).
You are still the author: read what you submit, make sure it's tested, and be ready
to explain it.

## Licensing

vurses is licensed under the **GNU General Public License v3.0 or later**
([LICENSE](LICENSE)). By opening a pull request you agree that your contribution is
licensed under the same terms. You keep your copyright.

### Third-party code

Don't paste code from other projects. If you learned something from one (a parsing
trick, an escape sequence table), credit it in a comment and write your own
implementation. If you need to include third-party material (a font, a data table),
say so in the PR together with its license; it must be compatible with the GPL, like
the FIGlet fonts in `src/fonts/` (New BSD License).

## Reporting security issues

Please don't open a public issue for a vulnerability. Use
[private vulnerability reporting](https://github.com/marcuspuchalla/vurses/security/advisories/new)
instead; [SECURITY.md](SECURITY.md) has the details.
