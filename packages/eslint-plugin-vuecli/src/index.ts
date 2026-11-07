/**
 * eslint-plugin-vuecli: lint rules for vuecli terminal apps (flat config).
 *
 *   // eslint.config.js
 *   import vuecli from 'eslint-plugin-vuecli'
 *   export default [...vuecli.configs.recommended]
 */
import type { ESLint, Linter, Rule } from 'eslint'
import vueParser from 'vue-eslint-parser'
import noDomElements from './rules/no-dom-elements.js'
import noBoxInText from './rules/no-box-in-text.js'
import noUnsupportedGlyphs from './rules/no-unsupported-glyphs.js'

export const rules: Record<string, Rule.RuleModule> = {
  'no-dom-elements': noDomElements,
  'no-box-in-text': noBoxInText,
  'no-unsupported-glyphs': noUnsupportedGlyphs,
}

const recommendedRules: Linter.RulesRecord = {
  'vuecli/no-dom-elements': 'error',
  'vuecli/no-box-in-text': 'error',
  'vuecli/no-unsupported-glyphs': 'warn',
}

const plugin = {
  meta: { name: 'eslint-plugin-vuecli', version: '0.1.0' },
  rules,
  configs: {} as Record<string, Linter.Config[]>,
} satisfies ESLint.Plugin

// `<script lang="ts">` needs a TypeScript parser; use @typescript-eslint/parser when installed.
const TS_PARSER = '@typescript-eslint/parser'
let tsParser: unknown = null
try {
  tsParser = ((await import(TS_PARSER)) as { default?: unknown }).default ?? null
} catch {
  // optional
}

const recommended: Linter.Config[] = [
  {
    name: 'vuecli/recommended',
    files: ['**/*.vue'],
    plugins: { vuecli: plugin as ESLint.Plugin },
    languageOptions: {
      parser: vueParser as Linter.Parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      ...(tsParser ? { parserOptions: { parser: { ts: tsParser, typescript: tsParser } } } : {}),
    },
    rules: recommendedRules,
  },
]

plugin.configs.recommended = recommended
plugin.configs['flat/recommended'] = recommended

export { createGlyphChecker } from './rules/no-unsupported-glyphs.js'
export { DOM_ELEMENTS, SECTIONING } from './rules/no-dom-elements.js'
export { BOX_TAGS, TEXT_TAGS } from './rules/no-box-in-text.js'
export { BLOCKS, DEFAULT_BLOCKS, EMOJI_BLOCKS } from './blocks.js'
export const configs = plugin.configs
export default plugin
