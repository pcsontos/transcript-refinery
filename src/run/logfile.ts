import { existsSync } from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunEvent } from '../events.js'

/** Egy naplósor: az esemény és — a Fázis 5 óta — az írás időpontja. */
export type RunLogLine = RunEvent & { at?: string }

/** Egy beolvasott sor, és a vége utáni bájt-offset: innen folytatható az olvasás. */
export interface RunLogEntry {
  line: RunLogLine
  end: number
}

export interface RunLogChunk {
  lines: RunLogEntry[]
  /** Az utolsó lezárt sor utáni offset; a félig kiírt sor ide nem számít bele. */
  nextOffset: number
  /** Kihagyott, értelmezhetetlen sorok száma. */
  invalid: number
}

/** Egy futás fájljai a naplómappában. */
export interface RunFiles {
  runId: string
  logPath: string
  /** A riport útvonala; `null`, ha még (vagy soha) nem készült el. */
  reportPath: string | null
}

const RUN_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d+)?$/

/**
 * A `runId` és a `reserveRunId` által előállítható alak. Fájlútvonal csak ezen
 * az őrön átjutott értékből képződhet: így URL-ből nem olvastatható a
 * naplómappán kívüli fájl.
 */
export function isRunId(value: string): boolean {
  return RUN_ID.test(value)
}

/** A naplómappa futásai, legújabb elöl. Hiányzó mappánál üres lista. */
export async function listRuns(logsDir: string): Promise<RunFiles[]> {
  let names: string[]
  try {
    names = await readdir(logsDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const runs: RunFiles[] = []
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue
    const runId = name.slice(0, -'.jsonl'.length)
    if (!isRunId(runId)) continue
    const reportPath = join(logsDir, `${runId}.md`)
    runs.push({
      runId,
      logPath: join(logsDir, name),
      reportPath: existsSync(reportPath) ? reportPath : null,
    })
  }
  // Az azonosító időbélyeg-alakú, tehát a kódpont szerinti rendezés időrend.
  return runs.sort((a, b) => (a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0))
}

function parseLine(text: string): RunLogLine | null {
  try {
    const value = JSON.parse(text) as unknown
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { type?: unknown }).type === 'string'
    ) {
      return value as RunLogLine
    }
    return null
  } catch {
    return null
  }
}

/**
 * A napló `offset`-től kezdődő, újsorral lezárt sorai.
 *
 * Egy futás közben olvasott napló utolsó sora félig kiírt lehet: az a következő
 * olvasásra marad. Az offset bájtban értendő, nem karakterben — az ékezetes
 * szöveg miatt a kettő eltér.
 */
export async function readRunEvents(path: string, offset = 0): Promise<RunLogChunk> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    if (offset >= size) return { lines: [], nextOffset: offset, invalid: 0 }

    const buffer = Buffer.alloc(size - offset)
    await handle.read(buffer, 0, buffer.length, offset)
    const lastNewline = buffer.lastIndexOf(0x0a)
    if (lastNewline === -1) return { lines: [], nextOffset: offset, invalid: 0 }

    const lines: RunLogEntry[] = []
    let invalid = 0
    let start = 0
    while (start <= lastNewline) {
      const newline = buffer.indexOf(0x0a, start)
      const text = buffer.subarray(start, newline).toString('utf8')
      const end = offset + newline + 1
      start = newline + 1
      if (text.trim() === '') continue
      const line = parseLine(text)
      if (line) lines.push({ line, end })
      else invalid++
    }
    return { lines, nextOffset: offset + lastNewline + 1, invalid }
  } finally {
    await handle.close()
  }
}

/** Az SSE `Last-Event-ID` fejlécéből kapott offset; érvénytelen értékre 0. */
export function parseEventId(value: string | undefined): number {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : 0
}

/** Egy futás fájljai azonosító szerint; nem `runId` alakú vagy nem létező futásra `null`. */
export function findRun(logsDir: string, runId: string): RunFiles | null {
  if (!isRunId(runId)) return null
  const logPath = join(logsDir, `${runId}.jsonl`)
  if (!existsSync(logPath)) return null
  const reportPath = join(logsDir, `${runId}.md`)
  return { runId, logPath, reportPath: existsSync(reportPath) ? reportPath : null }
}
