import { COMMIT_SCOPE } from '../meta.js'

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
