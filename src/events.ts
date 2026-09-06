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
  | {
      type: 'run:sliced'
      /** Ennyi elem indul ebben a futásban. */
      planned: number
      /** Ennyi maradt a következő futásra, mert nem fért a plafon alá. */
      deferred: number
      usd: number
      limitUsd: number
    }
  | {
      type: 'item:retry'
      itemId: string
      /** Hányadik kísérlet bukott el; egytől számozva. */
      attempt: number
      delayMs: number
      reason: string
    }

export type EventSink = (event: RunEvent) => void

export interface RunFailure {
  itemId: string
  error: string
}

export interface RunSummary {
  succeeded: number
  skipped: number
  failed: number
  /** A sikeres elemek felirat-forrás szerinti bontása. */
  byCaptionSource: Record<CaptionSource, number>
  /** Az automatikus feliratból készült sikeres elemek azonosítói, rendezve. */
  autoItems: string[]
  failures: RunFailure[]
}

/** Teszteléshez és a futás végi riporthoz: memóriában gyűjti az eseményeket. */
export function collectEvents(): { sink: EventSink; events: RunEvent[] } {
  const events: RunEvent[] = []
  return { sink: (e) => void events.push(e), events }
}

/**
 * Az összegzés **elemet** számol, nem eseményt: egy elem két jegyzetet is
 * publikálhat (átirat és recept), és az ugyanaz az egy siker. A hiba erősebb
 * a publikálásnál — ha a recept elbukott, az elem hibás, akkor is, ha az
 * átirata már kiment.
 */
export function summarize(events: readonly RunEvent[]): RunSummary {
  const captionOf = new Map<string, CaptionSource>()
  const published = new Set<string>()
  const skipped = new Set<string>()
  const failed = new Map<string, string>()

  for (const e of events) {
    switch (e.type) {
      case 'item:normalized':
        captionOf.set(e.itemId, e.captionSource)
        break
      case 'item:published':
        published.add(e.itemId)
        break
      case 'item:skipped':
        skipped.add(e.itemId)
        break
      case 'item:failed':
        failed.set(e.itemId, e.error)
        break
      default:
        break
    }
  }

  for (const itemId of failed.keys()) {
    published.delete(itemId)
    skipped.delete(itemId)
  }
  for (const itemId of published) skipped.delete(itemId)

  const byCaptionSource: Record<CaptionSource, number> = { creator: 0, auto: 0 }
  const autoItems: string[] = []
  for (const itemId of published) {
    const caption = captionOf.get(itemId)
    if (caption === undefined) continue
    byCaptionSource[caption]++
    if (caption === 'auto') autoItems.push(itemId)
  }
  autoItems.sort()

  return {
    succeeded: published.size,
    skipped: skipped.size,
    failed: failed.size,
    byCaptionSource,
    autoItems,
    failures: [...failed].map(([itemId, error]) => ({ itemId, error })),
  }
}
