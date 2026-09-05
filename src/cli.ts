#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { loadConfig, loadDotEnv, loadModelConfig, validateConfig, type Config } from './config.js'
import { collectEvents, summarize, type RunEvent } from './events.js'
import { createCostGuard, estimateRunUsd } from './model/budget.js'
import { createModelClient } from './model/client.js'
import { classifyCaptions } from './normalize/classify.js'
import { countWords, dedupeLines } from './normalize/dedupe.js'
import { normalizeItem, processItem, type RecipeDeps } from './pipeline.js'
import { getRecipe } from './recipe/registry.js'
import { parseSubtitle } from './subtitle/parse.js'
import { folderSource } from './source/folder.js'
import { openState } from './state/db.js'
import type { SourceItem } from './types.js'
import { gitCommitPaths, gitPullFfOnly, gitPush } from './vault/git.js'

const VERSION = '0.1.0'

const USAGE = `refinery <parancs> [kapcsolók]

Parancsok:
  scan    Felderíti a feldolgozható videókat, és nem ír semmit.
  run     Átiratot készít és a vaultba írja.

Kapcsolók:
  --channel <név>   csak a megadott csatorna
  --limit <szám>    legfeljebb ennyi elem
  --recipe <id>     receptet is futtat (pl. summary); enélkül csak átirat
  --dry-run         nem ír fájlt és nem rögzít állapotot; recepttel a
                    modellhívások VALÓS költséggel megtörténnek
  --force           létező fájlt is felülír
  --no-commit       nem commitol és nem pushol a vault repójába
`

function applyFilters(
  items: SourceItem[],
  filters: { channel?: string; limit?: number },
): SourceItem[] {
  let out = items
  if (filters.channel) {
    const wanted = filters.channel.toLocaleLowerCase()
    out = out.filter((i) => i.channel.toLocaleLowerCase() === wanted)
  }
  if (filters.limit !== undefined) out = out.slice(0, filters.limit)
  return out
}

function render(event: RunEvent): string | null {
  switch (event.type) {
    case 'scan:found':
      return `${event.count} feldolgozható videó`
    case 'item:normalized':
      return `  ${event.videoId}: ${event.wordsRaw} → ${event.wordsNormalized} szó (${event.captionSource})`
    case 'item:published':
      return `  ✓ ${event.path}`
    case 'item:skipped':
      return `  – ${event.videoId}: ${event.reason}`
    case 'item:failed':
      return `  ✗ ${event.videoId}: ${event.error}`
    case 'run:estimate':
      return `Becslés: ${String(event.items)} elem, ~${event.tokens.toLocaleString('hu-HU')} token, ~${event.usd.toFixed(2)} $ (plafon: ${event.limitUsd.toFixed(2)} $)`
    case 'run:aborted':
      return `A futás megállt: ${event.reason} (${event.spentUsd.toFixed(2)} $ / ${event.limitUsd.toFixed(2)} $)`
    case 'item:refined':
      return `  ~ ${event.videoId}: ${event.recipe} pontszám ${event.score.toFixed(2)}, ${String(event.generations)} generálás, ${event.usd.toFixed(4)} $`
    default:
      return null
  }
}

async function commandScan(cfg: Config): Promise<number> {
  const items = await folderSource(cfg.pinchflatDownloads).discover()
  console.log(`${items.length} feldolgozható videó\n`)
  for (const item of items) {
    let detail: string
    try {
      const raw = await readFile(item.subtitlePath, 'utf8')
      const cues = parseSubtitle(raw, item.subtitlePath)
      const rawText = cues.flatMap((c) => c.lines).join(' ')
      const normalized = dedupeLines(cues).join(' ')
      detail = `${countWords(rawText)} → ${countWords(normalized)} szó, ${classifyCaptions(normalized)}`
    } catch (error) {
      detail = `olvashatatlan felirat: ${(error as Error).message}`
    }
    console.log(`  ${item.videoId}  ${item.channel}  ${item.title}`)
    console.log(`      ${detail}`)
  }
  return 0
}

export async function commandRun(
  cfg: Config,
  flags: {
    channel?: string
    limit?: number
    recipe?: string
    dryRun: boolean
    force: boolean
    commit: boolean
  },
): Promise<number> {
  let recipeDeps: RecipeDeps | undefined
  let maxIterations = 0
  if (flags.recipe) {
    const recipe = getRecipe(flags.recipe)
    const modelConfig = loadModelConfig(process.env)
    recipeDeps = {
      recipe,
      client: createModelClient(modelConfig),
      modelConfig,
      guard: createCostGuard(modelConfig.costLimitUsd),
    }
    maxIterations = recipe.maxIterations
  }

  if (flags.commit && !flags.dryRun) await gitPullFfOnly(cfg.vaultPath)

  const store = openState(cfg.statePath)
  const { sink, events } = collectEvents()
  const printing = (e: RunEvent) => {
    sink(e)
    const line = render(e)
    if (line !== null) console.log(line)
  }

  try {
    const all = await folderSource(cfg.pinchflatDownloads).discover()
    const items = applyFilters(all, flags)
    printing({ type: 'scan:found', count: items.length })

    if (recipeDeps) {
      const pending = flags.force ? items : store.listPending(items, recipeDeps.recipe.id)
      const wordCounts: number[] = []
      for (const item of pending) {
        try {
          wordCounts.push((await normalizeItem(item)).wordsNormalized)
        } catch {
          // Az olvashatatlan feliratot a feldolgozás jelenti majd; a
          // becslésből egyszerűen kimarad.
        }
      }

      const estimate = estimateRunUsd(wordCounts, maxIterations, recipeDeps.modelConfig)
      printing({
        type: 'run:estimate',
        items: wordCounts.length,
        tokens: estimate.tokens,
        usd: estimate.usd,
        limitUsd: recipeDeps.modelConfig.costLimitUsd,
      })

      if (estimate.usd > recipeDeps.modelConfig.costLimitUsd) {
        printing({
          type: 'run:aborted',
          reason: 'a becsült költség meghaladja a plafont',
          spentUsd: 0,
          limitUsd: recipeDeps.modelConfig.costLimitUsd,
        })
        return 2
      }
    }

    const written: string[] = []
    for (const item of items) {
      const outcome = await processItem(item, {
        notesRoot: cfg.notesRoot,
        store,
        sink: printing,
        version: VERSION,
        options: { force: flags.force, dryRun: flags.dryRun },
        recipeDeps,
      })
      if (outcome.status === 'published') {
        if (outcome.path) written.push(outcome.path)
        if (outcome.recipePath && outcome.recipePath !== outcome.path) written.push(outcome.recipePath)
      }

      if (recipeDeps?.guard.exceeded()) {
        printing({
          type: 'run:aborted',
          reason: 'a tényleges költés meghaladta a plafont',
          spentUsd: recipeDeps.guard.spentUsd(),
          limitUsd: recipeDeps.modelConfig.costLimitUsd,
        })
        break
      }
    }

    const summary = summarize(events)
    printing({ type: 'run:done', ...summary })
    console.log(
      `\nKész: ${summary.succeeded} sikeres, ${summary.skipped} kihagyva, ${summary.failed} hibás.`,
    )

    if (flags.commit && !flags.dryRun && written.length > 0) {
      const message = `docs(videos): átirat ${written.length} videóhoz`
      if (await gitCommitPaths(cfg.vaultPath, written, message)) {
        const push = await gitPush(cfg.vaultPath)
        if (!push.pushed) console.log(`A push nem sikerült, a commit lokálisan maradt.`)
      }
    }

    return summary.failed > 0 ? 1 : 0
  } finally {
    store.close()
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0]
  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE)
    return command ? 0 : 1
  }

  const { values } = parseArgs({
    args: [...argv.slice(1)],
    options: {
      channel: { type: 'string' },
      limit: { type: 'string' },
      recipe: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      'no-commit': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  })

  const cfg = loadConfig(process.env)
  await validateConfig(cfg)

  if (command === 'scan') return commandScan(cfg)
  if (command === 'run') {
    return commandRun(cfg, {
      channel: values.channel,
      limit: values.limit === undefined ? undefined : Number(values.limit),
      recipe: values.recipe,
      dryRun: values['dry-run'],
      force: values.force,
      commit: !values['no-commit'],
    })
  }

  console.error(`Ismeretlen parancs: ${command}\n\n${USAGE}`)
  return 1
}

const isEntrypoint = process.argv[1]?.endsWith('cli.js') ?? false
if (isEntrypoint) {
  loadDotEnv()
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: Error) => {
      console.error(error.message)
      process.exit(1)
    })
}
