import { afterAll, describe, it } from 'vitest'
import { RuleTester } from 'eslint'
import vueParser from 'vue-eslint-parser'
import noDomElements from '../src/rules/no-dom-elements.js'
import noBoxInText from '../src/rules/no-box-in-text.js'
import noUnsupportedGlyphs from '../src/rules/no-unsupported-glyphs.js'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only
RuleTester.afterAll = afterAll

const tester = new RuleTester({ languageOptions: { parser: vueParser, ecmaVersion: 2022, sourceType: 'module' } })
const vue = (template: string, script = '') => `${script ? `<script setup>\n${script}\n</script>\n` : ''}<template>${template}</template>`

tester.run('no-dom-elements', noDomElements, {
  valid: [
    vue('<Box><Text>hi</Text><Button label="ok" /><TextInput v-model="x" /></Box>'),
    vue('<div><span>alias</span><p>text</p><box /><text>t</text><view /><br /></div>'),
    vue('<tui-box><tui-text>x</tui-text></tui-box>'),
    vue('<template v-if="a"><slot /></template><component :is="c" /><Teleport to="x" /><Transition /><KeepAlive />'),
    vue('<header>sectioning is fine by default</header>'),
    { code: vue('<input />'), options: [{ allow: ['input'] }] },
    'const el = "<input>"', // plain JS is ignored
  ],
  invalid: [
    {
      code: vue('<Box><input v-model="x" /></Box>'),
      errors: [{ messageId: 'noDom', data: { tag: 'input', suggestion: 'TextInput (text), Checkbox / Switch (checkbox), RadioGroup (radio) or Slider (range)' }, line: 1, column: 16 }],
    },
    {
      code: vue('<button @click="go">Go</button><img src="a.png" /><a href="/x">x</a>'),
      errors: [
        { message: '<button> has no terminal meaning in vurses and renders as a plain box. Use Button instead.' },
        { messageId: 'noDom', data: { tag: 'img', suggestion: 'Image' } },
        { messageId: 'noDom', data: { tag: 'a', suggestion: 'Link (App Router) or Text' } },
      ],
    },
    {
      code: vue('<ul><li v-for="i in items">{{ i }}</li></ul><table><tr><td>1</td></tr></table>'),
      errors: ['ul', 'li', 'table', 'tr', 'td'].map((tag) => ({ messageId: 'noDom', data: { tag, suggestion: { ul: 'List', li: 'List :items', table: 'Table', tr: 'Table :rows', td: 'Table :rows' }[tag]! } })),
    },
    {
      code: vue('<form><select><option>a</option></select><textarea /><h1>T</h1><hr /></form>'),
      errors: 6,
    },
    { code: vue('<section><nav /></section>'), options: [{ sectioning: true }], errors: [{ messageId: 'noSectioning' }, { messageId: 'noSectioning' }] },
  ],
})

tester.run('no-box-in-text', noBoxInText, {
  valid: [
    vue('<Box><Text>a <Text bold>b</Text></Text><Box /></Box>'),
    vue('<Text>a <Badge label="x" /> <span>c</span></Text>'),
    vue('<div><span>x</span><div /></div>'),
    vue('<Box><Text>a</Text><HStack /></Box>'),
  ],
  invalid: [
    {
      code: vue('<Text>hello <Box border /></Text>'),
      errors: [{ message: '<Box> inside <Text> is ignored: text elements only lay out inline text. Move it out of <Text> or wrap both in a <Box>.', column: 23 }],
    },
    { code: vue('<span><div>x</div></span>'), errors: [{ messageId: 'boxInText', data: { box: 'div', text: 'span' } }] },
    { code: vue('<p><template v-if="a"><tui-box /></template></p>'), errors: [{ messageId: 'boxInText', data: { box: 'tui-box', text: 'p' } }] },
    { code: vue('<text><Text><VStack /><Spacer /></Text></text>'), errors: [{ messageId: 'boxInText', data: { box: 'VStack', text: 'Text' } }, { messageId: 'boxInText', data: { box: 'Spacer', text: 'Text' } }] },
    { code: vue('<Label><Panel /></Label>'), options: [{ boxTags: ['Panel'], textTags: ['Label'] }], errors: [{ messageId: 'boxInText' }] },
  ],
})

tester.run('no-unsupported-glyphs', noUnsupportedGlyphs, {
  valid: [
    vue('<Text>plain ascii, äöü, ñ, € 世界 ─│┌┐ █▀▄ ⠿ ● ✓ ✕ ★ ← → ⏎ ⌘</Text>'),
    vue('<Text>party 🎉 rocket 🚀</Text>'),
    vue('<Text :label="`ok ${x} done`" title="✓ ok" />', 'const s = "◉ all ○ none"'),
    'const s = "← back · next →"',
    { code: vue('<Text> powerline</Text>'), options: [{ allowedRanges: [[0xe000, 0xf8ff]] }] },
    { code: vue('<Text>❤️ love</Text>'), options: [{ checkSequences: false }] },
    { code: vue('<Text>𝐁old</Text>'), options: [{ additionalBlocks: ['Mathematical Alphanumeric Symbols'] }] },
    { code: vue('<Text>𝐁old</Text>'), options: [{ allowChars: '𝐁' }] },
  ],
  invalid: [
    {
      code: vue('<Text>dev 👩‍💻</Text>'),
      errors: [{ messageId: 'sequence', data: { kind: 'a zero-width joiner (emoji ZWJ sequence)', code: 'U+200D' }, line: 1, column: 23 }],
    },
    { code: vue('<Text>love ❤️</Text>'), errors: [{ messageId: 'sequence', data: { kind: 'a variation selector', code: 'U+FE0F' } }] },
    { code: 'const thumbs = "👍🏽"', errors: [{ messageId: 'sequence', data: { kind: 'an emoji skin-tone modifier', code: 'U+1F3FD' }, column: 19 }] },
    { code: 'const flag = `go 🇩🇪`', errors: [{ messageId: 'sequence', data: { kind: 'a regional-indicator flag', code: 'U+1F1E9' } }, { messageId: 'sequence', data: { kind: 'a regional-indicator flag', code: 'U+1F1EA' } }] },
    { code: vue('<Text title="key 1️⃣" />'), errors: [{ messageId: 'sequence', data: { kind: 'a variation selector', code: 'U+FE0F' } }, { messageId: 'sequence', data: { kind: 'a keycap sequence', code: 'U+20E3' } }] },
    { code: vue('<Text> powerline</Text>'), errors: [{ messageId: 'privateUse', data: { char: '', code: 'U+E0B0' } }] },
    { code: vue('<Text>{{ "𝐁old" }}</Text>'), errors: [{ messageId: 'block', data: { char: '𝐁', code: 'U+1D401', block: 'Mathematical Alphanumeric Symbols' } }] },
    { code: vue('<Text>party 🎉</Text>'), options: [{ allowEmoji: false }], errors: [{ messageId: 'block', data: { char: '🎉', code: 'U+1F389', block: 'Miscellaneous Symbols and Pictographs' } }] },
    { code: vue('<Text>Привет</Text>'), options: [{ allowedBlocks: ['Basic Latin'] }], errors: 6 },
  ],
})
