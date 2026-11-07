import { defineComponent, h } from 'vue'

/**
 * A 5-pixel-high bitmap font rendered with half-block characters, so each
 * glyph is 3 terminal rows tall.
 */
const FONT: Record<string, string> = {
  '0': '### #.# #.# #.# ###',
  '1': '.#. ##. .#. .#. ###',
  '2': '### ..# ### #.. ###',
  '3': '### ..# .## ..# ###',
  '4': '#.# #.# ### ..# ..#',
  '5': '### #.. ### ..# ###',
  '6': '### #.. ### #.# ###',
  '7': '### ..# ..# .#. .#.',
  '8': '### #.# ### #.# ###',
  '9': '### #.# ### ..# ###',
  A: '.#. #.# ### #.# #.#',
  B: '##. #.# ##. #.# ##.',
  C: '.## #.. #.. #.. .##',
  D: '##. #.# #.# #.# ##.',
  E: '### #.. ##. #.. ###',
  F: '### #.. ##. #.. #..',
  G: '.## #.. #.# #.# .##',
  H: '#.# #.# ### #.# #.#',
  I: '### .#. .#. .#. ###',
  J: '..# ..# ..# #.# .#.',
  K: '#.# #.# ##. #.# #.#',
  L: '#.. #.. #.. #.. ###',
  M: '#...# ##.## #.#.# #...# #...#',
  N: '#..# ##.# #.## #..# #..#',
  O: '.#. #.# #.# #.# .#.',
  P: '##. #.# ##. #.. #..',
  Q: '.#. #.# #.# ##. .##',
  R: '##. #.# ##. #.# #.#',
  S: '.## #.. .#. ..# ##.',
  T: '### .#. .#. .#. .#.',
  U: '#.# #.# #.# #.# ###',
  V: '#.# #.# #.# #.# .#.',
  W: '#...# #...# #.#.# ##.## #...#',
  X: '#.# #.# .#. #.# #.#',
  Y: '#.# #.# .#. .#. .#.',
  Z: '### ..# .#. #.. ###',
  ' ': '.. .. .. .. ..',
  '!': '# # # . #',
  '.': '. . . . #',
  ',': '. . . # #',
  ':': '. # . # .',
  '-': '... ... ### ... ...',
  '+': '... .#. ### .#. ...',
  '?': '### ..# .## ... .#.',
  '/': '..# ..# .#. #.. #..',
  '=': '... ### ... ### ...',
  '_': '... ... ... ... ###',
  "'": '# # . . .',
  '#': '#.#.# ##### #.#.# ##### #.#.#',
  '<': '..# .#. #.. .#. ..#',
  '>': '#.. .#. ..# .#. #..',
  '(': '.# #. #. #. .#',
  ')': '#. .# .# .# #.',
  '*': '... #.# .#. #.# ...',
  '▼': '##### ##### .###. .###. ..#..',
}

const ROWS = 5

function glyph(ch: string): string[] {
  const def = FONT[ch] ?? FONT[ch.toUpperCase()] ?? FONT['?']
  return def.split(' ')
}

/** Renders text in the big font, returning 3 text lines. */
export function renderBigText(text: string, letterSpacing = 1): string[] {
  const glyphs = Array.from(text).map(glyph)
  const lines: string[] = []
  for (let r = 0; r < ROWS; r += 2) {
    let line = ''
    glyphs.forEach((g, gi) => {
      const w = g[0].length
      for (let x = 0; x < w; x++) {
        const top = g[r]?.[x] === '#'
        const bottom = r + 1 < ROWS && g[r + 1]?.[x] === '#'
        line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' '
      }
      if (gi < glyphs.length - 1) line += ' '.repeat(letterSpacing)
    })
    lines.push(line)
  }
  return lines
}

/** `<BigText text="VUE CLI" color="primary" />` — large ASCII-art banner text. */
export const BigText = defineComponent({
  name: 'BigText',
  props: {
    text: { type: String, required: true },
    color: { type: String, default: 'primary' },
    letterSpacing: { type: Number, default: 1 },
    /** Optional gradient end color (start is `color`). */
    gradient: String,
  },
  setup(props) {
    return () => {
      const lines = renderBigText(props.text, props.letterSpacing)
      return h(
        'tui-box',
        { flexDirection: 'column', flexShrink: 0 },
        lines.map((l, i) => h('tui-text', { key: i, wrap: 'none', color: props.gradient && i > 0 ? (i === 1 ? props.color : props.gradient) : props.color }, l)),
      )
    }
  },
})
