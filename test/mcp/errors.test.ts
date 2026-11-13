import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { ERRORS, VursesError, errorDocsUrl, fail, formatError, isVursesError, listErrors, vursesError, vursesWarn } from '../../src/errors.js'

describe('error codes', () => {
  it('builds coded errors with docs links', () => {
    const e = vursesError('VC001', { name: 'useApp' })
    expect(e).toBeInstanceOf(VursesError)
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('VC001')
    expect(e.docsUrl).toBe('https://github.com/marcuspuchalla/vurses/blob/HEAD/docs/errors.md#vc001')
    expect(e.message).toMatch(/^\[VC001\] useApp\(\) was called outside a vurses app/)
    expect(e.message).toContain('\n  → https://')
    expect(e.reason).toMatch(/^useApp\(\) was called/)
    expect(e.toJSON()).toMatchObject({ code: 'VC001', params: { name: 'useApp' } })
  })

  it('keeps the cause and supports custom messages', () => {
    const cause = new Error('inner')
    const e = vursesError('VC030', { file: 'App.vue', reason: 'bad' }, { cause })
    expect(e.cause).toBe(cause)
    expect(e.reason).toBe('App.vue: bad')
    expect(new VursesError('VC060', 'custom').reason).toBe('custom')
    expect(() => fail('VC060', { path: '/x' })).toThrow(/No route matches "\/x"/)
  })

  it('type-guards and formats', () => {
    const e = vursesError('VC060', { path: '/x' })
    expect(isVursesError(e)).toBe(true)
    expect(isVursesError(e, 'VC060')).toBe(true)
    expect(isVursesError(e, 'VC061')).toBe(false)
    expect(isVursesError(new Error('x'))).toBe(false)
    expect(isVursesError(null)).toBe(false)
    expect(formatError(e)).toBe('VC060: No route matches "/x".\n  → ' + errorDocsUrl('VC060'))
    expect(formatError(new TypeError('t'))).toBe('TypeError: t')
    expect(formatError('s')).toBe('s')
  })

  it('warns once per message', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vursesWarn('VC043', { name: 'foo-bar' })
    vursesWarn('VC043', { name: 'foo-bar' })
    vursesWarn('VC043', { name: 'other' })
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0][0]).toMatch(/^\[vurses VC043\] Unknown utility class "foo-bar"/)
    warn.mockRestore()
  })

  it('every code has a message for empty params and a docs section', () => {
    const docs = readFileSync(new URL('../../docs/errors.md', import.meta.url), 'utf8')
    for (const { code } of listErrors()) {
      expect(code).toMatch(/^VC\d{3}$/)
      expect(ERRORS[code].message({})).toBeTruthy()
      expect(docs).toContain(`<a id="${code.toLowerCase()}"></a>`)
      expect(docs).toMatch(new RegExp(`## ${code} `))
    }
  })
})
