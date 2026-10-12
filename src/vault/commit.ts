import { COMMIT_SCOPE } from '../meta.js'
import type { StateStore } from '../state/db.js'
import { gitCommitPaths, gitHasChanges } from './git.js'

/** A commit első sorának hosszkorlátja. */
const SUBJECT_MAX = 80

/**
 * Egy jegyzet commitjának első sora: `<fajta> | <cím> [<azonosító>]`. A cím
 * rövidül, az azonosító soha: ha mellette nem fér el cím, a sor inkább átlépi
 * a korlátot.
 */
export function noteCommitMessage(kind: string, title: string, id: string): string {
  const head = `docs(${COMMIT_SCOPE}): ${kind} | `
  // A yt-dlp fájlnevéből örökölt cím végén ott az azonosító: kétszer nem kell.
  const clean = title.replace(`[${id}]`, '').replace(/\s+/g, ' ').trim()
  const chars = [...clean]
  const room = SUBJECT_MAX - [...head].length - [...id].length - 2
  if (chars.length === 0) return `${head}[${id}]`
  if (chars.length + 1 <= room) return `${head}${clean} [${id}]`
  return `${head}${chars.slice(0, Math.max(room - 1, 0)).join('').trimEnd()}…[${id}]`
}

/**
 * A commitra váró jegyzeteket egyenként commitolja. A sor fájlja (ha
 * változott) az utolsó olyan jegyzet commitjával megy, amelynek a fájlja
 * ténylegesen változott, hogy ne szaporítsa a vault történetét; ha egyik sem
 * változott (vagy nincs jegyzet), saját commitot kap. Egy változatlan
 * jegyzet commitjába nem kerülhet a sor: az üzenet olyan jegyzetet nevezne
 * meg, amely nincs a commitban. Egy jegyzet csak a saját commitja után kerül
 * le a várólistáról: ha a sorozat félbeszakad, a maradékot a következő futás
 * pótolja. A commitok számát adja vissza; push nincs benne.
 */
export async function commitPending(repo: string, store: StateStore, queuePath: string | null): Promise<number> {
  const notes = store.listPendingNotes()
  // A fájlok állapota a commitok előtt is pontos: egy másik jegyzet commitja nem érinti az útját.
  let carrier = -1
  if (queuePath !== null) {
    for (let index = notes.length - 1; index >= 0; index -= 1) {
      if (await gitHasChanges(repo, [notes[index]!.path])) {
        carrier = index
        break
      }
    }
  }
  let commits = 0
  for (const [index, note] of notes.entries()) {
    const paths = queuePath !== null && index === carrier ? [note.path, queuePath] : [note.path]
    if (await gitCommitPaths(repo, paths, noteCommitMessage(note.kind, note.title, note.id))) commits += 1
    store.clearPendingCommits([note.path])
  }
  if (
    queuePath !== null &&
    carrier === -1 &&
    (await gitCommitPaths(repo, [queuePath], `docs(${COMMIT_SCOPE}): feldolgozási sor frissítése`))
  ) {
    commits += 1
  }
  return commits
}
