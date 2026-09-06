import type { CaptionSource } from './types.js'

/**
 * A mag kimenete. A CLI ezt haladásjelzéssé rendereli, a naplózó JSON
 * sorokká — a mag maga soha nem ír a konzolra.
 */
export type RunEvent =
  | { type: 'scan:start'; source: string }
  | { type: 'scan:found'; count: number }
  | { type: 'item:start'; itemId: string; title: string }
  | { type: 'item:parsed'; itemId: string; cues: number }
  | {
      type: 'item:normalized'
      itemId: string
      wordsRaw: number
      wordsNormalized: number
      captionSource: CaptionSource
    }
  | { type: 'item:published'; itemId: string; path: string }
  | { type: 'item:skipped'; itemId: string; reason: string }
  | { type: 'item:failed'; itemId: string; error: string }
  | { type: 'run:done'; succeeded: number; skipped: number; failed: number }
  | {
      type: 'run:estimate'
      items: number
      tokens: number
      usd: number
      limitUsd: number
    }
  | { type: 'run:aborted'; reason: string; spentUsd: number; limitUsd: number }
  | {
      type: 'item:generating'
      itemId: string
      recipe: string
      /** Hányadik generálás; egytől számozva. */
      generation: number
    }
  | {
      type: 'item:scored'
      itemId: string
      recipe: string
      score: number
      gaps: number
    }
  | {
      type: 'item:refined'
      itemId: string
      recipe: string
      score: number
      generations: number
      usd: number
    }

export type EventSink = (event: RunEvent) => void

export interface RunSummary {
  succeeded: number
  skipped: number
  failed: number
}

/** Teszteléshez és a futás végi riporthoz: memóriában gyűjti az eseményeket. */
export function collectEvents(): { sink: EventSink; events: RunEvent[] } {
  const events: RunEvent[] = []
  return { sink: (e) => void events.push(e), events }
}

export function summarize(events: readonly RunEvent[]): RunSummary {
  let succeeded = 0
  let skipped = 0
  let failed = 0
  for (const e of events) {
    if (e.type === 'item:published') succeeded++
    else if (e.type === 'item:skipped') skipped++
    else if (e.type === 'item:failed') failed++
  }
  return { succeeded, skipped, failed }
}
