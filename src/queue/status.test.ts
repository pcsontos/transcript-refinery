import { describe, expect, it } from 'vitest'
import { DEFERRED_STATUS, applyStatuses, doneStatus, failedStatus, pairKey } from './status.js'

describe('doneStatus', () => {
  it('pontszám, négytizedes költség és a notes_dir-hez relatív link', () => {
    expect(
      doneStatus(
        { score: 0.97, costUsd: 0.05123, path: '/v/root/feliratok/csatorna-a/Elso_summary.md' },
        '/v/root',
      ),
    ).toBe('✓ 0.97 · $0.0512 · [jegyzet](<feliratok/csatorna-a/Elso_summary.md>)')
  })

  it('útvonal nélküli receptnél a link elmarad', () => {
    expect(doneStatus({ score: 1, costUsd: 0.1, path: null }, '/v/root')).toBe('✓ 1.00 · $0.1000')
  })
})

describe('failedStatus', () => {
  it('az első sort adja, zárójelek és %%-horgony nélkül', () => {
    expect(failedStatus('wikilink tiltott: [[x]] %%id%%\nmásodik sor')).toBe(
      '✗ wikilink tiltott: x id',
    )
  })

  it('legfeljebb 120 karakter, … végződéssel', () => {
    expect(failedStatus('a'.repeat(300))).toBe(`✗ ${'a'.repeat(119)}…`)
  })

  it('üres vagy hiányzó hibára ismeretlen hibát ír', () => {
    expect(failedStatus(null)).toBe('✗ ismeretlen hiba')
    expect(failedStatus('  \n')).toBe('✗ ismeretlen hiba')
  })
})

const SOR = [
  '## feliratok/csatorna-a',
  '- Első példavideó %%abcDEF12345%%',
  '  - [x] summary — ✗ régi hiba',
  '  - [x] qa',
  'Saját megjegyzés.',
  '- Második példavideó %%0123456789abcdef%%',
  '  - [x] summary',
  '- Első példavideó újra %%abcDEF12345%%',
  '  - [x] summary',
  '',
].join('\n')

describe('applyStatuses', () => {
  it('csak a megadott párok utótagját cseréli; minden más sor bájtra azonos', () => {
    const statuses = new Map([
      [pairKey('0123456789abcdef', 'summary'), DEFERRED_STATUS],
      [pairKey('abcDEF12345', 'summary'), '✓ 1.00 · $0.0100'],
    ])

    expect(applyStatuses(SOR, statuses)).toBe(
      [
        '## feliratok/csatorna-a',
        '- Első példavideó %%abcDEF12345%%',
        '  - [x] summary — ✓ 1.00 · $0.0100',
        '  - [x] qa',
        'Saját megjegyzés.',
        '- Második példavideó %%0123456789abcdef%%',
        `  - [x] summary — ${DEFERRED_STATUS}`,
        '- Első példavideó újra %%abcDEF12345%%',
        '  - [x] summary',
        '',
      ].join('\n'),
    )
  })

  it('azonosító szerint talál: ugyanaz a recept egy másik videónál érintetlen marad', () => {
    const statuses = new Map([[pairKey('0123456789abcdef', 'summary'), '✓ 0.90 · $0.0200']])

    const out = applyStatuses(SOR, statuses).split('\n')

    expect(out[2]).toBe('  - [x] summary — ✗ régi hiba')
    expect(out[6]).toBe('  - [x] summary — ✓ 0.90 · $0.0200')
  })

  it('üres állapotlistára a szöveg bájtra azonos', () => {
    expect(applyStatuses(SOR, new Map())).toBe(SOR)
  })

  it('linkszabályt sértő állapotot nem ír ki', () => {
    const statuses = new Map([[pairKey('abcDEF12345', 'qa'), '✓ [[x]]']])
    expect(() => applyStatuses(SOR, statuses)).toThrow(/vault írási szabályait/)
  })
})
