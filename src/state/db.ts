import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CaptionSource, SourceItem } from '../types.js'
import {
  assertCurrentSchema,
  fromStored,
  selectArtifact,
  selectCorpusStatus,
  selectGaps,
  toStored,
} from './queries.js'

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

CREATE TABLE IF NOT EXISTS artifact_gaps (
  item_id TEXT NOT NULL,
  kind    TEXT NOT NULL,
  gaps    TEXT NOT NULL,
  PRIMARY KEY (item_id, kind),
  FOREIGN KEY (item_id, kind) REFERENCES artifacts(item_id, kind)
);

-- Egy commit-módú futás által megírt, de még nem commitolt műtermékek. Egy
-- megszakadt vagy elhasalt commit után a következő futás ebből tudja, mit
-- kell utólag felvennie — anélkül, hogy minden 'done' műterméket újra
-- commitolna, azt is, amit a felhasználó korábban tudatosan --no-commit
-- mellett írt. Új tábla, nem az artifacts oszlopa: a régi állapotfájlokon is
-- migráció nélkül, biztonságosan létrejön.
CREATE TABLE IF NOT EXISTS pending_commits (
  item_id TEXT NOT NULL,
  kind    TEXT NOT NULL,
  path    TEXT NOT NULL,
  PRIMARY KEY (item_id, kind)
);
`

/** Egy commitra váró jegyzet. Az `id` a videóazonosító, annak híján az elem azonosítója. */
export interface PendingNote {
  id: string
  title: string
  /** `transcript` vagy a recept azonosítója. */
  kind: string
  path: string
}

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
  /**
   * A megtartott kimenet hiánylistája, ahogy a bíró megnevezte. Hiánya azt
   * jelenti, hogy nincs rögzítve; az üres tömb azt, hogy a bíró nem talált
   * hiányt. A felület a kettőt megkülönbözteti.
   */
  gaps?: string[]
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
    /** Jelöld a műterméket commitra várónak — csak commit-módú futás adja meg. */
    pendingCommit?: boolean,
  ): void
  artifactOf(itemId: string, kind: string): ArtifactRecord | null
  /** A `done` sorok nem üres útja, abszolútként. */
  trackedPaths(): { itemId: string; kind: string; path: string }[]
  /** Egy kész jegyzet új útja (abszolút; a határ relatívvá alakítja). */
  movePath(itemId: string, kind: string, path: string): void
  /**
   * Minden még commitra váró műtermék útvonala, rögzítés sorrendjében —
   * FÜGGETLENÜL attól, hogy a hívó futás mely elemeket válogatta be. Egy
   * korábbi, más `--recipe`/`--source`/`--queue` szűrővel futó kötegből
   * maradt jegyzetet is felvesz: a #25 issue épp azt hiányolta, hogy egy
   * megszakadt vagy elhasalt commit csak akkor pótlódjon, ha a következő
   * futás véletlenül ugyanazt válogatja be.
   */
  listPendingCommits(): string[]
  /** Ugyanez jegyzetenként, a commit üzenetéhez kellő azonosítóval, címmel és fajtával. */
  listPendingNotes(): PendingNote[]
  /** A megadott útvonalak levétele a commitra várók közül, sikeres commit után. */
  clearPendingCommits(paths: readonly string[]): void
  /** A rögzített hiánylista; `null`, ha nincs rögzítve. */
  gapsOf(itemId: string, kind: string): string[] | null
  transcriptOf(itemId: string): TranscriptRecord | null
  isDone(itemId: string, kind: string): boolean
  listPending(items: SourceItem[], kind: string): SourceItem[]
  corpusStatus(items: readonly SourceItem[], kind: string): CorpusStatus
  listFailed(items: readonly SourceItem[], kind: string): SourceItem[]
  close(): void
}

/**
 * A `user_version` 0 → 1 migrációja: a `vaultPath` alatti abszolút utak
 * relatívvá válnak. Csak valódi átírnivalónál készül `.bak` (`VACUUM INTO`,
 * mert a WAL-ban ülő adatot egy fájlmásolás elveszítené). `substr`, nem
 * `LIKE`: a `_` és a `%` ott helyettesítő karakter.
 */
function migrateToRelativePaths(db: DatabaseSync, path: string, vaultPath: string): void {
  const prefix = vaultPath + '/'
  const tables = ['artifacts', 'pending_commits']
  const count = tables.reduce(
    (sum, t) =>
      sum +
      (
        db
          .prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE substr(path, 1, length(?)) = ?`)
          .get(prefix, prefix) as { n: number }
      ).n,
    0,
  )
  if (count > 0) {
    rmSync(`${path}.bak`, { force: true })
    db.exec(`VACUUM INTO '${`${path}.bak`.replaceAll("'", "''")}'`)
  }
  db.exec('BEGIN')
  try {
    for (const t of tables) {
      db.prepare(
        `UPDATE ${t} SET path = substr(path, length(?) + 1) WHERE substr(path, 1, length(?)) = ?`,
      ).run(prefix, prefix, prefix)
    }
    db.exec('PRAGMA user_version = 1')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  const left = db
    .prepare("SELECT path FROM artifacts WHERE path LIKE '/%' UNION SELECT path FROM pending_commits WHERE path LIKE '/%'")
    .all() as { path: string }[]
  if (left.length > 0) {
    console.error(
      `${left.length} tárolt út a vaulton kívül marad (abszolút): ${left
        .slice(0, 3)
        .map((r) => r.path)
        .join(', ')}`,
    )
  }
}

/**
 * Megnyitja (és szükség esetén létrehozza) az állapottárat. A séma
 * idempotens, tehát az újranyitás biztonságos. A `vaultPath`-szal a jegyzetek
 * útját a vaulthoz relatívan tárolja; nélküle (mérőszkript, régi teszt) a
 * viselkedés a régi, és a migráció nem fut.
 */
export function openState(path: string, vaultPath?: string): StateStore {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)

  assertCurrentSchema(db, path)

  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number })
    .user_version
  if (vaultPath !== undefined && version < 1) migrateToRelativePaths(db, path, vaultPath)

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

    recordArtifact(itemId, kind, status, path, error, metrics, pendingCommit) {
      // Egy tranzakcióban: a műtermék, a hiánylistája és a commit-várólistán
      // szereplése együtt változik, így egy újrafuttatás után sem maradhat a
      // régi kimenet hiánylistája vagy commit-jelölése az új mellett.
      db.exec('BEGIN')
      try {
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
          path === null ? null : toStored(vaultPath, path),
          error,
          metrics?.iterations ?? null,
          metrics?.score ?? null,
          metrics?.costUsd ?? null,
          metrics?.model ?? null,
          now(),
        )
        db.prepare('DELETE FROM artifact_gaps WHERE item_id = ? AND kind = ?').run(itemId, kind)
        if (status === 'done' && metrics?.gaps !== undefined) {
          db.prepare('INSERT INTO artifact_gaps (item_id, kind, gaps) VALUES (?, ?, ?)').run(
            itemId,
            kind,
            JSON.stringify(metrics.gaps),
          )
        }
        if (status === 'done' && path !== null && pendingCommit === true) {
          db.prepare(
            `INSERT INTO pending_commits (item_id, kind, path) VALUES (?, ?, ?)
             ON CONFLICT(item_id, kind) DO UPDATE SET path = excluded.path`,
          ).run(itemId, kind, toStored(vaultPath, path))
        }
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },

    gapsOf(itemId, kind) {
      return selectGaps(db, itemId, kind)
    },

    artifactOf(itemId, kind) {
      return selectArtifact(db, itemId, kind, vaultPath)
    },

    trackedPaths() {
      return (
        db
          .prepare(
            "SELECT item_id, kind, path FROM artifacts WHERE status = 'done' AND path IS NOT NULL AND path != '' ORDER BY item_id, kind",
          )
          .all() as { item_id: string; kind: string; path: string }[]
      ).map((r) => ({ itemId: r.item_id, kind: r.kind, path: fromStored(vaultPath, r.path) }))
    },

    movePath(itemId, kind, path) {
      db.prepare('UPDATE artifacts SET path = ? WHERE item_id = ? AND kind = ?').run(
        toStored(vaultPath, path),
        itemId,
        kind,
      )
    },

    listPendingCommits() {
      return (db.prepare('SELECT path FROM pending_commits ORDER BY rowid').all() as {
        path: string
      }[]).map((row) => fromStored(vaultPath, row.path))
    },

    listPendingNotes() {
      return db
        .prepare(
          `SELECT COALESCE(i.video_id, p.item_id) AS id, COALESCE(i.title, p.item_id) AS title, p.kind, p.path
           FROM pending_commits p LEFT JOIN items i ON i.item_id = p.item_id ORDER BY p.rowid`,
        )
        .all()
        .map((row) => ({
          ...(row as unknown as PendingNote),
          path: fromStored(vaultPath, (row as unknown as PendingNote).path),
        }))
    },

    clearPendingCommits(paths) {
      if (paths.length === 0) return
      const placeholders = paths.map(() => '?').join(', ')
      db.prepare(`DELETE FROM pending_commits WHERE path IN (${placeholders})`).run(
        ...paths.map((p) => toStored(vaultPath, p)),
      )
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
      return selectCorpusStatus(db, items, kind)
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
