#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
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
import { createCostGuard, estimateItemUsd, type CostGuard } from './model/budget.js'
import { createModelClient, type ModelClient } from './model/client.js'
import { comparePricing, fetchLivePricing } from './model/pricing-check.js'
import { classifyCaptions } from './normalize/classify.js'
import { countWords, dedupeLines } from './normalize/dedupe.js'
import { ARTIFACT_KIND, processItem, type RecipeDeps } from './pipeline.js'
import { queuePath, readQueueFile } from './queue/file.js'
import { mergeQueue } from './queue/merge.js'
import { checkedPairs, parseQueue, type QueuePair } from './queue/parse.js'
import {
  DEFERRED_STATUS,
  NOT_FOUND_STATUS,
  applyStatuses,
  doneStatus,
  failedStatus,
  pairKey,
} from './queue/status.js'
import { RECIPES, RECIPE_IDS, getRecipe } from './recipe/registry.js'
import type { Recipe } from './recipe/types.js'
import { countRunLogs, installSigint, writeReport } from './run/finish.js'
import { reserveRunId, runId } from './run/id.js'
import { openRunLog } from './run/log.js'
import {
  estimateUnits,
  filterItems,
  matchesFilters,
  unitKey,
  unitKind,
  type WorkUnit,
} from './run/plan.js'
import { renderReport, type QueueRecipeStatus } from './run/report.js'
import { nextCommand } from './run/suggest.js'
import { discoverAll } from './source/folder.js'
import { openState } from './state/db.js'
import { parseSubtitle } from './subtitle/parse.js'
import type { SourceItem } from './types.js'
import { writeFileAtomic } from './vault/atomic.js'
import { gitCommitPaths, gitPullFfOnly, gitPush } from './vault/git.js'

const VERSION = '0.1.0'

const USAGE = `refinery <parancs> [kapcsolók]

Parancsok:
  scan            Felderíti a feldolgozható videókat, és nem ír semmit.
  run             Átiratot készít és a vaultba írja.
  check-pricing   Összeveti a config árazását a LiteLLM élő áraival.

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
  --queue           scan: a vault _queue.md sorába fésül; run: a sor
                    kipipált (videó, recept) párjait dolgozza fel

  A futás naplója és riportja a konfigurációban megadott logs.dir alá kerül.
`

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
      return `  ✗ ${event.itemId} (${event.kind}): ${event.error}`
    case 'run:estimate':
      return `Becslés: ${String(event.items)} elem, ~${event.tokens.toLocaleString('hu-HU')} token, ~${event.usd.toFixed(4)} $ (plafon: ${event.limitUsd.toFixed(4)} $)`
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

export async function commandScan(cfg: Config): Promise<number> {
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

/**
 * A felderített elemek összefésülése a vault feldolgozási sorába. Modellt nem
 * hív, ezért `LITELLM_API_KEY` sem kell hozzá. A sort csak akkor írja, ha a
 * tartalma ténylegesen változik — így az ismételt futás nem hagy commitot
 * maga után.
 */
export async function commandScanQueue(
  cfg: Config,
  flags: { dryRun: boolean; commit: boolean },
): Promise<number> {
  const commit = flags.commit && !flags.dryRun
  if (commit) await gitPullFfOnly(cfg.vaultPath)

  const items = await discoverAll(cfg.sources, cfg.languages)
  const path = queuePath(cfg.notesRoot)
  const current = await readQueueFile(path)
  const { text, stats } = mergeQueue(current, items, RECIPE_IDS)

  console.log(
    `${String(items.length)} feldolgozható felirat · ${String(stats.addedVideos)} új videó, ` +
      `${String(stats.addedRecipeLines)} új receptsor meglévő videó alatt, ` +
      `${String(stats.changedMarks)} jelölés-változás`,
  )
  if (flags.dryRun) {
    console.log('Próbafutás: a sor nem íródott.')
    return 0
  }
  if (text === current) {
    console.log(`A sor naprakész: ${path}`)
    return 0
  }

  await writeFileAtomic(path, text)
  console.log(`Sor: ${path}`)
  if (commit && (await gitCommitPaths(cfg.vaultPath, [path], 'docs(videos): feldolgozási sor frissítése'))) {
    const push = await gitPush(cfg.vaultPath)
    if (!push.pushed) console.log('A push nem sikerült, a commit lokálisan maradt.')
  }
  return 0
}

/**
 * Összeveti a `refinery.config.yaml` árazását a LiteLLM élő adataival. A
 * statikus árazás elavulhat (modellváltás, díjszabás-változás) anélkül, hogy
 * bármi jelezné — ez a parancs ezt kapja el, mielőtt egy valódi futás rossz
 * becsléssel indulna.
 */
export async function commandCheckPricing(modelConfig: ModelConfig): Promise<number> {
  let live: Awaited<ReturnType<typeof fetchLivePricing>>
  try {
    live = await fetchLivePricing(modelConfig.baseUrl, modelConfig.apiKey)
  } catch (error) {
    console.error(`Nem sikerült lekérdezni a LiteLLM árazását: ${(error as Error).message}`)
    return 2
  }

  const { mismatches, unknown } = comparePricing(modelConfig.models, modelConfig.pricing, live)
  for (const u of unknown) {
    console.log(`? ${u.role} (${u.model}): a LiteLLM nem ismeri ezt a modellt — nem ellenőrizhető.`)
  }
  for (const m of mismatches) {
    console.log(
      `ELTÉR ${m.role} (${m.model}): config $${m.configured.inputPerMillion.toFixed(2)}/$${m.configured.outputPerMillion.toFixed(2)} (be/ki, milliónként) — LiteLLM $${m.live.inputPerMillion.toFixed(2)}/$${m.live.outputPerMillion.toFixed(2)}`,
    )
  }
  if (mismatches.length === 0 && unknown.length === 0) {
    console.log('Az árazás egyezik a LiteLLM élő adataival.')
  }
  return mismatches.length > 0 ? 1 : 0
}

export interface RunRuntime {
  /** A SIGINT forrása. A tesztek saját kibocsátót adnak. */
  signals?: { on(event: string, listener: () => void): unknown }
  /** Kilépés megszakításkor. */
  exit?: (code: number) => void
  /** A modellkliens gyártása; alapértelmezésben a valódi LiteLLM-kliens. */
  createClient?: (cfg: ModelConfig) => ModelClient
}

/** A modellréteg egy futásra: egy kliens és egy költségőr, minden receptnek közösen. */
interface ModelRuntime {
  modelConfig: ModelConfig
  client: ModelClient
  guard: CostGuard
}

export async function commandRun(
  cfg: Config,
  raw: unknown,
  flags: {
    source?: string
    channel?: string
    limit?: number
    /** Queue nélkül a futás receptje; queue-módban szűrő a kipipált párokra. */
    recipe?: string
    /** A vault `_queue.md` sorának kipipált (videó, recept) párjait dolgozza fel. */
    queue?: boolean
    dryRun: boolean
    force: boolean
    commit: boolean
    /** Csak a korábban `failed` állapotú elemeket — queue-módban párokat — futtatja újra. */
    retryFailed?: boolean
    /** A riport fejlécében megjelenő parancssor; hiányában „run”. */
    command?: string
  },
  runtime: RunRuntime = {},
): Promise<number> {
  const commandLine = flags.command ?? 'run'
  const queueMode = flags.queue === true
  const commit = flags.commit && !flags.dryRun
  const recipe = flags.recipe ? getRecipe(flags.recipe) : null

  // Egy kliens és egy költségőr az egész indításra: a plafon így nem
  // receptenként, hanem együtt vonatkozik minden egységre.
  let model: ModelRuntime | undefined
  if (recipe || queueMode) {
    const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)
    model = {
      modelConfig,
      client: (runtime.createClient ?? createModelClient)(modelConfig),
      guard: createCostGuard(modelConfig.costLimitUsd),
    }
  }
  const depsFor = (unitRecipe: Recipe | null): RecipeDeps | undefined =>
    unitRecipe && model
      ? {
          recipe: unitRecipe,
          client: model.client,
          modelConfig: model.modelConfig,
          guard: model.guard,
        }
      : undefined

  // A futás műtermék-típusa queue nélkül: recepttel a recept azonosítója,
  // enélkül az átirat. A riport és a hibás-szűrő ugyanazt kérdezi.
  const artifactKind = recipe?.id ?? ARTIFACT_KIND

  if (commit) await gitPullFfOnly(cfg.vaultPath)

  // A sort a pull UTÁN olvassuk: a pull frissebb változatot hozhat.
  const sorPath = queuePath(cfg.notesRoot)
  const queueText = queueMode ? await readQueueFile(sorPath) : null
  if (queueMode && queueText === null) {
    console.error(`Nincs feldolgozási sor: ${sorPath}\nElőbb: refinery scan --queue`)
    return 1
  }

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

  // A napló első sora: a felület ebből tudja, mi fut, és él-e még a folyamat.
  printing({ type: 'run:started', command: commandLine, pid: process.pid })

  // A discoverAll teljes, szűretlen eredménye — a korpusz állapota a teljes
  // korpuszról szól, nem a szűrt szeletről. Korán inicializálva, hogy egy
  // korai SIGINT is riportot írjon (üres korpusszal), ne undefined-ra
  // hivatkozzon.
  let discovered: SourceItem[] = []
  /** A szűrés utáni egységek: a visszaírás és a sor-állapot ezekről szól. */
  let selected: WorkUnit[] = []
  /** Kipipált párok, amelyek eleme nem található. */
  let notFound: QueuePair[] = []
  /** A plafon miatt nem futott egységek kulcsai: szeletelés vagy futás közbeni megállás. */
  const capped = new Set<string>()
  const warnings: string[] = []

  let wroteBack = false
  /**
   * A sor visszaírása az állapottárból. Egy futáson belül legfeljebb egyszer:
   * normál befejezéskor a commit előtt, egyébként a `finish`-ben.
   */
  const writeBack = async (): Promise<boolean> => {
    if (!queueMode || flags.dryRun || wroteBack) return false
    wroteBack = true
    const current = await readQueueFile(sorPath)
    if (current === null) return false
    const statuses = new Map<string, string>()
    for (const unit of selected) {
      const kind = unitKind(unit)
      const record = store.artifactOf(unit.item.itemId, kind)
      const key = pairKey(unit.item.itemId, kind)
      if (record?.status === 'done') statuses.set(key, doneStatus(record, cfg.notesRoot))
      else if (record?.status === 'failed') statuses.set(key, failedStatus(record.error))
      else if (capped.has(unitKey(unit))) statuses.set(key, DEFERRED_STATUS)
    }
    for (const pair of notFound) {
      statuses.set(pairKey(pair.itemId, pair.recipeId), NOT_FOUND_STATUS)
    }
    const next = applyStatuses(current, statuses)
    if (next === current) return false
    await writeFileAtomic(sorPath, next)
    return true
  }

  /** A sor állapota receptenként, registry-sorrendben — csak queue-futásnál. */
  const queueStatus = (): QueueRecipeStatus[] | undefined => {
    if (!queueMode) return undefined
    const rows = new Map<string, QueueRecipeStatus>()
    const row = (recipeId: string): QueueRecipeStatus => {
      let r = rows.get(recipeId)
      if (!r) {
        r = { recipe: recipeId, selected: 0, done: 0, failed: 0, pending: 0, deferred: 0 }
        rows.set(recipeId, r)
      }
      return r
    }
    for (const unit of selected) {
      const r = row(unitKind(unit))
      r.selected++
      const status = store.artifactOf(unit.item.itemId, unitKind(unit))?.status
      if (status === 'done') r.done++
      else if (status === 'failed') r.failed++
      else if (capped.has(unitKey(unit))) r.deferred++
      else r.pending++
    }
    for (const pair of notFound) {
      const r = row(pair.recipeId)
      r.selected++
      r.failed++
    }
    return RECIPE_IDS.flatMap((recipeId) => {
      const r = rows.get(recipeId)
      return r ? [r] : []
    })
  }

  // Egyszeri lefutás: a megszakítás és a normál befejezés is meghívja a
  // `finish`-t, és versenyben lehetnek egymással (a `process.exit` a SIGINT
  // ágon csak a riport kiírása UTÁN fut le, addig a fő ág is tovább
  // haladhat). Az őr szinkron, még az első `await` előtt fut le, tehát
  // bármelyik hívás érkezzen is előbb, a másik nem írja felül a riportot.
  let finished = false

  const finish = async (interrupted: boolean): Promise<void> => {
    if (finished) return
    finished = true

    // Megszakításnál, a törzsben dobott kivételnél és a 2-es kilépőkódnál a
    // visszaírás itt történik; a normál ágon már megtörtént, ez pedig nem
    // csinál semmit.
    try {
      await writeBack()
    } catch (error) {
      console.error(`A sor visszaírása nem sikerült: ${(error as Error).message}`)
    }

    // A lezárás a naplóban: enélkül egy riport nélküli napló nem különböztetné
    // meg a még futót a keményen leállítottól.
    printing({ type: 'run:ended', interrupted })

    const summary = summarize(events)
    const kinds = queueMode
      ? RECIPE_IDS.filter((recipeId) => selected.some((unit) => unitKind(unit) === recipeId))
      : [artifactKind]
    const corpora = kinds.map((kind) => ({ kind, status: store.corpusStatus(discovered, kind) }))
    const queue = queueStatus()
    const remaining = queue
      ? {
          pending: queue.reduce((n, q) => n + q.pending + q.deferred, 0),
          failed: queue.reduce((n, q) => n + q.failed, 0),
        }
      : (corpora[0]?.status ?? { pending: 0, failed: 0 })
    const markdown = renderReport({
      runId: id,
      startedAt,
      finishedAt: new Date(),
      command: commandLine,
      summary,
      corpora,
      queue,
      warnings,
      runs: countRunLogs(cfg.logsDir),
      logPath,
      cost: model
        ? {
            spentUsd: model.guard.spentUsd(),
            limitUsd: model.modelConfig.costLimitUsd,
            capped: model.guard.exceeded(),
          }
        : undefined,
      nextCommand: nextCommand(commandLine, remaining),
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

    let units: WorkUnit[]
    if (queueMode) {
      const byId = new Map(discovered.map((item) => [item.itemId, item] as const))
      units = []
      for (const pair of checkedPairs(parseQueue(queueText ?? ''))) {
        const pairRecipe = RECIPES[pair.recipeId]
        if (!pairRecipe) {
          warnings.push(`ismeretlen recept a sorban: ${pair.recipeId} (${pair.itemId})`)
          continue
        }
        const item = byId.get(pair.itemId)
        if (item) units.push({ item, recipe: pairRecipe })
        else notFound.push(pair)
      }
      // A kapcsolók a párokat szűkítik. A nem található pár eleméről nem
      // tudunk forrást vagy csatornát, ezért csak a receptszűrő vonatkozik
      // rá; az újrapróbálás pedig csak állapottárban rögzített hibára értelmes.
      units = units.filter((unit) => matchesFilters(unit.item, flags))
      if (recipe) {
        units = units.filter((unit) => unit.recipe?.id === recipe.id)
        notFound = notFound.filter((pair) => pair.recipeId === recipe.id)
      }
      if (flags.retryFailed) {
        units = units.filter(
          (unit) => store.artifactOf(unit.item.itemId, unitKind(unit))?.status === 'failed',
        )
        notFound = []
      }
      if (flags.limit !== undefined) units = units.slice(0, flags.limit)
    } else {
      // A limitnek a JELÖLTEKET kell határolnia, nem a teljes korpuszt: a
      // forrás/csatorna szűrés és a hibás-szűrő UTÁN vágunk, különben pl.
      // `--retry-failed --limit 1` a felfedezés szerint elöl álló (esetleg
      // kész) elemet nézné meg, nem a hibásak közül az elsőt.
      let items = filterItems(discovered, flags)
      if (flags.retryFailed) items = store.listFailed(items, artifactKind)
      if (flags.limit !== undefined) items = items.slice(0, flags.limit)
      units = items.map((item) => ({ item, recipe }))
    }
    selected = units
    printing({ type: 'scan:found', count: units.length })

    let planned = units
    if (model) {
      const pending = flags.force
        ? units
        : units.filter((unit) => !store.isDone(unit.item.itemId, unitKind(unit)))
      const { slice, first } = await estimateUnits(pending, model.modelConfig)
      const limitUsd = model.modelConfig.costLimitUsd
      for (const unit of slice.deferred) capped.add(unitKey(unit))

      printing({
        type: 'run:estimate',
        items: slice.planned.length,
        tokens: slice.tokens,
        usd: slice.usd,
        limitUsd,
      })

      // Az üres becslés (nincs feldolgozandó egység — a szűrők vagy a már
      // kész elemek miatt) nem plafon-túllépés: a köteg simán, nulla
      // egységgel fut le. A 2-es kilépőkód KIZÁRÓLAG akkor jár, ha VAN
      // jelölt, de az első sem fér a plafon alá.
      if (first !== undefined && slice.planned.length === 0) {
        const firstUsd = estimateItemUsd(first.words, first.maxIterations, model.modelConfig)
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

      // A `planned` a SZŰRT egységlista, csökkentve a plafon miatt
      // elhalasztottakkal. Így a már kész egység a kihagyás ágára jut, a
      // hibás elem a feldolgozás hibaágára — modellhívás egyikkel sem jár,
      // tehát a plafon szemantikája sértetlen.
      planned = units.filter((unit) => !capped.has(unitKey(unit)))
    }

    const written = new Set<string>()
    for (const [index, unit] of planned.entries()) {
      const outcome = await processItem(unit.item, {
        notesRoot: cfg.notesRoot,
        store,
        sink: printing,
        version: VERSION,
        options: { force: flags.force, dryRun: flags.dryRun },
        recipeDeps: depsFor(unit.recipe),
      })
      if (outcome.status === 'published') {
        if (outcome.path) written.add(outcome.path)
        if (outcome.recipePath) written.add(outcome.recipePath)
      }

      if (model?.guard.exceeded()) {
        printing({
          type: 'run:aborted',
          reason: 'a tényleges költés meghaladta a plafont',
          spentUsd: model.guard.spentUsd(),
          limitUsd: model.modelConfig.costLimitUsd,
        })
        // A plafon miatt el sem indult egységek a sorban ⏳-t kapnak.
        for (const rest of planned.slice(index + 1)) capped.add(unitKey(rest))
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

    // A visszaírás a commit ELŐTT: a frissített sor ugyanabba a commitba kerül.
    const queueChanged = await writeBack()
    const paths = queueChanged ? [...written, sorPath] : [...written]
    if (commit && paths.length > 0) {
      const message = queueMode
        ? `docs(videos): ${String(written.size)} jegyzet a feldolgozási sorból`
        : `docs(videos): átirat ${String(written.size)} videóhoz`
      if (await gitCommitPaths(cfg.vaultPath, paths, message)) {
        const push = await gitPush(cfg.vaultPath)
        if (!push.pushed) console.log(`A push nem sikerült, a commit lokálisan maradt.`)
      }
    }

    await finish(false)
    return summary.failed > 0 || notFound.length > 0 ? 1 : 0
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
      queue: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  })

  const configPath = resolve(process.cwd(), values.config ?? CONFIG_FILENAME)
  const raw = await readConfigFile(configPath)
  const cfg = loadConfig(raw, configPath)
  await validateConfig(cfg)

  if (command === 'scan') {
    return values.queue
      ? commandScanQueue(cfg, { dryRun: values['dry-run'], commit: !values['no-commit'] })
      : commandScan(cfg)
  }
  if (command === 'check-pricing') {
    return commandCheckPricing(loadModelConfig(raw, process.env, cfg.configPath))
  }
  if (command === 'run') {
    return commandRun(cfg, raw, {
      source: values.source,
      channel: values.channel,
      limit: values.limit === undefined ? undefined : Number(values.limit),
      recipe: values.recipe,
      queue: values.queue,
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

// A fájlnév-alapú ellenőrzés (`endsWith('cli.js')`) csendben nem futtatta a
// `main()`-t, ha a fájlt `tsx src/cli.ts`-ként hívták meg — a `.ts` kiterjesztés
// nem `cli.js`-re végződik. Az útvonal-azonosság mindkét esetben helyesen
// felismeri a belépési pontot, a fájlnévtől függetlenül.
const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntrypoint) {
  loadDotEnv()
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: Error) => {
      console.error(error.message)
      process.exit(1)
    })
}
