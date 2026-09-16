import { MockLanguageModelV4 } from 'ai/test'
import { modelClientFrom, type ModelClient } from '../src/model/client.js'
import type { Fixture } from './fixtures/transcripts.js'

function cannedModel(next: () => string) {
  return new MockLanguageModelV4({
    doGenerate: () =>
      Promise.resolve({
        content: [{ type: 'text' as const, text: next() }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage: {
          inputTokens: {
            total: 1000,
            noCache: 1000,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 200, text: 200, reasoning: undefined },
        },
        warnings: [],
      }),
  })
}

/** A fixture rögzített válaszainak felülbírálása, receptenként. */
export interface FixtureScript {
  notes?: string[]
  verdicts?: { score: number; gaps: string[] }[]
}

/**
 * Determinisztikus kliens egy fixture-höz. A `draft` szerep a fixture
 * jegyzeteit adja sorban, a `judge` az ítéleteit — így a teljes loop lefut
 * kulcs és hálózat nélkül, valódi pontszámokkal.
 */
export function fixtureClient(fixture: Fixture, script: FixtureScript = {}): ModelClient {
  const notes = script.notes ?? fixture.notes
  const verdicts = script.verdicts ?? fixture.verdicts
  let draft = 0
  let judge = 0
  return modelClientFrom({
    draft: cannedModel(() => {
      const note = notes[Math.min(draft, notes.length - 1)]
      draft++
      return note ?? ''
    }),
    judge: cannedModel(() => {
      const verdict = verdicts[Math.min(judge, verdicts.length - 1)]
      judge++
      return JSON.stringify(verdict ?? { score: 0, gaps: ['no verdict in fixture'] })
    }),
  })
}
