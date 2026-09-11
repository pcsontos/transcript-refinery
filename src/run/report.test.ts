import { describe, expect, it } from 'vitest'
import { renderReport, type ReportInput } from './report.js'

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    runId: '2026-09-07T02-14-03',
    startedAt: new Date('2026-09-07T02:14:03Z'),
    finishedAt: new Date('2026-09-07T06:41:00Z'),
    command: 'run --recipe summary',
    summary: {
      succeeded: 2,
      skipped: 1,
      failed: 1,
      byCaptionSource: { creator: 1, auto: 1 },
      autoItems: [{ itemId: 'eloadas-02', title: 'Második előadás' }],
      failures: [
        { itemId: 'mit-6-042-l14', source: 'youtube', kind: 'summary', error: 'olvashatatlan felirat' },
      ],
    },
    corpus: {
      bySource: [
        { source: 'meetings', total: 1, done: 1, failed: 0, pending: 0 },
        { source: 'youtube', total: 4, done: 2, failed: 1, pending: 1 },
      ],
      byCaptionSource: { creator: 3, auto: 2 },
      done: 3,
      failed: 1,
      pending: 1,
      totalCostUsd: 11.9,
    },
    runs: 3,
    logPath: '/p/logs/2026-09-07T02-14-03.jsonl',
    ...overrides,
  }
}

describe('renderReport', () => {
  it('a futás bontását a felirat-forrás szerint írja ki', () => {
    const md = renderReport(input())
    expect(md).toContain('kreátori 1 / automatikus 1')
    expect(md).toContain('| sikeres | 2 (kreátori 1 / automatikus 1) |')
  })

  it('a futásazonosítót a fejlécben jeleníti meg', () => {
    const md = renderReport(input())
    expect(md).toContain('Futásazonosító: `2026-09-07T02-14-03`')
  })

  it('az automatikus elemeket névvel és azonosítóval sorolja fel', () => {
    const md = renderReport(input())
    // A 2. sikerkritérium a NEVET kéri; az azonosító mellette marad, hogy a
    // naplóval és az állapottárral is összeköthető legyen.
    expect(md).toContain('- Második előadás (`eloadas-02`)')
  })

  it('a több soros címet egy sorba fésüli a felsorolásban', () => {
    const md = renderReport(
      input({
        summary: {
          ...input().summary,
          autoItems: [{ itemId: 'x', title: 'Első sor\nMásodik sor' }],
        },
      }),
    )
    expect(md).toContain('- Első sor Második sor (`x`)')
  })

  it('a hibát az elemmel, a típussal, a forrásmappával és az okkal együtt nevezi meg', () => {
    const md = renderReport(input())
    expect(md).toContain('| elem | típus | forrás | ok |')
    expect(md).toContain('| `mit-6-042-l14` | summary | youtube | olvashatatlan felirat |')
  })

  it('forrásonként kiírja a korpusz állapotát', () => {
    const md = renderReport(input())
    expect(md).toContain('| youtube | 4 | 2 | 1 | 1 |')
    expect(md).toContain('| meetings | 1 | 1 | 0 | 0 |')
  })

  it('a hátralévő elemekhez folytató parancsot ajánl', () => {
    const md = renderReport(input({ nextCommand: 'refinery run --recipe summary' }))
    expect(md).toContain('1 elem hátravan')
    expect(md).toContain('refinery run --recipe summary')
  })

  it('hátralévő elem nélkül nem ajánl folytatást', () => {
    const md = renderReport(
      input({
        corpus: { ...input().corpus, pending: 0, done: 4 },
        nextCommand: undefined,
      }),
    )
    expect(md).toContain('A korpusz feldolgozva')
    expect(md).not.toContain('Folytatás:')
  })

  it('tiszta korpusznál nem említi a hibás elemeket', () => {
    const md = renderReport(
      input({
        corpus: { ...input().corpus, pending: 0, done: 4, failed: 0 },
        nextCommand: undefined,
      }),
    )
    expect(md).toContain('A korpusz feldolgozva.')
    expect(md).not.toContain('maradtak hibás elemek')
  })

  it('a plafon elérését kiírja a fejlécben', () => {
    const md = renderReport(input({ cost: { spentUsd: 4.87, limitUsd: 5, capped: true } }))
    expect(md).toContain('4.87 $ / 5.00 $')
    expect(md).toContain('plafon elérve')
  })

  it('modell nélküli futásból kimarad a költségsor', () => {
    const md = renderReport(input({ cost: undefined }))
    expect(md).not.toContain('Költés')
  })

  it('hiba nélküli futásból kimarad a hibaszakasz', () => {
    const md = renderReport(
      input({ summary: { ...input().summary, failed: 0, failures: [] } }),
    )
    expect(md).not.toContain('## Hibák')
  })

  it('automatikus feliratú elem nélkül nem ír üres felsorolást', () => {
    const md = renderReport(
      input({
        summary: { ...input().summary, autoItems: [], byCaptionSource: { creator: 2, auto: 0 } },
      }),
    )
    expect(md).not.toContain('Automatikus feliratból készült')
  })

  it('a hibaszöveg újsorait és pipe-jait biztonságossá teszi a táblázatban', () => {
    const md = renderReport(
      input({
        summary: {
          ...input().summary,
          failures: [
            {
              itemId: 'test-item',
              source: 'furcsa | forrás',
              kind: 'summary',
              error: 'YAML parse error at line 5\nexpected "key" | got "|"',
            },
          ],
        },
      }),
    )
    // A hiba megjelenik, de az újsorok helyén szóköz áll.
    expect(md).toContain('YAML parse error at line 5 expected "key"')
    // A pipe escapelve kerül a cellába, így nem tör el a táblázat.
    expect(md).toContain('\\|')
    // A teljes sor: a forrás és az ok oszlopa is átment az escapelésen.
    expect(md).toContain(
      '| `test-item` | summary | furcsa \\| forrás | YAML parse error at line 5 expected "key" \\| got "\\|" |',
    )
  })
})
