import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isSubtitlePath, watchSubtitles, type FileWatcher } from './watcher.js'

let dir: string
let watcher: FileWatcher | undefined

const until = async (cond: () => boolean, ms = 5000): Promise<void> => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('időtúllépés')
    await new Promise((r) => setTimeout(r, 50))
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-watcher-'))
})
afterEach(async () => {
  await watcher?.close()
  watcher = undefined
  await rm(dir, { recursive: true, force: true })
})

describe('isSubtitlePath', () => {
  it('az .srt és .vtt feliratot ismeri fel, a letöltés közbeni és más fájlt nem', () => {
    expect(isSubtitlePath('/x/Cím.en.srt')).toBe(true)
    expect(isSubtitlePath('/x/Cím.hu.vtt')).toBe(true)
    expect(isSubtitlePath('/x/Cím.en.srt.part')).toBe(false)
    expect(isSubtitlePath('/x/Cím.mp4')).toBe(false)
    expect(isSubtitlePath('/x/Cím.info.json')).toBe(false)
  })
})

describe('watchSubtitles', () => {
  it('az almappába írt új feliratot jelzi, a nem felirat fájlt nem', async () => {
    const seen: string[] = []
    watcher = await watchSubtitles([dir], (p) => seen.push(p), () => {}, { stabilityMs: 200 })
    await mkdir(join(dir, 'Csatorna'), { recursive: true })
    await writeFile(join(dir, 'Csatorna', 'Videó.mp4'), 'x', 'utf8')
    await writeFile(join(dir, 'Csatorna', 'Videó.en.srt.part'), 'x', 'utf8')
    await writeFile(join(dir, 'Csatorna', 'Videó.en.srt'), 'x', 'utf8')
    await until(() => seen.length > 0)
    await new Promise((r) => setTimeout(r, 500))
    expect(seen).toEqual([join(dir, 'Csatorna', 'Videó.en.srt')])
  })

  it('a meglévő felirat változását jelzi, akkor is, ha az új mtime régebbi az indulásnál', async () => {
    // Pl. `yt-dlp --mtime`, `cp -p`, `rsync -t`: a fájl tartalma új, a dátuma régi.
    const path = join(dir, 'Régi.en.srt')
    const old = new Date(2020, 0, 1)
    await writeFile(path, 'x', 'utf8')
    await utimes(path, old, old)
    const seen: string[] = []
    watcher = await watchSubtitles([dir], (p) => seen.push(p), () => {}, { stabilityMs: 200 })
    await new Promise((r) => setTimeout(r, 300))
    seen.length = 0 // macOS-en az indulás előtti írásra utólag jöhet egy esemény
    await writeFile(path, 'új, hosszabb tartalom', 'utf8')
    await utimes(path, old, old)
    await until(() => seen.length > 0, 3000)
    expect(seen).toContain(path)
  })
})
