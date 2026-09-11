import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import {
  FlashcardsSchema,
  checkFlashcards,
  flashcardsRecipe,
  renderCards,
} from './flashcards.js'

const ITEM: SourceItem = {
  itemId: 'abc123',
  source: 'youtube',
  sourceFile: 'Csatorna/Cím.en.srt',
  subtitlePath: '/nem/szamit.srt',
  baseName: 'Cím',
  title: 'Cím',
  language: 'en',
  metadata: { videoId: 'abc123', channel: 'Csatorna' },
}

const HAROM = {
  cards: [
    { question: 'Mi az A?', answer: 'Az A egy dolog.' },
    { question: 'Mi a B?', answer: 'A B egy másik dolog.' },
    { question: 'Mi a C?', answer: 'A C a harmadik.' },
  ],
}

describe('FlashcardsSchema', () => {
  it('háromnál kevesebb kártyát elutasít', () => {
    expect(FlashcardsSchema.safeParse({ cards: HAROM.cards.slice(0, 2) }).success).toBe(false)
  })

  it('csupa szóköz oldalt elutasít', () => {
    const rossz = { cards: [...HAROM.cards.slice(1), { question: '   ', answer: 'x' }] }
    expect(FlashcardsSchema.safeParse(rossz).success).toBe(false)
  })

  it('érvényes kártyakészletet elfogad, és levágja a széli szóközöket', () => {
    const parsed = FlashcardsSchema.parse({
      cards: [...HAROM.cards.slice(1), { question: '  Mi a D?  ', answer: '  A D.  ' }],
    })
    expect(parsed.cards[2]).toEqual({ question: 'Mi a D?', answer: 'A D.' })
  })
})

describe('renderCards', () => {
  it('kártyánként `##` fejlécet és alatta bekezdést ad', () => {
    expect(renderCards(HAROM)).toBe(
      '## Mi az A?\n\nAz A egy dolog.\n\n## Mi a B?\n\nA B egy másik dolog.\n\n## Mi a C?\n\nA C a harmadik.',
    )
  })

  it('a kérdésbe került sortörést egyetlen sorrá normalizálja', () => {
    const rendered = renderCards({
      cards: [{ question: 'Mi az\nA fogalom?', answer: 'Ez.' }, ...HAROM.cards.slice(1)],
    })
    expect(rendered).toContain('## Mi az A fogalom?')
    expect(rendered).not.toContain('## Mi az\n')
  })

  it('a válaszban lévő `##` sort elfedi, hogy ne csináljon fantomkártyát', () => {
    const rendered = renderCards({
      cards: [
        { question: 'Mi az A?', answer: '## Nem fejléc\nHanem válasz.' },
        ...HAROM.cards.slice(1),
      ],
    })
    expect(rendered).toContain('\\## Nem fejléc')
    expect(rendered.match(/^## /gm)).toHaveLength(3)
  })

  // A Markdown három szóköz behúzásig fejlécnek olvassa az ATX sort, a
  // `---` aláhúzás pedig a fölötte álló sorból csinál H2-t. Escape nélkül
  // mindkettő fantomkártya a Decksben, miközben a séma három kártyát adott.
  it('a behúzott `##` sort is elfedi', () => {
    const rendered = renderCards({
      cards: [
        { question: 'Mi az A?', answer: 'Bevezető.\n\n  ## Fantom\n\n  Törzs.' },
        ...HAROM.cards.slice(1),
      ],
    })
    expect(rendered).toContain('  \\## Fantom')
    expect(rendered.match(/^ {0,3}## /gm)).toHaveLength(3)
  })

  it('a setext aláhúzást elfedi, a listaelemet viszont békén hagyja', () => {
    const rendered = renderCards({
      cards: [
        { question: 'Mi az A?', answer: 'Fantom cím\n---\nszöveg\n\n- listaelem\n- másik' },
        ...HAROM.cards.slice(1),
      ],
    })
    expect(rendered).toContain('Fantom cím\n\\---\nszöveg')
    expect(rendered).toContain('- listaelem\n- másik')
  })

  it('a szövegsor nélkül álló `---`-t nem escape-eli: az nem fejléc', () => {
    const rendered = renderCards({
      cards: [{ question: 'Mi az A?', answer: 'Első.\n\n---\n\nMásodik.' }, ...HAROM.cards.slice(1)],
    })
    expect(rendered).toContain('Első.\n\n---\n\nMásodik.')
  })
})

describe('checkFlashcards', () => {
  it('szabályos kártyakészletre 1-et ad, hiányok nélkül', () => {
    expect(checkFlashcards(renderCards(HAROM))).toEqual({ value: 1, gaps: [] })
  })

  it('ismétlődő kérdésre gap-et ad, és megnevezi a kérdést', () => {
    const ismetlodo = {
      cards: [HAROM.cards[0]!, HAROM.cards[1]!, { question: 'mi az a?', answer: 'Megint.' }],
    }
    const score = checkFlashcards(renderCards(ismetlodo))
    expect(score.value).toBe(0)
    expect(score.gaps.join(' ')).toMatch(/Mi az A\?/i)
  })

  it('háromnál kevesebb kártyára gap-et ad', () => {
    const score = checkFlashcards('## Egyetlen kérdés?\n\nEgyetlen válasz.')
    expect(score.value).toBe(0)
    expect(score.gaps.join(' ')).toMatch(/at least three/i)
  })

  it('üres törzsű kártyára gap-et ad', () => {
    const score = checkFlashcards('## A?\n\n## B?\n\nVálasz B.\n\n## C?\n\nVálasz C.')
    expect(score.value).toBe(0)
    expect(score.gaps.join(' ')).toMatch(/without an answer/i)
  })

  it('a behúzott `##` fejlécet is kártyakezdetnek veszi, ahogy Obsidian', () => {
    // Ha nem venné annak, egy kártyát látna, és „has 1 card"-ot írna.
    const score = checkFlashcards('  ## A?\n\nVálasz A.\n\n## B?\n\nVálasz B.')
    expect(score.gaps.join(' ')).toMatch(/has 2 card/i)
  })

  it('a gap-üzenetek angolul szólnak, mert visszamennek a modellnek', () => {
    const score = checkFlashcards('## Csak egy?\n\nVálasz.')
    expect(score.gaps.join(' ')).not.toMatch(/[áéíóöőúüű]/i)
  })
})

describe('flashcardsRecipe', () => {
  it('a vault névkonvenciójába illő kimeneti fájlt jelöl meg', () => {
    expect(flashcardsRecipe.id).toBe('flashcards')
    expect(flashcardsRecipe.outputFile).toBe('_flashcards.md')
  })

  it('publikálható, a draft szerepet kéri, és nem enged javító kört — a mérés (2026-09-09) szerint nem térül meg', () => {
    expect(flashcardsRecipe.publishable).toBe(true)
    expect(flashcardsRecipe.role).toBe('draft')
    expect(flashcardsRecipe.maxIterations).toBe(0)
  })

  it('sémával kikényszerített kimenetet kér', () => {
    expect(flashcardsRecipe.structured).toBeDefined()
  })

  it('rubrikája öt kritériumból áll, az első három blokkoló', () => {
    const nevek = flashcardsRecipe.rubric.criteria.map((c) => c.name)
    expect(nevek).toEqual(['format', 'flashcards-format', 'language', 'faithfulness', 'coverage'])
    expect(flashcardsRecipe.rubric.criteria[0]!.blocking).toBe(true)
    expect(flashcardsRecipe.rubric.criteria[1]!.blocking).toBe(true)
    expect(flashcardsRecipe.rubric.criteria[2]!.blocking).toBe(true)
  })

  it('a promptba bekerül az átirat és a cím', () => {
    const prompt = flashcardsRecipe.prompt({ item: ITEM, transcript: 'A, majd B.' })
    expect(prompt).toContain('A, majd B.')
    expect(prompt).toContain('Cím')
  })

  it('a prompt SOHA nem tartalmaz Channel: sort, metaadattal sem', () => {
    // Ez a hiba magja: a `Channel:` sorból a modell a beszélő nevére, abból
    // pedig kimeneti nyelvre következtetett. Kontrollált A/B igazolta, hogy
    // a sor eltávolítása megszünteti a sodródást (`0009`).
    const prompt = flashcardsRecipe.prompt({ item: ITEM, transcript: 'A, majd B.' })
    expect(prompt).toContain('Title: Cím')
    expect(prompt).not.toContain('Channel:')
    expect(prompt).not.toContain('Csatorna')

    const repairPrompt = flashcardsRecipe.repairPrompt({
      item: ITEM,
      transcript: 'A, majd B.',
      previous: 'placeholder',
      gaps: ['placeholder'],
    })
    expect(repairPrompt).toContain('Title: Cím')
    expect(repairPrompt).not.toContain('Channel:')
    expect(repairPrompt).not.toContain('Csatorna')
  })

  it('a javító prompt tartalmazza a hiányokat és az előző kimenetet', () => {
    const prompt = flashcardsRecipe.repairPrompt({
      item: ITEM,
      transcript: 'A, majd B.',
      previous: '## Régi kérdés?\n\nRégi válasz.',
      gaps: ['Two cards ask the same question'],
    })
    expect(prompt).toContain('Two cards ask the same question')
    expect(prompt).toContain('## Régi kérdés?')
    expect(prompt).toMatch(/do not\s*\n?rewrite the whole set/i)
  })
})
