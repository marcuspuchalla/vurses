import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { ERRORS, VuecliError, errorDocsUrl, fail, formatError, isVuecliError, listErrors, vuecliError, vuecliWarn } from '../../src/errors.js'

describe('error codes', () => {
  it('builds coded errors with docs links', () => {
    const e = vuecliError('VC001', { name: 'useApp' })
    expect(e).toBeInstanceOf(VuecliError)
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('VC001')
    expect(e.docsUrl).toBe('https://github.com/marcuspuchalla/vuecli/blob/HEAD/docs/errors.md#vc001')
    expect(e.message).toMatch(/^\[VC001\] useApp\(\) was called outside a vuecli app/)
    expect(e.message).toContain('\n  → https://')
    expect(e.reason).toMatch(/^useApp\(\) was called/)
    expect(e.toJSON()).toMatchObject({ code: 'VC001', params: { name: 'useApp' } })
  })

  it('keeps the cause and supports custom messages', () => {
    const cause = new Error('inner')
    const e = vuecliError('VC030', { file: 'App.vue', reason: 'bad' }, { cause })
    expect(e.cause).toBe(cause)
    expect(e.reason).toBe('App.vue: bad')
    expect(new VuecliError('VC060', 'custom').reason).toBe('custom')
    expect(() => fail('VC060', { path: '/x' })).toThrow(/No route matches "\/x"/)
  })

  it('type-guards and formats', () => {
    const e = vuecliError('VC060', { path: '/x' })
    expect(isVuecliError(e)).toBe(true)
    expect(isVuecliError(e, 'VC060')).toBe(true)
    expect(isVuecliError(e, 'VC061')).toBe(false)
    expect(isVuecliError(new Error('x'))).toBe(false)
    expect(isVuecliError(null)).toBe(false)
    expect(formatError(e)).toBe('VC060: No route matches "/x".\n  → ' + errorDocsUrl('VC060'))
    expect(formatError(new TypeError('t'))).toBe('TypeError: t')
    expect(formatError('s')).toBe('s')
  })

  it('warns once per message', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vuecliWarn('VC043', { name: 'foo-bar' })
    vuecliWarn('VC043', { name: 'foo-bar' })
    vuecliWarn('VC043', { name: 'other' })
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0][0]).toMatch(/^\[vuecli VC043\] Unknown utility class "foo-bar"/)
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
