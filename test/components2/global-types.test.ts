import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { components } from '../../src/components/index.js'

describe('GlobalComponents typings', () => {
  it('declare exactly the globally registered components', () => {
    const src = readFileSync(new URL('../../src/components/global-types.ts', import.meta.url), 'utf8')
    const declared = [...src.matchAll(/^ {4}(\w+): typeof import/gm)].map((m) => m[1]).sort()
    expect(declared).toEqual(Object.keys(components).sort())
  })
})
