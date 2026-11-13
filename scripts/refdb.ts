// A refinery.db csak olvasható pillanatképe a tmp/-ben, megnyitva a Harlequinben.
// Használat: pnpm db. A forrás a REFINERY_DB; a pnpm-parancs a .env-ből tölti, a környezet erősebb.
// Az élő fájlt csak olvassa. A pillanatkép a -wal friss írásait is tartalmazza (VACUUM INTO).
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

const ATTEMPTS = 3
const RETRY_MS = 1000
/** Ezeknél a forrás nem érhető el: rossz út, vagy nincs felcsatolva / alszik a megosztás. */
const UNREACHABLE: Record<string, true> = { ENOENT: true, EIO: true, ETIMEDOUT: true, EHOSTDOWN: true }
/** SQLITE_CORRUPT és SQLITE_NOTADB: írás közben másolt, széttört fájl. */
const TORN = new Set([11, 26])

/** A forrás a másolás alatt változott: a próbálkozás érvénytelen. */
class Unstable extends Error {}

export class SnapshotBusy extends Error {
  constructor() {
    super('Az adatbázis írás alatt van, próbáld újra.')
  }
}

/**
 * Pillanatkép `src`-ről `dest`-be: a `.db` és a `-wal` másolata egy egyedi
 * munkamappában, `VACUUM INTO` egyetlen önálló, rollback módú fájlba, `0444`,
 * végül atomikus csere. A `src`-t csak olvassa.
 */
export async function snapshot(src: string, dest: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      snapshotOnce(src, dest)
      return
    } catch (error) {
      if (!(error instanceof Unstable)) throw error
      if (attempt === ATTEMPTS) throw new SnapshotBusy()
      await sleep(RETRY_MS)
    }
  }
}

function snapshotOnce(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true })
  const work = mkdtempSync(join(dirname(dest), 'refinery-snap-'))
  try {
    const copy = join(work, 'refinery.db')
    const before = fingerprint(src)
    copyFileSync(src, copy)
    if (before.wal !== null) {
      try {
        copyFileSync(`${src}-wal`, `${copy}-wal`)
      } catch (error) {
        // Az író közben bezárt, és a checkpoint törölte a -wal-t.
        if (errorCode(error) === 'ENOENT') throw new Unstable()
        throw error
      }
    }
    const after = fingerprint(src)
    if (after.db !== before.db || after.wal !== before.wal) throw new Unstable()

    const out = join(work, 'out.db')
    vacuumInto(copy, out)
    chmodSync(out, 0o444)
    renameSync(out, dest)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** Írhatóan nyit: az SQLite így hozza létre a -shm-et és játssza vissza a -wal-t. */
function vacuumInto(copy: string, out: string): void {
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(copy)
    const check = db.prepare('PRAGMA quick_check').get()
    if (check?.quick_check !== 'ok') throw new Unstable()
    db.prepare('VACUUM INTO ?').run(out)
  } catch (error) {
    // A kiterjesztett hibakód alsó bájtja az elsődleges kód.
    if (error instanceof Error && 'errcode' in error && typeof error.errcode === 'number' && TORN.has(error.errcode & 0xff)) {
      throw new Unstable()
    }
    throw error
  } finally {
    db?.close()
  }
}

function fingerprint(src: string): { db: string; wal: string | null } {
  const stamp = (path: string) => {
    const stat = statSync(path)
    return `${stat.size}:${stat.mtimeMs}`
  }
  let wal: string | null
  try {
    wal = stamp(`${src}-wal`)
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
    wal = null
  }
  return { db: stamp(src), wal }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

async function main(): Promise<void> {
  const src = process.env.REFINERY_DB
  if (!src) fail('REFINERY_DB nincs beállítva (.env).')
  const root = resolve(import.meta.dirname, '..')
  try {
    await snapshot(src, join(root, 'tmp', 'refinery.db'))
  } catch (error) {
    if (error instanceof SnapshotBusy) fail(error.message)
    if (UNREACHABLE[errorCode(error) ?? '']) fail(`Nem olvasható: ${src}\nFel van csatolva a hálózati megosztás?`)
    throw error
  }
  // A fájlfa a scripts/sql/ egészét mutatja; a Ctrl+S / Ctrl+O útjai a repó gyökeréhez (cwd) relatívak.
  const result = spawnSync('harlequin', ['-a', 'sqlite', '-r', '-f', 'scripts/sql', 'tmp/refinery.db'], {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.error) fail(`A harlequin nem indult: ${result.error.message}`)
  process.exit(result.status ?? 1)
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
