import { evalite } from 'evalite'
import { dedupeTimedLines } from '../src/normalize/dedupe.js'
import { notesRecipe } from '../src/recipe/notes.js'
import { refine } from '../src/refine/loop.js'
import { parseSubtitle } from '../src/subtitle/parse.js'
import type { SourceItem } from '../src/types.js'
import { fixtureClient } from './fixture-model.js'
import { PUBLIC_FIXTURES, type Fixture } from './fixtures/transcripts.js'
import { loadPrivateFixtures } from './private-layer.js'

function itemOf(fixture: Fixture): SourceItem {
  return {
    itemId: fixture.id,
    source: 'fixtures',
    sourceFile: `${fixture.id}.srt`,
    subtitlePath: `${fixture.id}.srt`,
    baseName: fixture.id,
    title: fixture.title,
    language: 'en',
    metadata: {
      videoId: fixture.id,
      channel: fixture.channel,
      uploadedAt: '2026-01-01',
      url: `https://example.com/${fixture.id}`,
    },
  }
}

/**
 * Szerkezeti pontszám: minden `###` fogalom alatt ott a példa és a variáció,
 * és a táblázat sorainak száma megegyezik a fogalmakéval.
 */
function structure(output: string): number {
  const sections = output.split(/^### /m).slice(1)
  const rows = output
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| Term') && !line.startsWith('| ---'))
  const complete = sections.every((s) => s.includes('**Example:**') && s.includes('**Variation:**'))
  return sections.length > 0 && complete && rows.length === sections.length ? 1 : 0
}

evalite('notes recept — teljes loop fixture-modellen', {
  data: () =>
    [...PUBLIC_FIXTURES, ...loadPrivateFixtures()].map((fixture) => ({
      input: fixture,
    })),

  task: async (fixture) => {
    const timed = dedupeTimedLines(parseSubtitle(fixture.srt, `${fixture.id}.srt`))
    const lines = timed.map((line) => line.text)
    const transcript = lines.join(' ')
    const pick = (i: number): string => lines[i % Math.max(lines.length, 1)] ?? transcript

    // A jegyzetet a fixture SAJÁT soraiból rakjuk össze: a teljes út — séma,
    // renderer, kapuk, két bíró — valódi kódon fut, kézzel írt JSON nélkül.
    const notes = {
      summary: pick(0),
      diagram: 'flowchart LR\n  A[Start] --> B[End]',
      concepts: [0, 1, 2].map((n) => ({
        name: `Point ${String(n + 1)}`,
        definition: pick(n),
        explanation: pick(n + 1),
        example: `For example: ${pick(n + 2)}`,
        variation: 'What if this point were left out? → The note would miss it.',
      })),
    }

    const result = await refine(
      notesRecipe,
      { item: itemOf(fixture), transcript, timed },
      fixtureClient(fixture, {
        notes: [JSON.stringify(notes)],
        verdicts: [
          { score: 0.9, gaps: [] },
          { score: 0.9, gaps: [] },
        ],
      }),
    )

    return { output: result.output, score: result.score }
  },

  scorers: [
    {
      name: 'szerkezet',
      description: 'Determinisztikus: fogalmanként példa és variáció, a táblázat a fogalmakból.',
      scorer: ({ output }) => structure(output.output),
    },
    {
      name: 'rubrika-pontszam',
      description: 'A loop által elért rubrika-pontszám.',
      scorer: ({ output }) => output.score,
    },
  ],

  columns: ({ output }) => [{ label: 'Pontszám', value: output.score }],
})
