import { describe, expect, it } from 'vitest'
import { colorSgr, detectColorDepth, parseColor } from '../src/style/colors.js'

describe('detectColorDepth', () => {
  it('follows VURSES_COLOR, FORCE_COLOR, NO_COLOR, TERM=dumb, then terminal hints', () => {
    expect(detectColorDepth({ VURSES_COLOR: 'none', COLORTERM: 'truecolor' })).toBe('none')
    expect(detectColorDepth({ NO_COLOR: '1', COLORTERM: 'truecolor' })).toBe('none')
    expect(detectColorDepth({ NO_COLOR: '1', FORCE_COLOR: '3' })).toBe('truecolor')
    expect(detectColorDepth({ FORCE_COLOR: '0' })).toBe('none')
    expect(detectColorDepth({ FORCE_COLOR: '1' })).toBe(16)
    expect(detectColorDepth({ TERM: 'dumb' })).toBe('none')
    expect(detectColorDepth({ COLORTERM: 'truecolor', TERM: 'xterm-256color' })).toBe('truecolor')
    expect(detectColorDepth({ TERM: 'xterm-256color' })).toBe(256)
    expect(detectColorDepth({ TERM: 'xterm' })).toBe(16)
    expect(detectColorDepth({ TERM: 'linux' })).toBe(16)
    expect(detectColorDepth({})).toBe(256)
  })

  it('emits no color codes at depth none', () => {
    expect(colorSgr(parseColor('#ff0000')!, 'fg', 'none')).toBe('')
    expect(colorSgr(parseColor('red')!, 'bg', 'none')).toBe('')
  })
})
