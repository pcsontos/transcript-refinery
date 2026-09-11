import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import type { EventSink } from '../events.js'

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
 */
export function openRunLog(path: string): RunLog {
  mkdirSync(dirname(path), { recursive: true })
  const fd = openSync(path, 'a')
  let closed = false

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
      closeSync(fd)
    },
  }
}
