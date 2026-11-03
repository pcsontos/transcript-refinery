import { closeSync, futimesSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import type { EventSink } from '../events.js'
import { HEARTBEAT_MS } from './status.js'

export interface RunLog {
  /** A napló útvonala; a riport és a konzol ezt nevezi meg. */
  readonly path: string
  sink: EventSink
  close(): void
}

/**
 * JSONL eseménynapló: eseményenként egy sor, azonnali kiírással.
 *
 * A szinkron `writeSync` szándékos. Ennek a naplónak az egyetlen
 * létjogosultsága, hogy egy éjszaka közepén megszakadt futás után is legyen
 * nyom — egy pufferelt stream pont abban a pillanatban veszítené el az utolsó
 * sorokat, amiért a napló egyáltalán készül.
 *
 * A nyitott napló fájlideje esemény nélkül is `HEARTBEAT_MS`-enként frissül:
 * a felület ebből látja, él-e még az író (`isWriterAlive`).
 */
export function openRunLog(path: string): RunLog {
  mkdirSync(dirname(path), { recursive: true })
  const fd = openSync(path, 'a')
  let closed = false
  // Az életjel nem tartja életben a folyamatot; a hibája (pl. eltűnt fájl) nem
  // döntheti el a futást.
  const heartbeat = setInterval(() => {
    try {
      futimesSync(fd, new Date(), new Date())
    } catch {
      // szándékosan elnyelve
    }
  }, HEARTBEAT_MS)
  heartbeat.unref()

  return {
    path,

    sink(event) {
      if (closed) return
      // Az idő a napló tulajdonsága, nem az eseményé: a `RunEvent` időmentes
      // marad, így a mag tesztjei determinisztikusak. A felület ebből rajzolja
      // az idővonalat, és ebből látja, mióta nem jött esemény.
      writeSync(fd, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`)
    },

    // Idempotens, mint az állapottár `close()`-a: a hívónak nem feladata
    // számon tartani, hogy a napló már zárva van-e.
    close() {
      if (closed) return
      closed = true
      // Előbb az időzítő: a lezárt leírón a `futimesSync` `EBADF`-et dobna.
      clearInterval(heartbeat)
      closeSync(fd)
    },
  }
}
