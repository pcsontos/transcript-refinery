import { describe, expect, it } from 'vitest'
import type { ItemCell, ItemListRow } from './items.js'
import { describeFilters, filterRows, kindCodes } from './list.js'

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
