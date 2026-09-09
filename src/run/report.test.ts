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
      autoItems: ['eloadas-02'],
      failures: [{ itemId: 'mit-6-042-l14', error: 'olvashatatlan felirat' }],
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

  it('felsorolja az automatikus feliratból készült elemeket', () => {
    const md = renderReport(input())
    expect(md).toContain('eloadas-02')
  })

  it('a hibát az elemmel és az okkal együtt nevezi meg', () => {
    const md = renderReport(input())
    expect(md).toContain('mit-6-042-l14')
    expect(md).toContain('olvashatatlan felirat')
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
              error: 'YAML parse error at line 5\nexpected "key" | got "|"',
            },
          ],
        },
      }),
    )
    // A hiba kijelenik, de az újsorok szóközök lesznek
    expect(md).toContain('YAML parse error at line 5 expected "key"')
    // Az escape pipe megjelenik (escaped as \|) — mind az eredeti szöveg közepéről, mind a végéről
    expect(md).toContain('\\|')
    // A táblázat sor a helyes táblázat formátumban jelenik meg, mind az eredeti | escapeolva van
    expect(md).toContain('| `test-item` | YAML parse error at line 5 expected "key" \\| got "\\|" |')
  })
})
