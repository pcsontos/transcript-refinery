import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { VERSION } from './meta.js'

describe('VERSION', () => {
  it('a package.json verzióját követi', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string
    }
    expect(VERSION).toBe(pkg.version)
  })
})
