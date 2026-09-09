import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CaptionSource, SourceItem } from '../types.js'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  item_id       TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  source_file   TEXT NOT NULL,
  base_name     TEXT NOT NULL,
  title         TEXT NOT NULL,
  language      TEXT,
  video_id      TEXT,
  channel       TEXT,
  uploaded_at   TEXT,
  url           TEXT,
  subtitle_path TEXT NOT NULL,
  discovered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transcripts (
  item_id          TEXT PRIMARY KEY REFERENCES items(item_id),
  source           TEXT NOT NULL,
  words_raw        INTEGER NOT NULL,
  words_normalized INTEGER NOT NULL,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  item_id    TEXT NOT NULL REFERENCES items(item_id),
  kind       TEXT NOT NULL,
  status     TEXT NOT NULL,
  path       TEXT,
  error      TEXT,
  iterations INTEGER,
  score      REAL,
  cost_usd   REAL,
  model      TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (item_id, kind)
);
`

export interface TranscriptRecord {
  source: CaptionSource
  wordsRaw: number
  wordsNormalized: number
}

/** Egy recept futásának mérőszámai. A Fázis 0 átirata ezeket nem tölti ki. */
export interface ArtifactMetrics {
  /** Hány generálás történt. */
  iterations: number
  score: number
  costUsd: number
  /** A ténylegesen futott generáló modell neve. */
  model: string
}

export interface ArtifactRecord {
  status: string
  path: string | null
  error: string | null
  iterations: number | null
  score: number | null
  costUsd: number | null
  model: string | null
}

/** Egy forrásmappa állapota a köteg szempontjából. */
export interface SourceStatus {
  source: string
  total: number
  done: number
  failed: number
  pending: number
}

/**
 * A teljes korpusz állapota. Kizárólag olvasó összegzés: ez teszi a riportot
 * újraindítás után is teljessé.
 *
 * A kész/hibás/hátralévő számok EGY megadott műtermék-típusra szólnak (arra,
 * amit a futás készít), a `totalCostUsd` viszont MINDEN típuson összegez: a
 * kérdés az, hogy erre a korpuszra eddig összesen mennyit költöttünk, nem az,
 * hogy melyik recept vitte el.
 */
export interface CorpusStatus {
  bySource: SourceStatus[]
  byCaptionSource: Record<CaptionSource, number>
  done: number
  failed: number
  pending: number
  totalCostUsd: number
}

export interface StateStore {
  readonly path: string
  recordItem(item: SourceItem): void
  recordTranscript(
    itemId: string,
    source: CaptionSource,
    wordsRaw: number,
    wordsNormalized: number,
  ): void
  recordArtifact(
    itemId: string,
    kind: string,
    status: 'done' | 'failed',
    path: string | null,
    error: string | null,
    metrics?: ArtifactMetrics,
  ): void
  artifactOf(itemId: string, kind: string): ArtifactRecord | null
  transcriptOf(itemId: string): TranscriptRecord | null
  isDone(itemId: string, kind: string): boolean
  listPending(items: SourceItem[], kind: string): SourceItem[]
  corpusStatus(items: readonly SourceItem[], kind: string): CorpusStatus
  listFailed(items: readonly SourceItem[], kind: string): SourceItem[]
  close(): void
}

/**
 * Megnyitja (és szükség esetén létrehozza) az állapottárat. A séma
 * idempotens, tehát az újranyitás biztonságos.
 */
export function openState(path: string): StateStore {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)

  // A `CREATE TABLE IF NOT EXISTS` szándékosan nem migrál: egy Fázis 1-ből
  // maradt állapotfájlon a régi, `video_id`-alapú `artifacts` tábla
  // érintetlen marad. Enélkül az ellenőrzés nélkül az `isDone` egy
  // beazonosíthatatlan `no such column: item_id` hibával állítaná meg a
  // TELJES köteget (a `pipeline.ts` try-ágán kívül), ahelyett hogy megnevezné
  // a valódi okot.
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

  const now = () => new Date().toISOString()

  // A `close()` idempotens: a hívónak nem feladata számon tartani, hogy a
  // tár már zárva van-e. Kétszeri zárás enélkül „database is not open"-t dob.
  let closed = false

  // Önálló függvény, nem objektum-metódus: a `listPending` így hivatkozhat rá
  // `this` nélkül, ami strict módban típushibát adna.
  const isDone = (itemId: string, kind: string): boolean =>
    db
      .prepare(
        "SELECT 1 AS ok FROM artifacts WHERE item_id = ? AND kind = ? AND status = 'done'",
      )
      .get(itemId, kind) !== undefined

  return {
    path,

    recordItem(item) {
      db.prepare(
        `INSERT INTO items
           (item_id, source, source_file, base_name, title, language,
            video_id, channel, uploaded_at, url, subtitle_path, discovered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_id) DO UPDATE SET
           source = excluded.source,
           source_file = excluded.source_file,
           base_name = excluded.base_name,
           title = excluded.title,
           language = excluded.language,
           video_id = excluded.video_id,
           channel = excluded.channel,
           uploaded_at = excluded.uploaded_at,
           url = excluded.url,
           subtitle_path = excluded.subtitle_path`,
      ).run(
        item.itemId,
        item.source,
        item.sourceFile,
        item.baseName,
        item.title,
        item.language,
        item.metadata.videoId ?? null,
        item.metadata.channel ?? null,
        item.metadata.uploadedAt ?? null,
        item.metadata.url ?? null,
        item.subtitlePath,
        now(),
      )
    },

    recordTranscript(itemId, source, wordsRaw, wordsNormalized) {
      db.prepare(
        `INSERT INTO transcripts
           (item_id, source, words_raw, words_normalized, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(item_id) DO UPDATE SET
           source = excluded.source,
           words_raw = excluded.words_raw,
           words_normalized = excluded.words_normalized`,
      ).run(itemId, source, wordsRaw, wordsNormalized, now())
    },

    recordArtifact(itemId, kind, status, path, error, metrics) {
      db.prepare(
        `INSERT INTO artifacts
           (item_id, kind, status, path, error, iterations, score, cost_usd, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_id, kind) DO UPDATE SET
           status = excluded.status,
           path = excluded.path,
           error = excluded.error,
           iterations = excluded.iterations,
           score = excluded.score,
           cost_usd = excluded.cost_usd,
           model = excluded.model,
           created_at = excluded.created_at`,
      ).run(
        itemId,
        kind,
        status,
        path,
        error,
        metrics?.iterations ?? null,
        metrics?.score ?? null,
        metrics?.costUsd ?? null,
        metrics?.model ?? null,
        now(),
      )
    },

    artifactOf(itemId, kind) {
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
    },

    transcriptOf(itemId) {
      const row = db
        .prepare(
          'SELECT source, words_raw, words_normalized FROM transcripts WHERE item_id = ?',
        )
        .get(itemId) as
        | { source: string; words_raw: number; words_normalized: number }
        | undefined
      if (!row) return null
      return {
        source: row.source as CaptionSource,
        wordsRaw: row.words_raw,
        wordsNormalized: row.words_normalized,
      }
    },

    isDone,

    listPending(items, kind) {
      return items.filter((item) => !isDone(item.itemId, kind))
    },

    corpusStatus(items, kind) {
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

      // A költés minden műtermék-típusra összegződik: a kérdés az, hogy erre
      // a korpuszra eddig mennyit költöttünk, nem az, hogy melyik recept vitte.
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
    },

    listFailed(items, kind) {
      const failed = new Set(
        (
          db
            .prepare("SELECT item_id FROM artifacts WHERE kind = ? AND status = 'failed'")
            .all(kind) as { item_id: string }[]
        ).map((r) => r.item_id),
      )
      return items.filter((item) => failed.has(item.itemId))
    },

    close() {
      if (closed) return
      closed = true
      db.close()
    },
  }
}
