import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { $fetch, setup } from '@nuxt/test-utils/e2e'
import type { Overview } from 'transcript-refinery'
import { RUNNING_RUN, createFixture } from './fixture'

const fixture = await createFixture()

// Egyetlen `setup()` a fájlban: egy második `describe` saját `setup`-pal az egész
// fájlt elrontaná. A későbbi feladatok tesztjei ebbe a blokkba kerülnek.
describe('API', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    env: { REFINERY_CONFIG: fixture.configPath },
    setupTimeout: 300_000,
  })

  it('az áttekintő a szintetikus állapotot adja', async () => {
    const overview = await $fetch<Overview>('/api/overview')
    expect(overview.hasState).toBe(true)
    expect(overview.discovered).toBe(2)
    expect(overview.corpus.find((c) => c.kind === 'summary')?.status).toMatchObject({
      done: 1,
      failed: 0,
      pending: 1,
    })
    expect(overview.scores.find((s) => s.recipe === 'summary')).toMatchObject({
      scored: 1,
      belowThreshold: 1,
    })
    expect(overview.queue).toEqual([
      { recipe: 'summary', checked: 1, done: 1, failed: 0, pending: 0 },
    ])
    expect(overview.running.map((r) => r.runId)).toEqual([RUNNING_RUN])
    expect(overview.totalCostUsd).toBeCloseTo(0.0123, 10)
  })
})
