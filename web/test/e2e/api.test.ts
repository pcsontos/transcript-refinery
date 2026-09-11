import { appendFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import type {
  ArtifactDetail,
  FailureGroup,
  ItemDetail,
  ItemListRow,
  Overview,
  RunDetail,
  RunSummaryView,
} from 'transcript-refinery'
import { FINISHED_RUN, RUNNING_RUN, createFixture } from './fixture'

type ItemResponse = Omit<ItemDetail, 'artifacts'> & {
  artifacts: (ArtifactDetail & { html: string | null; obsidianUrl: string | null })[]
}

type RunResponse = RunDetail & { reportHtml: string | null }

const eventIds = (text: string): string[] =>
  [...text.matchAll(/^id: (\d+)$/gm)].map((match) => match[1] ?? '')

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

  it('a futáslista legújabb elöl, állapottal', async () => {
    const runs = await $fetch<RunSummaryView[]>('/api/runs')
    expect(runs.map((run) => [run.runId, run.status])).toEqual([
      [RUNNING_RUN, 'running'],
      [FINISHED_RUN, 'done'],
    ])
  })

  it('a lezárt futás oldala a sorokat, az állapotot és a renderelt riportot adja', async () => {
    const run = await $fetch<RunResponse>(`/api/runs/${FINISHED_RUN}`)
    expect(run.summary.status).toBe('done')
    expect(run.lines).toHaveLength(8)
    expect(run.state.spentUsd).toBeCloseTo(0.0123, 10)
    expect(run.reportHtml).toContain('<h1>Futás</h1>')
  })

  it('a nem futásazonosító alakú kérésre 404, az SSE-nél is', async () => {
    for (const path of [
      '/api/runs/..%2F..%2Fetc',
      '/api/runs/nincs-ilyen',
      '/api/runs/..%2F..%2Fetc/events',
    ]) {
      const error = await $fetch(path).catch((e: unknown) => e)
      expect((error as { statusCode?: number }).statusCode).toBe(404)
    }
  })

  it('a lezárt futás folyama minden sort ad, end eseménnyel zár, és a Last-Event-ID-től folytat', async () => {
    const all = await (await fetch(`/api/runs/${FINISHED_RUN}/events`)).text()
    expect(all).toContain('event: end')
    const ids = eventIds(all)
    expect(ids).toHaveLength(8)

    const rest = await (
      await fetch(`/api/runs/${FINISHED_RUN}/events`, { headers: { 'Last-Event-ID': ids[0]! } })
    ).text()
    expect(eventIds(rest)).toEqual(ids.slice(1))
  })

  it('a futó napló hozzáfűzött sora megjelenik a folyamban, az állapottal együtt', async () => {
    const response = await fetch(`/api/runs/${RUNNING_RUN}/events`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''

    /** Addig olvas, amíg a keresett szöveget tartalmazó üzenet teljesen meg nem jött. */
    const messageWith = async (needle: string): Promise<string> => {
      for (;;) {
        const at = text.indexOf(needle)
        const endAt = at === -1 ? -1 : text.indexOf('\n\n', at)
        if (endAt !== -1) {
          const before = text.lastIndexOf('\n\n', at)
          return text.slice(before === -1 ? 0 : before + 2, endAt)
        }
        const { value, done } = await reader.read()
        if (done) throw new Error(`a folyam véget ért, mielőtt megjött: ${needle}`)
        text += decoder.decode(value, { stream: true })
      }
    }

    await messageWith('"type":"scan:found"')
    await appendFile(
      fixture.runningLog,
      `${JSON.stringify({
        at: new Date().toISOString(),
        type: 'item:start',
        itemId: 'szint0002',
        title: 'Második példavideó',
      })}\n`,
    )
    const message = await messageWith('"type":"item:start"')
    await reader.cancel()

    const dataLine = message.split('\n').find((l) => l.startsWith('data: ')) ?? ''
    const data = JSON.parse(dataLine.slice('data: '.length)) as {
      line: { itemId: string }
      state: { current: { title: string } | null }
    }
    expect(data.line.itemId).toBe('szint0002')
    expect(data.state.current?.title).toBe('Második példavideó')
  })

  it('az oldalak a szerveren renderelve a szintetikus adatot mutatják', async () => {
    const overview = await $fetch<string>('/')
    expect(overview).toContain('A korpusz állapota')
    expect(overview).toContain('Fut: run --queue')

    const items = await $fetch<string>('/items')
    expect(items).toContain('Első példavideó')
    expect(items).toContain('Második példavideó')

    const item = await $fetch<string>('/items/szint0001')
    expect(item).toContain('kimaradt: a zárás')
    expect(item).toContain('&lt;script&gt;')
    expect(item).toContain('Megnyitás Obsidianban')

    const failures = await $fetch<string>('/failures')
    expect(failures).toContain('wikilink tiltott')
  })
})
