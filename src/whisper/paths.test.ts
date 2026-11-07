import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { channelSlug, WATCHER_STALE_MS, watcherWarning, whisperDirs } from './paths.js'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'refinery-whisper-'))
})

describe('channelSlug', () => {
  it('ékezet nélküli, kisbetűs, kötőjeles', () => {
    expect(channelSlug('Kovács Péter – Előadások')).toBe('kovacs-peter-eloadasok')
    expect(channelSlug('  ÁRVÍZTŰRŐ tükörfúrógép!! ')).toBe('arvizturo-tukorfurogep')
    expect(channelSlug('***')).toBe('nevtelen')
    expect(channelSlug('a'.repeat(80))).toHaveLength(60)
    expect(channelSlug('x y'.repeat(30))).not.toMatch(/-$/)
  })
})

describe('whisperDirs', () => {
  it('hiányzó mappa → null, és nem jön létre', async () => {
    const root = join(tmp, 'nincs')
    expect(await whisperDirs({ whisperDir: root })).toBeNull()
    expect(existsSync(root)).toBe(false)
  })

  it('létező mappa → az almappák útjai, létrehozás nélkül', async () => {
    const dirs = await whisperDirs({ whisperDir: tmp })
    expect(dirs).toEqual({
      root: tmp,
      inbox: join(tmp, 'inbox'),
      work: join(tmp, 'work'),
      failed: join(tmp, 'failed'),
      heartbeat: join(tmp, 'heartbeat'),
    })
    expect(existsSync(join(tmp, 'inbox'))).toBe(false)
  })
})

describe('watcherWarning', () => {
  const NOW = 1_800_000_000_000

  async function dirsWithHeartbeat(ageMs: number | null) {
    const dirs = (await whisperDirs({ whisperDir: tmp }))!
    if (ageMs !== null) {
      await mkdir(tmp, { recursive: true })
      await writeFile(dirs.heartbeat, '')
      const when = new Date(NOW - ageMs)
      await utimes(dirs.heartbeat, when, when)
    }
    return dirs
  }

  it('friss életjel → null', async () => {
    expect(await watcherWarning(await dirsWithHeartbeat(WATCHER_STALE_MS - 1_000), NOW)).toBeNull()
  })

  it('5 percnél régebbi életjel → figyelmeztetés a helyi idővel', async () => {
    const warning = await watcherWarning(await dirsWithHeartbeat(WATCHER_STALE_MS + 1_000), NOW)
    expect(warning).toMatch(
      /^A whisper-figyelő nem fut \(utolsó életjel: \d{4}-\d{2}-\d{2} \d{2}:\d{2}\); a tétel sorban marad, és bejelentkezés után feldolgozódik\.$/,
    )
  })

  it('nincs életjel → „nincs”', async () => {
    expect(await watcherWarning(await dirsWithHeartbeat(null), NOW)).toBe(
      'A whisper-figyelő nem fut (utolsó életjel: nincs); a tétel sorban marad, és bejelentkezés után feldolgozódik.',
    )
  })
})
