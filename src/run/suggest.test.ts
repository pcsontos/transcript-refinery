import { describe, expect, it } from 'vitest'
import { nextCommand, suggestionBase } from './suggest.js'

describe('suggestionBase', () => {
  it('a --limit kapcsolót az értékével együtt kivágja', () => {
    // Egy `--limit 5` futás után a szó szerinti hívási sor olyan parancsot
    // ajánlana, ami megint csak ötöt vinne el a hátralévőkből.
    expect(suggestionBase('run --recipe summary --limit 5')).toBe('run --recipe summary')
  })

  it('a --limit=<N> alakot is kivágja', () => {
    expect(suggestionBase('run --limit=12 --recipe summary')).toBe('run --recipe summary')
  })

  it('a --retry-failed kapcsolót kivágja', () => {
    expect(suggestionBase('run --retry-failed --source youtube')).toBe('run --source youtube')
  })

  it('a többi kapcsolót érintetlenül hagyja', () => {
    const sor = 'run --recipe summary --source youtube --channel Csatorna --no-commit'
    expect(suggestionBase(sor)).toBe(sor)
  })

  it('nem tesz bináris-előtagot a javaslat elé', () => {
    // A repó három hívási módot ismer, és a riport `Parancs:` sora is
    // előtag nélküli — a kettő egy alakú marad.
    expect(suggestionBase('run')).toBe('run')
  })
})

describe('nextCommand', () => {
  it('hátralévő elemhez a javaslat-alapot ajánlja', () => {
    expect(nextCommand('run --recipe summary --limit 5', { pending: 3, failed: 0 })).toBe(
      'run --recipe summary',
    )
  })

  it('hátralévő elem nélkül, de hibással a --retry-failed-et ajánlja', () => {
    // Ez a reggel-utáni eset, amiért a --retry-failed egyáltalán elkészült.
    expect(nextCommand('run --recipe summary --limit 5', { pending: 0, failed: 2 })).toBe(
      'run --recipe summary --retry-failed',
    )
  })

  it('a hátralévő elem erősebb a hibásnál, és a kapcsoló nem duplázódik', () => {
    expect(nextCommand('run --retry-failed --limit 1', { pending: 2, failed: 1 })).toBe('run')
  })

  it('tiszta korpuszra nincs javaslat', () => {
    expect(nextCommand('run', { pending: 0, failed: 0 })).toBeUndefined()
  })
})
