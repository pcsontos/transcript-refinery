import { evalite } from 'evalite'
import { dedupeLines } from '../src/normalize/dedupe.js'
import { summaryRecipe } from '../src/recipe/summary.js'
import { refine } from '../src/refine/loop.js'
import { checkFormat } from '../src/rubric/format.js'
import { parseSubtitle } from '../src/subtitle/parse.js'
import type { SourceItem } from '../src/types.js'
import { fixtureClient } from './fixture-model.js'
import { PUBLIC_FIXTURES, type Fixture } from './fixtures/transcripts.js'
import { loadPrivateFixtures } from './private-layer.js'

function itemOf(fixture: Fixture): SourceItem {
  return {
    videoId: fixture.id,
    title: fixture.title,
    channel: fixture.channel,
    uploadedAt: '2026-01-01',
    url: `https://example.com/${fixture.id}`,
    subtitlePath: `${fixture.id}.srt`,
    mediaPath: null,
  }
}

evalite('summary recept — teljes loop fixture-modellen', {
  data: () =>
    [...PUBLIC_FIXTURES, ...loadPrivateFixtures()].map((fixture) => ({
      input: fixture,
    })),

  task: async (fixture) => {
    // A valódi Fázis 0 út: nyers SRT → cue-k → deduplikált sorok.
    const cues = parseSubtitle(fixture.srt, `${fixture.id}.srt`)
    const transcript = dedupeLines(cues).join(' ')

    const result = await refine(
      summaryRecipe,
      { item: itemOf(fixture), transcript },
      fixtureClient(fixture),
    )

    return {
      output: result.output,
      score: result.score,
      generations: result.generations,
      gaps: result.gaps,
      inputTokens: result.usage.inputTokens,
    }
  },

  scorers: [
    {
      name: 'formatum',
      description: 'Determinisztikus vault-formátum: nulla token.',
      scorer: ({ output }) => checkFormat(output.output).value,
    },
    {
      name: 'rubrika-pontszam',
      description: 'A loop által elért rubrika-pontszám.',
      scorer: ({ output }) => output.score,
    },
  ],

  columns: ({ output }) => [
    { label: 'Generálás', value: output.generations },
    { label: 'Hiányok', value: output.gaps.length },
    { label: 'Bemeneti token', value: output.inputTokens },
  ],
})
