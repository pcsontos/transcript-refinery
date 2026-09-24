import { describe, expect, it } from 'vitest'
import type { ItemCell, ItemListRow } from './items.js'
import { describeFilters, filterRows, kindCodes, renderItemTable } from './list.js'

const KINDS = ['transcript', 'summary', 'clean', 'clean-hu']

const cell = (overrides: Partial<ItemCell> = {}): ItemCell => ({
  status: 'pending',
  score: null,
  costUsd: null,
  belowThreshold: false,
  ...overrides,
})

/** Egy sor; a meg nem adott típusok cellája „hátra". */
const row = (
  itemId: string,
  overrides: Partial<Omit<ItemListRow, 'cells'>> = {},
  cells: Record<string, Partial<ItemCell>> = {},
): ItemListRow => ({
  itemId,
  title: `Videó ${itemId}`,
  source: 'youtube',
  channel: 'Csatorna A',
  captionSource: 'creator',
  discovered: true,
  updatedAt: null,
  ...overrides,
  cells: Object.fromEntries(KINDS.map((k) => [k, cell(cells[k])])),
})

describe('filterRows', () => {
  const rows = [
    row('a', { channel: 'Csatorna A', source: 'youtube' }, { summary: { status: 'done' } }),
    row('b', { channel: 'Csatorna B', source: 'youtube' }, { clean: { status: 'failed' } }),
    row('c', { channel: null, source: 'meetings' }),
    row('d', { channel: 'csatorna a', source: 'youtube' }, {
      summary: { status: 'done', belowThreshold: true },
    }),
  ]
  const ids = (list: ItemListRow[]) => list.map((r) => r.itemId)

  it('szűrő nélkül minden sort, változatlan sorrendben ad', () => {
    expect(ids(filterRows(rows, {}))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('a forrás és a csatorna kis- és nagybetű nélkül egyezik', () => {
    expect(ids(filterRows(rows, { source: 'MEETINGS' }))).toEqual(['c'])
    expect(ids(filterRows(rows, { channel: 'CSATORNA A' }))).toEqual(['a', 'd'])
  })

  it('csatorna nélküli elemre a csatornaszűrő nem illik', () => {
    expect(ids(filterRows(rows, { channel: 'null' }))).toEqual([])
  })

  it('recepttel az állapot csak arra a típusra vonatkozik; a küszöb alatti is kész', () => {
    expect(ids(filterRows(rows, { recipe: 'summary', status: 'done' }))).toEqual(['a', 'd'])
    expect(ids(filterRows(rows, { recipe: 'summary', status: 'pending' }))).toEqual(['b', 'c'])
  })

  it('recept nélkül az állapot bármely típusra illik', () => {
    expect(ids(filterRows(rows, { status: 'failed' }))).toEqual(['b'])
    expect(ids(filterRows(rows, { status: 'done' }))).toEqual(['a', 'd'])
    expect(ids(filterRows(rows, { status: 'pending' }))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('a limit a szűrés után vág', () => {
    expect(ids(filterRows(rows, { status: 'done', limit: 1 }))).toEqual(['a'])
    expect(ids(filterRows(rows, { limit: 3 }))).toEqual(['a', 'b', 'c'])
  })
})

describe('describeFilters', () => {
  it('szűrő nélkül üres, egyébként a megadott szűrőket sorolja', () => {
    expect(describeFilters({})).toBe('')
    expect(
      describeFilters({ source: 'youtube', channel: 'X', recipe: 'clean', status: 'pending', limit: 5 }),
    ).toBe('forrás: youtube, csatorna: X, típus: clean, állapot: pending, legfeljebb 5')
  })
})

describe('kindCodes', () => {
  it('a valós típusok kódjai', () => {
    expect(
      kindCodes([
        'transcript',
        'summary',
        'flashcards',
        'qa',
        'clean',
        'bloom',
        'notes',
        'clean-hu',
        'summary-hu',
        'notes-hu',
        'bloom-hu',
      ]),
    ).toEqual({
      transcript: 'tra',
      summary: 'sum',
      flashcards: 'fla',
      qa: 'qa',
      clean: 'cle',
      bloom: 'blo',
      notes: 'not',
      'clean-hu': 'cle-hu',
      'summary-hu': 'sum-hu',
      'notes-hu': 'not-hu',
      'bloom-hu': 'blo-hu',
    })
  })

  it('ütközésnél mindkét típus a teljes azonosítót kapja', () => {
    expect(kindCodes(['summary', 'summit', 'clean'])).toEqual({
      summary: 'summary',
      summit: 'summit',
      clean: 'cle',
    })
  })

  it('a -xx utótag csak akkor fordítás, ha az alapja is szerepel', () => {
    expect(kindCodes(['cross-en'])).toEqual({ 'cross-en': 'cro' })
  })
})

describe('renderItemTable', () => {
  it('mátrix: jelek, összköltség, jelmagyarázat, szűrőmegjegyzés', () => {
    const text = renderItemTable(
      [
        row('a', {}, {
          transcript: { status: 'done' },
          summary: { status: 'done', score: 0.9, costUsd: 0.07 },
          clean: { status: 'done', belowThreshold: true, costUsd: 0.2 },
          'clean-hu': { status: 'failed' },
        }),
        row('b'),
      ],
      KINDS,
      { showChannel: false, filterNote: 'csatorna: Csatorna A' },
    )
    expect(text).toBe(
      [
        '2 elem (csatorna: Csatorna A)',
        '',
        '# Cím     tra sum cle cle-hu      $',
        '1 Videó a ✓   ✓   ↓   ✗      0.2700',
        '2 Videó b ·   ·   ·   ·           —',
        '',
        '✓ kész  ↓ küszöb alatt  ✗ hibás  · hátra  † a felirat eltűnt',
        'tra = transcript, sum = summary, cle = clean, cle-hu = clean-hu',
      ].join('\n'),
    )
  })

  it('csatornaoszlop 16 karakterre vágva, null csatorna —, eltűnt felirat †', () => {
    const text = renderItemTable(
      [
        row('a', { channel: 'Egy nagyon hosszú csatornanév' }),
        row('b', { channel: null, discovered: false }),
      ],
      KINDS,
      { showChannel: true, filterNote: '' },
    )
    const lines = text.split('\n')
    expect(lines[0]).toBe('2 elem')
    expect(lines[2]).toBe('# Cím       Csatorna         tra sum cle cle-hu $')
    expect(lines[3]).toBe('1 Videó a   Egy nagyon hoss… ·   ·   ·   ·      —')
    expect(lines[4]).toBe('2 † Videó b —                ·   ·   ·   ·      —')
  })

  it('a cím terminál nélkül 40, terminállal a maradék helyre vágódik, legalább 20-ra', () => {
    const long = row('a', { title: 'x'.repeat(100) })
    const titleOf = (lineWidth?: number) =>
      renderItemTable([long], KINDS, { showChannel: false, filterNote: '', lineWidth })
        .split('\n')[3]!
        .split(' ')[1]!
    expect(titleOf()).toHaveLength(40)
    expect(titleOf()).toMatch(/…$/)
    // A többi oszlop: '#'(1) + tra, sum, cle (3-3) + cle-hu (6) + '$'(1),
    // mindegyik után egy szóköz: 2 + 4·3 + 7 + 2 = 23; plusz egy tartalék.
    expect(titleOf(100)).toHaveLength(76)
    expect(titleOf(30)).toHaveLength(20)
  })

  it('recept nézet: állapot szövegesen, pontszám, költség; † magyarázat csak ha kell', () => {
    const text = renderItemTable(
      [
        row('a', {}, { clean: { status: 'done', score: 0.95, costUsd: 0.19 } }),
        row('b', {}, { clean: { status: 'done', score: 0.71, costUsd: 0.18, belowThreshold: true } }),
        row('c', {}, { clean: { status: 'failed' } }),
        row('d'),
      ],
      KINDS,
      { recipe: 'clean', showChannel: false, filterNote: 'típus: clean' },
    )
    expect(text).toBe(
      [
        '4 elem (típus: clean)',
        '',
        '# Cím     clean  Pont      $',
        '1 Videó a kész   0.95 0.1900',
        '2 Videó b kész ↓ 0.71 0.1800',
        '3 Videó c hibás     —      —',
        '4 Videó d hátra     —      —',
        '',
      ].join('\n'),
    )
    const gone = renderItemTable([row('a', { discovered: false })], KINDS, {
      recipe: 'clean',
      showChannel: false,
      filterNote: '',
    })
    expect(gone.split('\n').at(-1)).toBe('† a felirat eltűnt')
  })
})
