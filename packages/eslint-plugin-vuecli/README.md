# eslint-plugin-vuecli

ESLint rules for [vuecli](../../README.md) terminal apps. Catches markup that
works in a browser but not in a terminal: HTML elements with no terminal
meaning, layout boxes nested in inline text, and glyphs that terminal fonts
draw wrong.

```sh
npm i -D eslint eslint-plugin-vuecli vue-eslint-parser
# for <script lang="ts">:
npm i -D @typescript-eslint/parser
```

```js
// eslint.config.js (flat config, ESLint 9+)
import vuecli from 'eslint-plugin-vuecli'

export default [
  ...vuecli.configs.recommended,
  // optional: check glyphs in plain JS/TS files too
  { files: ['**/*.{js,ts}'], plugins: { vuecli }, rules: { 'vuecli/no-unsupported-glyphs': 'warn' } },
]
```

`configs.recommended` applies to `**/*.vue`, sets `vue-eslint-parser` (with
`@typescript-eslint/parser` for TS script blocks when it is installed) and
enables:

| Rule | Default | What it reports |
| --- | --- | --- |
| [`vuecli/no-dom-elements`](#vueclino-dom-elements) | error | `<input>`, `<button>`, `<img>`, `<a>`, `<ul>`, `<table>`, ... |
| [`vuecli/no-box-in-text`](#vueclino-box-in-text) | error | `<Box>` / `<div>` inside `<Text>` / `<span>` |
| [`vuecli/no-unsupported-glyphs`](#vueclino-unsupported-glyphs) | warn | ZWJ emoji, variation selectors, flags, private-use icons, rare blocks |

It combines with `eslint-plugin-vue` (use it for `vue/require-v-for-key` and the
other general Vue rules).

## Rules

### `vuecli/no-dom-elements`

vuecli renders `div`, `span`, `p`, `box`, `text`, `view`, `br` and the
`tui-*` tags natively. Every other lowercase HTML tag becomes a plain box and
loses its HTML behavior. The rule reports them and names the vuecli
component to use:

```vue
<input v-model="name" />        <!-- ✗ use TextInput (text), Checkbox / Switch (checkbox), ... -->
<TextInput v-model="name" />    <!-- ✓ -->
<button @click="save">Save</button>   <!-- ✗ use Button -->
<ul><li v-for="i in items">{{ i }}</li></ul>   <!-- ✗ use List -->
```

Options:

- `allow: string[]`: tags to accept anyway.
- `sectioning: boolean` (default `false`): also report `header`, `footer`,
  `main`, `nav`, `section`, `article`, `aside`, ... (they render as plain boxes).

### `vuecli/no-box-in-text`

`<Text>` lays out inline text only. A box nested inside it (directly or
through a `<template>`) is ignored: no size, border or padding.

```vue
<Text>Status: <Box border>ok</Box></Text>        <!-- ✗ -->
<Box class="gap-1"><Text>Status:</Text><Box border>ok</Box></Box>   <!-- ✓ -->
<Text>a <Text bold>b</Text></Text>               <!-- ✓ nested text is an inline span -->
```

Box tags: `Box`, `box`, `tui-box`, `div`, `view`, `HStack`, `VStack`, `Center`,
`ScrollBox`, `Spacer`, `Divider`. Text tags: `Text`, `text`, `tui-text`,
`span`, `p`. Both match PascalCase and kebab-case.

Options: `boxTags: string[]`, `textTags: string[]` add your own components.

### `vuecli/no-unsupported-glyphs`

Checks template text, attribute values and string / template literals (in
templates and scripts) for characters that many terminals and fonts (Menlo,
DejaVu Sans Mono, Consolas, ...) do not draw as one cell-aligned glyph:

- **Sequences** (always reported unless `checkSequences: false`): zero-width
  joiner emoji (`👩‍💻`), variation selectors (`❤️`, `1️⃣`), skin-tone
  modifiers (`👍🏽`), regional-indicator flags (`🇩🇪`), keycaps and tag
  sequences. Terminals disagree on their width, which shifts the rest of the row.
- **Private-use code points** (Nerd Font / Powerline icons such as ``):
  they only render with a patched font.
- **Characters outside the allowed Unicode blocks.** The default list covers
  Latin, Greek, Cyrillic, Hebrew, Arabic, Thai, punctuation, currency, arrows,
  math operators, technical symbols, box drawing, block elements, geometric
  shapes, misc symbols, dingbats, braille and CJK. Single-codepoint emoji are
  allowed (`allowEmoji`).

Options:

| Option | Type | Default |
| --- | --- | --- |
| `allowedBlocks` | block names | the default list (replaces it) |
| `additionalBlocks` | block names | `[]` |
| `allowedRanges` | `[from, to][]` code points | `[]`, e.g. `[[0xe000, 0xf8ff]]` for Nerd Fonts |
| `allowChars` | string | `''` |
| `allowEmoji` | boolean | `true` |
| `checkSequences` | boolean | `true` |

Block names are the Unicode names, e.g. `"Mathematical Alphanumeric Symbols"`,
`"Symbols for Legacy Computing"` (see `BLOCKS` in `src/blocks.ts`).

## API

```js
import vuecli, { rules, createGlyphChecker, DOM_ELEMENTS } from 'eslint-plugin-vuecli'
createGlyphChecker({ allowEmoji: false })('party 🎉') // → [{ messageId: 'block', index: 6, ... }]
```

## Development

```sh
npm run build   # tsc → dist/
npm test        # vitest + ESLint RuleTester
```
