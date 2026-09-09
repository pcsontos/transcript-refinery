#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  CONFIG_FILENAME,
  loadConfig,
  loadDotEnv,
  loadModelConfig,
  readConfigFile,
  validateConfig,
  type Config,
  type ModelConfig,
} from './config.js'
import { collectEvents, summarize, type RunEvent } from './events.js'
import { createCostGuard, estimateItemUsd, sliceToBudget, type BudgetEntry } from './model/budget.js'
import { createModelClient, type ModelClient } from './model/client.js'
import { classifyCaptions } from './normalize/classify.js'
import { countWords, dedupeLines } from './normalize/dedupe.js'
import { ARTIFACT_KIND, normalizeItem, processItem, type RecipeDeps } from './pipeline.js'
import { getRecipe } from './recipe/registry.js'
import { countRunLogs, installSigint, writeReport } from './run/finish.js'
import { reserveRunId, runId } from './run/id.js'
import { openRunLog } from './run/log.js'
import { renderReport } from './run/report.js'
import { nextCommand } from './run/suggest.js'
import { discoverAll } from './source/folder.js'
import { openState } from './state/db.js'
import { parseSubtitle } from './subtitle/parse.js'
import type { SourceItem } from './types.js'
import { gitCommitPaths, gitPullFfOnly, gitPush } from './vault/git.js'

const VERSION = '0.1.0'

const USAGE = `refinery <parancs> [kapcsolók]

Parancsok:
  scan    Felderíti a feldolgozható videókat, és nem ír semmit.
  run     Átiratot készít és a vaultba írja.

Kapcsolók:
  --config <út>     konfigurációs fájl (alapértelmezés: refinery.config.yaml)
  --source <név>    csak a megadott forrásmappából
  --channel <név>   csak a megadott csatorna (metaadat nélküli elemre nem illik)
  --limit <szám>    legfeljebb ennyi elem
  --recipe <id>     receptet is futtat (pl. summary); enélkül csak átirat
  --dry-run         nem ír fájlt és nem rögzít állapotot; recepttel a
                    modellhívások VALÓS költséggel megtörténnek
  --force           létező fájlt is felülír
  --no-commit       nem commitol és nem pushol a vault repójába
  --retry-failed    csak a korábban hibára futott elemek

  A futás naplója és riportja a konfigurációban megadott logs.dir alá kerül.
`

function applyFilters(
  items: SourceItem[],
  filters: { source?: string; channel?: string },
): SourceItem[] {
  let out = items
  if (filters.source) {
    const wanted = filters.source.toLocaleLowerCase()
    out = out.filter((i) => i.source.toLocaleLowerCase() === wanted)
  }
  if (filters.channel) {
    // Metaadat nélküli elemnek nincs csatornája: a szűrő ilyenkor kizárja.
    const wanted = filters.channel.toLocaleLowerCase()
    out = out.filter((i) => i.metadata.channel?.toLocaleLowerCase() === wanted)
  }
  return out
}

function render(event: RunEvent): string | null {
  switch (event.type) {
    case 'scan:found':
      return `${event.count} feldolgozható videó`
    case 'item:normalized':
      return `  ${event.itemId}: ${event.wordsRaw} → ${event.wordsNormalized} szó (${event.captionSource})`
    case 'item:published':
      return `  ✓ ${event.path}`
    case 'item:skipped':
      return `  – ${event.itemId}: ${event.reason}`
    case 'item:failed':
      return `  ✗ ${event.itemId}: ${event.error}`
    case 'run:estimate':
      return `Becslés: ${String(event.items)} elem, ~${event.tokens.toLocaleString('hu-HU')} token, ~${event.usd.toFixed(2)} $ (plafon: ${event.limitUsd.toFixed(2)} $)`
    case 'run:aborted':
      // Négy tizedes, mint az `item:refined`-nél: elemenkénti nagyságrendben
      // a két tizedes minden számot `0.00`-ként mutatna.
      return `A futás megállt: ${event.reason} (${event.spentUsd.toFixed(4)} $ / ${event.limitUsd.toFixed(4)} $)`
    case 'run:sliced':
      return `  A plafon alá ${String(event.planned)} elem fér; ${String(event.deferred)} a következő futásra marad.`
    case 'item:refined':
      return `  ~ ${event.itemId}: ${event.recipe} pontszám ${event.score.toFixed(2)}, ${String(event.generations)} generálás, ${event.usd.toFixed(4)} $`
    case 'item:retry':
      return `  ↻ ${event.itemId}: ${event.reason} — újrapróba ${String(event.attempt)}., ${String(event.delayMs / 1000)} mp múlva`
    default:
      return null
  }
}

async function commandScan(cfg: Config): Promise<number> {
  const items = await discoverAll(cfg.sources, cfg.languages)
  console.log(`${items.length} feldolgozható felirat\n`)
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
    console.log(`  ${item.source}  ${item.itemId}  ${item.title}`)
    console.log(`      ${item.sourceFile}`)
    console.log(`      ${detail}`)
  }
  return 0
}

export interface RunRuntime {
  /** A SIGINT forrása. A tesztek saját kibocsátót adnak. */
  signals?: { on(event: string, listener: () => void): unknown }
  /** Kilépés megszakításkor. */
  exit?: (code: number) => void
  /** A modellkliens gyártása; alapértelmezésben a valódi LiteLLM-kliens. */
  createClient?: (cfg: ModelConfig) => ModelClient
}

export async function commandRun(
  cfg: Config,
  raw: unknown,
  flags: {
    source?: string
    channel?: string
    limit?: number
    recipe?: string
    dryRun: boolean
    force: boolean
    commit: boolean
    /** Csak a korábban `failed` állapotú elemeket futtatja újra. */
    retryFailed?: boolean
    /** A riport fejlécében megjelenő parancssor; hiányában „run”. */
    command?: string
  },
  runtime: RunRuntime = {},
): Promise<number> {
  const commandLine = flags.command ?? 'run'

  let recipeDeps: RecipeDeps | undefined
  let maxIterations = 0
  if (flags.recipe) {
    const recipe = getRecipe(flags.recipe)
    const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)
    recipeDeps = {
      recipe,
      client: (runtime.createClient ?? createModelClient)(modelConfig),
      modelConfig,
      guard: createCostGuard(modelConfig.costLimitUsd),
    }
    maxIterations = recipe.maxIterations
  }

  // A futás műtermék-típusa: recepttel a recept azonosítója, enélkül az
  // átirat. Egyszer számoljuk ki — a riport és a hibás-szűrő ugyanazt kérdezi.
  const artifactKind = recipeDeps?.recipe.id ?? ARTIFACT_KIND

  if (flags.commit && !flags.dryRun) await gitPullFfOnly(cfg.vaultPath)

  const store = openState(cfg.statePath)

  const startedAt = new Date()
  // Ütközésmentes név: két azonos másodpercben induló futás nem írhat
  // egymás naplójába, és nem írhatja felül egymás riportját.
  const id = reserveRunId(cfg.logsDir, runId(startedAt))
  const logPath = join(cfg.logsDir, `${id}.jsonl`)
  const reportPath = join(cfg.logsDir, `${id}.md`)
  const log = openRunLog(logPath)

  const { sink, events } = collectEvents()
  const printing = (e: RunEvent) => {
    sink(e)
    log.sink(e)
    const line = render(e)
    if (line !== null) console.log(line)
  }

  // A discoverAll teljes, szűretlen eredménye — a korpusz állapota a teljes
  // korpuszról szól, nem a szűrt szeletről. Korán inicializálva, hogy egy
  // korai SIGINT is riportot írjon (üres korpusszal), ne undefined-ra
  // hivatkozzon.
  let discovered: SourceItem[] = []

  // Egyszeri lefutás: a megszakítás és a normál befejezés is meghívja a
  // `finish`-t, és versenyben lehetnek egymással (a `process.exit` a SIGINT
  // ágon csak a riport kiírása UTÁN fut le, addig a fő ág is tovább
  // haladhat). Az őr szinkron, még az első `await` előtt fut le, tehát
  // bármelyik hívás érkezzen is előbb, a másik nem írja felül a riportot.
  let finished = false

  const finish = async (interrupted: boolean): Promise<void> => {
    if (finished) return
    finished = true

    const summary = summarize(events)
    const corpus = store.corpusStatus(discovered, artifactKind)
    const markdown = renderReport({
      runId: id,
      startedAt,
      finishedAt: new Date(),
      command: commandLine,
      summary,
      corpus,
      runs: countRunLogs(cfg.logsDir),
      logPath,
      cost: recipeDeps
        ? {
            spentUsd: recipeDeps.guard.spentUsd(),
            limitUsd: recipeDeps.modelConfig.costLimitUsd,
            capped: recipeDeps.guard.exceeded(),
          }
        : undefined,
      nextCommand: nextCommand(commandLine, corpus),
    })
    await writeReport(reportPath, markdown)
    // A naplót SZÁNDÉKOSAN nem itt zárjuk: a `finish(true)` (megszakítás) és
    // a fő ág versenyezhet, és egy itt lezárt napló a fő ág további
    // eseményeit némán elnyelné. A napló lezárása a `finally` dolga —
    // egyszer fut le, akkor, amikor a `commandRun` valóban véget ér.
    console.log(`${interrupted ? '\nMegszakítva. ' : ''}Riport: ${reportPath}`)
  }

  // A kezelő nem zárja az állapottárat. Egy valódi Ctrl+C-nél a
  // process.exit úgyis véget vet a folyamatnak, és az állapottár minden
  // írása már commitolva van; a tesztben pedig a hamis exit után a futás
  // zavartalanul befejeződik, ami egy lezárt adatbázison hibát dobna.
  const uninstallSigint = installSigint(() => {
    void finish(true).then(() => (runtime.exit ?? process.exit)(130))
  }, runtime.signals)

  try {
    discovered = await discoverAll(cfg.sources, cfg.languages)
    // A limitnek a JELÖLTEKET kell határolnia, nem a teljes korpuszt: a
    // forrás/csatorna szűrés (`applyFilters`) és a hibás-szűrő UTÁN vágunk,
    // különben pl. `--retry-failed --limit 1` a felfedezés szerint elöl
    // álló (esetleg kész) elemet nézné meg, nem a hibásak közül az elsőt.
    let items = applyFilters(discovered, flags)
    if (flags.retryFailed) items = store.listFailed(items, artifactKind)
    if (flags.limit !== undefined) items = items.slice(0, flags.limit)
    printing({ type: 'scan:found', count: items.length })

    let planned = items
    if (recipeDeps) {
      const pending = flags.force ? items : store.listPending(items, recipeDeps.recipe.id)
      const entries: BudgetEntry<SourceItem>[] = []
      for (const item of pending) {
        try {
          entries.push({ value: item, words: (await normalizeItem(item)).wordsNormalized })
        } catch {
          // Az elem, aminek a normalizálása dob (olvashatatlan fájl, üres
          // felirat), csak a BECSLÉSBŐL marad ki — szószám híján nincs mit
          // becsülni rá. A feldolgozás sorra veszi: a `planned` a szűrt
          // `items`-ből épül, tehát a hibája `item:failed`-ként megjelenik a
          // naplóban, a riportban és a kilépőkódban is.
        }
      }

      const slice = sliceToBudget(entries, maxIterations, recipeDeps.modelConfig)
      const limitUsd = recipeDeps.modelConfig.costLimitUsd

      printing({
        type: 'run:estimate',
        items: slice.planned.length,
        tokens: slice.tokens,
        usd: slice.usd,
        limitUsd,
      })

      // Az üres `entries` (nincs feldolgozandó elem — a szűrők vagy a már
      // kész elemek miatt) nem plafon-túllépés: a köteg simán, nulla elemmel
      // fut le. A 2-es kilépőkód KIZÁRÓLAG akkor jár, ha VAN jelölt, de az
      // első sem fér a plafon alá.
      const first = entries[0]
      if (first !== undefined && slice.planned.length === 0) {
        const firstUsd = estimateItemUsd(first.words, maxIterations, recipeDeps.modelConfig)
        printing({
          type: 'run:aborted',
          reason: `már az első elem becsült költsége (${firstUsd.toFixed(4)} $) meghaladja a plafont`,
          spentUsd: 0,
          limitUsd,
        })
        await finish(false)
        return 2
      }

      if (slice.deferred.length > 0) {
        printing({
          type: 'run:sliced',
          planned: slice.planned.length,
          deferred: slice.deferred.length,
          usd: slice.usd,
          limitUsd,
        })
      }

      // A `planned` a SZŰRT lista, csökkentve a plafon miatt elhalasztott
      // elemekkel. Így a már kész elem a kihagyás ágára jut, a hibás elem a
      // feldolgozás hibaágára — modellhívás egyikkel sem jár, tehát a plafon
      // szemantikája sértetlen. A `slice` számai a becslésről szólnak, azaz a
      // ténylegesen modellhívást igénylő elemekről; a feldolgozandó lista
      // ennél tágabb.
      const deferredIds = new Set(slice.deferred.map((i) => i.itemId))
      planned = items.filter((i) => !deferredIds.has(i.itemId))
    }

    const written: string[] = []
    for (const item of planned) {
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
    printing({
      type: 'run:done',
      succeeded: summary.succeeded,
      skipped: summary.skipped,
      failed: summary.failed,
    })
    console.log(
      `\nKész: ${summary.succeeded} sikeres ` +
        `(kreátori ${summary.byCaptionSource.creator} / automatikus ${summary.byCaptionSource.auto}), ` +
        `${summary.skipped} kihagyva, ${summary.failed} hibás.`,
    )

    if (flags.commit && !flags.dryRun && written.length > 0) {
      const message = `docs(videos): átirat ${written.length} videóhoz`
      if (await gitCommitPaths(cfg.vaultPath, written, message)) {
        const push = await gitPush(cfg.vaultPath)
        if (!push.pushed) console.log(`A push nem sikerült, a commit lokálisan maradt.`)
      }
    }

    await finish(false)
    return summary.failed > 0 ? 1 : 0
  } finally {
    // A riport a `finally`-ből is elkészül: a törzsben dobott kivétel
    // (git-hiba, tele lemez) enélkül naplót hagyna maga után, riportot nem.
    // A `finish` idempotens, tehát a normál ág után ez már nem csinál semmit.
    // Saját try/catch-ben, hogy egy riportírási hiba se akadályozza meg a
    // leiratkozást és a lezárásokat — és hogy ne nyelje el a törzs eredeti
    // kivételét sem.
    try {
      await finish(false)
    } catch (error) {
      console.error(`A riport nem készült el: ${(error as Error).message}`)
    }
    // A leiratkozás azért kerül ide, hogy a `commandRun` visszatérte után
    // egy késői jel ne fusson neki egy lent már lezárt állapottárnak.
    uninstallSigint()
    log.close()
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
      config: { type: 'string' },
      source: { type: 'string' },
      channel: { type: 'string' },
      limit: { type: 'string' },
      recipe: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      'no-commit': { type: 'boolean', default: false },
      'retry-failed': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  })

  const configPath = resolve(process.cwd(), values.config ?? CONFIG_FILENAME)
  const raw = await readConfigFile(configPath)
  const cfg = loadConfig(raw, configPath)
  await validateConfig(cfg)

  if (command === 'scan') return commandScan(cfg)
  if (command === 'run') {
    return commandRun(cfg, raw, {
      source: values.source,
      channel: values.channel,
      limit: values.limit === undefined ? undefined : Number(values.limit),
      recipe: values.recipe,
      dryRun: values['dry-run'],
      force: values.force,
      commit: !values['no-commit'],
      retryFailed: values['retry-failed'],
      command: argv.join(' '),
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
