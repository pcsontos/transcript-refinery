import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Fixture } from './fixtures/transcripts.js'

const PRIVATE_PATH = join(process.cwd(), 'evals', 'private', 'fixtures.json')

/**
 * A mérőhalmaz privát rétege: a valós korpuszból válogatott elemek, amik
 * verziókövetésen kívül élnek (`evaluation.md` §4).
 *
 * Hiánya **nem hiba** — egy idegennek a publikus réteggel is le kell tudnia
 * futtatni a mérést. A kihagyás viszont látható, nem csendes.
 */
export function loadPrivateFixtures(): Fixture[] {
  try {
    return JSON.parse(readFileSync(PRIVATE_PATH, 'utf8')) as Fixture[]
  } catch {
    console.log(
      'A privát mérőréteg nincs jelen (evals/private/fixtures.json) — a mérés a publikus, szintetikus rétegen fut.',
    )
    return []
  }
}
