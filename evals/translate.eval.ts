import { evalite } from 'evalite'
import { translationOf } from '../src/recipe/translate.js'
import { refine } from '../src/refine/loop.js'
import { checkLanguageIs } from '../src/rubric/language.js'
import { checkSkeleton } from '../src/rubric/skeleton.js'
import type { SourceItem } from '../src/types.js'
import { scriptedClient } from './fixture-model.js'
import { SKELETON_LABELS, SKELETON_SOURCE_RECIPES } from './fixtures/skeleton.js'

const ITEM: SourceItem = {
  itemId: 'forditas-fixture',
  source: 'fixtures',
  sourceFile: 'forditas.en.srt',
  subtitlePath: 'forditas.en.srt',
  baseName: 'forditas',
  title: 'How to start a one-person business',
  language: 'en',
  metadata: {},
}

evalite('fordítás — a négy forrásrecept jegyzete fixture-modellen', {
  data: () =>
    SKELETON_LABELS.filter((c) => c.label === 'ok').map((c) => ({
      input: c,
    })),

  task: async (c) => {
    const result = await refine(
      translationOf(SKELETON_SOURCE_RECIPES[c.recipe], 'hu'),
      { item: ITEM, transcript: c.source, timed: [] },
      // A rubrikában EGY modell-bíró van, tehát generálásonként egy ítélet kell.
      scriptedClient([c.translation], [{ score: 0.95, gaps: [] }]),
    )
    return { recipe: c.recipe, output: result.output, source: c.source, score: result.score }
  },

  scorers: [
    {
      name: 'vazkapu',
      description: 'Determinisztikus: a fordítás váza a forrásé.',
      scorer: ({ output }) =>
        checkSkeleton(output.output, output.source, {
          headingsAreContent: SKELETON_SOURCE_RECIPES[output.recipe].headingsAreContent,
        }).value,
    },
    {
      name: 'celnyelv',
      description: 'Determinisztikus: a fordítás magyar.',
      scorer: ({ output }) => checkLanguageIs(output.output, 'hu').value,
    },
    {
      name: 'rubrika-pontszam',
      description: 'A loop által elért rubrika-pontszám.',
      scorer: ({ output }) => output.score,
    },
  ],

  columns: ({ output }) => [
    { label: 'Forrásrecept', value: output.recipe },
    { label: 'Pontszám', value: output.score },
  ],
})
