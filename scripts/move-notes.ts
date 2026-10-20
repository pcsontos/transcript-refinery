// Egyszeri: a vault meglévő jegyzeteit az új `vault.layout` szerinti mappákba mozgatja.
// Használat: pnpm exec tsx scripts/move-notes.ts [--config refinery.config.yaml] [--apply]
// --apply nélkül csak kiírja a `régi → új` párokat. Az állapottárhoz nem nyúl: az utakat
// a következő `refinery run` követése frissíti.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { parseArgs } from 'node:util'
import { promisify } from 'node:util'
import { loadCliConfig } from '../src/config.js'
import { layoutSegments } from '../src/vault/paths.js'
import { findNotes } from '../src/vault/relink.js'
import { sanitizeSegment } from '../src/vault/sanitize.js'

const git = promisify(execFile)

// A `serve` kimeneti mappája átnevezésének megfelelő forrásnév-csere.
const RENAMED: Record<string, string> = { 'serve-out': 'telegram' }

const text = (value: unknown): string | undefined =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : value instanceof Date ? value.toISOString().slice(0, 10) : undefined

const { values } = parseArgs({ options: { apply: { type: 'boolean' }, config: { type: 'string' } } })
const { cfg } = await loadCliConfig(values.config)
const root = cfg.notesRoot + '/'

let moved = 0
for (const note of await findNotes(cfg.vaultPath)) {
  if (!note.path.startsWith(root)) continue
  const source = text(note.fields.source)
  if (source === undefined) continue
  const target = join(
    cfg.notesRoot,
    sanitizeSegment(RENAMED[source] ?? source),
    ...layoutSegments(cfg.layout, {
      item_id: text(note.fields.item_id),
      title: text(note.fields.title),
      channel: text(note.fields.channel),
      video_id: text(note.fields.video_id),
      uploaded: text(note.fields.uploaded),
    }),
    basename(note.path),
  )
  if (target === note.path) continue
  const pair = `${relative(cfg.notesRoot, note.path)} → ${relative(cfg.notesRoot, target)}`
  if (existsSync(target)) {
    console.log(`kihagyva, létezik: ${pair}`)
    continue
  }
  console.log(pair)
  if (values.apply) {
    await mkdir(dirname(target), { recursive: true })
    await git('git', ['-C', cfg.vaultPath, 'mv', note.path, target])
  }
  moved++
}
console.log(`${String(moved)} jegyzet ${values.apply ? 'áthelyezve' : 'mozdulna'}.`)
if (values.apply && moved > 0) console.log('Commitold a vaultot, aztán futtasd: refinery run')
