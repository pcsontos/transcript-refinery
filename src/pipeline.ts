import { readFile } from 'node:fs/promises'
import type { ModelConfig } from './config.js'
import type { EventSink } from './events.js'
import type { CostGuard } from './model/budget.js'
import type { ModelClient } from './model/client.js'
import { costOf } from './model/pricing.js'
import { retrying } from './model/retry.js'
import { classifyCaptions, punctuationDensity } from './normalize/classify.js'
import { countWords, dedupeLines } from './normalize/dedupe.js'
import type { Recipe } from './recipe/types.js'
import { refine } from './refine/loop.js'
import { parseSubtitle } from './subtitle/parse.js'
import type { StateStore } from './state/db.js'
import type { NormalizedTranscript, SourceItem } from './types.js'
import { lintVaultMarkdown } from './vault/lint.js'
import { noteFile } from './vault/paths.js'
import { publishNote, type PublishOptions } from './vault/publish.js'
import { renderRecipeNote, renderTranscriptNote } from './vault/render.js'

export interface RecipeDeps {
  recipe: Recipe
  client: ModelClient
  modelConfig: ModelConfig
  guard: CostGuard
  /** Az újrapróbálkozás várakozása; a tesztek azonnalira cserélik. */
  sleep?: (ms: number) => Promise<void>
}

export interface PipelineDeps {
  notesRoot: string
  store: StateStore
  sink: EventSink
  version: string
  options: PublishOptions
  /** Ha hiányzik, a csővezeték a Fázis 0 útján marad: csak átirat. */
  recipeDeps?: RecipeDeps
}

export interface ItemOutcome {
  status: 'published' | 'skipped' | 'failed'
  path?: string
  /** A recept jegyzetének útvonala, ha készült ilyen. */
  recipePath?: string
  error?: string
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
  const lines = dedupeLines(cues)
  if (lines.length === 0) {
    throw new Error('a feliratfájl nem tartalmaz szöveget')
  }
  const normalizedText = lines.join(' ')

  return {
    lines,
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
    deps.store.recordArtifact(item.itemId, kind, 'done', result.path, null)
    deps.sink({ type: 'item:skipped', itemId: item.itemId, reason: 'a fájl már létezik' })
    return { status: 'skipped', path: result.path }
  }

  if (!deps.options.dryRun) {
    deps.store.recordArtifact(item.itemId, kind, 'done', result.path, null)
  }
  deps.sink({ type: 'item:published', itemId: item.itemId, path: result.path })
  return { status: 'published', path: result.path }
}

/** A 6. csővezeték-lépés: recept futtatása és publikálása. */
async function runRecipe(
  item: SourceItem,
  transcript: NormalizedTranscript,
  deps: PipelineDeps,
  recipeDeps: RecipeDeps,
): Promise<ItemOutcome> {
  const { recipe, modelConfig, guard } = recipeDeps
  const text = transcript.lines.join(' ')

  // A dekorátor elemenként készül, hogy az esemény meg tudja nevezni, melyik
  // elem hívása bukott el.
  const client = retrying(recipeDeps.client, {
    sleep: recipeDeps.sleep,
    onRetry: ({ attempt, delayMs, reason }) =>
      deps.sink({ type: 'item:retry', itemId: item.itemId, attempt, delayMs, reason }),
  })

  // A dryRun itt NEM érvényesül: ez a hívás feltétel nélkül lefut, valós
  // költséggel. Csak a lenti recordArtifact/publishNote van dryRun mögé zárva.
  const result = await refine(recipe, { item, transcript: text }, client)

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
  })

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
        }
      } catch (error) {
        const message = (error as Error).message
        store.recordArtifact(item.itemId, recipeDeps.recipe.id, 'failed', null, message)
        sink({
          type: 'item:failed',
          itemId: item.itemId,
          source: item.source,
          kind: recipeDeps.recipe.id,
          error: message,
        })
        // A recept hibája nem ronthatja el az átirat már sikeres állapotát —
        // az `outcome` a már elért eredményt (vagy a kezdeti 'skipped'-et) tartja meg.
      }
    }

    return outcome
  } catch (error) {
    const message = (error as Error).message
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
      })
    }
    return { status: 'failed', error: message }
  }
}
