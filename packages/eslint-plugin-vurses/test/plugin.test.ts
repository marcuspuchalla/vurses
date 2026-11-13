import { describe, expect, it } from 'vitest'
import { Linter } from 'eslint'
import plugin, { createGlyphChecker, rules } from '../src/index.js'

describe('plugin', () => {
  it('exposes rules and a flat recommended config', () => {
    expect(Object.keys(rules).sort()).toEqual(['no-box-in-text', 'no-dom-elements', 'no-unsupported-glyphs'])
    expect(plugin.configs.recommended[0]).toMatchObject({ name: 'vurses/recommended', files: ['**/*.vue'] })
    expect(plugin.configs['flat/recommended']).toBe(plugin.configs.recommended)
    for (const r of Object.values(rules)) expect(r.meta?.docs?.url).toMatch(/^https:\/\//)
  })

  it('lints a .vue file with the recommended config', () => {
    const linter = new Linter({ configType: 'flat' })
    const code = '<template>\n  <Box>\n    <Text>hi <Box /> 👩‍💻</Text>\n    <button>x</button>\n  </Box>\n</template>\n'
    const messages = linter.verify(code, [...plugin.configs.recommended], 'App.vue')
    expect(messages.map((m) => [m.ruleId, m.severity, m.line])).toEqual([
      ['vurses/no-box-in-text', 2, 3],
      ['vurses/no-unsupported-glyphs', 1, 3],
      ['vurses/no-dom-elements', 2, 4],
    ])
  })

  it('exports the glyph checker', () => {
    const check = createGlyphChecker()
    expect(check('ok ✓')).toEqual([])
    expect(check('a‍b')[0]).toMatchObject({ messageId: 'sequence', index: 1 })
  })
})
