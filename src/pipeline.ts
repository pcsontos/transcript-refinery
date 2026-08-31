import { readFile } from 'node:fs/promises'
import type { EventSink } from './events.js'
import { classifyCaptions, punctuationDensity } from './normalize/classify.js'
import { countWords, dedupeLines } from './normalize/dedupe.js'
import { parseSubtitle } from './subtitle/parse.js'
import type { StateStore } from './state/db.js'
import type { NormalizedTranscript, SourceItem } from './types.js'
import { lintVaultMarkdown } from './vault/lint.js'
import { resolveChannelDir, transcriptFile, videoDir } from './vault/paths.js'
import { publishNote, type PublishOptions } from './vault/publish.js'
import { renderTranscriptNote } from './vault/render.js'

export interface PipelineDeps {
  notesRoot: string
  store: StateStore
  sink: EventSink
  version: string
  options: PublishOptions
}

export interface ItemOutcome {
  status: 'published' | 'skipped' | 'failed'
  path?: string
  error?: string
}

const ARTIFACT_KIND = 'transcript'

/** Egyetlen elem végigvitele a csővezetéken. Soha nem dob kivételt. */
export async function processItem(
  item: SourceItem,
  deps: PipelineDeps,
): Promise<ItemOutcome> {
  const { notesRoot, store, sink, version, options } = deps
  sink({ type: 'item:start', videoId: item.videoId, title: item.title })
  store.recordVideo(item)

  if (!options.force && store.isDone(item.videoId, ARTIFACT_KIND)) {
    sink({ type: 'item:skipped', videoId: item.videoId, reason: 'már feldolgozva' })
    return { status: 'skipped' }
  }

  try {
    const raw = await readFile(item.subtitlePath, 'utf8')
    const cues = parseSubtitle(raw, item.subtitlePath)
    sink({ type: 'item:parsed', videoId: item.videoId, cues: cues.length })
    if (cues.length === 0) {
      throw new Error('a feliratfájl nem tartalmaz értelmezhető feliratblokkot')
    }

    const rawText = cues.flatMap((c) => c.lines).join(' ')
    const lines = dedupeLines(cues)
    const normalizedText = lines.join(' ')
    // Üres átirat nem kerülhet a vaultba: a jegyzet értéktelen, és a
    // következő futás késznek hinné az elemet.
    if (lines.length === 0) {
      throw new Error('a feliratfájl nem tartalmaz szöveget')
    }

    const transcript: NormalizedTranscript = {
      lines,
      wordsRaw: countWords(rawText),
      wordsNormalized: countWords(normalizedText),
      captionSource: classifyCaptions(normalizedText),
      punctuationDensity: punctuationDensity(normalizedText),
    }

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

    const markdown = renderTranscriptNote(item, transcript, version)
    const lintErrors = lintVaultMarkdown(markdown)
    if (lintErrors.length > 0) {
      throw new Error(`a jegyzet megsérti a vault linkszabályát: ${lintErrors.join('; ')}`)
    }

    const channelDir = await resolveChannelDir(notesRoot, item.channel)
    const target = transcriptFile(videoDir(notesRoot, channelDir, item.title), item.title)
    const result = await publishNote(target, markdown, options)

    if (result.status === 'skipped') {
      store.recordArtifact(item.videoId, ARTIFACT_KIND, 'done', result.path, null)
      sink({ type: 'item:skipped', videoId: item.videoId, reason: 'a fájl már létezik' })
      return { status: 'skipped', path: result.path }
    }

    if (!options.dryRun) {
      store.recordArtifact(item.videoId, ARTIFACT_KIND, 'done', result.path, null)
    }
    sink({ type: 'item:published', videoId: item.videoId, path: result.path })
    return { status: 'published', path: result.path }
  } catch (error) {
    const message = (error as Error).message
    store.recordArtifact(item.videoId, ARTIFACT_KIND, 'failed', null, message)
    sink({ type: 'item:failed', videoId: item.videoId, error: message })
    return { status: 'failed', error: message }
  }
}
