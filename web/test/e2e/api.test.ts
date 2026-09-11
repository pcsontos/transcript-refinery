import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { $fetch, setup } from '@nuxt/test-utils/e2e'
import type {
  ArtifactDetail,
  FailureGroup,
  ItemDetail,
  ItemListRow,
  Overview,
} from 'transcript-refinery'
import { RUNNING_RUN, createFixture } from './fixture'

type ItemResponse = Omit<ItemDetail, 'artifacts'> & {
  artifacts: (ArtifactDetail & { html: string | null; obsidianUrl: string | null })[]
}

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

  it('az elemlista a felderített elemeket adja, típusonkénti cellákkal', async () => {
    const rows = await $fetch<ItemListRow[]>('/api/items')
    expect(rows.map((row) => row.itemId)).toEqual(['szint0001', 'szint0002'])
    expect(rows[0]?.cells.summary).toEqual({
      status: 'done',
      score: 0.62,
      costUsd: 0.0123,
      belowThreshold: true,
    })
    expect(rows[0]?.cells.qa?.status).toBe('failed')
    expect(rows[1]?.cells.summary?.status).toBe('pending')
  })

  it('az elem oldala a renderelt jegyzetet, a hiánylistát és az Obsidian-linket adja', async () => {
    const detail = await $fetch<ItemResponse>('/api/items/szint0001')
    expect(detail.item.title).toBe('Első példavideó')

    const summary = detail.artifacts.find((a) => a.kind === 'summary')
    expect(summary?.gaps).toEqual(['kimaradt: a zárás'])
    expect(summary?.html).toContain('<h2>Összefoglaló</h2>')
    expect(summary?.obsidianUrl).toBe(
      `obsidian://open?path=${encodeURIComponent(fixture.summaryNote)}`,
    )

    const transcript = detail.artifacts.find((a) => a.kind === 'transcript')
    expect(transcript?.html).toContain('Ez az első szintetikus mondat.')
  })

  it('a jegyzetbe írt nyers HTML szövegként jelenik meg', async () => {
    const detail = await $fetch<ItemResponse>('/api/items/szint0001')
    const html = detail.artifacts.find((a) => a.kind === 'summary')?.html ?? ''
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('ismeretlen elemre 404', async () => {
    const error = await $fetch('/api/items/nincs-ilyen').catch((e: unknown) => e)
    expect((error as { statusCode?: number }).statusCode).toBe(404)
  })

  it('a hibák a hibaüzenet első sora szerint csoportosítva', async () => {
    expect(await $fetch<FailureGroup[]>('/api/failures')).toEqual([
      {
        message: 'a jegyzet megsérti a vault írási szabályait: wikilink tiltott',
        count: 1,
        items: [{ itemId: 'szint0001', title: 'Első példavideó', kind: 'qa' }],
      },
    ])
  })
})
