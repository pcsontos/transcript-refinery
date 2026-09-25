import type { Config, SourceDir } from '../config.js'
import type { RunEvent } from '../events.js'
import { COMMIT_SCOPE, VERSION } from '../meta.js'
import { ARTIFACT_KIND, processItem } from '../pipeline.js'
import { refreshQueue, withContentLanguage } from '../queue/refresh.js'
import type { Registry } from '../recipe/registry.js'
import { discoverAll } from '../source/folder.js'
import { openState } from '../state/db.js'
import type { SourceItem } from '../types.js'
import { writeFileAtomic } from '../vault/atomic.js'
import { gitCommitPaths, gitHeadShort, gitPullFfOnly, gitPush } from '../vault/git.js'

export interface RoundOptions {
  cfg: Config
  registry: Registry
  /** A figyelt forrásmappák (a `--source` szűkítheti). */
  sources: readonly SourceDir[]
  commit: boolean
  /** Az e körben változott feliratfájlok abszolút útvonalai; a felzárkózó körnél `null`. */
  changed: ReadonlySet<string> | null
  /** Egy terminálsor, időbélyeg nélkül — azt a hívó teszi elé. */
  out: (line: string) => void
}

export interface RoundResult {
  transcripts: number
  failed: number
  queueChanged: boolean
  /** A commit rövid hashe; `null`, ha nem volt commit. */
  commit: string | null
}

const firstLine = (text: string): string => text.split('\n')[0] ?? text

const describeItem = (item: SourceItem): string =>
  `${item.metadata.channel ?? item.source} / ${item.title} (${item.language ?? '?'})`

/**
 * A watch egy köre: átirat minden új feliratból, a sor frissítése, és — ha kell —
 * egyetlen commit. Modellt nem hív, futásnaplót nem ír. A korábban elbukott
 * elemet csak a felzárkózó körben (`changed === null`), vagy akkor próbálja
 * újra, ha a fájlja változott: enélkül minden kör ugyanazt a hibát írná ki.
 *
 * A sort közvetlenül írás előtt frissen olvassa (`refreshQueue`); egy kézzel
 * futó `run --queue` ugyanígy tesz, tehát külön zárolás nincs (spec 3.4).
 */
export async function watchRound(opts: RoundOptions): Promise<RoundResult> {
  const { cfg, registry, sources, commit, changed, out } = opts
  if (commit) await gitPullFfOnly(cfg.vaultPath)

  const discovered = await discoverAll(sources, cfg.languages)
  const store = openState(cfg.statePath)
  try {
    let transcripts = 0
    let failed = 0
    for (const item of discovered) {
      const record = store.artifactOf(item.itemId, ARTIFACT_KIND)
      if (record?.status === 'done') continue
      if (record?.status === 'failed' && changed !== null && !changed.has(item.subtitlePath)) continue

      const errors: string[] = []
      const outcome = await processItem(item, {
        notesRoot: cfg.notesRoot,
        store,
        version: VERSION,
        options: { force: false, dryRun: false },
        commit,
        sink: (event: RunEvent) => {
          if (event.type === 'item:failed') errors.push(event.error)
        },
      })
      if (outcome.status === 'published') {
        transcripts++
        out(`új átirat: ${describeItem(item)}`)
      } else if (outcome.status === 'failed') {
        failed++
        out(`hiba: ${item.sourceFile}: ${firstLine(errors[0] ?? outcome.error ?? 'ismeretlen hiba')}`)
      }
    }

    const queue = await refreshQueue(cfg, registry, await withContentLanguage(discovered))
    const queueChanged = queue.text !== queue.current
    if (queueChanged) {
      await writeFileAtomic(queue.path, queue.text)
      const added = `+${String(queue.stats.addedVideos)} elem`
      out(`_queue.md frissítve: ${queue.marked > 0 ? `${added}, ${String(queue.marked)} kész` : added}`)
    }

    let hash: string | null = null
    if (commit) {
      const notePaths = store.listPendingCommits()
      const paths = queueChanged ? [...notePaths, queue.path] : notePaths
      const message = `docs(${COMMIT_SCOPE}): watch — átirat ${String(notePaths.length)} videóhoz`
      if (paths.length > 0 && (await gitCommitPaths(cfg.vaultPath, paths, message))) {
        hash = await gitHeadShort(cfg.vaultPath)
        const push = await gitPush(cfg.vaultPath)
        out(
          push.pushed
            ? `commit: ${hash} (push ok)`
            : `commit: ${hash} (push sikertelen: ${firstLine(push.reason ?? 'ismeretlen ok')})`,
        )
      }
      store.clearPendingCommits(notePaths)
    }

    return { transcripts, failed, queueChanged, commit: hash }
  } finally {
    store.close()
  }
}
