import { evalite } from 'evalite'
import { dedupeTimedLines } from '../src/normalize/dedupe.js'
import { cleanRecipeFor } from '../src/recipe/clean.js'
import { refine } from '../src/refine/loop.js'
import { checkFidelity } from '../src/rubric/fidelity.js'
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

evalite('clean-moderate recept — teljes loop fixture-modellen', {
  data: () =>
    [...PUBLIC_FIXTURES, ...loadPrivateFixtures()].map((fixture) => ({
      input: fixture,
    })),

  task: async (fixture) => {
    const cues = parseSubtitle(fixture.srt, `${fixture.id}.srt`)
    const timed = dedupeTimedLines(cues)
    const transcript = timed.map((line) => line.text).join(' ')

    // A „megtisztított" vázlatot a fixture SAJÁT szövegéből állítjuk elő,
    // nyolcsoronként bekezdésre bontva. Így a blokkoló szöveghűség-kapu
    // konstrukció szerint átmegy, és az illesztőnek valódi szöveget kell
    // visszakeresnie — kézzel írt második szövegváltozat nélkül.
    const draft = timed
      .reduce<string[][]>((groups, line, index) => {
        if (index % 8 === 0) groups.push([])
        groups[groups.length - 1]!.push(line.text)
        return groups
      }, [])
      .map((group) => {
        const text = group.join(' ')
        return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
      })
      .join('\n\n')

    const result = await refine(
      cleanRecipeFor('moderate'),
      { item: itemOf(fixture), transcript, timed },
      // A `clean-moderate` rubrikájában EGY modell-bíró van, tehát generálásonként egy
      // ítélet kell — szemben a `summary` kettejével (hűség, lefedettség).
      fixtureClient(fixture, { notes: [draft], verdicts: [{ score: 0.95, gaps: [] }] }),
    )

    return {
      output: result.output,
      score: result.score,
      transcript,
      // Hány bekezdés kapott időbélyeget: ez a recept fő állítása.
      stamped: result.output.split(/\n{2,}/).filter((b) => /^\[\d/.test(b.trim())).length,
    }
  },

  scorers: [
    {
      name: 'szoveghuseg',
      description: 'Determinisztikus: a kimenet nem összefoglaló.',
      scorer: ({ output }) => checkFidelity(output.output, output.transcript).value,
    },
    {
      name: 'rubrika-pontszam',
      description: 'A loop által elért rubrika-pontszám.',
      scorer: ({ output }) => output.score,
    },
  ],

  columns: ({ output }) => [
    { label: 'Időbélyeges bekezdés', value: output.stamped },
    { label: 'Pontszám', value: output.score },
  ],
})
