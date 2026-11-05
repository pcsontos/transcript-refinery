import { summarize } from '../events.js'
import type { RunLogLine } from '../run/logfile.js'

/** Egy elem a futás elemtáblázatában; az utolsó esemény dönt az eredményéről. */
export interface LiveRunItem {
  itemId: string
  title: string
  outcome: 'running' | 'done' | 'skipped' | 'failed'
  /** Kész elemnél az út, kihagyottnál az ok, hibásnál a hiba; futónál `null`. */
  detail: string | null
}

/** Egy futás állapota, ahogy a felület mutatja. Mindig a napló elejétől számol. */
export interface LiveRunState {
  /** A feldolgozandó egységek száma (`scan:found`). */
  units: number | null
  /** Az elkezdett egységek száma (`item:start`). */
  started: number
  succeeded: number
  skipped: number
  failed: number
  estimate: { items: number; usd: number; limitUsd: number } | null
  /** A tényleges költés: az `item:refined` összegei. */
  spentUsd: number
  /** Az éppen feldolgozott elem és lépése; a futás végén `null`. */
  current: { itemId: string; title: string; step: string } | null
  lastScore: { itemId: string; recipe: string; score: number; gaps: number } | null
  retries: number
  /** A legutóbbi legfeljebb öt hiba, a legfrissebb elöl. */
  recentFailures: { itemId: string; kind: string; error: string }[]
  /** A plafon miatti megállás oka, ha volt. */
  aborted: string | null
  ended: { interrupted: boolean } | null
  /** Az utolsó időbélyeges sor ideje. */
  lastEventAt: string | null
  /** Az elemek az első `item:start` sorrendjében. */
  items: LiveRunItem[]
}

/**
 * A futás állapota a naplósorokból. Tiszta függvény: az SSE-útvonal minden sor
 * után hívja, a futás oldala a teljes naplóra. A kliens csak megjeleníti.
 */
export function liveRunState(lines: readonly RunLogLine[]): LiveRunState {
  const summary = summarize(lines)
  const titles = new Map<string, string>()
  const stepOf = (itemId: string, step: string): LiveRunState['current'] => ({
    itemId,
    title: titles.get(itemId) ?? itemId,
    step,
  })

  let units: number | null = null
  let started = 0
  let estimate: LiveRunState['estimate'] = null
  let spentUsd = 0
  let current: LiveRunState['current'] = null
  let lastScore: LiveRunState['lastScore'] = null
  let retries = 0
  const failures: LiveRunState['recentFailures'] = []
  let aborted: string | null = null
  let ended: LiveRunState['ended'] = null
  let lastEventAt: string | null = null
  const items = new Map<string, LiveRunItem>()
  const itemOf = (itemId: string): LiveRunItem => {
    let item = items.get(itemId)
    if (item === undefined) {
      item = { itemId, title: titles.get(itemId) ?? itemId, outcome: 'running', detail: null }
      items.set(itemId, item)
    }
    return item
  }
  const settle = (itemId: string, outcome: LiveRunItem['outcome'], detail: string | null): void => {
    const item = itemOf(itemId)
    item.outcome = outcome
    item.detail = detail
  }

  for (const line of lines) {
    if (line.at !== undefined) lastEventAt = line.at
    switch (line.type) {
      case 'scan:found':
        units = line.count
        break
      case 'run:estimate':
        estimate = { items: line.items, usd: line.usd, limitUsd: line.limitUsd }
        break
      case 'item:start':
        started++
        titles.set(line.itemId, line.title)
        current = stepOf(line.itemId, 'feldolgozás')
        itemOf(line.itemId).title = line.title
        settle(line.itemId, 'running', null)
        break
      case 'item:step':
        current = stepOf(line.itemId, line.step)
        break
      case 'item:published':
        settle(line.itemId, 'done', line.path)
        break
      case 'item:skipped':
        settle(line.itemId, 'skipped', line.reason)
        break
      case 'item:generating':
        current = stepOf(line.itemId, `${line.recipe}: generálás (${String(line.generation)}.)`)
        break
      case 'item:scored':
        lastScore = { itemId: line.itemId, recipe: line.recipe, score: line.score, gaps: line.gaps }
        current = stepOf(line.itemId, `${line.recipe}: pontozva, ${line.score.toFixed(2)}`)
        break
      case 'item:retry':
        retries++
        current = stepOf(line.itemId, `újrapróba (${String(line.attempt)}.)`)
        break
      case 'item:refined':
        spentUsd += line.usd
        break
      case 'item:failed':
        failures.unshift({ itemId: line.itemId, kind: line.kind, error: line.error })
        settle(line.itemId, 'failed', line.error)
        break
      case 'run:aborted':
        aborted = line.reason
        break
      case 'run:done':
        current = null
        break
      case 'run:ended':
        ended = { interrupted: line.interrupted }
        current = null
        break
      default:
        break
    }
  }

  return {
    units,
    started,
    succeeded: summary.succeeded,
    skipped: summary.skipped,
    failed: summary.failed,
    estimate,
    spentUsd,
    current,
    lastScore,
    retries,
    recentFailures: failures.slice(0, 5),
    aborted,
    ended,
    lastEventAt,
    items: [...items.values()],
  }
}
