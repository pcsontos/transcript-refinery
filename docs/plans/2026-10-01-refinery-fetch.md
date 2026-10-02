# Refinery Fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `refinery fetch subtitle` parancs YouTube-feliratot és `.info.json` fájlt ír egy helyi mappába a `yt-dlp` segítségével, és a kész párost átugorja.

**Architecture:** A parancs a csővezetéken kívül él. A közös vezérlés és bemenetosztályozás a `src/fetch/` gyökerében él (`command.ts`, `classify.ts`), míg a felirat-specifikus letöltési és átugrási logika a `src/fetch/subtitle/` almappába szerveződik (`args.ts`, `skip.ts`, `ytdlp.ts`). A `yt-dlp` egy injektált folyamatfuttató. A `run` és a `watch` kódja nem változik. A `fetch` belépési pontja a `subtitle` modalitást ellenőrzi (később `audio` és `video` modalitásokkal bővíthető).

**Tech Stack:** Node.js `>=26.2.0`, TypeScript, `node:util` `parseArgs`, `node:child_process` `spawn`, Vitest. Új függőség nincs.

**Spec:** `docs/plans/2026-10-01-refinery-fetch-spec.md`

A munka a meglévő worktree-ben megy: `.worktrees/refinery-fetch`, ág `feat/refinery-fetch`. Új worktree nem kell.

## Global Constraints

- A parancs alakja: `refinery fetch subtitle <url> ...` vagy `refinery fetch subtitle --list <fájl> ...`. A `subtitle` nem hagyható el.
- Ha az első argumentum hiányzik vagy kapcsoló (`-` kezdetű), a hiba: `Hiányzó fetch-mód. Ismert: subtitle` (exit code 1).
- Ha az első argumentum nem `subtitle`, a hiba: `Ismeretlen fetch-mód: <mód>. Ismert: subtitle` (exit code 1).
- `--help` / `-h` a parancs legelején (akár mód nélkül is) a súgót írja ki 0-s kóddal.
- A tételek sorban futnak. Párhuzamos letöltés nincs.
- Whisper, provider-felület, süti, `--netrc`, felhasználónév, ffmpeg, `--convert-subs`, a `best` formátum és a `--download-archive` kimarad.
- A `--force` a `run` kapcsolója. Felülírás: `--overwrite`.
- A `validateConfig` nem fut. Az `index.ts` nem exportálja a fetch-et. A web és az eval nem változik.
- A `--sub-format` alapértéke `vtt,srt`, a `yt-dlp`-nek `vtt/srt`.
- A `--sub-lang` alapértéke a config `languages` listája, üres lista esetén `hu,en`.
- YouTube-host: `youtube.com`, `*.youtube.com`, `youtu.be`, `youtube-nocookie.com`.
- A videóazonosító 11 karakter, `[A-Za-z0-9_-]`.
- Kilépés: minden tétel letöltve vagy átugorva → `0`; felirat nélkül, hiba vagy elutasított sor → `1`; indulási hiba → `1`; megszakítás → `130`.
- Hiányzó bináris üzenete, szó szerint: `A yt-dlp nem található a PATH-on. Telepítés: brew install yt-dlp vagy mise use yt-dlp`
- A teszt nem éri el a hálózatot és nem hív valódi YouTube-ot.
- A `pnpm test` a worktree-ben zöld.

## Review Focus

Ezek a bemenetek a specből következnek, és egy elnézett ág rossz mappát vagy örök újrapróbálást okoz. Mindegyikhez a tulajdonos feladat tartalmaz tesztet.

1. A `watch?v=<id>&list=<lista>` cím `--yes-playlist` nélkül csak a videó. Várható: egy videó, a kanonikus `watch?v=` URL, a lista nem indul. (1. feladat)
2. A mód hiánya vagy hibája (`fetch` mód nélkül, vagy `fetch audio` / `fetch youtube`) indulási hiba, a config és a letöltő hívás előtt. (5. feladat)
3. A címben lévő ál-azonosító, `Talk [live] [abcdefghijk].hu.vtt`, nem nyeli el a valódi 11 karakteres azonosítót. Várható: az átugrás az `abcdefghijk` fájlt látja. (3. feladat)
4. A jó `.hu.vtt` mellett álló sérült `.info.json` nem számít kész párnak, és a törlés a szomszéd videó fájlját békén hagyja. Várható: a hívás `--no-overwrites`, a jó felirat megmarad. (3. és 5. feladat)
5. Ugyanaz a videóazonosító a szomszéd listamappában nem ugorja át a másik lista példányát. Várható: mindkét listára lemegy a letöltés. (6. feladat)
6. A `Ctrl+C` a második tétel előtt megáll. Várható: a második letöltés nem indul, a kód `130`, az összesítés csak a kész tételt számolja. A félbeszakadt hívás nem kap sort. (6. feladat)

## File Structure

| Fájl | Felelősség |
|---|---|
| `src/fetch/classify.ts` | Egy sor → videó, lista vagy elutasítás (közös URL osztályozó) |
| `src/fetch/subtitle/args.ts` | A `fetch subtitle` utáni argumentumok → `SubtitleArgs` vagy hiba |
| `src/fetch/subtitle/skip.ts` | Célmappa neve, kész feliratpár, hiányos fájl takarítása |
| `src/fetch/subtitle/ytdlp.ts` | Feliratos argumentumlisták, JSON-olvasás, folyamatfuttató |
| `src/fetch/command.ts` | Mód ellenőrzése (`subtitle`), diszpecselés, kiírás, kilépési kód, listafájl |
| `src/cli.ts` | `fetch` ág a közös elemző előtt, `USAGE` |
| `README.md` | Egy bekezdés az „Ami már fut” alatt |
| `docs/decisions/0008-forras-fuggetlen-bemenet.md` | A spec kiegészítő bekezdése |

A tesztek a modulok mellett vannak: `src/fetch/*.test.ts` és `src/fetch/subtitle/*.test.ts`, plusz egy `describe` a `src/cli.test.ts`-ben.

---

### Task 1: Cím osztályozása

**Files:**
- Create: `src/fetch/classify.ts`
- Test: `src/fetch/classify.test.ts`

**Interfaces:**
- Consumes: semmit
- Produces:
  - `export type VideoInput = { kind: 'video'; id: string; url: string }`
  - `export type PlaylistInput = { kind: 'playlist'; id: string; url: string }`
  - `export type RejectedInput = { kind: 'rejected'; raw: string }`
  - `export type ClassifiedInput = VideoInput | PlaylistInput | RejectedInput`
  - `export function classifyInput(raw: string, yesPlaylist: boolean): ClassifiedInput`
  - Videónál az `url` mindig `https://www.youtube.com/watch?v=<id>`. Listánál az `url` a trimelt eredeti cím. Az `id` listánál a `list` paraméter.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { classifyInput } from './classify.js'

const video = (id: string) => ({
  kind: 'video' as const,
  id,
  url: `https://www.youtube.com/watch?v=${id}`,
})

describe('classifyInput', () => {
  it('a watch cím videó', () => {
    expect(classifyInput('https://www.youtube.com/watch?v=abcdefghijk', false)).toEqual(
      video('abcdefghijk'),
    )
  })

  it('a watch?v=&list= cím alapból csak a videó', () => {
    expect(
      classifyInput('https://www.youtube.com/watch?v=abcdefghijk&list=PLcourse123', false),
    ).toEqual(video('abcdefghijk'))
  })

  it('a --yes-playlist a watch?v=&list= címet listának veszi', () => {
    expect(
      classifyInput(' https://music.youtube.com/watch?v=abcdefghijk&list=PLcourse123 ', true),
    ).toEqual({
      kind: 'playlist',
      id: 'PLcourse123',
      url: 'https://music.youtube.com/watch?v=abcdefghijk&list=PLcourse123',
    })
  })

  it('a playlist útvonal és a list= v= nélkül lista', () => {
    expect(
      classifyInput('https://www.youtube.com/playlist?list=PLcourse123', false).kind,
    ).toBe('playlist')
  })

  it('a youtu.be, a shorts, az embed és a csupasz azonosító videó', () => {
    expect(classifyInput('https://youtu.be/abcdefghijk?t=3', false)).toEqual(video('abcdefghijk'))
    expect(classifyInput('https://www.youtube.com/shorts/abcdefghijk', false)).toEqual(
      video('abcdefghijk'),
    )
    expect(classifyInput('https://www.youtube-nocookie.com/embed/abcdefghijk', false)).toEqual(
      video('abcdefghijk'),
    )
    expect(classifyInput('abcdefghijk', false)).toEqual(video('abcdefghijk'))
  })

  it('a --yes-playlist lista nélkül videó marad', () => {
    expect(classifyInput('https://www.youtube.com/watch?v=abcdefghijk', true)).toEqual(
      video('abcdefghijk'),
    )
  })

  it('a 11-től eltérő v= és az idegen host elutasítás', () => {
    expect(classifyInput('https://www.youtube.com/watch?v=rovid', false)).toEqual({
      kind: 'rejected',
      raw: 'https://www.youtube.com/watch?v=rovid',
    })
    expect(classifyInput('https://vimeo.com/123456789', false).kind).toBe('rejected')
    expect(classifyInput('   ', false)).toEqual({ kind: 'rejected', raw: '' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/fetch/classify.test.ts`
Expected: FAIL, a `./classify.js` modul nem létezik.

- [ ] **Step 3: Write minimal implementation**

```ts
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const LIST_ID = /^[A-Za-z0-9_-]+$/

export interface VideoInput {
  kind: 'video'
  id: string
  url: string
}

export interface PlaylistInput {
  kind: 'playlist'
  id: string
  url: string
}

export interface RejectedInput {
  kind: 'rejected'
  raw: string
}

export type ClassifiedInput = VideoInput | PlaylistInput | RejectedInput

function rejected(raw: string): RejectedInput {
  return { kind: 'rejected', raw }
}

function video(id: string): VideoInput {
  return { kind: 'video', id, url: `https://www.youtube.com/watch?v=${id}` }
}

function isYouTubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '')
  return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be' || host === 'youtube-nocookie.com'
}

function pathId(pathname: string, marker: string): string | null {
  const parts = pathname.split('/').filter((part) => part !== '')
  const at = parts.indexOf(marker)
  const id = at === -1 ? undefined : parts[at + 1]
  return id !== undefined && VIDEO_ID.test(id) ? id : null
}

/** Egy trimelt sorból videó, lista vagy elutasítás. A videó URL-je kanonikus. */
export function classifyInput(raw: string, yesPlaylist: boolean): ClassifiedInput {
  const text = raw.trim()
  if (VIDEO_ID.test(text)) return video(text)
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    return rejected(text)
  }
  if (!isYouTubeHost(parsed.hostname)) return rejected(text)
  const list = parsed.searchParams.get('list')
  const watch = parsed.searchParams.get('v')
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  const bare = host === 'youtu.be' ? parsed.pathname.split('/').filter((part) => part !== '')[0] : undefined
  const id =
    (watch !== null && VIDEO_ID.test(watch) ? watch : null) ??
    (bare !== undefined && VIDEO_ID.test(bare) ? bare : null) ??
    pathId(parsed.pathname, 'shorts') ??
    pathId(parsed.pathname, 'embed') ??
    pathId(parsed.pathname, 'live') ??
    pathId(parsed.pathname, 'v')
  const playlist = list !== null && LIST_ID.test(list)
  const playlistPath = parsed.pathname === '/playlist' || parsed.pathname.endsWith('/playlist')
  if (playlist && (yesPlaylist || id === null || playlistPath)) {
    return { kind: 'playlist', id: list, url: text }
  }
  if (id !== null) return video(id)
  return rejected(text)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/fetch/classify.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/fetch/classify.ts src/fetch/classify.test.ts
git commit -m "feat(fetch): classify YouTube addresses"
```

---

### Task 2: Subtitle argumentumok

**Files:**
- Create: `src/fetch/subtitle/args.ts`
- Test: `src/fetch/subtitle/args.test.ts`

**Interfaces:**
- Consumes: semmit
- Produces:
  - `export interface SubtitleArgs { inputs: string[]; listPath?: string; out?: string; subLang?: string[]; subFormat: string[]; overwrite: boolean; flat: boolean; playlistItems?: string; yesPlaylist: boolean; config?: string }`
  - `export type ParseResult = { ok: true; args: SubtitleArgs } | { ok: false; error: string }`
  - `export function parseSubtitleArgs(argv: readonly string[]): ParseResult`
  - `inputs` a nyers sorok, még osztályozás nélkül. A `parseSubtitleArgs` a `subtitle` mód utáni argumentumokat dolgozza fel. `subLang === undefined` azt jelenti, hogy a config dönt. `subFormat` mindig legalább egy elem, alapból `['vtt', 'srt']`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { parseSubtitleArgs } from './args.js'

describe('parseSubtitleArgs', () => {
  it('egy cím és célmappa, a formátum alapból vtt,srt', () => {
    const parsed = parseSubtitleArgs(['https://youtu.be/abcdefghijk', '--out', '/tmp/felirat'])
    expect(parsed).toEqual({
      ok: true,
      args: {
        inputs: ['https://youtu.be/abcdefghijk'],
        out: '/tmp/felirat',
        subLang: undefined,
        subFormat: ['vtt', 'srt'],
        listPath: undefined,
        overwrite: false,
        flat: false,
        playlistItems: undefined,
        yesPlaylist: false,
        config: undefined,
      },
    })
  })

  it('a nyelv kisbetűsödik, a lista útvonal megmarad', () => {
    const parsed = parseSubtitleArgs(['--sub-lang', 'HU,en-US', '--list', 'lista.txt'])
    expect(parsed.ok && parsed.args.inputs).toEqual([])
    expect(parsed.ok && parsed.args.listPath).toBe('lista.txt')
    expect(parsed.ok && parsed.args.subLang).toEqual(['hu', 'en-US'])
  })

  it('cím és --list együtt, és egyik híján is, hiba', () => {
    expect(parseSubtitleArgs(['https://youtu.be/abcdefghijk', '--list', 'a.txt'])).toEqual({
      ok: false,
      error: 'Adj meg egy címet vagy egy --list fájlt, a kettőt együtt nem.',
    })
    expect(parseSubtitleArgs(['--out', '/tmp/felirat'])).toEqual({
      ok: false,
      error: 'Adj meg egy címet vagy egy --list fájlt.',
    })
    expect(parseSubtitleArgs(['elso', 'masodik'])).toEqual({
      ok: false,
      error: 'Egy cím adható meg.',
    })
  })

  it('a relatív --out, a hibás nyelv és a dupla formátum hiba', () => {
    expect(parseSubtitleArgs(['abcdefghijk', '--out', 'relatív'])).toEqual({
      ok: false,
      error: 'A --out abszolút útvonal kell legyen.',
    })
    expect(parseSubtitleArgs(['abcdefghijk', '--sub-lang', 'all'])).toEqual({
      ok: false,
      error: 'A --sub-lang eleme nyelvkód, például hu vagy en-US.',
    })
    expect(parseSubtitleArgs(['abcdefghijk', '--sub-format', 'vtt,vtt'])).toEqual({
      ok: false,
      error: 'A --sub-format egy formátumot csak egyszer tartalmazhat.',
    })
    expect(parseSubtitleArgs(['abcdefghijk', '--sub-format', 'srt,best'])).toEqual({
      ok: false,
      error: 'A --sub-format csak vtt és srt lehet.',
    })
  })

  it('a --force ismeretlen kapcsoló', () => {
    expect(parseSubtitleArgs(['abcdefghijk', '--force'])).toEqual({
      ok: false,
      error: 'Ismeretlen kapcsoló: --force',
    })
  })

  it('a --sub-format sorrendje megmarad', () => {
    const parsed = parseSubtitleArgs(['abcdefghijk', '--sub-format', 'srt,vtt'])
    expect(parsed.ok && parsed.args.subFormat).toEqual(['srt', 'vtt'])
  })
})
```

A `--list` ág `inputs` tömbje üres: a fájl tartalmát a parancs olvassa. A `listPath` a fájl útja.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/fetch/subtitle/args.test.ts`
Expected: FAIL, a modul nem létezik.

- [ ] **Step 3: Write minimal implementation**

```ts
import { isAbsolute } from 'node:path'
import { parseArgs } from 'node:util'

const LANG = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/

export interface SubtitleArgs {
  inputs: string[]
  listPath?: string
  out?: string
  subLang?: string[]
  subFormat: string[]
  overwrite: boolean
  flat: boolean
  playlistItems?: string
  yesPlaylist: boolean
  config?: string
}

export type ParseResult = { ok: true; args: SubtitleArgs } | { ok: false; error: string }

function fail(error: string): ParseResult {
  return { ok: false, error }
}

function normalizeLang(raw: string): string | null {
  const [head, ...rest] = raw.trim().split('-')
  if (head === undefined || head === '') return null
  const tag = rest.length === 0 ? head.toLowerCase() : `${head.toLowerCase()}-${rest.join('-')}`
  return LANG.test(tag) ? tag : null
}

function languages(raw: string | undefined): string[] | undefined | ParseResult {
  if (raw === undefined) return undefined
  const items = raw.split(',').map((item) => item.trim()).filter((item) => item !== '')
  if (items.length === 0) return fail('A --sub-lang eleme nyelvkód, például hu vagy en-US.')
  const tags: string[] = []
  for (const item of items) {
    const tag = normalizeLang(item)
    if (tag === null) return fail('A --sub-lang eleme nyelvkód, például hu vagy en-US.')
    tags.push(tag)
  }
  return tags
}

function formats(raw: string | undefined): string[] | ParseResult {
  if (raw === undefined) return ['vtt', 'srt']
  const items = raw.split(',').map((item) => item.trim()).filter((item) => item !== '')
  if (items.length === 0 || items.some((item) => item !== 'vtt' && item !== 'srt')) {
    return fail('A --sub-format csak vtt és srt lehet.')
  }
  if (new Set(items).size !== items.length) return fail('A --sub-format egy formátumot csak egyszer tartalmazhat.')
  return items
}

/** A subtitle modalitás saját kapcsolóelemzője. */
export function parseSubtitleArgs(argv: readonly string[]): ParseResult {
  let values: {
    out?: string
    list?: string
    'sub-lang'?: string
    'sub-format'?: string
    overwrite: boolean
    flat: boolean
    'playlist-items'?: string
    'yes-playlist': boolean
    config?: string
  }
  let positionals: string[]
  try {
    const parsed = parseArgs({
      args: [...argv],
      options: {
        out: { type: 'string' },
        list: { type: 'string' },
        'sub-lang': { type: 'string' },
        'sub-format': { type: 'string' },
        overwrite: { type: 'boolean', default: false },
        flat: { type: 'boolean', default: false },
        'playlist-items': { type: 'string' },
        'yes-playlist': { type: 'boolean', default: false },
        config: { type: 'string' },
      },
      allowPositionals: true,
      strict: true,
    })
    values = parsed.values
    positionals = parsed.positionals
  } catch (error) {
    const unknown = /Unknown option '(--[^']+)'/.exec((error as Error).message)
    if (unknown?.[1] !== undefined) return fail(`Ismeretlen kapcsoló: ${unknown[1]}`)
    return fail((error as Error).message)
  }

  if (positionals.length > 1) return fail('Egy cím adható meg.')
  const url = positionals[0]
  if (url !== undefined && values.list !== undefined) {
    return fail('Adj meg egy címet vagy egy --list fájlt, a kettőt együtt nem.')
  }
  if (url === undefined && values.list === undefined) {
    return fail('Adj meg egy címet vagy egy --list fájlt.')
  }
  if (values.out !== undefined && !isAbsolute(values.out)) return fail('A --out abszolút útvonal kell legyen.')
  if (values['playlist-items'] === '') return fail('A --playlist-items értéke nem lehet üres.')
  const subLang = languages(values['sub-lang'])
  if (subLang !== undefined && !Array.isArray(subLang)) return subLang
  const subFormat = formats(values['sub-format'])
  if (!Array.isArray(subFormat)) return subFormat
  return {
    ok: true,
    args: {
      inputs: url === undefined ? [] : [url],
      listPath: values.list,
      out: values.out,
      subLang,
      subFormat,
      overwrite: values.overwrite,
      flat: values.flat,
      playlistItems: values['playlist-items'],
      yesPlaylist: values['yes-playlist'],
      config: values.config,
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/fetch/subtitle/args.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/fetch/subtitle/args.ts src/fetch/subtitle/args.test.ts
git commit -m "feat(fetch): parse subtitle arguments"
```

---

### Task 3: Célmappa és átugrás

**Files:**
- Create: `src/fetch/subtitle/skip.ts`
- Test: `src/fetch/subtitle/skip.test.ts`

**Interfaces:**
- Consumes: `sanitizeSegment(name: string): string` a `src/vault/sanitize.ts`-ből
- Produces:
  - `export function videoDir(out: string, channel: string, flat: boolean): string`
  - `export function playlistDir(out: string, title: string, playlistId: string, flat: boolean): string`
  - `export function alreadyFetched(dir: string, videoId: string, languages: readonly string[]): Promise<boolean>`
  - `export function prepareIncomplete(dir: string, videoId: string): Promise<void>`
  - `videoDir` a `join(out, sanitizeSegment(channel))`, `--flat` esetén maga az `out`. Üres csatornából `névtelen` lesz.
  - `playlistDir` a `join(out, sanitizeSegment(`${title} [${playlistId}]`))`. Üres címnél a mappa neve `[playlistId]`.
  - Az `alreadyFetched` egy szintet olvas, nem megy almappába. Kész a pár, ha van nem üres, illő nyelvű `.vtt` vagy `.srt`, és van `.info.json`, amelynek az `id` mezője a videó.
  - A nyelvi szabály: a fájl címkéje kisbetűsen a kért kóddal kezdődik. `en` illik az `en-US`-re. `en-US` nem illik az `en`-re.
  - A `prepareIncomplete` csak ennek a videónak az üres feliratát és a rossz `id` vagy olvashatatlan `.info.json` fájlját törli.

- [ ] **Step 1: Write the failing test**

```ts
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { alreadyFetched, playlistDir, prepareIncomplete, videoDir } from './skip.js'

const ID = 'abcdefghijk'

async function temp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fetch-skip-'))
}

describe('célmappa', () => {
  it('a perjel és a kettőspont egy útvonalszegmens marad', () => {
    expect(playlistDir('/out', 'A/B: C', 'PLxxx', false)).toBe('/out/A⧸B： C [PLxxx]')
  })

  it('üres lista címnél a mappa a listaazonosító', () => {
    expect(playlistDir('/out', '', 'PLxxx', false)).toBe('/out/[PLxxx]')
    expect(playlistDir('/out', 'Cím', 'PLxxx', true)).toBe('/out')
    expect(videoDir('/out', '', false)).toBe('/out/névtelen')
  })
})

describe('alreadyFetched', () => {
  it('a Talk [live] [id].hu.vtt a valódi azonosítót látja', async () => {
    const dir = await temp()
    await writeFile(join(dir, `Talk [live] [${ID}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(dir, `Talk [live] [${ID}].info.json`), JSON.stringify({ id: ID }))
    expect(await alreadyFetched(dir, ID, ['hu'])).toBe(true)
  })

  it('az en kérés az en-US fájlra igen, az en-US kérés a puszta en fájlra nem', async () => {
    const dir = await temp()
    await writeFile(join(dir, `Cím [${ID}].en-US.vtt`), 'WEBVTT\n')
    await writeFile(join(dir, `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
    expect(await alreadyFetched(dir, ID, ['en'])).toBe(true)
    expect(await alreadyFetched(dir, ID, ['en-US'])).toBe(true)
    await writeFile(join(dir, `Masik [${ID}].en.vtt`), 'WEBVTT\n')
    const onlyEn = await temp()
    await writeFile(join(onlyEn, `Cím [${ID}].en.vtt`), 'WEBVTT\n')
    await writeFile(join(onlyEn, `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
    expect(await alreadyFetched(onlyEn, ID, ['en-US'])).toBe(false)
  })

  it('üres felirat, rossz id és hiányzó pár nem kész', async () => {
    const dir = await temp()
    await writeFile(join(dir, `Cím [${ID}].hu.vtt`), '')
    await writeFile(join(dir, `Cím [${ID}].info.json`), '{rossz')
    expect(await alreadyFetched(dir, ID, ['hu'])).toBe(false)
  })

  it('a szomszéd mappa másolata nem számít', async () => {
    const root = await temp()
    const here = join(root, 'itt')
    const there = join(root, 'ott')
    await mkdir(there, { recursive: true })
    await mkdir(here)
    await writeFile(join(there, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(there, `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
    expect(await alreadyFetched(here, ID, ['hu'])).toBe(false)
  })
})

describe('prepareIncomplete', () => {
  it('a rossz info.json-t törli, a jó feliratot és a másik videót megtartja', async () => {
    const dir = await temp()
    const other = 'zzzzzzzzzzz'
    await writeFile(join(dir, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(dir, `Cím [${ID}].info.json`), '{rossz')
    await writeFile(join(dir, `Masik [${other}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(dir, `Ures [${ID}].en.srt`), '')
    await prepareIncomplete(dir, ID)
    expect(await readFile(join(dir, `Cím [${ID}].hu.vtt`), 'utf8')).toBe('WEBVTT\n')
    expect(await readFile(join(dir, `Masik [${other}].hu.vtt`), 'utf8')).toBe('WEBVTT\n')
    await expect(readFile(join(dir, `Cím [${ID}].info.json`), 'utf8')).rejects.toThrow()
    await expect(readFile(join(dir, `Ures [${ID}].en.srt`), 'utf8')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/fetch/subtitle/skip.test.ts`
Expected: FAIL, a modul nem létezik.

- [ ] **Step 3: Write minimal implementation**

```ts
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { sanitizeSegment } from '../../vault/sanitize.js'

const VIDEO_ID = '([A-Za-z0-9_-]{11})'
const SUB = new RegExp(`^(.*) \\[${VIDEO_ID}\\]\\.([a-z]{2,3}(?:-[A-Za-z]{2,4})?)\\.(vtt|srt)$`, 'i')
const INFO = new RegExp(`^(.*) \\[${VIDEO_ID}\\]\\.info\\.json$`, 'i')

export function videoDir(out: string, channel: string, flat: boolean): string {
  return flat ? out : join(out, sanitizeSegment(channel))
}

export function playlistDir(out: string, title: string, playlistId: string, flat: boolean): string {
  return flat ? out : join(out, sanitizeSegment(`${title} [${playlistId}]`))
}

function languageMatches(tag: string, languages: readonly string[]): boolean {
  const lower = tag.toLowerCase()
  return languages.some((wanted) => lower.startsWith(wanted.toLowerCase()))
}

async function jsonId(path: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as { id?: unknown }
    return typeof raw.id === 'string' ? raw.id : null
  } catch {
    return null
  }
}

/** A célmappa egy szintje. A hiányzó mappa nem kész. */
export async function alreadyFetched(
  dir: string,
  videoId: string,
  languages: readonly string[],
): Promise<boolean> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return false
  }
  let subtitle = false
  let info = false
  for (const name of names) {
    const sub = SUB.exec(name)
    if (sub?.[2] === videoId && sub[3] !== undefined && languageMatches(sub[3], languages)) {
      const file = await stat(join(dir, name))
      if (file.size > 0) subtitle = true
    }
    const meta = INFO.exec(name)
    if (meta?.[2] === videoId && (await jsonId(join(dir, name))) === videoId) info = true
  }
  return subtitle && info
}

/** Üres felirat és idegen vagy törött info.json. Más videó fájlja marad. */
export async function prepareIncomplete(dir: string, videoId: string): Promise<void> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  for (const name of names) {
    const path = join(dir, name)
    const sub = SUB.exec(name)
    if (sub?.[2] === videoId && (await stat(path)).size === 0) await rm(path)
    const meta = INFO.exec(name)
    if (meta?.[2] === videoId && (await jsonId(path)) !== videoId) await rm(path)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/fetch/subtitle/skip.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/fetch/subtitle/skip.ts src/fetch/subtitle/skip.test.ts
git commit -m "feat(fetch): skip a complete subtitle pair"
```

---

### Task 4: Subtitle yt-dlp argumentumai

**Files:**
- Create: `src/fetch/subtitle/ytdlp.ts`
- Test: `src/fetch/subtitle/ytdlp.test.ts`

**Interfaces:**
- Consumes: semmit
- Produces:
  - `export interface ProcessResult { code: number; stdout: string; stderr: string }`
  - `export type ProcessRunner = (args: readonly string[]) => Promise<ProcessResult>`
  - `export const YTDLP_MISSING = 'A yt-dlp nem található a PATH-on. Telepítés: brew install yt-dlp vagy mise use yt-dlp'`
  - `export function versionArgs(): string[]` → `['--version']`
  - `export function videoProbeArgs(url: string): string[]`
  - `export function playlistProbeArgs(url: string, playlistItems?: string): string[]`
  - `export function downloadArgs(input: { url: string; dest: string; languages: readonly string[]; formats: readonly string[]; overwrite: boolean }): string[]`
  - `export interface VideoProbe { id: string; title?: string; channel?: string }`
  - `export function parseVideoProbe(stdout: string): VideoProbe | null`
  - `export interface PlaylistEntry { id?: string; title?: string }`
  - `export interface PlaylistProbe { id: string; title?: string; entries: PlaylistEntry[] }`
  - `export function parsePlaylistProbe(stdout: string): PlaylistProbe | null`
  - `export function createYtdlpRunner(): ProcessRunner`
  - A probe és a letöltés argumentumlistája a bináris neve nélkül indul. A `parseVideoProbe` csak 11 karakteres `id`-t fogad el. A csatorna a `channel`, annak híján az `uploader`. A `parsePlaylistProbe` `id` nélkül `null`. Az azonosító nélküli listaelem bent marad, `id` nélkül.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import {
  downloadArgs,
  parsePlaylistProbe,
  parseVideoProbe,
  playlistProbeArgs,
  videoProbeArgs,
  YTDLP_MISSING,
} from './ytdlp.js'

describe('yt-dlp argumentumok', () => {
  it('a letöltés a spec kapcsolóival megy, best és convert-subs nélkül', () => {
    const args = downloadArgs({
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      dest: '/out/Csatorna',
      languages: ['hu', 'en'],
      formats: ['srt', 'vtt'],
      overwrite: false,
    })
    expect(args).toEqual([
      '--skip-download',
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs',
      'hu,en',
      '--sub-format',
      'srt/vtt',
      '--write-info-json',
      '--no-playlist',
      '--no-progress',
      '--no-overwrites',
      '--paths',
      'home:/out/Csatorna',
      '-o',
      '%(title)s [%(id)s].%(ext)s',
      '--',
      'https://www.youtube.com/watch?v=abcdefghijk',
    ])
    expect(args).not.toContain('best')
    expect(args).not.toContain('--convert-subs')
  })

  it('az --overwrite --force-overwrites', () => {
    const args = downloadArgs({
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      dest: '/out',
      languages: ['hu'],
      formats: ['vtt'],
      overwrite: true,
    })
    expect(args).toContain('--force-overwrites')
    expect(args).not.toContain('--no-overwrites')
  })

  it('a lista -I kapcsolót kap, a videó-probe --no-playlist', () => {
    expect(playlistProbeArgs('https://www.youtube.com/playlist?list=PLxxx', '1:10')).toEqual([
      '-J',
      '--flat-playlist',
      '--skip-download',
      '--no-progress',
      '-I',
      '1:10',
      '--',
      'https://www.youtube.com/playlist?list=PLxxx',
    ])
    expect(videoProbeArgs('https://www.youtube.com/watch?v=abcdefghijk')).toContain('--no-playlist')
  })

  it('a probe a channelt, annak híján az uploadert olvassa', () => {
    expect(parseVideoProbe('{"id":"abcdefghijk","uploader":"Feltöltő","title":"Cím"}')).toEqual({
      id: 'abcdefghijk',
      title: 'Cím',
      channel: 'Feltöltő',
    })
    expect(parseVideoProbe('{"id":"rovid"}')).toBeNull()
    expect(parsePlaylistProbe('{"id":"PLxxx","title":"Kurzus","entries":[{"title":"nincs id"}]}')).toEqual({
      id: 'PLxxx',
      title: 'Kurzus',
      entries: [{ title: 'nincs id' }],
    })
    expect(parsePlaylistProbe('{"title":"nincs id"}')).toBeNull()
  })

  it('a hiányzó bináris mondata rögzített', () => {
    expect(YTDLP_MISSING).toBe(
      'A yt-dlp nem található a PATH-on. Telepítés: brew install yt-dlp vagy mise use yt-dlp',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/fetch/subtitle/ytdlp.test.ts`
Expected: FAIL, a modul nem létezik.

- [ ] **Step 3: Write minimal implementation**

```ts
import { spawn } from 'node:child_process'

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

export interface ProcessResult {
  code: number
  stdout: string
  stderr: string
}

export type ProcessRunner = (args: readonly string[]) => Promise<ProcessResult>

export const YTDLP_MISSING =
  'A yt-dlp nem található a PATH-on. Telepítés: brew install yt-dlp vagy mise use yt-dlp'

export function versionArgs(): string[] {
  return ['--version']
}

export function videoProbeArgs(url: string): string[] {
  return ['-J', '--no-playlist', '--skip-download', '--no-progress', '--', url]
}

export function playlistProbeArgs(url: string, playlistItems?: string): string[] {
  return [
    '-J',
    '--flat-playlist',
    '--skip-download',
    '--no-progress',
    ...(playlistItems === undefined ? [] : ['-I', playlistItems]),
    '--',
    url,
  ]
}

export function downloadArgs(input: {
  url: string
  dest: string
  languages: readonly string[]
  formats: readonly string[]
  overwrite: boolean
}): string[] {
  return [
    '--skip-download',
    '--write-subs',
    '--write-auto-subs',
    '--sub-langs',
    input.languages.join(','),
    '--sub-format',
    input.formats.join('/'),
    '--write-info-json',
    '--no-playlist',
    '--no-progress',
    input.overwrite ? '--force-overwrites' : '--no-overwrites',
    '--paths',
    `home:${input.dest}`,
    '-o',
    '%(title)s [%(id)s].%(ext)s',
    '--',
    input.url,
  ]
}

export interface VideoProbe {
  id: string
  title?: string
  channel?: string
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

export function parseVideoProbe(stdout: string): VideoProbe | null {
  try {
    const raw = JSON.parse(stdout) as { id?: unknown; title?: unknown; channel?: unknown; uploader?: unknown }
    if (typeof raw.id !== 'string' || !VIDEO_ID.test(raw.id)) return null
    return { id: raw.id, title: text(raw.title), channel: text(raw.channel) ?? text(raw.uploader) }
  } catch {
    return null
  }
}

export interface PlaylistEntry {
  id?: string
  title?: string
}

export interface PlaylistProbe {
  id: string
  title?: string
  entries: PlaylistEntry[]
}

export function parsePlaylistProbe(stdout: string): PlaylistProbe | null {
  try {
    const raw = JSON.parse(stdout) as { id?: unknown; title?: unknown; entries?: unknown }
    if (typeof raw.id !== 'string' || raw.id === '') return null
    const entries = Array.isArray(raw.entries) ? raw.entries : []
    return {
      id: raw.id,
      title: text(raw.title),
      entries: entries.map((entry) => {
        const row = entry as { id?: unknown; title?: unknown }
        return {
          id: typeof row.id === 'string' && VIDEO_ID.test(row.id) ? row.id : undefined,
          title: text(row.title),
        }
      }),
    }
  } catch {
    return null
  }
}

/** A yt-dlp folyamat. Az ENOENT a Promise elutasítása, `code: 'ENOENT'` mezővel. */
export function createYtdlpRunner(): ProcessRunner {
  return (args) =>
    new Promise((resolve, reject) => {
      const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })
      child.on('error', reject)
      child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/fetch/subtitle/ytdlp.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/fetch/subtitle/ytdlp.ts src/fetch/subtitle/ytdlp.test.ts
git commit -m "feat(fetch): build subtitle yt-dlp argument lists"
```

---

### Task 5: Subtitle parancsvezérlés (egy videó)

**Files:**
- Create: `src/fetch/command.ts`
- Test: `src/fetch/command.test.ts`

**Interfaces:**
- Consumes:
  - `classifyInput` a `src/fetch/classify.js`-ből
  - `parseSubtitleArgs` a `src/fetch/subtitle/args.js`-ből
  - `videoDir`, `alreadyFetched`, `prepareIncomplete` a `src/fetch/subtitle/skip.js`-ből
  - `createYtdlpRunner`, `versionArgs`, `videoProbeArgs`, `downloadArgs`, `parseVideoProbe`, `YTDLP_MISSING` a `src/fetch/subtitle/ytdlp.js`-ből
  - `installSigint` a `src/run/finish.ts`-ből
  - `loadCliConfig` a `src/config.ts`-ből
- Produces:
  - `export interface FetchRuntime { runner?: ProcessRunner; stdout?: (line: string) => void; stderr?: (line: string) => void; signals?: { on(event: string, listener: () => void): unknown; off?(event: string, listener: () => void): unknown } }`
  - `export function listEntries(text: string): string[]`
  - `export async function commandFetch(argv: readonly string[], runtime?: FetchRuntime): Promise<number>`
  - Mód ellenőrzése: `--help`/`-h` esetén USAGE és return 0. Ha hiányzik vagy kapcsoló: stderr `Hiányzó fetch-mód. Ismert: subtitle`, return 1. Ha nem `subtitle`: stderr `Ismeretlen fetch-mód: <mód>. Ismert: subtitle`, return 1.
  - Sorok, szó szerint: `[OK]   <cím> [<id>]`, `[SKIP] <cím> [<id>]`, `[SKIP] Nincs felirat: <cím> [<id>]`, `[FAIL] <url>: <ok>`. Az `[OK]` után három szóköz van.
  - Összesítés: `Kész: N letöltve, N átugorva, N felirat nélkül, N hibás.`
  - Ebben a feladatban a bemenet egy videócím. A lista osztályú cím és a `--list` az itt visszaadott `[FAIL]` nélkül, a 6. feladatban kap ágat; addig a `commandFetch` lista címre és `listPath`-ra a `A lista a következő feladat.` hibát adja stderrre, kilépés 1, futtató hívás nélkül. Így a köztes commit nem tölt le véletlenül egy teljes listát egy videó-útvonalon.

- [ ] **Step 1: Write the failing test**

```ts
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { commandFetch } from './command.js'
import type { ProcessResult, ProcessRunner } from './subtitle/ytdlp.js'

const ID = 'abcdefghijk'
const URL = `https://www.youtube.com/watch?v=${ID}`

function io() {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
  }
}

function runnerOf(handler: (args: readonly string[], calls: string[][]) => Promise<ProcessResult>): {
  calls: string[][]
  runner: ProcessRunner
} {
  const calls: string[][] = []
  return { calls, runner: (args) => handler(args, calls) }
}

describe('commandFetch mód ellenőrzése', () => {
  it('hiányzó mód esetén indulási hiba', async () => {
    const streams = io()
    const code = await commandFetch(['--out', '/tmp/felirat'], streams)
    expect(code).toBe(1)
    expect(streams.err[0]).toBe('Hiányzó fetch-mód. Ismert: subtitle')
  })

  it('ismeretlen mód esetén indulási hiba', async () => {
    const streams = io()
    const code = await commandFetch(['audio', URL], streams)
    expect(code).toBe(1)
    expect(streams.err[0]).toBe('Ismeretlen fetch-mód: audio. Ismert: subtitle')
  })

  it('--help mód nélkül is kiírja a súgót és 0-val tér vissza', async () => {
    const streams = io()
    const code = await commandFetch(['--help'], streams)
    expect(code).toBe(0)
    expect(streams.out.join('\n')).toContain('refinery fetch subtitle')
  })
})

describe('commandFetch egy videóra', () => {
  it('a probe után letölt, és [OK] sort ír', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-cmd-'))
    const { calls, runner } = runnerOf(async (args, seen) => {
      seen.push([...args])
      if (args[0] === '--version') return { code: 0, stdout: 'yt-dlp\n', stderr: '' }
      if (args.includes('--no-playlist') && args.includes('-J')) {
        return { code: 0, stdout: JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna' }), stderr: '' }
      }
      const dest = args[args.indexOf('--paths') + 1]?.replace(/^home:/, '') ?? ''
      await mkdir(dest, { recursive: true })
      await writeFile(join(dest, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
      await writeFile(join(dest, `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
      return { code: 0, stdout: '', stderr: '' }
    })
    const streams = io()
    const code = await commandFetch(['subtitle', URL, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })
    expect(code).toBe(0)
    expect(streams.out[0]).toBe(`[OK]   Cím [${ID}]`)
    expect(streams.out.at(-1)).toBe('Kész: 1 letöltve, 0 átugorva, 0 felirat nélkül, 0 hibás.')
    expect(calls.some((args) => args.includes('--write-subs'))).toBe(true)
    expect(calls.some((args) => args.includes('--no-overwrites'))).toBe(true)
  })

  it('kész párnál a letöltő hívás kimarad', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-cmd-'))
    const dest = join(out, 'Csatorna')
    await mkdir(dest)
    await writeFile(join(dest, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(dest, `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
    const { calls, runner } = runnerOf(async (args, seen) => {
      seen.push([...args])
      if (args.includes('--write-subs')) return { code: 1, stdout: '', stderr: 'nem szabadott letölteni' }
      if (args[0] === '--version') return { code: 0, stdout: 'yt-dlp\n', stderr: '' }
      return { code: 0, stdout: JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna' }), stderr: '' }
    })
    const streams = io()
    const code = await commandFetch(['subtitle', URL, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })
    expect(code).toBe(0)
    expect(streams.out[0]).toBe(`[SKIP] Cím [${ID}]`)
    expect(calls.some((args) => args.includes('--write-subs'))).toBe(false)
  })

  it('a sérült info.json törlődik, a jó felirat megmarad, a hívás --no-overwrites', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-cmd-'))
    const dest = join(out, 'Csatorna')
    await mkdir(dest)
    await writeFile(join(dest, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(dest, `Cím [${ID}].info.json`), '{rossz')
    const { calls, runner } = runnerOf(async (args, seen) => {
      seen.push([...args])
      if (args[0] === '--version') return { code: 0, stdout: 'yt-dlp\n', stderr: '' }
      if (args.includes('-J')) {
        return { code: 0, stdout: JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna' }), stderr: '' }
      }
      const home = args[args.indexOf('--paths') + 1]?.replace(/^home:/, '') ?? ''
      expect(await readFile(join(home, `Cím [${ID}].hu.vtt`), 'utf8')).toBe('WEBVTT\n')
      await expect(readFile(join(home, `Cím [${ID}].info.json`), 'utf8')).rejects.toThrow()
      await writeFile(join(home, `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
      return { code: 0, stdout: '', stderr: '' }
    })
    const streams = io()
    expect(await commandFetch(['subtitle', URL, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })).toBe(0)
    expect(calls.some((args) => args.includes('--no-overwrites'))).toBe(true)
    expect(streams.out[0]).toBe(`[OK]   Cím [${ID}]`)
  })

  it('felirat nélkül 1-es kód, a köteg számlálója külön van', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-cmd-'))
    const { runner } = runnerOf(async (args) => {
      if (args[0] === '--version') return { code: 0, stdout: 'yt-dlp\n', stderr: '' }
      if (args.includes('-J')) return { code: 0, stdout: JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna' }), stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    })
    const streams = io()
    const code = await commandFetch(['subtitle', URL, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })
    expect(code).toBe(1)
    expect(streams.out[0]).toBe(`[SKIP] Nincs felirat: Cím [${ID}]`)
    expect(streams.out.at(-1)).toBe('Kész: 0 letöltve, 0 átugorva, 1 felirat nélkül, 0 hibás.')
  })

  it('a yt-dlp hibája [FAIL], és nem állítja meg a folyamatot egy videónál 1-es kóddal', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-cmd-'))
    const { runner } = runnerOf(async (args) => {
      if (args[0] === '--version') return { code: 0, stdout: 'yt-dlp\n', stderr: '' }
      return { code: 1, stdout: '', stderr: 'Private video\nWARNING: extra\n' }
    })
    const streams = io()
    expect(await commandFetch(['subtitle', URL, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })).toBe(1)
    expect(streams.out[0]).toBe(`[FAIL] ${URL}: Private video`)
  })

  it('ENOENT induláskor a telepítési mondat, további hívás nélkül', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-cmd-'))
    let calls = 0
    const runner: ProcessRunner = () => {
      calls += 1
      return Promise.reject(Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' }))
    }
    const streams = io()
    expect(await commandFetch(['subtitle', URL, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })).toBe(1)
    expect(streams.err[0]).toContain('brew install yt-dlp')
    expect(streams.err[0]).toContain('mise use yt-dlp')
    expect(calls).toBe(1)
    expect(streams.out).toEqual([])
  })

  it('a --version nem nulla kilépése indulási hiba', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-cmd-'))
    const runner: ProcessRunner = async () => ({ code: 1, stdout: '', stderr: 'dyld: hiányzik\n' })
    const streams = io()
    expect(await commandFetch(['subtitle', URL, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })).toBe(1)
    expect(streams.err[0]).toBe('dyld: hiányzik')
  })

  it('az idegen cím [FAIL] és 1-es kód, probe nélkül', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-cmd-'))
    let calls = 0
    const runner: ProcessRunner = () => {
      calls += 1
      return Promise.resolve({ code: 0, stdout: 'yt-dlp\n', stderr: '' })
    }
    const streams = io()
    expect(await commandFetch(['subtitle', 'https://vimeo.com/1', '--out', out, '--sub-lang', 'hu'], { ...streams, runner })).toBe(1)
    expect(streams.out[0]).toBe('[FAIL] https://vimeo.com/1: nem YouTube-cím')
    expect(calls).toBe(1)
  })

  it('a --flat a csatornamappa nélkül, az --overwrite --force-overwrites-szal tölt', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-cmd-'))
    await mkdir(join(out, 'Csatorna'), { recursive: true })
    await writeFile(join(out, 'Csatorna', `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(out, 'Csatorna', `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
    const { calls, runner } = runnerOf(async (args, seen) => {
      seen.push([...args])
      if (args[0] === '--version') return { code: 0, stdout: 'yt-dlp\n', stderr: '' }
      if (args.includes('-J')) return { code: 0, stdout: JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna' }), stderr: '' }
      const dest = args[args.indexOf('--paths') + 1]?.replace(/^home:/, '') ?? ''
      expect(dest).toBe(out)
      await writeFile(join(dest, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
      await writeFile(join(dest, `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
      return { code: 0, stdout: '', stderr: '' }
    })
    const streams = io()
    expect(
      await commandFetch(['subtitle', URL, '--out', out, '--sub-lang', 'hu', '--flat', '--overwrite'], { ...streams, runner }),
    ).toBe(0)
    expect(calls.some((args) => args.includes('--force-overwrites'))).toBe(true)
  })

  it('üres languages mellett a config forrásmappája és a hu,en a cél', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fetch-cfg-'))
    const source = join(root, 'forras')
    await mkdir(source)
    const config = join(root, 'refinery.config.yaml')
    await writeFile(
      config,
      `vault:\n  path: /tmp/nem-letezo-vault\nsources:\n  - ${source}\nlanguages: []\n`,
    )
    const { calls, runner } = runnerOf(async (args, seen) => {
      seen.push([...args])
      if (args[0] === '--version') return { code: 0, stdout: 'yt-dlp\n', stderr: '' }
      if (args.includes('-J')) return { code: 0, stdout: JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna' }), stderr: '' }
      const dest = args[args.indexOf('--paths') + 1]?.replace(/^home:/, '') ?? ''
      await mkdir(dest, { recursive: true })
      await writeFile(join(dest, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
      await writeFile(join(dest, `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
      return { code: 0, stdout: '', stderr: '' }
    })
    const streams = io()
    expect(await commandFetch(['subtitle', URL, '--config', config], { ...streams, runner })).toBe(0)
    const download = calls.find((args) => args.includes('--write-subs'))
    expect(download).toContain('--sub-langs')
    expect(download?.[download.indexOf('--sub-langs') + 1]).toBe('hu,en')
    expect(download).toContain(`home:${join(source, 'Csatorna')}`)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/fetch/command.test.ts`
Expected: FAIL, a `commandFetch` nincs.

- [ ] **Step 3: Write minimal implementation**

A `command.ts` ebben a feladatban egy videót kezel. A `listEntries` már exportált, a 6. feladat használja:

```ts
export function listEntries(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
}
```

A `commandFetch` sorrendje:

1. Ha `argv.includes('--help') || argv.includes('-h')`: kiírja a súgót és `return 0`.
2. Mód vizsgálata:
   - `const mode = argv[0]`
   - Ha `!mode || mode.startsWith('-')`: stderr `Hiányzó fetch-mód. Ismert: subtitle`, `return 1`.
   - Ha `mode !== 'subtitle'`: stderr `Ismeretlen fetch-mód: ${mode}. Ismert: subtitle`, `return 1`.
3. `parseSubtitleArgs(argv.slice(1))`. Hiba esetén `stderr(error)`, vissza `1`.
4. Ha `listPath` megvan, vagy az egyetlen input `classifyInput(..., yesPlaylist).kind === 'playlist'`: `stderr('A lista a következő feladat.')`, vissza `1`. Futtatót nem hív.
5. Célmappa és nyelvek. Ha `out` és `subLang` is megvan, és `config` nincs, configot nem tölt. Különben `loadCliConfig(args.config)`. A dobott hiba üzenete stderr, vissza `1`. A cél az `args.out ?? cfg.sources[0].path`. A nyelv az `args.subLang ?? (cfg.languages.length > 0 ? cfg.languages : ['hu', 'en'])`.
6. `mkdir(out, { recursive: true })`. Ha a `stat` fájlt lát, stderr `A --out nem mappa: <út>`, vissza `1`. A `mkdir` egyéb hibája stderr, vissza `1`.
7. `installSigint`, a flag neve `stopped`. A teszt `signals` objektumát kapja, ha van.
8. `run(versionArgs())`. Az `ENOENT` (`(error as NodeJS.ErrnoException).code === 'ENOENT'`) a `YTDLP_MISSING` stderrre, vissza `1`. Nem nulla kód: stderr a `firstLine(stderr)`, üres stderrnél `A yt-dlp --version nem sikerült.`, vissza `1`.
9. `classifyInput(args.inputs[0], args.yesPlaylist)`. `rejected`: stdout `[FAIL] <raw>: nem YouTube-cím`, összesítés egy hibással, vissza `1`. A `--version` hívás már lefutott.
10. Videó: `run(videoProbeArgs(video.url))`. Nem nulla kód vagy `parseVideoProbe === null`: stdout `[FAIL] <video.url>: <első sor vagy hiányzó videóazonosító>`, összesítés, vissza `1`.
11. `dest = videoDir(out, probe.channel ?? '', args.flat)`.
12. Ha nincs `overwrite` és `await alreadyFetched(dest, probe.id, languages)`: stdout `[SKIP] <cím> [<id>]`, összesítés `1 átugorva`, vissza `0`. A cím a probe `title` első sora, trimelve, üresen az `id`.
13. Ha nincs `overwrite`: `await prepareIncomplete(dest, probe.id)`.
14. `run(downloadArgs({ url: video.url, dest, languages, formats: args.subFormat, overwrite: args.overwrite }))`.
15. Utána `alreadyFetched`. Igaz: `[OK]   <cím> [<id>]`, kód `0`. Hamis és a folyamat kódja `0`: `[SKIP] Nincs felirat: …`, kód `1`. Hamis és a kód nem `0`: `[FAIL] <video.url>: <első sor>`, kód `1`.
16. Minden eredményes ág kiírja az összesítést. A `finally` leveszi a SIGINT-kezelőt.

A `run` belső függvény elkapja az `ENOENT`-et, kiírja a `YTDLP_MISSING` mondatot, és `{ missing: true }` értéket ad. A hívó további tételt nem indít. Ha már volt eredmény, előtte kiírja az összesítést, és `1`-gyel tér vissza. Ezt a 6. feladat második tételének `ENOENT` tesztje használja, ezért a segédfüggvény már ebben a feladatban így viselkedik.

A `--out` és a `--sub-lang` együtt, `--config` nélkül nem hívja a `loadCliConfig`-ot. A worktree-ben nincs `refinery.config.yaml`; ha a parancs mégis betöltené, az egyvideós tesztek a „Nincs konfigurációs fájl” hibával állnának meg.

Az eredmény és a kilépés egy helyen dől el:

```ts
type Kind = 'downloaded' | 'skipped' | 'no-subtitle' | 'failed'

function summary(rows: readonly Kind[]): string {
  const count = (kind: Kind) => rows.filter((row) => row === kind).length
  return `Kész: ${count('downloaded')} letöltve, ${count('skipped')} átugorva, ${count('no-subtitle')} felirat nélkül, ${count('failed')} hibás.`
}

function finish(rows: readonly Kind[], stopped: boolean, stdout: (line: string) => void): number {
  if (stopped) {
    if (rows.length > 0) stdout(summary(rows))
    return 130
  }
  stdout(summary(rows))
  return rows.some((row) => row === 'failed' || row === 'no-subtitle') ? 1 : 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/fetch/command.test.ts src/fetch/classify.test.ts src/fetch/subtitle/args.test.ts src/fetch/subtitle/skip.test.ts src/fetch/subtitle/ytdlp.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/fetch/command.ts src/fetch/command.test.ts
git commit -m "feat(fetch): download one YouTube video"
```

---

### Task 6: Lista, köteg, megszakítás

**Files:**
- Modify: `src/fetch/command.ts`
- Modify: `src/fetch/command.test.ts`

**Interfaces:**
- Consumes:
  - `listEntries(text: string): string[]`
  - `classifyInput(raw: string, yesPlaylist: boolean): ClassifiedInput`
  - `playlistDir(out: string, title: string, playlistId: string, flat: boolean): string`
  - `playlistProbeArgs(url: string, playlistItems?: string): string[]`
  - `parsePlaylistProbe(stdout: string): PlaylistProbe | null`
  - `downloadArgs`, `alreadyFetched`, `prepareIncomplete`, `videoDir`
  - a 5. feladat `commandFetch` videó-ága
- Produces: ugyanaz a `commandFetch`. A lista cím és a `--list` többé nem adja a `A lista a következő feladat.` hibát.
  - Üres listafájl a szűrés után: stderr `A listafájl nem tartalmaz címet.`, kód `1`.
  - Hiányzó listafájl: stderr `Nincs listafájl: <út>.`, kód `1`.
  - Üres lista vagy szűrés után nulla elem: stdout `[FAIL] <playlist-url>: a lista üres`.
  - Lista JSON `id` nélkül, vagy probe hiba: egy `[FAIL]`, a videókra nincs letöltés. Az ok `hiányzó listaazonosító`, illetve a stderr első sora.
  - Azonosító nélküli elem: `[FAIL] <playlist-url>: hiányzó videóazonosító`, a többi elem fut.
  - A listaelem letöltési URL-je `https://www.youtube.com/watch?v=<id>`. Célmappa a `playlistDir`. Külön videó-probe nincs.
  - A `--playlist-items` csak a listaprobe `-I` értéke.

- [ ] **Step 1: Write the failing test**

Az előző tesztfájlba három `describe` kerül. A `runnerOf` és az `io` már ott van. A hívásokban a parancssor `['subtitle', ...]` formát kap.

```ts
describe('listafájl és köteg', () => {
  it('a megjegyzést és az üres sort kihagyja, az idegen cím nem állítja meg a videót', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fetch-list-'))
    const list = join(root, 'lista.txt')
    const out = join(root, 'out')
    await writeFile(list, '# megjegyzés\n\nhttps://vimeo.com/1\nabcdefghijk\n')
    const seen: string[][] = []
    const runner: ProcessRunner = async (args) => {
      seen.push([...args])
      if (args[0] === '--version') return { code: 0, stdout: 'yt-dlp\n', stderr: '' }
      if (args.includes('-J')) return { code: 0, stdout: JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna' }), stderr: '' }
      const dest = args[args.indexOf('--paths') + 1]?.replace(/^home:/, '') ?? ''
      await mkdir(dest, { recursive: true })
      await writeFile(join(dest, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
      await writeFile(join(dest, `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
      return { code: 0, stdout: '', stderr: '' }
    }
    const streams = io()
    const code = await commandFetch(['subtitle', '--list', list, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })
    expect(code).toBe(1)
    expect(streams.out[0]).toBe('[FAIL] https://vimeo.com/1: nem YouTube-cím')
    expect(streams.out[1]).toBe(`[OK]   Cím [${ID}]`)
    expect(streams.out.at(-1)).toBe('Kész: 1 letöltve, 0 átugorva, 0 felirat nélkül, 1 hibás.')
    expect(seen.filter((args) => args.includes('--write-subs'))).toHaveLength(1)
  })

  it('üres listafájl indulási hiba', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fetch-list-'))
    const list = join(root, 'ures.txt')
    await writeFile(list, '# csak megjegyzés\n\n')
    const streams = io()
    const code = await commandFetch(['subtitle', '--list', list, '--out', join(root, 'out'), '--sub-lang', 'hu'], streams)
    expect(code).toBe(1)
    expect(streams.err[0]).toBe('A listafájl nem tartalmaz címet.')
  })
})

describe('lejátszási lista', () => {
  it('két lista ugyanarra az azonosítóra két letöltést indít', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-pl-'))
    const list = join(out, 'lista.txt')
    await writeFile(
      list,
      'https://www.youtube.com/playlist?list=PLelso\nhttps://www.youtube.com/playlist?list=PLmasodik\n',
    )
    const downloads: string[] = []
    const runner: ProcessRunner = async (args) => {
      if (args[0] === '--version') return { code: 0, stdout: 'yt-dlp\n', stderr: '' }
      if (args.includes('--flat-playlist')) {
        const id = args.at(-1)?.includes('PLelso') ? 'PLelso' : 'PLmasodik'
        return {
          code: 0,
          stdout: JSON.stringify({ id, title: `Kurzus ${id}`, entries: [{ id: ID, title: 'Első' }] }),
          stderr: '',
        }
      }
      downloads.push(args[args.indexOf('--paths') + 1] ?? '')
      const dest = (args[args.indexOf('--paths') + 1] ?? '').replace(/^home:/, '')
      await mkdir(dest, { recursive: true })
      await writeFile(join(dest, `Első [${ID}].hu.vtt`), 'WEBVTT\n')
      await writeFile(join(dest, `Első [${ID}].info.json`), JSON.stringify({ id: ID }))
      return { code: 0, stdout: '', stderr: '' }
    }
    const streams = io()
    expect(await commandFetch(['subtitle', '--list', list, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })).toBe(0)
    expect(downloads).toHaveLength(2)
    expect(downloads.some((dest) => dest.includes('Kurzus PLelso [PLelso]'))).toBe(true)
    expect(downloads.some((dest) => dest.includes('Kurzus PLmasodik [PLmasodik]'))).toBe(true)
  })

  it('az azonosító nélküli elem hiba, a következő elem letöltődik', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-pl-'))
    let downloads = 0
    const runner: ProcessRunner = async (args) => {
      if (args[0] === '--version') return { code: 0, stdout: 'yt-dlp\n', stderr: '' }
      if (args.includes('--flat-playlist')) {
        return {
          code: 0,
          stdout: JSON.stringify({
            id: 'PLxxx',
            title: 'Kurzus',
            entries: [{ title: 'nincs' }, { id: ID, title: 'Van' }],
          }),
          stderr: '',
        }
      }
      downloads += 1
      const dest = args[args.indexOf('--paths') + 1]?.replace(/^home:/, '') ?? ''
      await mkdir(dest, { recursive: true })
      await writeFile(join(dest, `Van [${ID}].hu.vtt`), 'WEBVTT\n')
      await writeFile(join(dest, `Van [${ID}].info.json`), JSON.stringify({ id: ID }))
      return { code: 0, stdout: '', stderr: '' }
    }
    const streams = io()
    const url = 'https://www.youtube.com/playlist?list=PLxxx'
    expect(await commandFetch(['subtitle', url, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })).toBe(1)
    expect(streams.out[0]).toBe(`[FAIL] ${url}: hiányzó videóazonosító`)
    expect(downloads).toBe(1)
  })

  it('a második tétel ENOENT-je megáll, az első bent van az összesítésben', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fetch-miss-'))
    const list = join(root, 'lista.txt')
    const out = join(root, 'out')
    await writeFile(list, 'abcdefghijk\nzzzzzzzzzzz\n')
    let probes = 0
    const runner: ProcessRunner = async (args) => {
      if (args[0] === '--version') return { code: 0, stdout: 'yt-dlp\n', stderr: '' }
      if (args.includes('-J')) {
        probes += 1
        if (probes === 2) return Promise.reject(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))
        return { code: 0, stdout: JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna' }), stderr: '' }
      }
      const dest = args[args.indexOf('--paths') + 1]?.replace(/^home:/, '') ?? ''
      await mkdir(dest, { recursive: true })
      await writeFile(join(dest, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
      await writeFile(join(dest, `Cím [${ID}].info.json`), JSON.stringify({ id: ID }))
      return { code: 0, stdout: '', stderr: '' }
    }
    const streams = io()
    const code = await commandFetch(['subtitle', '--list', list, '--out', out, '--sub-lang', 'hu'], { ...streams, runner })
    expect(code).toBe(1)
    expect(streams.out[0]).toBe(`[OK]   Cím [${ID}]`)
    expect(streams.out.at(-1)).toBe('Kész: 1 letöltve, 0 átugorva, 0 felirat nélkül, 0 hibás.')
    expect(streams.err[0]).toContain('brew install yt-dlp')
  })
})

describe('megszakítás és védelem', () => {
  it('a félbeszakadt letöltés nem kap sort és összesítést', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fetch-stop-'))
    const handlers: Array<() => void> = []
    const runner: ProcessRunner = async (args) => {
      if (args[0] === '--version') return { code: 0, stdout: 'yt-dlp\n', stderr: '' }
      if (args.includes('-J')) return { code: 0, stdout: JSON.stringify({ id: ID, title: 'Cím', channel: 'Csatorna' }), stderr: '' }
      for (const handler of handlers) handler()
      return { code: 1, stdout: '', stderr: 'Interrupted\n' }
    }
    const streams = io()
    const code = await commandFetch(['subtitle', URL, '--out', out, '--sub-lang', 'hu'], {
      runner,
      stdout: streams.stdout,
      stderr: streams.stderr,
      signals: { on: (_event, listener) => handlers.push(listener as () => void) },
    })
    expect(code).toBe(130)
    expect(streams.out).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/fetch/command.test.ts`
Expected: FAIL. A listafájlos hívás még a `A lista a következő feladat.` ágon áll, vagy a várt `[FAIL]` / `130` hiányzik.

- [ ] **Step 3: Write minimal implementation**

A `A lista a következő feladat.` ág törlődik. A bemenetek összegyűjtése:

```ts
async function inputsFrom(args: SubtitleArgs): Promise<{ lines: string[] } | { error: string }> {
  if (args.listPath === undefined) return { lines: args.inputs }
  try {
    return { lines: listEntries(await readFile(args.listPath, 'utf8')) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { error: `Nincs listafájl: ${args.listPath}.` }
    return { error: (error as Error).message }
  }
}
```

Üres `lines`: stderr `A listafájl nem tartalmaz címet.`, vissza `1`. Ez a `--version` előtt van.

A ciklus minden sorra, a ciklus tetején `if (stopped) break`:

- `rejected` → eredmény `[FAIL] <raw>: nem YouTube-cím`, számláló `failed`.
- `video` → az 5. feladat videó-ága. Ha a futtató közben `stopped` lett, az a tétel nem kap sort, a ciklus megáll.
- `playlist` → `run(playlistProbeArgs(item.url, args.playlistItems))`. Hiba vagy `parsePlaylistProbe === null`: egy `[FAIL] <item.url>: <első sor vagy hiányzó listaazonosító>`, és `continue`. `entries.length === 0`: `[FAIL] <item.url>: a lista üres`. Különben minden elem: `id` nélkül `[FAIL] <item.url>: hiányzó videóazonosító`. Azonosítóval a cél `playlistDir(out, probe.title ?? '', probe.id, args.flat)`, a letöltés URL-je `https://www.youtube.com/watch?v=<id>`, a megjelenő cím az elem `title` vagy az `id`. Az átugrás, a `prepareIncomplete` és a letöltés utáni döntés ugyanaz, mint a videónál. Elem közben is `if (stopped) break`.

A ciklus a 5. feladat `run` segédjét használja. Ha az `ENOENT`-et ad, stderrre kerül a `YTDLP_MISSING`, az addigi eredmények összesítése kijön, a kód `1`, és a ciklus megáll. Újabb probe vagy letöltés nincs.

A ciklus után: ha `stopped`, és volt már eredmény, stdout az összesítés, vissza `130`. Ha `stopped` és nincs eredmény, összesítés nincs, vissza `130`. Különben stdout az összesítés, és ha `failed + noSubtitle > 0`, vissza `1`, egyébként `0`. A `finish` függvény a 5. feladatból ezt adja; az `ENOENT` ág előbb tér vissza, a `finish` előtt.

A `finally` továbbra is leveszi a SIGINT-kezelőt.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/fetch/command.test.ts`
Expected: PASS, a régi egyvideós tesztekkel együtt.

- [ ] **Step 5: Commit**

```bash
git add src/fetch/command.ts src/fetch/command.test.ts
git commit -m "feat(fetch): fetch playlists and url lists"
```

---

### Task 7: Valódi folyamatindító

**Files:**
- Modify: `src/fetch/subtitle/ytdlp.test.ts`

**Interfaces:**
- Consumes: `createYtdlpRunner(): ProcessRunner`, `commandFetch`, `folderSource`, `readSidecar` közvetetten a `folderSource`-on át
- Produces: nincs új export. A teszt igazolja, hogy a spawn a `PATH` első `yt-dlp` nevű programját indítja, és a leírt fájlt a felderítés olvassa.

- [ ] **Step 1: Write the failing test**

```ts
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { folderSource } from '../../source/folder.js'
import { commandFetch } from '../command.js'
import { createYtdlpRunner } from './ytdlp.js'

it('a PATH-on álló yt-dlp fájlját a folderSource látja', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fetch-bin-'))
  const bin = join(root, 'bin')
  const out = join(root, 'out')
  await mkdir(bin)
  await writeFile(
    join(bin, 'yt-dlp'),
    `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] === '--version') process.exit(0)
if (args.includes('-J')) {
  process.stdout.write(JSON.stringify({ id: 'abcdefghijk', title: 'Video', channel: 'Chan' }))
  process.exit(0)
}
const home = args[args.indexOf('--paths') + 1].replace(/^home:/, '')
const fs = await import('node:fs/promises')
await fs.mkdir(home, { recursive: true })
await fs.writeFile(home + '/Video [abcdefghijk].hu.vtt', 'WEBVTT\\n')
await fs.writeFile(home + '/Video [abcdefghijk].info.json', JSON.stringify({ id: 'abcdefghijk', title: 'Video' }))
process.exit(0)
`,
  )
  await chmod(join(bin, 'yt-dlp'), 0o755)
  const previous = process.env.PATH
  process.env.PATH = `${bin}:${previous ?? ''}`
  try {
    const code = await commandFetch(
      ['subtitle', 'abcdefghijk', '--out', out, '--sub-lang', 'hu'],
      { runner: createYtdlpRunner(), stdout: () => {}, stderr: () => {} },
    )
    expect(code).toBe(0)
    const items = await folderSource({ name: 'out', path: out }, ['hu']).discover()
    expect(items).toHaveLength(1)
    expect(items[0]?.metadata.videoId).toBe('abcdefghijk')
    expect(items[0]?.language).toBe('hu')
  } finally {
    process.env.PATH = previous
  }
})
```

A teszt a `describe` blokkon belül van, hogy a fájl `describe` importja megmaradjon. A shebang `node`, mert a worktree-ben a `node` a `PATH`-on van; a hamis program a `bin` mappában `yt-dlp` néven áll, ezért a `spawn('yt-dlp')` ezt találja meg először.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/fetch/subtitle/ytdlp.test.ts`
Expected: FAIL, amíg a teszt nincs a fájlban. A teszt beírása után, ha a runner jó, egyből PASS is lehet: akkor a Step 2 helyett jegyezd fel, hogy a futás azonnal PASS, mert a `createYtdlpRunner` a 4. feladatban elkészült. Nem kell új viselkedést kitalálni.

- [ ] **Step 3: Write minimal implementation**

Ha a teszt PASS, ez a lépés üres. Ha a `spawn` nem találja a `bin/yt-dlp` programot, a `createYtdlpRunner` a `spawn` hívásban ne adjon `env`-et, hogy a folyamat a `process.env.PATH` értékét örökölje. A `shell` opció maradjon hamis.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/fetch/subtitle/ytdlp.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/fetch/subtitle/ytdlp.test.ts src/fetch/subtitle/ytdlp.ts
git commit -m "test(fetch): spawn yt-dlp from PATH"
```

---

### Task 8: CLI, README, döntésnapló

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/cli.test.ts`
- Modify: `README.md` (az „Ami már fut” első bekezdése után)
- Modify: `docs/decisions/0008-forras-fuggetlen-bemenet.md` (a fájl végére)

**Interfaces:**
- Consumes: `commandFetch(argv: readonly string[], runtime?: FetchRuntime): Promise<number>`
- Produces: a `main` a `fetch` szót a közös `parseArgs` előtt a `commandFetch(argv.slice(1))` hívásnak adja. A `fetch --help` és a `fetch subtitle --help` továbbra is a teljes `USAGE`.

- [ ] **Step 1: Write the failing test**

A `src/cli.test.ts` importjába bekerül, hogy a `USAGE` már importálva van. Új `describe`:

```ts
describe('fetch a CLI-ben', () => {
  it('a USAGE felsorolja a fetch subtitle parancsot és a saját kapcsolóit', () => {
    expect(USAGE).toContain('fetch subtitle')
    expect(USAGE).toContain('--out <út>')
    expect(USAGE).toContain('--list <fájl>')
    expect(USAGE).toContain('--sub-lang')
    expect(USAGE).toContain('--sub-format')
    expect(USAGE).toContain('--overwrite')
    expect(USAGE).toContain('--flat')
    expect(USAGE).toContain('--playlist-items')
    expect(USAGE).toContain('--yes-playlist')
  })

  it('a fetch subtitle --out nem kéri a vaultot', async () => {
    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      errors.push(String(line))
    })
    const code = await main(['fetch', 'subtitle', '--out', '/tmp/felirat', '--sub-lang', 'hu'])
    spy.mockRestore()
    expect(code).toBe(1)
    expect(errors.join('\n')).not.toContain('vault.path')
    expect(errors.join('\n')).toContain('Adj meg egy címet vagy egy --list fájlt.')
  })

  it('a run nem fogadja a --out kapcsolót', async () => {
    await expect(main(['run', '--out', '/tmp/felirat'])).rejects.toThrow(/out/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/cli.test.ts -t "fetch a CLI-ben"`
Expected: FAIL. A `USAGE` még nem tartalmazza a `fetch subtitle` és `--yes-playlist` sort, vagy a `main` ismeretlen parancsnak veszi a `fetch`-et.

- [ ] **Step 3: Write minimal implementation**

A `src/cli.ts` tetején: `import { commandFetch } from './fetch/command.js'`.

A `main` függvényben, közvetlenül a `wantsHelp` ág után:

```ts
  if (command === 'fetch') return commandFetch(argv.slice(1))
```

A `USAGE` parancslistájába, a `watch` elé:

```text
  fetch subtitle  YouTube-feliratot és .info.json fájlt tölt egy mappába.
                  A run és a watch nem hívja.
```

A kapcsolók végére, a naplómondat elé:

```text
  A fetch subtitle saját kapcsolói, a run ezeket nem ismeri:
  --out <út>        célmappa, abszolút; hiányában a config első sources eleme
  --list <fájl>     soronkénti címek; a # sor és az üres sor kimarad
  --sub-lang <kód>  vesszős nyelvkódok; alap a config languages, vagy hu,en
  --sub-format <f>  vtt és srt, vesszővel; alap: vtt,srt
  --overwrite       meglévő felirat és .info.json újraírása
  --flat            minden fájl az --out gyökerébe
  --playlist-items  lista szűrése, a yt-dlp -I értékeként
  --yes-playlist    a watch?v=&list= cím a teljes listát jelenti
```

A README „Ami már fut” első bekezdése után:

```markdown
A `refinery fetch subtitle` YouTube-feliratot és `.info.json` metaadatot tölt egy helyi
mappába a `yt-dlp` segítségével. Ami már ott van, azt átugorja. A `run` és a
`watch` ettől még csak a helyi fájlt olvassa, hálózat nélkül.
```

A `docs/decisions/0008-forras-fuggetlen-bemenet.md` végére:

```markdown
**Kiegészítés (2026-10-01).** A `refinery fetch subtitle` a feliratot előállító
testvérparancs: `yt-dlp`-vel `.vtt`/`.srt` és `.info.json` fájlt ír egy
mappába. A csővezeték nem hívja, és a felderítés szerződése nem változik.
A transzkribálás továbbra is kívül van.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/cli.test.ts -t "fetch a CLI-ben" && pnpm test`
Expected: PASS. A teljes `pnpm test` zöld, a worktree-ben.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/cli.test.ts README.md docs/decisions/0008-forras-fuggetlen-bemenet.md
git commit -m "feat(fetch): wire the fetch subtitle command"
```

---

## Spec coverage

| Spec rész | Feladat |
|---|---|
| Parancs, modalitás (`subtitle`), kapcsolók, config nélküliség, `validateConfig` kihagyása | 2, 5, 8 |
| Célfa B, `sanitizeSegment`, fájlnév-szerződés | 3, 4, 5, 7 |
| Átugrás a célmappában, nyelvi prefix, sérült fájl | 3, 5, 6 |
| Modulok (`src/fetch/subtitle/`), `-J` probe, letöltő argumentumok | 4, 5, 6 |
| Hibák, kimenet, 0 / 1 / 130, menet közbeni ENOENT, hiányzó/ismeretlen mód | 5, 6 |
| Config `sources[0]`, üres `languages` → `hu,en`, `--flat`, `--overwrite` | 5 |
| Listafájl, playlist, `--playlist-items`, két példány | 6 |
| `folderSource` szerződés, `PATH` | 7 |
| `USAGE`, README, `0008` | 8 |
| Kívül eső Whisper, süti, ffmpeg, web, eval, későbbi módok (`audio`, `video`) | nincs feladat |
