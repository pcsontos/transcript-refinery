import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../types.js'
import { NotesSchema, diagramSource, notesRecipe, renderNotes, type Notes } from './notes.js'

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

const INPUT = { item: ITEM, transcript: 'A, majd B.', timed: [] }

const JEGYZET: Notes = {
  summary: 'The video explains caching.',
  diagram: 'flowchart LR\n  A[Request] --> B[Cache]',
  concepts: [
    {
      name: 'Cache hit',
      definition: 'Data found in the cache.',
      explanation: 'The request is served from memory.',
      example: 'A CDN returns a stored image.',
      variation: 'What if the entry expired? → It becomes a miss.',
    },
    {
      name: 'Cache miss',
      definition: 'Data not in the cache.',
      explanation: 'The request goes to the origin.',
      example: 'A first visit to a page.',
      variation: 'What if the origin is down? → The request fails.',
    },
    {
      name: 'Eviction',
      definition: 'Removing entries.',
      explanation: 'Old entries make room for new ones.',
      example: 'LRU drops the oldest read.',
      variation: 'What if memory grows? → Fewer evictions.',
    },
  ],
}

describe('NotesSchema', () => {
  it('háromnál kevesebb fogalmat elutasít', () => {
    expect(NotesSchema.safeParse({ ...JEGYZET, concepts: JEGYZET.concepts.slice(0, 2) }).success).toBe(false)
  })

  it('a diagram mező kötelező, de üres lehet — strict sémában nincs opcionális mező', () => {
    expect(NotesSchema.safeParse({ summary: JEGYZET.summary, concepts: JEGYZET.concepts }).success).toBe(false)
    expect(NotesSchema.safeParse({ ...JEGYZET, diagram: '' }).success).toBe(true)
  })

  it('csupa szóköz példát elutasít', () => {
    const rossz = {
      ...JEGYZET,
      concepts: [{ ...JEGYZET.concepts[0]!, example: '   ' }, ...JEGYZET.concepts.slice(1)],
    }
    expect(NotesSchema.safeParse(rossz).success).toBe(false)
  })
})

describe('diagramSource', () => {
  it('a kerítés nélküli forrást változatlanul adja', () => {
    expect(diagramSource('flowchart LR\n  A --> B')).toBe('flowchart LR\n  A --> B')
  })

  it('a ```mermaid kerítést leszedi', () => {
    expect(diagramSource('```mermaid\nflowchart LR\n  A --> B\n```')).toBe('flowchart LR\n  A --> B')
  })

  it('a nyelv nélküli kerítést is leszedi', () => {
    expect(diagramSource('```\nmindmap\n  root\n```')).toBe('mindmap\n  root')
  })

  it('üres vagy csupa szóköz forrásra null', () => {
    expect(diagramSource('')).toBeNull()
    expect(diagramSource('  \n ')).toBeNull()
  })

  it('bent maradt kerítéssorra null: a félbevágott kerítés elrontaná a jegyzetet', () => {
    expect(diagramSource('flowchart LR\n```\nA --> B')).toBeNull()
  })
})

describe('renderNotes', () => {
  it('összefoglaló, diagram, fogalmak példával és variációval, a megadott sorrendben', () => {
    const expected = [
      'The video explains caching.',
      '',
      '## Overview',
      '',
      '```mermaid',
      'flowchart LR',
      '  A[Request] --> B[Cache]',
      '```',
      '',
      '## Key Concepts',
      '',
      '### Cache hit',
      '',
      'The request is served from memory.',
      '',
      '**Example:** A CDN returns a stored image.',
      '',
      '**Variation:** What if the entry expired? → It becomes a miss.',
      '',
      '### Cache miss',
    ].join('\n')
    const rendered = renderNotes(JEGYZET)
    expect(rendered.slice(0, expected.length)).toBe(expected)
  })

  it('a táblázatot a fogalmakból építi, fogalmanként egy sorral', () => {
    const expected = [
      '## Summary Table',
      '',
      '| Term | Definition | Example |',
      '| --- | --- | --- |',
      '| Cache hit | Data found in the cache. | A CDN returns a stored image. |',
      '| Cache miss | Data not in the cache. | A first visit to a page. |',
      '| Eviction | Removing entries. | LRU drops the oldest read. |',
    ].join('\n')
    const rendered = renderNotes(JEGYZET)
    expect(rendered.slice(-expected.length)).toBe(expected)
  })

  it('üres diagramnál az Overview szakasz kimarad', () => {
    const rendered = renderNotes({ ...JEGYZET, diagram: '' })
    expect(rendered).not.toContain('## Overview')
    expect(rendered).not.toContain('```')
    expect(rendered.startsWith('The video explains caching.\n\n## Key Concepts\n\n### Cache hit')).toBe(true)
  })

  it('a cellában a `|` escape-et kap, a sortörés szóközzé olvad', () => {
    const rendered = renderNotes({
      ...JEGYZET,
      concepts: [{ ...JEGYZET.concepts[0]!, definition: 'A | B\nC' }, ...JEGYZET.concepts.slice(1)],
    })
    expect(rendered).toContain('| Cache hit | A \\| B C | A CDN returns a stored image. |')
  })

  it('a magyarázatban lévő fejléc-alakú sort elfedi', () => {
    const rendered = renderNotes({
      ...JEGYZET,
      concepts: [{ ...JEGYZET.concepts[0]!, explanation: 'Első.\n## Fantom' }, ...JEGYZET.concepts.slice(1)],
    })
    expect(rendered).toContain('Első.\n\\## Fantom')
    expect(rendered.match(/^## /gm)).toHaveLength(3)
  })
})

describe('notesRecipe', () => {
  it('a vault névkonvenciójába illő kimeneti fájlt jelöl meg', () => {
    expect(notesRecipe.id).toBe('notes')
    expect(notesRecipe.outputFile).toBe('_notes.md')
  })

  it('publikálható, draft szerepű, javító kör nélküli, sémás recept, címke nélkül', () => {
    expect(notesRecipe.publishable).toBe(true)
    expect(notesRecipe.role).toBe('draft')
    expect(notesRecipe.maxIterations).toBe(0)
    expect(notesRecipe.structured).toBeDefined()
    expect(notesRecipe.tags).toBeUndefined()
  })

  it('a kimeneti aránya a 0,1-es alapértelmezés fölött van', () => {
    expect(notesRecipe.outputRatio).toBeGreaterThan(0.1)
  })

  it('rubrikája négy kritérium, az első kettő blokkoló', () => {
    const nevek = notesRecipe.rubric.criteria.map((c) => c.name)
    expect(nevek).toEqual(['format', 'language', 'pedagogical-faithfulness', 'coverage'])
    expect(notesRecipe.rubric.criteria.slice(0, 2).every((c) => c.blocking === true)).toBe(true)
    expect(notesRecipe.rubric.criteria.slice(2).every((c) => c.blocking === undefined)).toBe(true)
  })

  it('a prompt kéri a kulcsfogalmakat és az üres diagramot, és benne van az átirat', () => {
    const prompt = notesRecipe.prompt(INPUT)
    expect(prompt).toContain('3 to 8 key concepts')
    expect(prompt).toContain('otherwise an empty string')
    expect(prompt).toContain('A, majd B.')
    expect(prompt).toContain('Title: Cím')
  })

  it('a prompt a pedagógiai szabályt idézi, nem a RULE.traceable-t', () => {
    const prompt = notesRecipe.prompt(INPUT)
    expect(prompt).toContain('must never contradict the transcript')
    expect(prompt).not.toContain('Do not add outside')
    expect(prompt).not.toContain('Channel:')
  })

  it('a javító prompt tartalmazza a hiányokat és az előző kimenetet', () => {
    const prompt = notesRecipe.repairPrompt({
      ...INPUT,
      previous: '### Régi fogalom',
      gaps: ['The example of "Cache hit" contradicts the transcript.'],
    })
    expect(prompt).toContain('The example of "Cache hit" contradicts the transcript.')
    expect(prompt).toContain('### Régi fogalom')
  })
})
