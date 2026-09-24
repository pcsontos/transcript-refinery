#!/usr/bin/env node
import { existsSync, realpathSync } from 'node:fs'
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
  readConfigText,
  validateConfig,
  type Config,
  type ModelConfig,
} from './config.js'
import { collectEvents, summarize, type RunEvent } from './events.js'
import { createCostGuard, estimateItemUsd, type CostGuard } from './model/budget.js'
import { createModelClient, type ModelClient } from './model/client.js'
import { applyPricingFix, comparePricing, fetchLivePricing } from './model/pricing-check.js'
import { classifyCaptions } from './normalize/classify.js'
import { countWords, dedupeLines } from './normalize/dedupe.js'
import { ARTIFACT_KIND, normalizeItem, processItem, type RecipeDeps } from './pipeline.js'
import { doneLookup, markDone } from './queue/done.js'
import { queuePath, readQueueFile } from './queue/file.js'
import { queueLayout } from './queue/layout.js'
import { isLegacyQueue, migrateLegacy } from './queue/legacy.js'
import { mergeQueue } from './queue/merge.js'
import { checkedPairs, parseQueue, type QueuePair } from './queue/parse.js'
import { renumberQueue } from './queue/renumber.js'
import {
  DEFERRED_STATUS,
  NOT_FOUND_STATUS,
  applyStatuses,
  doneStatus,
  failedStatus,
  pairKey,
  skippedStatus,
} from './queue/status.js'
import { recipeFrom, recipesFor } from './recipe/registry.js'
import type { Recipe } from './recipe/types.js'
import { countRunLogs, installSigint, writeReport } from './run/finish.js'
import { reserveRunId, runId } from './run/id.js'
import { openRunLog } from './run/log.js'
import {
  estimateUnits,
  filterItems,
  matchesFilters,
  sourceGap,
  sourcePlanned,
  sourcesFirst,
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

/**
 * A `finish` commitból eredő hibáját jelöli, megkülönböztetve a riportírás
 * hibájától — a két hívó (a törzs `finally`-je és a SIGINT-kezelő) enélkül
 * nem tudná, melyik üzenetet írja ki.
 */
class VaultCommitError extends Error {
  constructor(cause: Error) {
    super(cause.message, { cause })
  }
}

/** A `finish` hibájából a hívónak szóló üzenet — a valódi okot nevezi meg, nem azt, melyik hívó észlelte. */
function describeFinishError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return error instanceof VaultCommitError
    ? `A vault-commit nem sikerült: ${message}`
    : `A riport nem készült el: ${message}`
}

export const USAGE = `refinery <parancs> [kapcsolók]

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
  --no-judge        a bíró pontozói nem futnak (a determinisztikus kapuk
                    igen); felülírja a model.judge_enabled beállítást
  --fix             check-pricing: a talált árazási eltéréseket visszaírja
                    a konfigurációs fájlba
  --help, -h        megjeleníti ezt a súgót

  A futás naplója és riportja a konfigurációban megadott logs.dir alá kerül.
`

/**
 * Az app saját, vaultba írt commitjainak scope-ja. Az app neve, nem a
 * feldolgozott tartalomé: a `videos` egy korábbi, videó-központú fázisból
 * maradt itt.
 */
const COMMIT_SCOPE = 'transcript-refinery'

function render(event: RunEvent): string | null {
  switch (event.type) {
    case 'scan:found':
      return `${event.count} feldolgozható videó`
    case 'item:start':
      return `▸ ${event.itemId}: ${event.title}`
    case 'item:generating':
      return `  … ${event.itemId}: ${event.recipe} generálás #${String(event.generation)}`
    case 'item:scored':
      return `  · ${event.itemId}: ${event.recipe} kör ${event.score.toFixed(2)}, ${String(event.gaps)} hiány`
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
    case 'item:anchor-skipped':
      return `  ! ${event.itemId}: ${String(event.count)}/${String(event.total)} bekezdés időbélyeg nélkül`
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
 * Nyelvkód nélküli feliratnál a tartalom dönt a nyelvről, ugyanúgy, mint a
 * futásban (`normalizeItem`). Az eredeti elemet nem módosítja. Ha a nyelv a
 * tartalomból sem ismerhető fel, vagy a felirat nem olvasható, `null` marad:
 * a scan ettől nem áll meg, a fordítássor pedig megmarad.
 */
async function withContentLanguage(items: readonly SourceItem[]): Promise<SourceItem[]> {
  return Promise.all(
    items.map(async (item) => {
      if (item.language !== null) return item
      const copy = { ...item }
      try {
        await normalizeItem(copy)
      } catch {
        // A nyelv null marad.
      }
      return copy
    }),
  )
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
  // A regiszter a felderítés és a sor írása előtt épül: egy hibás translate
  // kulcs így nem hagy félig frissített sort maga után.
  const registry = recipesFor(cfg)
  const commit = flags.commit && !flags.dryRun
  if (commit) await gitPullFfOnly(cfg.vaultPath)

  const layout = queueLayout(registry)
  const items = await withContentLanguage(await discoverAll(cfg.sources, cfg.languages))
  const path = queuePath(cfg.notesRoot)
  const current = await readQueueFile(path)
  // A régi formátumot egyszer átalakítjuk; utána a merge és az újraszámozás
  // már az újat látja.
  const legacy = current === null ? null : migrateLegacy(current, layout)
  const merged = mergeQueue(legacy?.text ?? null, items, layout)
  // Az állapottárat csak olvassuk, és csak ha már van: a scan nem hoz létre
  // állapottárat. Nélküle a „kész" forrása a lemezen lévő jegyzet.
  const store = existsSync(cfg.statePath) ? openState(cfg.statePath) : null
  let done: ReturnType<typeof markDone>
  try {
    done = markDone(
      merged.text,
      doneLookup({
        items: new Map(items.map((item) => [item.itemId, item] as const)),
        registry,
        notesRoot: cfg.notesRoot,
        artifactOf: (itemId, kind) => store?.artifactOf(itemId, kind) ?? null,
        exists: existsSync,
      }),
    )
  } finally {
    store?.close()
  }
  const text = renumberQueue(done.text)
  const { stats } = merged

  console.log(
    `${String(items.length)} feldolgozható felirat · ${String(stats.addedVideos)} új videó, ` +
      `${String(stats.addedRecipeLines)} új receptsor meglévő videó alatt, ` +
      `${String(stats.changedMarks)} jelölés-változás`,
  )
  if (legacy?.migrated) {
    console.log('A sor átalakítva az új formátumra: számozott fejlécek, behúzott fordítások.')
  }
  if (stats.removedTranslationLines > 0) {
    console.log(
      `${String(stats.removedTranslationLines)} fordítássor törölve célnyelvű videó alól.`,
    )
  }
  if (done.marked > 0) {
    console.log(
      `${String(done.marked)} sor késznek jelölve (állapottár vagy meglévő jegyzet alapján).`,
    )
  }
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
  if (
    commit &&
    (await gitCommitPaths(cfg.vaultPath, [path], `docs(${COMMIT_SCOPE}): feldolgozási sor frissítése`))
  ) {
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
export async function commandCheckPricing(
  modelConfig: ModelConfig,
  opts: { fix?: boolean; configPath?: string } = {},
): Promise<number> {
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
    return 0
  }

  if (mismatches.length > 0 && opts.fix && opts.configPath) {
    const fixed = applyPricingFix(await readConfigText(opts.configPath), mismatches)
    await writeFileAtomic(opts.configPath, fixed)
    console.log(
      `Javítva a configban: ${mismatches.map((m) => m.role).join(', ')} — ${opts.configPath}`,
    )
    return 0
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
    /** A `--no-judge`; hiányában (`undefined`) a config `judge_enabled` mezője dönt. */
    noJudge?: boolean
    /** A riport fejlécében megjelenő parancssor; hiányában „run”. */
    command?: string
  },
  runtime: RunRuntime = {},
): Promise<number> {
  const commandLine = flags.command ?? 'run'
  const queueMode = flags.queue === true
  const commit = flags.commit && !flags.dryRun
  const registry = recipesFor(cfg)
  const recipe = flags.recipe ? recipeFrom(registry, flags.recipe) : null

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
  // A CLI elsőbbsége: a megadott kapcsoló felülírja a configot, hiányában a
  // config dönt. A `--no-judge` csak kikapcsolni tud — visszakapcsolni nem
  // kell, mert a config alapértelmezése amúgy is a bekapcsolt bíró.
  const skipJudge = flags.noJudge ?? !(model?.modelConfig.judgeEnabled ?? true)

  const depsFor = (unitRecipe: Recipe | null): RecipeDeps | undefined =>
    unitRecipe && model
      ? {
          recipe: unitRecipe,
          client: model.client,
          modelConfig: model.modelConfig,
          guard: model.guard,
          skipJudge,
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
  if (queueMode && queueText !== null && isLegacyQueue(queueText)) {
    console.error(
      `A feldolgozási sor még a régi formátumú: ${sorPath}\n` +
        'Előbb: refinery scan --queue — ez átalakítja, a pipákkal együtt.',
    )
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
  /** A forrás hiánya vagy a már célnyelvű forrás miatt kihagyott fordítási egységek, okkal. */
  const skipped = new Map<string, { unit: WorkUnit; reason: string }>()
  const skip = (unit: WorkUnit, reason: string): void => {
    skipped.set(unitKey(unit), { unit, reason })
    printing({ type: 'item:skipped', itemId: unit.item.itemId, reason })
  }

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
      // A kihagyás ennek a futásnak a friss ítélete: felülírja a párról korábban
      // rögzített állapotot.
      const kihagyva = skipped.get(unitKey(unit))
      if (kihagyva) statuses.set(key, skippedStatus(kihagyva.reason))
      else if (record?.status === 'done') statuses.set(key, doneStatus(record, cfg.notesRoot))
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
        r = { recipe: recipeId, selected: 0, done: 0, failed: 0, pending: 0, deferred: 0, skipped: 0 }
        rows.set(recipeId, r)
      }
      return r
    }
    for (const unit of selected) {
      const r = row(unitKind(unit))
      r.selected++
      const status = store.artifactOf(unit.item.itemId, unitKind(unit))?.status
      if (skipped.has(unitKey(unit))) r.skipped++
      else if (status === 'done') r.done++
      else if (status === 'failed') r.failed++
      else if (capped.has(unitKey(unit))) r.deferred++
      else r.pending++
    }
    for (const pair of notFound) {
      const r = row(pair.recipeId)
      r.selected++
      r.failed++
    }
    return Object.keys(registry).flatMap((recipeId) => {
      const r = rows.get(recipeId)
      return r ? [r] : []
    })
  }

  // Egyszeri lefutás: a megszakítás és a normál befejezés is meghívja a
  // `finish`-t, és versenyben lehetnek egymással. A második hívó ne egy
  // azonnal teljesült, üres promise-t kapjon vissza — a `finish` MOST már
  // valódi munkát végez (git commit, push), és a SIGINT-ág `exit`-je enélkül
  // megelőzhetné a másik hívás tényleges befejezését. Ezért mindkét hívó
  // ugyanazt a promise-t várja: a második hívás `interrupted` paramétere
  // eldobódik, de a munka csak egyszer fut, és mindkét hívó a tényleges
  // befejezésre vár.
  let finishPromise: Promise<void> | undefined

  const finish = (interrupted: boolean): Promise<void> => {
    finishPromise ??= runFinish(interrupted)
    return finishPromise
  }

  const runFinish = async (interrupted: boolean): Promise<void> => {
    // Megszakításnál, a törzsben dobott kivételnél és a 2-es kilépőkódnál a
    // visszaírás itt történik; a normál ágon már megtörtént, ez pedig nem
    // csinál semmit.
    let queueChanged = false
    try {
      queueChanged = await writeBack()
    } catch (error) {
      console.error(`A sor visszaírása nem sikerült: ${(error as Error).message}`)
    }

    // A commit is itt történik, ne csak a törzs sikeres ágán: így a
    // megszakítás vagy egy korábbi elhasalt commit miatt még commitra váró,
    // de már megírt jegyzetek is bekerülnek — az #25 issue épp ezt hiányolta.
    // A hibáját elkapjuk, hogy a riport akkor is elkészüljön (lásd lent), de a
    // végén újradobjuk, hogy a hívó megtudja.
    let commitError: Error | undefined
    if (commit) {
      try {
        // MINDEN commitra váró jegyzetet felvesz, nem csak ennek a futásnak a
        // válogatását: egy korábbi, más szűrővel futott kötegből maradt
        // jegyzetet is pótol — enélkül egy megszakadt `--recipe summary`
        // futás után egy `--recipe qa` futás sosem venné fel.
        const notePaths = store.listPendingCommits()
        const paths = queueChanged ? [...notePaths, sorPath] : notePaths
        if (paths.length > 0) {
          const message = queueMode
            ? `docs(${COMMIT_SCOPE}): ${String(notePaths.length)} jegyzet a feldolgozási sorból`
            : `docs(${COMMIT_SCOPE}): átirat ${String(notePaths.length)} videóhoz`
          if (await gitCommitPaths(cfg.vaultPath, paths, message)) {
            const push = await gitPush(cfg.vaultPath)
            if (!push.pushed) console.log('A push nem sikerült, a commit lokálisan maradt.')
          }
          store.clearPendingCommits(notePaths)
        }
      } catch (error) {
        commitError = error as Error
      }
    }

    // A lezárás a naplóban: enélkül egy riport nélküli napló nem különböztetné
    // meg a még futót a keményen leállítottól.
    printing({ type: 'run:ended', interrupted })

    for (const { unit, reason } of skipped.values()) {
      warnings.push(`${unitKind(unit)} — ${unit.item.title}: ${reason}`)
    }

    const summary = summarize(events)
    const kinds = queueMode
      ? Object.keys(registry).filter((recipeId) => selected.some((unit) => unitKind(unit) === recipeId))
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

    if (commitError) throw new VaultCommitError(commitError)
  }

  // A kezelő nem zárja az állapottárat. Egy valódi Ctrl+C-nél a
  // process.exit úgyis véget vet a folyamatnak, és az állapottár minden
  // írása már commitolva van; a tesztben pedig a hamis exit után a futás
  // zavartalanul befejeződik, ami egy lezárt adatbázison hibát dobna.
  const uninstallSigint = installSigint(() => {
    void finish(true)
      .catch((error: unknown) => console.error(describeFinishError(error)))
      .then(() => (runtime.exit ?? process.exit)(130))
  }, runtime.signals)

  try {
    discovered = await discoverAll(cfg.sources, cfg.languages)

    let units: WorkUnit[]
    if (queueMode) {
      const byId = new Map(discovered.map((item) => [item.itemId, item] as const))
      units = []
      for (const pair of checkedPairs(parseQueue(queueText ?? ''))) {
        const pairRecipe = registry[pair.recipeId]
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
    // A fordítás a forrása után fut: a sor kézi átrendezése ezt nem fordíthatja meg.
    units = sourcesFirst(units)
    selected = units
    printing({ type: 'scan:found', count: units.length })

    let planned = units
    if (model) {
      const pending = (
        flags.force
          ? units
          : units.filter((unit) => !store.isDone(unit.item.itemId, unitKind(unit)))
      ).filter((unit) => {
        // Egy fordítás csak akkor tervezhető, ha a forrása kész, vagy ugyanebben
        // az indításban készül. A szeletelő az első túllépés után mindent
        // elhalaszt, a fordítások pedig a forrásaik után állnak: egy elhalasztott
        // forrás fordítása így maga is elhalasztott lesz.
        const gap = sourceGap(unit, store)
        if (gap === null || sourcePlanned(unit, units)) return true
        skip(unit, gap)
        return false
      })
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
        const firstUsd = estimateItemUsd(
          first.words,
          first.maxIterations,
          model.modelConfig,
          first.shape,
        )
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
      planned = units.filter((unit) => !capped.has(unitKey(unit)) && !skipped.has(unitKey(unit)))
    }

    for (const [index, unit] of planned.entries()) {
      // A forrás ebben a futásban is elbukhatott: a fordítás ilyenkor modellhívás
      // nélkül kimarad.
      const gap = sourceGap(unit, store)
      if (gap !== null) {
        skip(unit, gap)
        continue
      }
      const outcome = await processItem(unit.item, {
        notesRoot: cfg.notesRoot,
        store,
        sink: printing,
        version: VERSION,
        options: { force: flags.force, dryRun: flags.dryRun },
        recipeDeps: depsFor(unit.recipe),
        commit,
      })
      // A pipeline maga bocsátja ki az `item:skipped` eseményt; itt csak a sor és
      // a riport kedvéért jegyezzük fel.
      if (outcome.skipReason !== undefined) {
        skipped.set(unitKey(unit), { unit, reason: outcome.skipReason })
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
      console.error(describeFinishError(error))
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
  const wantsHelp = argv.includes('--help') || argv.includes('-h')
  if (!command || wantsHelp) {
    console.log(USAGE)
    return wantsHelp ? 0 : 1
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
      // Szándékosan `default` nélkül: az `undefined` jelenti azt, hogy a
      // kapcsolót nem adták meg, és ilyenkor a config dönt.
      'no-judge': { type: 'boolean' },
      fix: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
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
    return commandCheckPricing(loadModelConfig(raw, process.env, cfg.configPath), {
      fix: values.fix,
      configPath,
    })
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
      noJudge: values['no-judge'],
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
//
// A `process.argv[1]`-et a valódi útvonalára oldjuk fel (`realpathSync`),
// mert az `import.meta.url` a Node ESM-loaderében szimlinkeken átkövetkezik
// (a valódi fájl URL-jét adja), a parancssori argumentum viszont nem — egy
// npm/pnpm bin-szimlinken (`node_modules/.bin/refinery`) át indítva a kettő
// enélkül sosem egyezne, és a `main()` csendben el sem indulna.
const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
if (isEntrypoint) {
  loadDotEnv()
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: Error) => {
      console.error(error.message)
      process.exit(1)
    })
}
