import { describe, expect, it } from 'vitest'
import type { ModelClient } from '../model/client.js'
import { checkSkeleton, skeletonCriterionFor, skeletonOf } from './skeleton.js'
import { scoreRubric, type Criterion } from './types.js'

const nemHivhatoKliens: ModelClient = {
  generate: () => Promise.reject(new Error('a kliens nem hívható itt')),
  generateObject: () => Promise.reject(new Error('a kliens nem hívható itt')),
}

const FORRAS = [
  '# Introduction',
  '',
  '[00:01] First paragraph of the talk.',
  '',
  '## Part one',
  '',
  '[00:19] Second paragraph, with a [link](<https://example.com/a>).',
  '',
  '- one',
  '- two',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[Idea] --> B[Problem]',
  '',
  '```',
  '',
  '| Term | Definition |',
  '| --- | --- |',
  '| A | B |',
  '',
  '[01:02:03] Last paragraph after an hour.',
].join('\n')

const FORDITAS = [
  '# Bevezetés',
  '',
  '[00:01] Az előadás első bekezdése.',
  '',
  '## Első rész',
  '',
  '[00:19] Második bekezdés, egy [hivatkozással](<https://example.com/a>).',
  '',
  '- egy',
  '- kettő',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[Ötlet] --> B[Probléma]',
  '',
  '```',
  '',
  '| Fogalom | Meghatározás |',
  '| --- | --- |',
  '| A | B |',
  '',
  '[01:02:03] Utolsó bekezdés egy óra után.',
].join('\n')

/** Hat fejléc, tizenkét blokk: itt már él a tűrés (fejléc 1, bekezdés 1). */
const HOSSZU_FORRAS = [
  '## One',
  '',
  'First paragraph.',
  '',
  '## Two',
  '',
  'Second paragraph.',
  '',
  '## Three',
  '',
  'Third paragraph.',
  '',
  '## Four',
  '',
  'Fourth paragraph.',
  '',
  '## Five',
  '',
  'Fifth paragraph.',
  '',
  '## Six',
  '',
  'Sixth paragraph.',
].join('\n')

/** A fordítás egy részének cseréje; a cserélt szövegnek léteznie kell. */
function valtoztat(from: string, to: string): string {
  expect(FORDITAS).toContain(from)
  return FORDITAS.replace(from, to)
}

describe('skeletonOf', () => {
  it('a vázat a renderelt Markdown elemeiből állítja össze, a kódblokk belsejét kihagyva', () => {
    expect(skeletonOf(FORRAS)).toEqual({
      timestamps: ['[00:01]', '[00:19]', '[01:02:03]'],
      headings: [1, 2],
      blocks: 8,
      listItems: 2,
      tableRows: [2, 2, 2],
      fences: ['mermaid'],
      links: ['https://example.com/a'],
    })
  })

  it('az escape-elt fejlécet és a hashtaget nem veszi fejlécnek', () => {
    expect(skeletonOf('Válasz.\n\n\\## Nem fejléc\n\n#decks').headings).toEqual([])
  })

  it('a sor közepén álló sorszámot nem veszi listaelemnek', () => {
    expect(skeletonOf('Ez az 1. lépés.').listItems).toBe(0)
  })
})

describe('checkSkeleton', () => {
  it('azonos vázú fordítást átenged, a lefordított szöveg és Mermaid-címke nem hiba', () => {
    expect(checkSkeleton(FORDITAS, FORRAS)).toEqual({ value: 1, gaps: [] })
  })

  it('a kimaradt időbélyeges bekezdést megnevezi, az előző időbélyeggel', () => {
    const score = checkSkeleton(
      valtoztat('[00:19] Második bekezdés, egy [hivatkozással](<https://example.com/a>).\n\n', ''),
      FORRAS,
    )
    expect(score.value).toBe(0)
    expect(score.gaps).toContain(
      'The translation has 2 timestamps, the source has 3; the first difference follows [00:01].',
    )
  })

  it('az átírt időbélyeget megnevezi', () => {
    expect(checkSkeleton(valtoztat('[00:19]', '[00:20]'), FORRAS).gaps).toEqual([
      'Timestamp 2 is [00:19] in the source but [00:20] in the translation. Keep every timestamp exactly as it is.',
    ])
  })

  it('a megváltozott fejlécszintet megnevezi', () => {
    expect(checkSkeleton(valtoztat('## Első rész', '### Első rész'), FORRAS).gaps).toEqual([
      'Heading 2 is level 2 in the source but level 3 in the translation.',
    ])
  })

  it('a tűrésen belüli, egy bekezdésnyi eltérést átengedi', () => {
    expect(
      checkSkeleton(
        valtoztat('első bekezdése.\n\n## Első rész', 'első bekezdése.\n## Első rész'),
        FORRAS,
      ),
    ).toEqual({ value: 1, gaps: [] })
  })

  it('a tűrésen kívüli, két bekezdésnyi összevonást megnevezi', () => {
    const osszevont = valtoztat(
      'első bekezdése.\n\n## Első rész\n\n[00:19]',
      'első bekezdése.\n## Első rész\n[00:19]',
    )
    // Az összevonás a második időbélyeget is elnyeli: a bekezdés a [00:01]-es
    // blokk közepére kerül, tehát a kapu két hiányt nevez meg.
    expect(checkSkeleton(osszevont, FORRAS).gaps).toEqual([
      'The translation has 2 timestamps, the source has 3; the first difference follows [00:01].',
      'The translation has 6 paragraphs, the source has 8. Do not merge, split or drop paragraphs.',
    ])
  })

  it('a kimaradt listaelemet megnevezi', () => {
    expect(checkSkeleton(valtoztat('- egy\n- kettő', '- egy és kettő'), FORRAS).gaps).toEqual([
      'The translation has 1 list items, the source has 2. Keep every list item.',
    ])
  })

  it('a táblázatsor eltérő oszlopszámát megnevezi', () => {
    expect(checkSkeleton(valtoztat('| A | B |', '| A B |'), FORRAS).gaps).toEqual([
      'Table row 3 has 2 columns in the source but 1 in the translation.',
    ])
  })

  it('a kódblokk elveszett típusjelölőjét megnevezi', () => {
    expect(checkSkeleton(valtoztat('```mermaid', '```'), FORRAS).gaps).toEqual([
      'Code block 1 is marked `mermaid` in the source but `plain` in the translation.',
    ])
  })

  it('a megváltozott linkcélt megnevezi', () => {
    expect(
      checkSkeleton(valtoztat('https://example.com/a', 'https://example.com/b'), FORRAS).gaps,
    ).toEqual(['A link target changed: <https://example.com/a> is missing from the translation.'])
  })

  it('a hozzáadott linkcélt megnevezi', () => {
    expect(
      checkSkeleton(
        valtoztat('egy óra után.', 'egy óra után, [itt](<https://example.com/c>).'),
        FORRAS,
      ).gaps,
    ).toEqual([
      'The translation adds a link target that is not in the source: <https://example.com/c>.',
    ])
  })

  it('az escape nélkül maradt fejlécet megnevezi', () => {
    expect(checkSkeleton('Válasz.\n\n## Nem fejléc', 'Answer.\n\n\\## Not a heading').gaps).toEqual(
      ['The translation has 1 headings, the source has 0. Keep every heading at its level.'],
    )
  })

  it('a hat fejléces jegyzetben a hetedik fejlécet átengedi', () => {
    expect(checkSkeleton(`${HOSSZU_FORRAS}\n\n## Seven`, HOSSZU_FORRAS)).toEqual({
      value: 1,
      gaps: [],
    })
  })

  it('a hetedik fejlécet megnevezi, ha a fejléc tartalom', () => {
    const score = checkSkeleton(`${HOSSZU_FORRAS}\n\n## Seven`, HOSSZU_FORRAS, {
      headingsAreContent: true,
    })
    expect(score.value).toBe(0)
    expect(score.gaps).toEqual([
      'The translation has 7 headings, the source has 6. Keep every heading at its level.',
    ])
  })

  it('a két kimaradt bekezdést a tűrés nem nyeli el', () => {
    const rovidebb = HOSSZU_FORRAS.replace('\n\nFirst paragraph.', '').replace(
      '\n\nSecond paragraph.',
      '',
    )
    expect(checkSkeleton(rovidebb, HOSSZU_FORRAS).gaps).toEqual([
      'The translation has 10 paragraphs, the source has 12. Do not merge, split or drop paragraphs.',
    ])
  })

  it('öt elem alatt nincs tűrés: a fejléc nélküli forrásban megjelenő fejléc hiba', () => {
    expect(checkSkeleton('Válasz.\n\n## Nem fejléc', 'Answer.\n\nNot a heading').gaps).toEqual([
      'The translation has 1 headings, the source has 0. Keep every heading at its level.',
    ])
  })
})

describe('skeletonCriterionFor', () => {
  it('blokkoló kapu, skeleton néven, a ScoreContext átiratát veszi forrásnak', async () => {
    const criterion = skeletonCriterionFor()
    expect(criterion.blocking).toBe(true)
    expect(criterion.name).toBe('skeleton')
    const score = await criterion.score(
      { transcript: FORRAS, output: FORDITAS },
      nemHivhatoKliens,
    )
    expect(score.value).toBe(1)
  })

  it('a törött vázú kimenet NULLA bíró-hívásba kerül', async () => {
    let futott = false
    const dragaKriterium: Criterion = {
      name: 'draga',
      score: () => {
        futott = true
        return Promise.resolve({ value: 1, gaps: [] })
      },
    }

    const eredmeny = await scoreRubric(
      { criteria: [skeletonCriterionFor(), dragaKriterium], passThreshold: 0.8 },
      { transcript: FORRAS, output: valtoztat('[00:19]', '[00:20]') },
      nemHivhatoKliens,
    )

    expect(futott).toBe(false)
    expect(eredmeny.value).toBe(0)
  })
})
