import { readFile } from 'node:fs/promises'
import type { ModelConfig } from './config.js'
import type { EventSink } from './events.js'
import type { CostGuard } from './model/budget.js'
import type { ModelClient } from './model/client.js'
import { costOf } from './model/pricing.js'
import { classifyCaptions, punctuationDensity } from './normalize/classify.js'
import { countWords, dedupeLines } from './normalize/dedupe.js'
import type { Recipe } from './recipe/types.js'
import { refine } from './refine/loop.js'
import { parseSubtitle } from './subtitle/parse.js'
import type { StateStore } from './state/db.js'
import type { NormalizedTranscript, SourceItem } from './types.js'
import { lintVaultMarkdown } from './vault/lint.js'
import { recipeFile, resolveChannelDir, videoDir } from './vault/paths.js'
import { publishNote, type PublishOptions } from './vault/publish.js'
import { renderRecipeNote, renderTranscriptNote } from './vault/render.js'

export interface RecipeDeps {
  recipe: Recipe
  client: ModelClient
  modelConfig: ModelConfig
  guard: CostGuard
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

const ARTIFACT_KIND = 'transcript'

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
    throw new Error(`a jegyzet megsérti a vault linkszabályát: ${lintErrors.join('; ')}`)
  }

  const result = await publishNote(target, markdown, deps.options)
  if (result.status === 'skipped') {
    deps.store.recordArtifact(item.videoId, kind, 'done', result.path, null)
    deps.sink({ type: 'item:skipped', videoId: item.videoId, reason: 'a fájl már létezik' })
    return { status: 'skipped', path: result.path }
  }

  if (!deps.options.dryRun) {
    deps.store.recordArtifact(item.videoId, kind, 'done', result.path, null)
  }
  deps.sink({ type: 'item:published', videoId: item.videoId, path: result.path })
  return { status: 'published', path: result.path }
}

/** A 6. csővezeték-lépés: recept futtatása és publikálása. */
async function runRecipe(
  item: SourceItem,
  transcript: NormalizedTranscript,
  dir: string,
  deps: PipelineDeps,
  recipeDeps: RecipeDeps,
): Promise<ItemOutcome> {
  const { recipe, client, modelConfig, guard } = recipeDeps
  const text = transcript.lines.join(' ')

  const result = await refine(recipe, { item, transcript: text }, client)

  guard.add('draft', result.usage, modelConfig)
  const usd = costOf(result.usage, modelConfig.pricing.draft)

  deps.sink({
    type: 'item:refined',
    videoId: item.videoId,
    recipe: recipe.id,
    score: result.score,
    generations: result.generations,
    usd,
  })

  // A `publishable: false` a publisher által kikényszerített invariáns, nem
  // konvenció: bizonyos típusok soha nem kerülhetnek publikálási útra.
  if (!recipe.publishable) {
    if (!deps.options.dryRun) {
      deps.store.recordArtifact(item.videoId, recipe.id, 'done', null, null, {
        iterations: result.generations,
        score: result.score,
        costUsd: usd,
        model: modelConfig.models[recipe.role],
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
    throw new Error(`a jegyzet megsérti a vault linkszabályát: ${lintErrors.join('; ')}`)
  }

  const target = recipeFile(dir, item.title, recipe.outputFile)
  const published = await publishNote(target, markdown, deps.options)

  if (!deps.options.dryRun) {
    deps.store.recordArtifact(
      item.videoId,
      recipe.id,
      'done',
      published.path,
      null,
      {
        iterations: result.generations,
        score: result.score,
        costUsd: usd,
        model: modelConfig.models[recipe.role],
      },
    )
  }

  if (published.status === 'skipped') {
    deps.sink({ type: 'item:skipped', videoId: item.videoId, reason: 'a fájl már létezik' })
    return { status: 'skipped', recipePath: published.path }
  }

  deps.sink({ type: 'item:published', videoId: item.videoId, path: published.path })
  return { status: 'published', recipePath: published.path }
}

/** Egyetlen elem végigvitele a csővezetéken. Soha nem dob kivételt. */
export async function processItem(
  item: SourceItem,
  deps: PipelineDeps,
): Promise<ItemOutcome> {
  const { notesRoot, store, sink, version, options, recipeDeps } = deps
  sink({ type: 'item:start', videoId: item.videoId, title: item.title })
  store.recordVideo(item)

  const kellAtirat = options.force || !store.isDone(item.videoId, ARTIFACT_KIND)
  const kellRecept =
    recipeDeps !== undefined &&
    (options.force || !store.isDone(item.videoId, recipeDeps.recipe.id))

  if (!kellAtirat && !kellRecept) {
    sink({ type: 'item:skipped', videoId: item.videoId, reason: 'már feldolgozva' })
    return { status: 'skipped' }
  }

  try {
    const transcript = await normalizeItem(item)
    sink({ type: 'item:parsed', videoId: item.videoId, cues: transcript.lines.length })
    sink({
      type: 'item:normalized',
      videoId: item.videoId,
      wordsRaw: transcript.wordsRaw,
      wordsNormalized: transcript.wordsNormalized,
      captionSource: transcript.captionSource,
    })
    store.recordTranscript(
      item.videoId,
      transcript.captionSource,
      transcript.wordsRaw,
      transcript.wordsNormalized,
    )

    const channelDir = await resolveChannelDir(notesRoot, item.channel)
    const dir = videoDir(notesRoot, channelDir, item.title)

    let outcome: ItemOutcome = { status: 'skipped' }

    if (kellAtirat) {
      outcome = await publishRendered(
        recipeFile(dir, item.title, '_transcript.md'),
        renderTranscriptNote(item, transcript, version),
        item,
        ARTIFACT_KIND,
        deps,
      )
    }

    if (kellRecept && recipeDeps) {
      try {
        const recipeOutcome = await runRecipe(item, transcript, dir, deps, recipeDeps)
        if (recipeOutcome.status === 'published') {
          outcome = { ...recipeOutcome, path: outcome.path ?? recipeOutcome.recipePath }
        }
      } catch (error) {
        const message = (error as Error).message
        store.recordArtifact(item.videoId, recipeDeps.recipe.id, 'failed', null, message)
        sink({ type: 'item:failed', videoId: item.videoId, error: message })
        // A recept hibája nem ronthatja el az átirat már sikeres állapotát —
        // az `outcome` a már elért eredményt (vagy a kezdeti 'skipped'-et) tartja meg.
      }
    }

    return outcome
  } catch (error) {
    const message = (error as Error).message
    store.recordArtifact(item.videoId, ARTIFACT_KIND, 'failed', null, message)
    sink({ type: 'item:failed', videoId: item.videoId, error: message })
    return { status: 'failed', error: message }
  }
}
