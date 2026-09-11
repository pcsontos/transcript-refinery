import type { DatabaseSync } from 'node:sqlite'
import type { CaptionSource, SourceItem } from '../types.js'
import type { ArtifactRecord, CorpusStatus, SourceStatus } from './db.js'

// Az állapottár lekérdezései egy helyen. Az író (`openState`) és a csak olvasó
// (`openStateReader`) ugyanezt hívja, így a felület pontosan azt a
// korpusz-állapotot mutatja, amit a futás riportja.

/** Egy elem sora az átirat mérőszámaival. */
export interface ItemRow {
  itemId: string
  source: string
  sourceFile: string
  baseName: string
  title: string
  language: string | null
  channel: string | null
  uploadedAt: string | null
  url: string | null
  discoveredAt: string
  /** Az átirat felirat-eredete; `null`, ha még nincs átirat. */
  captionSource: CaptionSource | null
  wordsRaw: number | null
  wordsNormalized: number | null
}

/** Egy műtermék sora, minden mezővel. */
export interface ArtifactRow {
  itemId: string
  kind: string
  status: string
  path: string | null
  error: string | null
  iterations: number | null
  score: number | null
  costUsd: number | null
  model: string | null
  createdAt: string
}

/**
 * A `CREATE TABLE IF NOT EXISTS` szándékosan nem migrál: egy Fázis 1-ből maradt
 * állapotfájlon a régi, `video_id`-alapú `artifacts` tábla érintetlen marad.
 * Enélkül az ellenőrzés nélkül az `isDone` egy beazonosíthatatlan
 * `no such column: item_id` hibával állítaná meg a TELJES köteget, ahelyett hogy
 * megnevezné a valódi okot. Hiba esetén a kapcsolatot lezárja.
 */
export function assertCurrentSchema(db: DatabaseSync, path: string): void {
  const cols = db.prepare("SELECT name FROM pragma_table_info('artifacts')").all() as {
    name: string
  }[]
  if (!cols.some((c) => c.name === 'item_id')) {
    db.close()
    throw new Error(
      `A(z) ${path} állapotfájl a régi, videó-alapú sémát használja. ` +
        `Töröld — a vaultban lévő jegyzeteid érintetlenek maradnak, ` +
        `az állapot az első futáskor újraépül.`,
    )
  }
}

/** Létezik-e a tábla. A csak olvasó kapcsolat nem hozhatja létre, ezért kérdezni kell. */
export function hasTable(db: DatabaseSync, name: string): boolean {
  return (
    db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined
  )
}

export function selectArtifact(
  db: DatabaseSync,
  itemId: string,
  kind: string,
): ArtifactRecord | null {
  const row = db
    .prepare(
      `SELECT status, path, error, iterations, score, cost_usd, model
         FROM artifacts WHERE item_id = ? AND kind = ?`,
    )
    .get(itemId, kind) as
    | {
        status: string
        path: string | null
        error: string | null
        iterations: number | null
        score: number | null
        cost_usd: number | null
        model: string | null
      }
    | undefined
  if (!row) return null
  return {
    status: row.status,
    path: row.path,
    error: row.error,
    iterations: row.iterations,
    score: row.score,
    costUsd: row.cost_usd,
    model: row.model,
  }
}

/** A rögzített hiánylista; `null`, ha nincs rögzítve. */
export function selectGaps(db: DatabaseSync, itemId: string, kind: string): string[] | null {
  const row = db
    .prepare('SELECT gaps FROM artifact_gaps WHERE item_id = ? AND kind = ?')
    .get(itemId, kind) as { gaps: string } | undefined
  return row ? (JSON.parse(row.gaps) as string[]) : null
}

/**
 * A teljes korpusz állapota egy műtermék-típusra. A kész/hibás/hátralévő számok
 * erre a típusra szólnak, a `totalCostUsd` viszont minden típuson összegez.
 */
export function selectCorpusStatus(
  db: DatabaseSync,
  items: readonly SourceItem[],
  kind: string,
): CorpusStatus {
  const rows = db
    .prepare('SELECT item_id, status FROM artifacts WHERE kind = ?')
    .all(kind) as { item_id: string; status: string }[]
  const statusOf = new Map(rows.map((r) => [r.item_id, r.status]))

  const captions = db
    .prepare('SELECT item_id, source FROM transcripts')
    .all() as { item_id: string; source: string }[]
  const captionOf = new Map(captions.map((r) => [r.item_id, r.source as CaptionSource]))

  const bySourceName = new Map<string, SourceStatus>()
  const byCaptionSource: Record<CaptionSource, number> = { creator: 0, auto: 0 }
  let done = 0
  let failed = 0

  for (const item of items) {
    const entry = bySourceName.get(item.source) ?? {
      source: item.source,
      total: 0,
      done: 0,
      failed: 0,
      pending: 0,
    }
    entry.total++

    const status = statusOf.get(item.itemId)
    if (status === 'done') {
      entry.done++
      done++
    } else if (status === 'failed') {
      entry.failed++
      failed++
    } else {
      entry.pending++
    }
    bySourceName.set(item.source, entry)

    const caption = captionOf.get(item.itemId)
    if (caption !== undefined) byCaptionSource[caption]++
  }

  // A költés minden műtermék-típusra összegződik: a kérdés az, hogy erre ezt a
  // korpuszra eddig mennyit költöttünk, nem az, hogy melyik recept vitte.
  const cost = db
    .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM artifacts')
    .get() as { total: number }

  return {
    bySource: [...bySourceName.values()].sort((a, b) => a.source.localeCompare(b.source)),
    byCaptionSource,
    done,
    failed,
    pending: items.length - done - failed,
    totalCostUsd: cost.total,
  }
}

/** Az elemek sorai az átirat mérőszámaival, azonosító szerint rendezve. */
export function selectItemRows(db: DatabaseSync): ItemRow[] {
  const rows = db
    .prepare(
      `SELECT i.item_id, i.source, i.source_file, i.base_name, i.title, i.language,
              i.channel, i.uploaded_at, i.url, i.discovered_at,
              t.source AS caption_source, t.words_raw, t.words_normalized
         FROM items i
         LEFT JOIN transcripts t ON t.item_id = i.item_id
        ORDER BY i.item_id`,
    )
    .all() as {
    item_id: string
    source: string
    source_file: string
    base_name: string
    title: string
    language: string | null
    channel: string | null
    uploaded_at: string | null
    url: string | null
    discovered_at: string
    caption_source: string | null
    words_raw: number | null
    words_normalized: number | null
  }[]
  return rows.map((r) => ({
    itemId: r.item_id,
    source: r.source,
    sourceFile: r.source_file,
    baseName: r.base_name,
    title: r.title,
    language: r.language,
    channel: r.channel,
    uploadedAt: r.uploaded_at,
    url: r.url,
    discoveredAt: r.discovered_at,
    captionSource: r.caption_source as CaptionSource | null,
    wordsRaw: r.words_raw,
    wordsNormalized: r.words_normalized,
  }))
}

/** Minden műtermék sora, elem és típus szerint rendezve. */
export function selectArtifactRows(db: DatabaseSync): ArtifactRow[] {
  const rows = db
    .prepare(
      `SELECT item_id, kind, status, path, error, iterations, score, cost_usd, model, created_at
         FROM artifacts
        ORDER BY item_id, kind`,
    )
    .all() as {
    item_id: string
    kind: string
    status: string
    path: string | null
    error: string | null
    iterations: number | null
    score: number | null
    cost_usd: number | null
    model: string | null
    created_at: string
  }[]
  return rows.map((r) => ({
    itemId: r.item_id,
    kind: r.kind,
    status: r.status,
    path: r.path,
    error: r.error,
    iterations: r.iterations,
    score: r.score,
    costUsd: r.cost_usd,
    model: r.model,
    createdAt: r.created_at,
  }))
}
