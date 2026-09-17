import { evalite } from 'evalite'
import { dedupeTimedLines } from '../src/normalize/dedupe.js'
import { BLOOM_LEVELS, bloomRecipe, checkBloom } from '../src/recipe/bloom.js'
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

evalite('bloom recept — teljes loop fixture-modellen', {
  data: () =>
    [...PUBLIC_FIXTURES, ...loadPrivateFixtures()].map((fixture) => ({
      input: fixture,
    })),

  task: async (fixture) => {
    const timed = dedupeTimedLines(parseSubtitle(fixture.srt, `${fixture.id}.srt`))
    const lines = timed.map((line) => line.text)
    const transcript = lines.join(' ')

    // A paklit a fixture SAJÁT soraiból rakjuk össze, szintenként hármat: így a
    // blokkoló kapuk konstrukció szerint átmennek, és a teljes út — séma,
    // renderer, kapu, két bíró — valódi kódon fut, kézzel írt JSON nélkül.
    const deck = {
      cards: BLOOM_LEVELS.flatMap((level, l) =>
        [0, 1, 2].map((n) => {
          const line = lines[(l * 3 + n) % Math.max(lines.length, 1)] ?? transcript
          return {
            level,
            difficulty: 'beginner',
            question: `Which point does ${level} card ${String(n + 1)} ask about?`,
            answer: line,
            explanation: `The transcript says: ${line}`,
          }
        }),
      ),
    }

    const result = await refine(
      bloomRecipe,
      { item: itemOf(fixture), transcript, timed },
      // Két modell-bíró van (pedagógiai hűség, lefedettség), tehát
      // generálásonként két ítélet kell.
      fixtureClient(fixture, {
        notes: [JSON.stringify(deck)],
        verdicts: [
          { score: 0.9, gaps: [] },
          { score: 0.9, gaps: [] },
        ],
      }),
    )

    return {
      output: result.output,
      score: result.score,
      cards: (result.output.match(/^## /gm) ?? []).length,
    }
  },

  scorers: [
    {
      name: 'bloom-kapu',
      description: 'Determinisztikus: szintsorrend, címkesor, szintenként 3–5 kártya.',
      scorer: ({ output }) => checkBloom(output.output).value,
    },
    {
      name: 'rubrika-pontszam',
      description: 'A loop által elért rubrika-pontszám.',
      scorer: ({ output }) => output.score,
    },
  ],

  columns: ({ output }) => [
    { label: 'Kártya', value: output.cards },
    { label: 'Pontszám', value: output.score },
  ],
})
