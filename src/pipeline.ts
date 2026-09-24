import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'
import type { ModelConfig } from './config.js'
import type { EventSink } from './events.js'
import { identifyLanguage } from './lang/identify.js'
import type { CostGuard } from './model/budget.js'
import type { ModelClient } from './model/client.js'
import { costOf } from './model/pricing.js'
import { retrying } from './model/retry.js'
import { classifyCaptions, punctuationDensity } from './normalize/classify.js'
import { countWords, dedupeTimedLines } from './normalize/dedupe.js'
import { unanchoredParagraphs } from './recipe/anchor.js'
import { alreadyInTarget } from './recipe/translate.js'
import type { Recipe, RecipeInput, Translation } from './recipe/types.js'
import { refine } from './refine/loop.js'
import { parseSubtitle } from './subtitle/parse.js'
import type { StateStore } from './state/db.js'
import type { NormalizedTranscript, SourceItem } from './types.js'
import { lintVaultMarkdown } from './vault/lint.js'
import { noteBody, type NoteBody } from './vault/note-body.js'
import { noteFile } from './vault/paths.js'
import { exists, publishNote, type PublishOptions } from './vault/publish.js'
import { renderRecipeNote, renderTranscriptNote } from './vault/render.js'

export interface RecipeDeps {
  recipe: Recipe
  client: ModelClient
  modelConfig: ModelConfig
  guard: CostGuard
  /** Az újrapróbálkozás várakozása; a tesztek azonnalira cserélik. */
  sleep?: (ms: number) => Promise<void>
  /** Igaz esetén a bíró pontozói kimaradnak; a determinisztikus kapuk futnak. */
  skipJudge?: boolean
}

export interface PipelineDeps {
  notesRoot: string
  store: StateStore
  sink: EventSink
  version: string
  options: PublishOptions
  /** Ha hiányzik, a csővezeték a Fázis 0 útján marad: csak átirat. */
  recipeDeps?: RecipeDeps
  /**
   * A hívó futás commit-módban van-e. Ha igen, minden megírt műtermék a
   * commitra várók közé kerül — a hívó ebből tudja, mit kell commitolnia,
   * akár egy megszakadt vagy elhasalt korábbi futásból maradt ott.
   */
  commit?: boolean
}

export interface ItemOutcome {
  status: 'published' | 'skipped' | 'failed'
  path?: string
  /** A recept jegyzetének útvonala, ha készült ilyen. */
  recipePath?: string
  error?: string
  /** A recept kihagyásának oka, ha fordítás volt, és nem futott — a sor és a riport ebből ír. */
  skipReason?: string
}

/** Az átirat műtermék-típusa. A CLI is ezt használja — egyetlen forrásból. */
export const ARTIFACT_KIND = 'transcript'

/**
 * Feliratfájl → normalizált átirat. A `scan`, a költségbecslés és a
 * feldolgozás ugyanezt hívja, hogy a szószám mindhárom helyen ugyanaz legyen.
 */
export async function normalizeItem(
  item: SourceItem,
): Promise<NormalizedTranscript> {
  const raw = await readFile(item.subtitlePath, 'utf8')
  const cues = parseSubtitle(raw, item.subtitlePath)
  if (cues.length === 0) {
    throw new Error('a feliratfájl nem tartalmaz értelmezhető feliratblokkot')
  }

  const rawText = cues.flatMap((c) => c.lines).join(' ')
  const timed = dedupeTimedLines(cues)
  if (timed.length === 0) {
    throw new Error('a feliratfájl nem tartalmaz szöveget')
  }
  const lines = timed.map((line) => line.text)
  const normalizedText = lines.join(' ')

  // A fájlnév nyelvkódja az elsődleges forrás; ha nincs, a tartalom dönt.
  // Csendes angol alapértelmezés helyett megnevezett hiba: egy holland vagy
  // német feliratot angolnak véve a nyelvi kapu rossz alaphoz mérne.
  if (item.language === null) {
    const detected = identifyLanguage(normalizedText)
    if (detected === null) {
      throw new Error(
        'a feliratfájl nevében nincs nyelvkód, és a tartalom nyelve sem ' +
          `ismerhető fel biztosan: ${item.sourceFile}`,
      )
    }
    item.language = detected
  }

  return {
    lines,
    timed,
    wordsRaw: countWords(rawText),
    wordsNormalized: countWords(normalizedText),
    captionSource: classifyCaptions(normalizedText),
    punctuationDensity: punctuationDensity(normalizedText),
  }
}

/** Lintel, publikál, és rögzíti az állapotot. */
async function publishRendered(
  target: string,
  markdown: string,
  item: SourceItem,
  kind: string,
  deps: PipelineDeps,
): Promise<ItemOutcome> {
  const lintErrors = lintVaultMarkdown(markdown)
  if (lintErrors.length > 0) {
    throw new Error(`a jegyzet megsérti a vault írási szabályait: ${lintErrors.join('; ')}`)
  }

  const result = await publishNote(target, markdown, deps.options)
  if (result.status === 'skipped') {
    deps.store.recordArtifact(item.itemId, kind, 'done', result.path, null, undefined, deps.commit)
    deps.sink({ type: 'item:skipped', itemId: item.itemId, reason: 'a fájl már létezik' })
    return { status: 'skipped', path: result.path }
  }

  if (!deps.options.dryRun) {
    deps.store.recordArtifact(item.itemId, kind, 'done', result.path, null, undefined, deps.commit)
  }
  deps.sink({ type: 'item:published', itemId: item.itemId, path: result.path })
  return { status: 'published', path: result.path }
}

/**
 * Egy fordítás forrásjegyzete, az állapottárban rögzített útról. A futás csak
 * kész forrásnál indít fordítást; ez az ellenőrzés a közvetlen hívót is védi.
 */
async function readSourceNote(
  item: SourceItem,
  translation: Translation,
  deps: PipelineDeps,
): Promise<NoteBody> {
  const record = deps.store.artifactOf(item.itemId, translation.source.id)
  if (record?.status !== 'done' || record.path === null) {
    throw new Error(`előbb a ${translation.source.id} recept kell`)
  }
  let markdown: string
  try {
    markdown = await readFile(record.path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`a forrásjegyzet nem található: ${relative(deps.notesRoot, record.path)}`, {
        cause: error,
      })
    }
    throw error
  }
  return noteBody(markdown)
}

/** A 6. csővezeték-lépés: recept futtatása és publikálása. */
async function runRecipe(
  item: SourceItem,
  transcript: NormalizedTranscript,
  deps: PipelineDeps,
  recipeDeps: RecipeDeps,
): Promise<ItemOutcome> {
  const { recipe, modelConfig, guard } = recipeDeps

  // A write-once elv a modellhívás ELŐTT: a már meglévő jegyzetért nem
  // fizetünk. A `force` felülírja a fájlt, ezért ott a hívás is kell. A fájlt
  // nem a pipeline írta, ezért nem kerül a commitra várók közé.
  if (recipe.publishable && !deps.options.force) {
    const target = noteFile(deps.notesRoot, item, recipe.outputFile)
    if (await exists(target)) {
      if (!deps.options.dryRun) {
        deps.store.recordArtifact(item.itemId, recipe.id, 'done', target, null)
      }
      deps.sink({ type: 'item:skipped', itemId: item.itemId, reason: 'a fájl már létezik' })
      return { status: 'skipped', recipePath: target }
    }
  }

  // Fordításnál a bemenet és a viszonyítási alap a forrásjegyzet törzse, nem az
  // átirat: így a rubrika a forráshoz mér, és a `refine` loop érintetlen.
  let input: RecipeInput = { item, transcript: transcript.lines.join(' '), timed: transcript.timed }
  let source: NoteBody | null = null
  if (recipe.translation) {
    source = await readSourceNote(item, recipe.translation, deps)
    const reason = alreadyInTarget(source.body, recipe.translation.target)
    if (reason !== null) {
      deps.sink({ type: 'item:skipped', itemId: item.itemId, reason })
      return { status: 'skipped', skipReason: reason }
    }
    input = { item, transcript: source.body, timed: [] }
  }

  // A dekorátor elemenként készül, hogy az esemény meg tudja nevezni, melyik
  // elem hívása bukott el.
  const client = retrying(recipeDeps.client, {
    sleep: recipeDeps.sleep,
    onRetry: ({ attempt, delayMs, reason }) =>
      deps.sink({ type: 'item:retry', itemId: item.itemId, attempt, delayMs, reason }),
  })

  // A dryRun itt NEM érvényesül: ez a hívás feltétel nélkül lefut, valós
  // költséggel. Csak a lenti recordArtifact/publishNote van dryRun mögé zárva.
  const result = await refine(recipe, input, client, {
    // Az élő követés ezekből látja, hol tart a loop: enélkül a modellhívások
    // alatt — a futásidő nagyobb részében — nem jönne esemény.
    onGenerate: (generation) =>
      deps.sink({ type: 'item:generating', itemId: item.itemId, recipe: recipe.id, generation }),
    onScore: (score, gaps) =>
      deps.sink({ type: 'item:scored', itemId: item.itemId, recipe: recipe.id, score, gaps }),
    skipJudge: recipeDeps.skipJudge,
  })

  // Körönként és szerepenként könyvelünk: a generálás a recept szerepén, a
  // pontozás a bíróén. Az összevont `result.usage` a bíró tokenjeit is a
  // vázlatmodell árán számolná — a mérő script ezt épp elkerüli.
  let usd = 0
  for (const round of result.rounds) {
    guard.add(recipe.role, round.generateUsage, modelConfig)
    guard.add('judge', round.scoreUsage, modelConfig)
    usd +=
      costOf(round.generateUsage, modelConfig.pricing[recipe.role]) +
      costOf(round.scoreUsage, modelConfig.pricing.judge)
  }

  deps.sink({
    type: 'item:refined',
    itemId: item.itemId,
    recipe: recipe.id,
    score: result.score,
    generations: result.generations,
    usd,
    rounds: result.rounds.map((round) => ({
      score: round.score,
      gaps: round.gaps,
      generateTokens: {
        input: round.generateUsage.inputTokens,
        output: round.generateUsage.outputTokens,
      },
      scoreTokens: {
        input: round.scoreUsage.inputTokens,
        output: round.scoreUsage.outputTokens,
      },
    })),
  })

  // Csak az időbélyeges receptnél értelmes: egy `summary` jegyzetben minden
  // bekezdés időbélyeg nélküli, az nem hiány.
  if (recipe.anchored) {
    const { count, total } = unanchoredParagraphs(result.output)
    if (count > 0) {
      deps.sink({ type: 'item:anchor-skipped', itemId: item.itemId, recipe: recipe.id, count, total })
    }
  }

  // A `publishable: false` a publisher által kikényszerített invariáns, nem
  // konvenció: bizonyos típusok soha nem kerülhetnek publikálási útra.
  if (!recipe.publishable) {
    if (!deps.options.dryRun) {
      deps.store.recordArtifact(item.itemId, recipe.id, 'done', null, null, {
        iterations: result.generations,
        score: result.score,
        costUsd: usd,
        model: modelConfig.models[recipe.role],
        gaps: result.gaps,
      })
    }
    return { status: 'skipped' }
  }

  const markdown = renderRecipeNote(item, transcript, result.output, {
    recipe: recipe.id,
    model: modelConfig.models[recipe.role],
    iterations: result.generations,
    score: result.score,
    costUsd: usd,
    tags: recipe.tags,
    translation:
      recipe.translation && source
        ? {
            language: recipe.translation.target,
            sourceRecipe: recipe.translation.source.id,
            sourceGeneratedAt: source.generatedAt,
          }
        : undefined,
  }, deps.version)

  const lintErrors = lintVaultMarkdown(markdown)
  if (lintErrors.length > 0) {
    throw new Error(`a jegyzet megsérti a vault írási szabályait: ${lintErrors.join('; ')}`)
  }

  const target = noteFile(deps.notesRoot, item, recipe.outputFile)
  const published = await publishNote(target, markdown, deps.options)

  if (!deps.options.dryRun) {
    deps.store.recordArtifact(
      item.itemId,
      recipe.id,
      'done',
      published.path,
      null,
      {
        iterations: result.generations,
        score: result.score,
        costUsd: usd,
        model: modelConfig.models[recipe.role],
        gaps: result.gaps,
      },
      deps.commit,
    )
  }

  if (published.status === 'skipped') {
    deps.sink({ type: 'item:skipped', itemId: item.itemId, reason: 'a fájl már létezik' })
    return { status: 'skipped', recipePath: published.path }
  }

  deps.sink({ type: 'item:published', itemId: item.itemId, path: published.path })
  return { status: 'published', recipePath: published.path }
}

/** Egyetlen elem végigvitele a csővezetéken. Soha nem dob kivételt. */
export async function processItem(
  item: SourceItem,
  deps: PipelineDeps,
): Promise<ItemOutcome> {
  const { store, sink, version, options, recipeDeps } = deps
  sink({ type: 'item:start', itemId: item.itemId, title: item.title })
  store.recordItem(item)

  const kellAtirat = options.force || !store.isDone(item.itemId, ARTIFACT_KIND)
  const kellRecept =
    recipeDeps !== undefined &&
    (options.force || !store.isDone(item.itemId, recipeDeps.recipe.id))

  if (!kellAtirat && !kellRecept) {
    sink({ type: 'item:skipped', itemId: item.itemId, reason: 'már feldolgozva' })
    return { status: 'skipped' }
  }

  try {
    const transcript = await normalizeItem(item)
    sink({ type: 'item:parsed', itemId: item.itemId, cues: transcript.lines.length })
    sink({
      type: 'item:normalized',
      itemId: item.itemId,
      wordsRaw: transcript.wordsRaw,
      wordsNormalized: transcript.wordsNormalized,
      captionSource: transcript.captionSource,
    })
    store.recordTranscript(
      item.itemId,
      transcript.captionSource,
      transcript.wordsRaw,
      transcript.wordsNormalized,
    )

    let outcome: ItemOutcome = { status: 'skipped' }

    if (kellAtirat) {
      outcome = await publishRendered(
        noteFile(deps.notesRoot, item, '_transcript.md'),
        renderTranscriptNote(item, transcript, version),
        item,
        ARTIFACT_KIND,
        deps,
      )
    }

    if (kellRecept && recipeDeps) {
      try {
        const recipeOutcome = await runRecipe(item, transcript, deps, recipeDeps)
        if (recipeOutcome.status === 'published') {
          outcome = { ...recipeOutcome, path: outcome.path ?? recipeOutcome.recipePath }
        } else if (recipeOutcome.skipReason !== undefined) {
          outcome = { ...outcome, skipReason: recipeOutcome.skipReason }
        }
      } catch (error) {
        const message = (error as Error).message
        const stack = (error as Error).stack
        store.recordArtifact(item.itemId, recipeDeps.recipe.id, 'failed', null, message)
        sink({
          type: 'item:failed',
          itemId: item.itemId,
          source: item.source,
          kind: recipeDeps.recipe.id,
          error: message,
          stack,
        })
        // A recept hibája nem ronthatja el az átirat már sikeres állapotát —
        // az `outcome` a már elért eredményt (vagy a kezdeti 'skipped'-et) tartja meg.
      }
    }

    return outcome
  } catch (error) {
    const message = (error as Error).message
    const stack = (error as Error).stack
    // MINDKÉT érintett típusra rögzítünk: ha ez a hívás recept-futás volt,
    // a `store.corpusStatus`/`store.listFailed` a recept azonosítója alatt
    // keres (lásd `cli.ts` `artifactKind`), nem `ARTIFACT_KIND` alatt —
    // enélkül az elem örökre „hátra" (pending) maradna a korpuszriportban.
    // Típusonként egy esemény is megy: a riport hibalistája (elem, típus)
    // párokra bomlik.
    if (kellAtirat) {
      store.recordArtifact(item.itemId, ARTIFACT_KIND, 'failed', null, message)
      sink({
        type: 'item:failed',
        itemId: item.itemId,
        source: item.source,
        kind: ARTIFACT_KIND,
        error: message,
        stack,
      })
    }
    if (kellRecept && recipeDeps) {
      store.recordArtifact(item.itemId, recipeDeps.recipe.id, 'failed', null, message)
      sink({
        type: 'item:failed',
        itemId: item.itemId,
        source: item.source,
        kind: recipeDeps.recipe.id,
        error: message,
        stack,
      })
    }
    return { status: 'failed', error: message }
  }
}
