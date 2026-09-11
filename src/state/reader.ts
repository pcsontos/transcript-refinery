import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { SourceItem } from '../types.js'
import type { CorpusStatus } from './db.js'
import {
  assertCurrentSchema,
  hasTable,
  selectArtifactRows,
  selectCorpusStatus,
  selectGaps,
  selectItemRows,
  type ArtifactRow,
  type ItemRow,
} from './queries.js'

/** Az állapottár a felület szemével: csak olvas. */
export interface StateReader {
  readonly path: string
  items(): ItemRow[]
  artifacts(): ArtifactRow[]
  /**
   * A rögzített hiánylista. `null`, ha nincs rögzítve — vagy ha az állapotfájlban
   * még nincs meg a tábla, mert a változás óta nem futott a CLI.
   */
  gapsOf(itemId: string, kind: string): string[] | null
  /** Ugyanaz a lekérdezés, amiből a futás riportja dolgozik. */
  corpusStatus(items: readonly SourceItem[], kind: string): CorpusStatus
  close(): void
}

/**
 * Csak olvasó kapcsolat. Külön függvény, hogy a teszt közvetlenül bizonyíthassa:
 * írni nem lehet rajta — az SQLite utasítja el, nem konvenció.
 */
export function openReadOnlyDatabase(path: string): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true })
}

/**
 * Az állapottár megnyitása a felületnek. Sémát nem hoz létre és PRAGMA-t nem
 * állít — ez az író dolga. Hiányzó fájlnál `null`: még nem futott semmi, ez nem
 * hiba.
 */
export function openStateReader(path: string): StateReader | null {
  if (!existsSync(path)) return null
  const db = openReadOnlyDatabase(path)
  assertCurrentSchema(db, path)
  const gapsTable = hasTable(db, 'artifact_gaps')

  let closed = false
  return {
    path,
    items: () => selectItemRows(db),
    artifacts: () => selectArtifactRows(db),
    gapsOf: (itemId, kind) => (gapsTable ? selectGaps(db, itemId, kind) : null),
    corpusStatus: (items, kind) => selectCorpusStatus(db, items, kind),
    close() {
      if (closed) return
      closed = true
      db.close()
    },
  }
}
