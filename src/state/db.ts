import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CaptionSource, SourceItem } from '../types.js'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS videos (
  video_id      TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  channel       TEXT NOT NULL,
  uploaded_at   TEXT NOT NULL,
  url           TEXT NOT NULL,
  subtitle_path TEXT NOT NULL,
  media_path    TEXT,
  discovered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transcripts (
  video_id         TEXT PRIMARY KEY REFERENCES videos(video_id),
  source           TEXT NOT NULL,
  words_raw        INTEGER NOT NULL,
  words_normalized INTEGER NOT NULL,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  video_id   TEXT NOT NULL REFERENCES videos(video_id),
  kind       TEXT NOT NULL,
  status     TEXT NOT NULL,
  path       TEXT,
  error      TEXT,
  iterations INTEGER,
  score      REAL,
  cost_usd   REAL,
  model      TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (video_id, kind)
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

/** A Fázis 0 után hozzáadott oszlopok, migrációs sorrendben. */
const ARTIFACT_COLUMNS: { name: string; ddl: string }[] = [
  { name: 'iterations', ddl: 'INTEGER' },
  { name: 'score', ddl: 'REAL' },
  { name: 'cost_usd', ddl: 'REAL' },
  { name: 'model', ddl: 'TEXT' },
]

/**
 * Hozzáadja a hiányzó oszlopokat egy Fázis 0-ban létrehozott adatbázishoz.
 *
 * A `CREATE TABLE IF NOT EXISTS` meglévő táblán nem csinál semmit, tehát az
 * új oszlopok enélkül sosem jelennének meg egy már használt `.state`-ben —
 * és a hiba nem a teszten, hanem az első valós futáson jönne elő.
 */
function migrateArtifacts(db: DatabaseSync): void {
  const existing = new Set(
    (db.prepare('PRAGMA table_info(artifacts)').all() as { name: string }[]).map(
      (row) => row.name,
    ),
  )
  for (const column of ARTIFACT_COLUMNS) {
    if (existing.has(column.name)) continue
    db.exec(`ALTER TABLE artifacts ADD COLUMN ${column.name} ${column.ddl}`)
  }
}

export interface StateStore {
  readonly path: string
  recordVideo(item: SourceItem): void
  recordTranscript(
    videoId: string,
    source: CaptionSource,
    wordsRaw: number,
    wordsNormalized: number,
  ): void
  recordArtifact(
    videoId: string,
    kind: string,
    status: 'done' | 'failed',
    path: string | null,
    error: string | null,
    metrics?: ArtifactMetrics,
  ): void
  artifactOf(videoId: string, kind: string): ArtifactRecord | null
  transcriptOf(videoId: string): TranscriptRecord | null
  isDone(videoId: string, kind: string): boolean
  listPending(items: SourceItem[], kind: string): SourceItem[]
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
  migrateArtifacts(db)

  const now = () => new Date().toISOString()

  // A `close()` idempotens: a hívónak nem feladata számon tartani, hogy a
  // tár már zárva van-e. Kétszeri zárás enélkül „database is not open"-t dob.
  let closed = false

  // Önálló függvény, nem objektum-metódus: a `listPending` így hivatkozhat rá
  // `this` nélkül, ami strict módban típushibát adna.
  const isDone = (videoId: string, kind: string): boolean =>
    db
      .prepare(
        "SELECT 1 AS ok FROM artifacts WHERE video_id = ? AND kind = ? AND status = 'done'",
      )
      .get(videoId, kind) !== undefined

  return {
    path,

    recordVideo(item) {
      db.prepare(
        `INSERT INTO videos
           (video_id, title, channel, uploaded_at, url, subtitle_path, media_path, discovered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET
           title = excluded.title,
           subtitle_path = excluded.subtitle_path,
           media_path = excluded.media_path`,
      ).run(
        item.videoId,
        item.title,
        item.channel,
        item.uploadedAt,
        item.url,
        item.subtitlePath,
        item.mediaPath,
        now(),
      )
    },

    recordTranscript(videoId, source, wordsRaw, wordsNormalized) {
      db.prepare(
        `INSERT INTO transcripts
           (video_id, source, words_raw, words_normalized, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET
           source = excluded.source,
           words_raw = excluded.words_raw,
           words_normalized = excluded.words_normalized`,
      ).run(videoId, source, wordsRaw, wordsNormalized, now())
    },

    recordArtifact(videoId, kind, status, path, error, metrics) {
      db.prepare(
        `INSERT INTO artifacts
           (video_id, kind, status, path, error, iterations, score, cost_usd, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(video_id, kind) DO UPDATE SET
           status = excluded.status,
           path = excluded.path,
           error = excluded.error,
           iterations = excluded.iterations,
           score = excluded.score,
           cost_usd = excluded.cost_usd,
           model = excluded.model,
           created_at = excluded.created_at`,
      ).run(
        videoId,
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

    artifactOf(videoId, kind) {
      const row = db
        .prepare(
          `SELECT status, path, error, iterations, score, cost_usd, model
             FROM artifacts WHERE video_id = ? AND kind = ?`,
        )
        .get(videoId, kind) as
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

    transcriptOf(videoId) {
      const row = db
        .prepare(
          'SELECT source, words_raw, words_normalized FROM transcripts WHERE video_id = ?',
        )
        .get(videoId) as
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
      return items.filter((i) => !isDone(i.videoId, kind))
    },

    close() {
      if (closed) return
      closed = true
      db.close()
    },
  }
}
