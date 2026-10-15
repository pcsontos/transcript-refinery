# Szöveges átirat (`.txt`, `.md`) Telegramból — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Egy Telegramban csatolt `.txt`/`.md` fájlból vagy egy `/scan` után beillesztett szövegből ugyanúgy recept-gombok, futás és vault-jegyzet lesz, mint egy YouTube-linkből.

**Architecture:** A `src/source/text.ts` Node-mentes magja egy új modulba (`src/source/text-core.ts`) költözik, és a csomag `transcript-refinery/text` néven adja ki; a Worker ezzel normalizál és számolja a `t-…` azonosítót. A Worker a szöveget a kopogtatás törzsében adja át; a serve újraellenőrzi és az R2-be teszi (`videos/<t-id>/text.txt`), a recept-futás pedig az A szelet `--file` útján (`commandRun` + `adHoc.file`) megy. A D1 a cron-újrapróbáláshoz a csatolmány `file_id`-ját és nevét, illetve a `/scan` szövegét tartja; a szöveg a sor lezárásakor ürül.

**Tech Stack:** TypeScript, Node 26 (Web Crypto, `TextDecoder`), Cloudflare Worker + D1, Vitest.

**Spec:** `docs/plans/2026-10-15-szoveges-atirat-telegram-spec.md`

Az implementáció a `feat/szoveges-atirat-telegram` ágon, külön worktree-ben (`../transcript-refinery-szoveges-atirat-telegram`) indul a friss `main`-ről, miután ez a terv és a spec (a `docs/szoveges-atirat-telegram` ágon, egy docs-PR-ben) bekerült. Issue: #206 (a B szelet kiadása és az éles próba után zárható).

## Eltérések a spectől (a felhasználó jóváhagyására)

1. **`text_lang` helyett `file_name` oszlop.** A cron-újrapróbálás a `file_id`-ből újra letölti a fájlt, és ehhez tudnia kell, hogy `.md`-e (frontmatter-vágás), különben más azonosító jönne ki. A fájlnévből a nyelvkód és a `.md` jelzés is megvan, így egy oszlop kettőt helyettesít. Oszlopok: `file_id`, `file_name`, `text`.
2. **A teljes R2-pár ellenőrzése a kulcsok megléte.** A `text.txt` kulcsa a tartalom hash-e, üres objektumot a `putWithRetry` nem hagy, ezért a tartalom újraolvasása fölösleges.
3. **A vault-commit címéhez nem kell az `info.json`.** A `noteCommitMessage` (`src/vault/commit.ts:16`) már levágja a címből a `[azonosító]` utótagot, így a `Beszéd [t-…]` alapnévből is `summary | Beszéd [t-…]` lesz, mint videónál.
4. **A `splitSubtitleName` is a közös modulba kerül**, mert a Worker ezzel bontja a fájlnevet címre és nyelvkódra. A `folder.ts` továbbadja, a hívók nem változnak.
5. **A `/scan` bármely normalizálási hibája az „Írd a /scan után…” tipp.** Egy Telegram-szöveg nem lehet érvénytelen UTF-8 vagy 2 MB-nál nagyobb; az egyetlen valós hiba az üresség.
6. **Szöveges tételnél a bot a címet mutatja** a „vár”, a „már sorban” és a „kész” sorban is, és a kész sor: `<cím>. A szöveg megvan.` (videónál változatlanul `A felirat megvan.`). A spec csak a „Sorba került” sort nevezte meg.

## Global Constraints

- Kiterjesztések: szöveg `.txt`, `.md` (kis- és nagybetű mindegy); a MIME-típus nem számít.
- Fájlméret-kapu: legfeljebb 2 MB (`2 * 1024 * 1024` bájt), a Workerben a `file_size`-ból letöltés előtt, és a letöltött bájtokon is.
- Azonosító: `t-` + a normalizált szöveg SHA-256 hex kivonatának első 16 jegye; az értéke nem változhat (a meglévő állapottár és sorhorgony erre épül). Alak: `/^t-[0-9a-f]{16}$/`.
- A `/scan` figyelmeztetési küszöbe: a `message.text` hossza legalább 3900 karakter. A cím legfeljebb 80 karakter (kódpont).
- R2-kulcsok: `videos/<t-id>/text.txt`, `videos/<t-id>/info.json` (`{ id, title, language? }`).
- `SERVE_OUT`-fájlnév: `<sanitizeSegment(cím)> [t-…].<nyelv>.txt`, nyelvkód nélkül `… [t-…].txt`; mindig `.txt`.
- A Worker nem kap R2-kötést; a serve nem kap bot-tokent és D1-hozzáférést.
- Bot-üzenetek, szó szerint:
  - `Csak .txt vagy .md fájlt tudok feldolgozni.`
  - `A fájl túl nagy: <X.Y> MB, legfeljebb 2 MB.`
  - `A fájl nem UTF-8 szöveg.` / `A fájl üres.`
  - `A fájlt nem tudtam letölteni, küldd újra.`
  - `Írd a /scan után a szöveget, vagy küldd fájlként.`
  - `A szöveg elérhette a Telegram-üzenet határát, lehet, hogy csonka. Hosszabb átiratot fájlként küldj.`
  - `Sorba került: <cím>` / `Már sorban van: <cím>.` / `A gép ébredésére vár: <cím>.` / `<cím>. A szöveg megvan.`
- Serve-hiba, szó szerint: `A szöveg azonosítója nem egyezik.`
- Ellenőrzés minden task végén: `pnpm build && pnpm typecheck && pnpm exec tsc -p worker/tsconfig.json --noEmit && pnpm lint && pnpm test`. A Worker típusellenőrzése a `dist`-ből olvassa a `transcript-refinery/*` típusokat, ezért előtte `pnpm build` kell.

## Review Focus

1. **`t-` kezdetű YouTube-azonosító** (`t-abcdefghi`, 11 karakter): videó marad, nem szöveges tétel → Task 1 `isTextItemId` teszt.
2. **Csatolmány aláírásában YouTube-link:** csak a fájl indul, egy sor, egy kopogtatás → Task 5 teszt.
3. **Nagybetűs kiterjesztés** (`ÁTIRAT.TXT`): elfogadva, cím `ÁTIRAT` → Task 5 teszt.
4. **`.md` újraletöltése a cronban:** a frontmatter újra lekerül, a kopogtatás szövege és azonosítója ugyanaz → Task 5 teszt.
5. **Már elküldött, kész szöveg újra:** új sor, a serve a teljes R2-párra azonnal `ready`-t ad feltöltés nélkül, a futás „már feldolgozva” címén modell nélkül → Task 2 és Task 3 teszt.

## File Structure

| Fájl | Felelősség |
|---|---|
| `src/source/text-core.ts` (új) | Node-mentes mag: kiterjesztések, méretkapu, `splitSubtitleName`, `stripFrontmatter`, `vaultSafeLinks`, `normalizeText`, `textItemId`, `isTextItemId` |
| `src/source/text.ts` | a mag továbbadása + a fájlhoz kötött `readTextSource` |
| `src/source/folder.ts` | a `splitSubtitleName`-et a magból veszi és továbbadja; `textItemId` `await`-tel |
| `package.json`, `vitest.config.ts` | `./text` export és teszt-alias |
| `src/serve/inventory.ts` | `textKey` |
| `src/serve/job.ts`, `src/serve/http.ts` | szöveges átvétel (`runTextJob`), szöveges pár betöltése, `isJob` |
| `src/serve/summary.ts` | szöveges tétel futása `adHoc.file`-lal |
| `worker/migrations/0005_text.sql` (új), `worker/src/store.ts`, `worker/src/d1.ts` | új oszlopok, a szöveg ürítése lezáráskor |
| `worker/src/handle.ts`, `messages.ts`, `plan.ts`, `index.ts` | csatolmány és `/scan` felismerése, letöltés, kopogtatás, üzenetek |
| `docs/operations/telegram-worker-topology.md` | a bot bemeneteinek táblázata |

---

### Task 1: Közös szövegmag (`src/source/text-core.ts`, `transcript-refinery/text`)

**Files:**
- Create: `src/source/text-core.ts`
- Modify: `src/source/text.ts` (teljes csere), `src/source/folder.ts:11-87` és `:225`, `package.json` (`exports`), `vitest.config.ts` (`alias`)
- Test: `src/source/text.test.ts`

**Interfaces:**
- Produces (a `transcript-refinery/text` és a `./text.js` is kiadja):
  - `TEXT_EXTENSIONS: readonly ['.txt', '.md']`, `SUBTITLE_EXTENSIONS: readonly ['.srt', '.vtt']`, `MAX_TEXT_BYTES: number`
  - `tooLargeMessage(bytes: number): string`
  - `splitSubtitleName(fileName: string, extensions?: readonly string[]): SubtitleName | null`, `interface SubtitleName { base: string; language: string | null }`
  - `stripFrontmatter(text: string): string`, `vaultSafeLinks(text: string): string`
  - `normalizeText(bytes: Uint8Array, markdown: boolean): string`
  - `textItemId(text: string): Promise<string>` (**aszinkron lett**)
  - `isTextItemId(id: string): boolean`
  - `readTextSource(path: string): Promise<string>` (csak `./text.js`, változatlan viselkedés)

- [x] **Step 1: Write the failing tests**

A `src/source/text.test.ts`-ben a `textItemId` hívások elé `await` kerül (a `readTextSource és textItemId` blokk három tesztjében: `expect(await textItemId(b)).toBe(await textItemId(a))`, `expect(await textItemId(a)).not.toBe(await textItemId(b))`, `expect(await textItemId(a)).toMatch(...)`, `expect(await textItemId(a)).toBe(await textItemId(b))`). Az import bővül, és a fájl végére új blokk jön:

```ts
import { createHash } from 'node:crypto'
// ...a meglévő importok mellé:
import { isTextItemId, normalizeText, readTextSource, stripFrontmatter, textItemId, vaultSafeLinks } from './text.js'

const enc = (text: string) => new TextEncoder().encode(text)

describe('normalizeText (Node-mentes mag)', () => {
  it('ugyanazt adja, mint a fájlból olvasás, .md-nél frontmatter nélkül', async () => {
    const raw = '﻿---\ntitle: X\n---\r\n# Fejezet\r\nLásd [[Cél|itt]].\r\n'
    expect(normalizeText(enc(raw), true)).toBe(await readTextSource(await file('a.md', raw)))
    expect(normalizeText(enc(raw), true)).toBe('# Fejezet\nLásd itt.')
  })

  it('a már normalizált szöveg .txt-ként újra normalizálva változatlan, így az azonosító is', async () => {
    const once = normalizeText(enc('---\na: 1\n---\n[W](https://e.org/Foo_(bar)) és [t](https://e.org/x "c")\n'), true)
    expect(normalizeText(enc(once), false)).toBe(once)
    expect(await textItemId(normalizeText(enc(once), false))).toBe(await textItemId(once))
  })

  it('a megnevezett hibák a bájtokon is: túl nagy, NUL, érvénytelen UTF-8, üres', () => {
    expect(() => normalizeText(new Uint8Array(2 * 1024 * 1024 + 1), false)).toThrow('a fájl túl nagy: 2.0 MB, legfeljebb 2 MB')
    expect(() => normalizeText(enc('a\0b'), false)).toThrow('a fájl nem UTF-8 szöveg')
    expect(() => normalizeText(new Uint8Array([0xc3, 0x28]), false)).toThrow('a fájl nem UTF-8 szöveg')
    expect(() => normalizeText(enc(' \n'), false)).toThrow('a fájl üres')
  })
})

describe('textItemId (Web Crypto)', () => {
  it('az érték azonos a korábbi node:crypto kivonattal', async () => {
    const text = 'Első sor.\nMásodik sor.'
    const before = `t-${createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)}`
    expect(await textItemId(text)).toBe(before)
  })

  it('az isTextItemId csak a t- + 16 hex alakot ismeri fel, a t- kezdetű videóazonosítót nem', async () => {
    expect(isTextItemId(await textItemId('x'))).toBe(true)
    expect(isTextItemId('t-abcdefghi')).toBe(false)
    expect(isTextItemId('abcdefghijk')).toBe(false)
  })
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/source/text.test.ts`
Expected: FAIL — `normalizeText` és `isTextItemId` nem exportált.

- [x] **Step 3: Write the implementation**

`src/source/text-core.ts` (új). A `LANGUAGE_TAG` a teljes kommentjével, a `SubtitleName` és a `splitSubtitleName` **szó szerint** átkerül a `src/source/folder.ts`-ből (ma `:16-87`), a `stripFrontmatter` és a `vaultSafeLinks` a `src/source/text.ts`-ből, a dokumentációs kommentjeikkel együtt:

```ts
/**
 * A szöveges átirat Node-mentes magja. A CLI (`./text.js`) és a Worker
 * (`transcript-refinery/text`) ugyanezt hívja, így a `t-…` azonosító mindkét
 * oldalon ugyanaz. Ide Node-modul nem importálható: a Worker bundle-je betölti.
 */

/** Az ad hoc úton (`--dir`, `--file`) és Telegramból felvehető szöveges átiratok kiterjesztései. */
export const TEXT_EXTENSIONS = ['.txt', '.md'] as const

export const SUBTITLE_EXTENSIONS = ['.srt', '.vtt'] as const

/** A véletlen óriásfájl elleni kapu; a költséget a becslés és a költségkeret védi. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024

export function tooLargeMessage(bytes: number): string {
  return `a fájl túl nagy: ${(bytes / 1024 / 1024).toFixed(1)} MB, legfeljebb 2 MB`
}

// <-- ide a LANGUAGE_TAG (kommenttel), a SubtitleName és a splitSubtitleName a folder.ts-ből, változatlanul

// <-- ide a stripFrontmatter és a vaultSafeLinks a text.ts-ből, változatlanul

/**
 * Egy `.txt`/`.md` átirat szövege a bájtokból, ellenőrizve és normalizálva: BOM
 * nélkül (a `TextDecoder` levágja), `\n` sorvégekkel, `.md`-nél frontmatter
 * nélkül, vault-biztos linkekkel, levágott szélekkel. Az azonosító ebből készül.
 * A már normalizált szövegen (`markdown: false`) hatástalan.
 */
export function normalizeText(bytes: Uint8Array, markdown: boolean): string {
  if (bytes.byteLength > MAX_TEXT_BYTES) throw new Error(tooLargeMessage(bytes.byteLength))
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('a fájl nem UTF-8 szöveg')
  }
  if (text.includes('\0')) throw new Error('a fájl nem UTF-8 szöveg')

  text = text.replace(/\r\n?/g, '\n')
  if (markdown) text = stripFrontmatter(text)
  text = vaultSafeLinks(text).trim()
  if (text === '') throw new Error('a fájl üres')
  return text
}

/**
 * A szöveges tétel azonosítója a tartalomból: átnevezés, áthelyezés nem új
 * tétel, szerkesztés igen. A `t-` előtag választja el a videóazonosítótól.
 * Web Crypto, hogy a Workerben is fusson; az érték a korábbi `node:crypto`-s.
 */
export async function textItemId(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `t-${hex.slice(0, 16)}`
}

const TEXT_ITEM_ID = /^t-[0-9a-f]{16}$/

/** A YouTube-azonosító 11 karakter, és kezdődhet `t-`-vel; a szöveges tételé mindig 18. */
export function isTextItemId(id: string): boolean {
  return TEXT_ITEM_ID.test(id)
}
```

`src/source/text.ts` (teljes csere):

```ts
import { readFile, stat } from 'node:fs/promises'
import { MAX_TEXT_BYTES, normalizeText, tooLargeMessage } from './text-core.js'

export * from './text-core.js'

/**
 * Egy `.txt`/`.md` átirat szövege a fájlból. A méretet beolvasás előtt nézi,
 * a többi szabály a `normalizeText`-ben van.
 */
export async function readTextSource(path: string): Promise<string> {
  const { size } = await stat(path)
  if (size > MAX_TEXT_BYTES) throw new Error(tooLargeMessage(size))
  return normalizeText(await readFile(path), path.toLowerCase().endsWith('.md'))
}
```

`src/source/folder.ts`:
- törlendő a `const SUBTITLE_EXTENSIONS = ['.srt', '.vtt'] as const` sor, a `LANGUAGE_TAG` a kommentjével, a `SubtitleName` interfész és a `splitSubtitleName` függvény (ezek most a magban vannak);
- az import: `import { readTextSource, splitSubtitleName, SUBTITLE_EXTENSIONS, TEXT_EXTENSIONS, textItemId } from './text.js'`;
- az import alá: `export { splitSubtitleName, type SubtitleName } from './text.js'` (a `summary.ts`, a `watcher.ts` és a `folder.test.ts` innen importál);
- a `textItem`-ben: `itemId = await textItemId(await readTextSource(path))`.

`package.json` `exports`, a `./classify` után:

```json
    "./text": {
      "types": "./dist/source/text-core.d.ts",
      "default": "./dist/source/text-core.js"
    }
```

`vitest.config.ts` `alias`, a `classify` sor alá:

```ts
      'transcript-refinery/text': fileURLToPath(new URL('./src/source/text-core.ts', import.meta.url)),
```

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/source` majd a Global Constraints teljes ellenőrzése.
Expected: PASS; a meglévő `folder.test.ts` (`splitSubtitleName`) és `text.test.ts` esetek változatlanul zöldek; `grep -n "node:" src/source/text-core.ts` üres.

- [x] **Step 5: Commit**

```bash
git add src/source/text-core.ts src/source/text.ts src/source/text.test.ts src/source/folder.ts package.json vitest.config.ts
git commit   # commit-message skill; pl. "refactor(source): Share text normalization without Node"
```

---

### Task 2: A serve átveszi a szöveget (`src/serve/job.ts`, `http.ts`, `inventory.ts`)

**Files:**
- Modify: `src/serve/inventory.ts` (`infoKey` alá), `src/serve/job.ts` (`ServeJob`, új `runTextJob`, `runJob` eleje), `src/serve/http.ts` (`isJob`)
- Test: `src/serve/job.test.ts`, `src/serve/http.test.ts`

**Interfaces:**
- Consumes: `normalizeText`, `textItemId` (`../source/text.js`, Task 1)
- Produces:
  - `textKey(videoId: string): string` → `videos/<videoId>/text.txt`
  - `ServeJob` új opcionális mezői: `text?: string`, `title?: string`, `textLang?: string`
  - a recept nélküli, `text`-es kopogtatásra az R2-ben `text.txt` + `info.json`, majd `ready`

- [ ] **Step 1: Write the failing tests**

`src/serve/job.test.ts`, import: `import { textItemId } from '../source/text.js'`; új blokk a fájl végére:

```ts
describe('runJob szöveges tétel', () => {
  const TEXT = 'Első sor.\nMásodik sor.'
  const enc = (text: string) => new TextEncoder().encode(text)

  function capture(store: ReturnType<typeof memoryStore>, callbacks: CallbackBody[]): JobEffects {
    return {
      ...emptyEffects(store),
      fetchSubtitle: () => Promise.reject(new Error('yt-dlp nem indulhat')),
      callback: (_id, body) => {
        callbacks.push(body)
        return Promise.resolve()
      },
    }
  }

  it('a szöveget és az infót az R2-be teszi, yt-dlp nélkül, és a címmel ready', async () => {
    const id = await textItemId(TEXT)
    const store = memoryStore()
    const callbacks: CallbackBody[] = []
    await runJob({ jobId: `5:${id}`, videoId: id, url: '', text: TEXT, title: 'átirat', textLang: 'en' }, capture(store, callbacks))
    expect(new TextDecoder().decode(store.objects[`videos/${id}/text.txt`])).toBe(TEXT)
    expect(JSON.parse(new TextDecoder().decode(store.objects[`videos/${id}/info.json`]))).toEqual({
      id,
      title: 'átirat',
      language: 'en',
    })
    expect(callbacks).toEqual([{ status: 'ready', title: 'átirat' }])
  })

  it('nyelvkód nélkül az info.json-ban nincs language', async () => {
    const id = await textItemId(TEXT)
    const store = memoryStore()
    await runJob({ jobId: `5:${id}`, videoId: id, url: '', text: TEXT, title: 'átirat' }, capture(store, []))
    expect(JSON.parse(new TextDecoder().decode(store.objects[`videos/${id}/info.json`]))).toEqual({ id, title: 'átirat' })
  })

  it('a teljes R2-párra azonnal ready, feltöltés nélkül', async () => {
    const id = await textItemId(TEXT)
    const store = memoryStore({
      [`videos/${id}/text.txt`]: enc(TEXT),
      [`videos/${id}/info.json`]: enc(JSON.stringify({ id, title: 'régi' })),
    })
    const puts: string[] = []
    const put = store.put
    store.put = (key, body) => {
      puts.push(key)
      return put(key, body)
    }
    const callbacks: CallbackBody[] = []
    await runJob({ jobId: `6:${id}`, videoId: id, url: '', text: TEXT, title: 'új név' }, capture(store, callbacks))
    expect(puts).toEqual([])
    expect(callbacks).toEqual([{ status: 'ready', title: 'új név' }])
  })

  it('eltérő azonosítóra failed, és az R2-be nem ír', async () => {
    const store = memoryStore()
    const callbacks: CallbackBody[] = []
    await runJob({ jobId: '5:t-0000000000000000', videoId: 't-0000000000000000', url: '', text: TEXT }, capture(store, callbacks))
    expect(store.objects).toEqual({})
    expect(callbacks).toEqual([{ status: 'failed', error: 'A szöveg azonosítója nem egyezik.' }])
  })
})
```

`src/serve/http.test.ts`, a `'a receptlista 202 …'` teszt mintájára új teszt a `createServeServer` blokkban:

```ts
  it('a szöveges mezők szövegként 202, más típussal 400', async () => {
    const seen: unknown[] = []
    server = createServeServer({
      secret: 'titok',
      gate,
      version: '9.9.9',
      onJob: (job) => {
        seen.push(job)
        return Promise.resolve()
      },
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as { port: number }).port
    const job = { jobId: '5:t-0123456789abcdef', videoId: 't-0123456789abcdef', url: '' }
    expect(await post(port, 'titok', { ...job, text: 1 })).toBe(400)
    expect(await post(port, 'titok', { ...job, title: 1 })).toBe(400)
    expect(await post(port, 'titok', { ...job, textLang: 1 })).toBe(400)
    expect(await post(port, 'titok', { ...job, text: 'Szöveg.', title: 'Cím', textLang: 'en' })).toBe(202)
    await vi.waitFor(() => expect(seen).toEqual([{ ...job, text: 'Szöveg.', title: 'Cím', textLang: 'en' }]))
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/serve/job.test.ts src/serve/http.test.ts`
Expected: FAIL — a szöveges kopogtatás ma a yt-dlp-utat indítja, a hibás típus 202.

- [ ] **Step 3: Write the implementation**

`src/serve/inventory.ts`, az `infoKey` alá:

```ts
/** A Telegramból jött szöveges tétel normalizált szövege; a kulcs azonosítója a tartalom hash-e. */
export function textKey(videoId: string): string {
  return `videos/${videoId}/text.txt`
}
```

`src/serve/job.ts`:
- import: `import { normalizeText, textItemId } from '../source/text.js'`, és az `inventory.js` importba `textKey`;
- a `ServeJob` bővül:

```ts
export interface ServeJob {
  jobId: string
  videoId: string
  url: string
  recipes?: string[]
  lang?: string
  /** Szöveges tétel (Telegram-csatolmány vagy `/scan`): a Worker normalizálta, a `videoId` a `t-…` azonosító. */
  text?: string
  title?: string
  /** A fájlnévből kapott nyelvkód; nem a fordítás `lang`-ja. */
  textLang?: string
}
```

- a konstansok mellé: `const ID_MISMATCH = 'A szöveg azonosítója nem egyezik.'`
- a `runRecipeJob` elé:

```ts
/** A feliratletöltés párja szöveges tételre: ellenőrzés, majd az R2-be, yt-dlp nélkül. */
async function runTextJob(job: ServeJob & { text: string }, effects: JobEffects): Promise<void> {
  const title = job.title ?? job.videoId
  try {
    const keys = await effects.store.list(`videos/${job.videoId}/`)
    // ponytail: a kulcs a tartalom hash-e, ezért a megléte elég; üres objektumot a putWithRetry nem hagy.
    if (keys.includes(textKey(job.videoId)) && keys.includes(infoKey(job.videoId))) {
      await report(effects, job.jobId, { status: 'ready', title })
      return
    }
    // A Worker és a serve más verziója más azonosítót adhat: ilyenkor a jegyzet rossz tételhez kerülne.
    const text = normalizeText(new TextEncoder().encode(job.text), false)
    if ((await textItemId(text)) !== job.videoId) {
      await report(effects, job.jobId, { status: 'failed', error: ID_MISMATCH })
      return
    }
    const info = { id: job.videoId, title, ...(job.textLang === undefined ? {} : { language: job.textLang }) }
    await putWithRetry(effects.store, textKey(job.videoId), new TextEncoder().encode(text))
    await putWithRetry(effects.store, infoKey(job.videoId), new TextEncoder().encode(JSON.stringify(info)))
    console.log(`[job] Szöveges tétel az R2-ben: "${title}" (${job.videoId})`)
    await report(effects, job.jobId, { status: 'ready', title })
  } catch (error) {
    const message = error instanceof Error ? error.message : UPLOAD_FAILED
    await report(effects, job.jobId, { status: 'failed', error: message })
  }
}
```

- a `runJob` elején, a `recipes`-ág után:

```ts
  if (job.text !== undefined) {
    await runTextJob({ ...job, text: job.text }, effects)
    return
  }
```

`src/serve/http.ts`, `isJob`: a `job` típusa kiegészül `text?: unknown; title?: unknown; textLang?: unknown`-nal, és a `return job.lang === …` sor elé:

```ts
  for (const field of [job.text, job.title, job.textLang]) {
    if (field !== undefined && typeof field !== 'string') return false
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/serve` majd a teljes ellenőrzés.
Expected: PASS; a meglévő felirat- és receptjob-tesztek változatlanul zöldek.

- [ ] **Step 5: Commit**

```bash
git add src/serve/inventory.ts src/serve/job.ts src/serve/http.ts src/serve/job.test.ts src/serve/http.test.ts
git commit   # commit-message skill; pl. "feat(serve): Store Telegram text transcripts in R2"
```

---

### Task 3: A serve futása szöveges tételen (`loadSummaryPair`, `runRecipes`)

**Files:**
- Modify: `src/serve/job.ts` (`loadSummaryPair`, `runRecipeJob` kiírása), `src/serve/summary.ts` (`runRecipes`)
- Test: `src/serve/job.test.ts`, `src/serve/summary.test.ts`

**Interfaces:**
- Consumes: `textKey` (Task 2), `TEXT_EXTENSIONS`, `splitSubtitleName`, `textItemId` (Task 1); `commandRun` `adHoc: { file }` kapcsolója (A szelet, `src/cli.ts:458`)
- Produces: a szöveges recept-futás a vaultba `Beszéd [t-…]_<fajta>.md`-t ír `item_id: t-…`-vel, és `{ ok: true, noteUrl }`-t ad

- [ ] **Step 1: Write the failing tests**

`src/serve/job.test.ts`, a `runJob szöveges tétel` blokkba:

```ts
  it('a recept-futás a SERVE_OUT-ba .txt-t ír, nyelvkóddal vagy anélkül', async () => {
    const id = 't-0123456789abcdef'
    const cases = [
      [undefined, `Kész cím [${id}].txt`],
      ['en', `Kész cím [${id}].en.txt`],
    ] as const
    for (const [language, name] of cases) {
      const info = enc(JSON.stringify({ id, title: 'Kész cím', ...(language === undefined ? {} : { language }) }))
      const store = memoryStore({ [`videos/${id}/text.txt`]: enc('Szöveg.'), [`videos/${id}/info.json`]: info })
      const paths: string[] = []
      const callbacks: CallbackBody[] = []
      await runJob(
        { jobId: `5:${id}`, videoId: id, url: '', recipes: ['summary'] },
        {
          ...effectsWith(store, paths),
          callback: (_id, body) => {
            callbacks.push(body)
            return Promise.resolve()
          },
        },
      )
      expect(paths).toEqual([`/data/telegram/${name}`, `/data/telegram/Kész cím [${id}].info.json`])
      expect(callbacks).toEqual([{ status: 'ready', title: 'Kész cím', noteUrl: 'https://github.com/tulaj/repo/blob/main/a.md' }])
    }
  })

  it('a hiányzó szövegre a hiányzó pár mondata jön', async () => {
    const id = 't-0123456789abcdef'
    const store = memoryStore({ [`videos/${id}/info.json`]: enc(JSON.stringify({ id, title: 'X' })) })
    const callbacks: CallbackBody[] = []
    await runJob({ jobId: `5:${id}`, videoId: id, url: '', recipes: ['summary'] }, capture(store, callbacks))
    expect(callbacks).toEqual([{ status: 'failed', error: 'A felirat nincs az R2-ben.' }])
  })
```

`src/serve/summary.test.ts`, import: `import { textItemId } from '../source/text.js'`; új teszt a `runRecipes` blokkban:

```ts
  it('a szöveges tétel a --file úton fut: jegyzet t- azonosítóval, a második kérés modell nélkül', async () => {
    process.env.LITELLM_API_KEY = 'sk-proba'
    const { root, vault, outDir, load } = await scene()
    roots.push(root)
    const text =
      'Ez a beszéd arról szól, hogy a figyelem és a türelem hogyan segít a tanulásban, és a tanító azt mondja, hogy nem kell sietni.'
    const id = await textItemId(text)
    // A scene feliratát a futás eleji takarítás (keepThisVideo) elviszi, mert nem ehhez az azonosítóhoz tartozik.
    await writeFile(join(outDir, `Beszéd [${id}].txt`), text)
    await writeFile(join(outDir, `Beszéd [${id}].info.json`), JSON.stringify({ id, title: 'Beszéd' }))
    const calls = { generate: 0 }
    const run = (createClient: RunRuntime['createClient']) =>
      runRecipes({ videoId: id, recipes: ['summary'], outDir, createClient, load, git: gitWith() })
    const result = await run(() => client(calls))
    expect(result).toEqual({ ok: true, noteUrl: `Inbox/transcript-refinery/telegram/Beszéd [${id}]_transcript.md` })
    const note = await readFile(join(vault, `Inbox/transcript-refinery/telegram/Beszéd [${id}]_summary.md`), 'utf8')
    expect(note).toMatch(new RegExp(`item_id: "?${id}"?\\n`))
    expect(note).toContain('origin: telegram\n')
    expect(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: vault, encoding: 'utf8' }).trim()).toBe(
      `docs(transcript-refinery): summary | Beszéd [${id}]`,
    )
    const again = { generate: 0 }
    expect(await run(() => client(again))).toEqual(result)
    expect(again.generate).toBe(0)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/serve/job.test.ts src/serve/summary.test.ts`
Expected: FAIL — a `loadSummaryPair` csak feliratot ismer (`MISSING_PAIR`), a `runRecipes` a `.txt`-t nem találja.

- [ ] **Step 3: Write the implementation**

`src/serve/job.ts`, a `loadSummaryPair` teljes cseréje:

```ts
async function loadSummaryPair(
  effects: JobEffects,
  videoId: string,
): Promise<
  | { ok: true; title: string; language: string | null; extension: string; subtitle: Uint8Array; info: Uint8Array }
  | { ok: false; error: string }
> {
  const prefix = `videos/${videoId}/`
  let keys: string[]
  try {
    keys = await effects.store.list(prefix)
  } catch {
    return { ok: false, error: UNREADABLE_PAIR }
  }
  const named = keys.map((key) => ({ key, name: key.slice(prefix.length) }))
  const infoItem = named.find((item) => item.name === 'info.json')
  const subs = named.filter((item) => SUB_NAME.test(item.name))
  const textItem = named.find((item) => item.key === textKey(videoId))
  if (infoItem === undefined || (subs.length === 0 && textItem === undefined)) return { ok: false, error: MISSING_PAIR }
  let infoBody: Uint8Array | null
  try {
    infoBody = await effects.store.get(infoItem.key)
  } catch {
    return { ok: false, error: UNREADABLE_PAIR }
  }
  if (infoBody === null || infoBody.byteLength === 0) return { ok: false, error: UNREADABLE_PAIR }
  let title: string
  let accepted = effects.languages
  let infoLanguage: string | null = null
  try {
    const raw = JSON.parse(new TextDecoder().decode(infoBody)) as { id?: unknown; title?: unknown; language?: unknown }
    if (raw.id !== videoId) return { ok: false, error: MISSING_PAIR }
    const text = typeof raw.title === 'string' ? raw.title : ''
    title = text.trim() === '' ? videoId : text
    if (typeof raw.language === 'string' && raw.language.trim() !== '') {
      accepted = [raw.language]
      infoLanguage = raw.language
    }
  } catch {
    return { ok: false, error: MISSING_PAIR }
  }
  if (textItem !== undefined) {
    let text: Uint8Array | null
    try {
      text = await effects.store.get(textItem.key)
    } catch {
      return { ok: false, error: UNREADABLE_PAIR }
    }
    if (text === null || text.byteLength === 0) return { ok: false, error: UNREADABLE_PAIR }
    // A szöveges tétel nyelve a fájlnévből jön, ha volt; különben a futás a tartalomból dönt.
    return { ok: true, title, language: infoLanguage, extension: 'txt', subtitle: text, info: infoBody }
  }
  for (const sub of subs) {
    const match = SUB_NAME.exec(sub.name)
    if (match?.[1] === undefined || match[2] === undefined || !languageMatches(match[1], accepted)) continue
    let subtitle: Uint8Array | null
    try {
      subtitle = await effects.store.get(sub.key)
    } catch {
      return { ok: false, error: UNREADABLE_PAIR }
    }
    if (subtitle === null || subtitle.byteLength === 0) return { ok: false, error: UNREADABLE_PAIR }
    return { ok: true, title, language: match[1], extension: match[2], subtitle, info: infoBody }
  }
  return { ok: false, error: MISSING_PAIR }
}
```

A `runRecipeJob`-ban a felirat kiírása:

```ts
    const name =
      loaded.language === null ? `${stem}.${loaded.extension}` : `${stem}.${loaded.language}.${loaded.extension}`
    await effects.writeFile(join(effects.outDir, name), loaded.subtitle)
```

`src/serve/summary.ts`:
- import: `import { TEXT_EXTENSIONS } from '../source/text.js'`;
- a `keepThisVideo` hívás után:

```ts
  // A szöveges tétel az A szelet `--file` útján fut: a `sources` csak feliratot vesz fel.
  const textName = (await readdir(input.outDir)).find(
    (name) => name.includes(input.videoId) && splitSubtitleName(name, TEXT_EXTENSIONS) !== null,
  )
```

- a `commandRun` flagjei bővülnek: `...(textName === undefined ? {} : { adHoc: { file: join(input.outDir, textName) } }),`
- a fájlkeresés:

```ts
  const fileName =
    textName ??
    names.find((name) => {
      const parsed = splitSubtitleName(name)
      return parsed !== null && parsed.base.includes(input.videoId)
    })
  const parsed =
    fileName === undefined ? null : (splitSubtitleName(fileName) ?? splitSubtitleName(fileName, TEXT_EXTENSIONS))
```

A cím fallbackje (`found?.title ?? parsed.base`) marad: a `noteCommitMessage` a `[t-…]` utótagot levágja.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/serve` majd a teljes ellenőrzés.
Expected: PASS; a meglévő `runRecipes` és receptjob-tesztek változatlanul zöldek.

- [ ] **Step 5: Commit**

```bash
git add src/serve/job.ts src/serve/summary.ts src/serve/job.test.ts src/serve/summary.test.ts
git commit   # commit-message skill; pl. "feat(serve): Run recipes on Telegram text items"
```

---

### Task 4: A Worker tárolója (`0005_text.sql`, `store.ts`, `d1.ts`)

**Files:**
- Create: `worker/migrations/0005_text.sql`, `worker/src/store.test.ts`, `worker/src/d1.test.ts`
- Modify: `worker/src/store.ts` (`JobRow`, `memoryStore.save`, `claimJob`), `worker/src/d1.ts` (`JobRecord`, `toRow`, `insert`, `save`, `claimJob`)
- Test: `worker/src/entry.test.ts` (migráció)

**Interfaces:**
- Produces: `JobRow` új opcionális mezői: `fileId?: string | null`, `fileName?: string | null`, `text?: string | null`. A `save` és a `claimJob` a nem nyitott (`ready`/`failed`/`cancelled`) sor `text`-jét `null`-ra írja.

- [ ] **Step 1: Write the failing tests**

`worker/src/store.test.ts` (új):

```ts
import { describe, expect, it } from 'vitest'
import { memoryStore, type JobRow } from './store.js'

function row(partial: Partial<JobRow> = {}): JobRow {
  return {
    jobId: '5:t-0123456789abcdef',
    updateId: 5,
    chatId: '42',
    messageId: 5,
    videoId: 't-0123456789abcdef',
    url: '',
    status: 'queued',
    error: null,
    title: 'Cím',
    notifiedReady: false,
    acceptedAt: null,
    sub: 'sub-42',
    fileId: null,
    fileName: null,
    text: 'Szöveg.',
    ...partial,
  }
}

describe('a szöveg a sor lezárásáig él', () => {
  it('nyitott mentésnél marad, ready-nél és failed-nél kiürül', async () => {
    for (const status of ['ready', 'failed'] as const) {
      const store = memoryStore()
      await store.insert(row())
      await store.save(row({ status: 'waiting' }))
      expect((await store.listByUpdate(5))[0]?.text).toBe('Szöveg.')
      await store.save(row({ status }))
      expect((await store.listByUpdate(5))[0]?.text).toBeNull()
    }
  })

  it('a megszakítás (claimJob) is kiüríti', async () => {
    const store = memoryStore()
    await store.insert(row())
    expect(await store.claimJob(row().jobId, 'queued', 'cancelled')).toBe(true)
    expect((await store.listByUpdate(5))[0]?.text).toBeNull()
  })
})
```

`worker/src/d1.test.ts` (új):

```ts
import { describe, expect, it } from 'vitest'
import { createD1Store, type D1Like, type D1Statement } from './d1.js'
import type { JobRow } from './store.js'

function capture(): D1Like & { calls: { sql: string; values: unknown[] }[] } {
  const calls: { sql: string; values: unknown[] }[] = []
  return {
    calls,
    prepare(sql) {
      const call = { sql, values: [] as unknown[] }
      calls.push(call)
      const statement: D1Statement = {
        bind(...values) {
          call.values = values
          return statement
        },
        all: <T>() => Promise.resolve({ results: [] as T[] }),
        first: () => Promise.resolve(null),
        run: () => Promise.resolve({ meta: { changes: 1 } }),
      }
      return statement
    },
  }
}

const row: JobRow = {
  jobId: '5:t-0123456789abcdef',
  updateId: 5,
  chatId: '42',
  messageId: 5,
  videoId: 't-0123456789abcdef',
  url: '',
  status: 'waiting',
  error: null,
  title: 'Cím',
  notifiedReady: false,
  acceptedAt: null,
  sub: 'sub-42',
  fileId: 'F5',
  fileName: 'átirat.md',
  text: 'Szöveg.',
}

describe('D1: szöveges sor', () => {
  it('a beszúrás és a nyitott mentés viszi a file_id-t, a nevet és a szöveget; a lezárt mentés a szöveget null-ra írja', async () => {
    const db = capture()
    const store = createD1Store(db)
    await store.insert(row)
    await store.save(row)
    await store.save({ ...row, status: 'ready' })
    const [insert, open, closed] = db.calls
    expect(insert?.values.slice(-3)).toEqual(['F5', 'átirat.md', 'Szöveg.'])
    expect(open?.values.slice(-4, -1)).toEqual(['F5', 'átirat.md', 'Szöveg.'])
    expect(closed?.values.slice(-4, -1)).toEqual(['F5', 'átirat.md', null])
  })

  it('a megszakítás a szöveget is üríti', async () => {
    const db = capture()
    await createD1Store(db).claimJob(row.jobId, 'queued', 'cancelled')
    expect(db.calls[0]?.sql).toContain('text = NULL')
  })
})
```

`worker/src/entry.test.ts`, a `'a wrangler percenként fut …'` teszt végére:

```ts
    const text = await readFile('worker/migrations/0005_text.sql', 'utf8')
    expect(text).toContain('ALTER TABLE jobs ADD COLUMN file_id TEXT')
    expect(text).toContain('ALTER TABLE jobs ADD COLUMN file_name TEXT')
    expect(text).toContain('ALTER TABLE jobs ADD COLUMN text TEXT')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run worker/src/store.test.ts worker/src/d1.test.ts worker/src/entry.test.ts`
Expected: FAIL — a migráció hiányzik, a szöveg nem ürül, a D1 nem viszi az új oszlopokat.

- [ ] **Step 3: Write the implementation**

`worker/migrations/0005_text.sql`:

```sql
ALTER TABLE jobs ADD COLUMN file_id TEXT;
ALTER TABLE jobs ADD COLUMN file_name TEXT;
ALTER TABLE jobs ADD COLUMN text TEXT;
```

`worker/src/store.ts`, a `JobRow` végére:

```ts
  /** Szöveges tétel: a Telegram-csatolmány `file_id`-je; a cron ebből tölti le újra. */
  fileId?: string | null
  /** Szöveges tétel: a csatolmány neve; ebből a nyelvkód és a `.md` jelzés. */
  fileName?: string | null
  /** Szöveges tétel: a `/scan` szövege, amíg a sor nyitott; lezáráskor `null`. */
  text?: string | null
```

A `memoryStore`-ban:

```ts
    save: (row) => {
      const index = rows.findIndex((item) => item.jobId === row.jobId)
      // A cron 202-je és a megszakítás versenyének őre, mint a D1-ben.
      if (rows[index]?.status === 'cancelled') return Promise.resolve(false)
      // A lezárt sor szövegére nincs több újrapróbálás, mint a D1-ben.
      const stored = OPEN.includes(row.status) ? row : { ...row, text: null }
      if (index === -1) rows.push(stored)
      else rows[index] = stored
      return Promise.resolve(true)
    },
```

és a `claimJob`-ban: `rows[index] = { ...row, status: next, ...(OPEN.includes(next) ? {} : { text: null }) }`.

`worker/src/d1.ts`:
- import: `import { OPEN, type Binding, type JobRow, type JobStatus, type JobStore, type LinkToken, type RunRow } from './store.js'`;
- `JobRecord` végére: `file_id: string | null`, `file_name: string | null`, `text: string | null`;
- `toRow` végére: `fileId: record.file_id, fileName: record.file_name, text: record.text,`;
- `insert`: az oszloplista végére `, file_id, file_name, text`, a `VALUES`-ba még három `?`, a `bind` végére `row.fileId ?? null, row.fileName ?? null, row.text ?? null`;
- `save`: a `SET` végére `, file_id = ?, file_name = ?, text = ?` (a `WHERE` előtt), a `bind`-ban a `row.sub` és a `row.jobId` közé `row.fileId ?? null, row.fileName ?? null, OPEN.includes(row.status) ? (row.text ?? null) : null`;
- `claimJob`:

```ts
    async claimJob(jobId, expect, next) {
      // Ma csak a megszakítás hívja; a lezárt sor szövegére nincs több újrapróbálás.
      const sql = OPEN.includes(next)
        ? 'UPDATE jobs SET status = ? WHERE job_id = ? AND status = ?'
        : 'UPDATE jobs SET status = ?, text = NULL WHERE job_id = ? AND status = ?'
      return changed(await db.prepare(sql).bind(next, jobId, expect).run())
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run worker` majd a teljes ellenőrzés.
Expected: PASS; a meglévő Worker-tesztek változatlanul zöldek (az új mezők opcionálisak, a régi `JobRow` literálok nem változnak).

- [ ] **Step 5: Commit**

```bash
git add worker/migrations/0005_text.sql worker/src/store.ts worker/src/d1.ts worker/src/store.test.ts worker/src/d1.test.ts worker/src/entry.test.ts
git commit   # commit-message skill; pl. "feat(worker): Keep text job sources until the job closes"
```

---

### Task 5: A Worker fogadja a csatolmányt és a `/scan`-t

**Files:**
- Modify: `worker/src/messages.ts`, `worker/src/plan.ts` (re-export lista), `worker/src/handle.ts`, `worker/src/index.ts`, `docs/operations/telegram-worker-topology.md`
- Test: `worker/src/handle.test.ts`, `worker/src/entry.test.ts`

**Interfaces:**
- Consumes: `normalizeText`, `textItemId`, `isTextItemId`, `splitSubtitleName`, `TEXT_EXTENSIONS`, `MAX_TEXT_BYTES`, `tooLargeMessage` (`transcript-refinery/text`, Task 1); `JobRow.fileId/fileName/text` (Task 4); a serve `text`/`title`/`textLang` mezői (Task 2)
- Produces:
  - `WorkerDeps.download: (fileId: string) => Promise<Uint8Array | null>`
  - `PlannedKnock` új opcionális mezői: `text?: string`, `title?: string`, `textLang?: string`
  - `readyLine(title: string, text?: boolean): string`
  - üzenetek: `TEXT_ONLY`, `SCAN_EMPTY`, `DOWNLOAD_FAILED`, `SCAN_LONG`

- [ ] **Step 1: Write the failing tests**

`worker/src/handle.test.ts`:
- import: `import { textItemId } from 'transcript-refinery/text'`; a `plan.js` importba `runReadyMessage`;
- a `deps()` segéd visszatérési objektumában a `...over` elé: `download: () => Promise.resolve(null),`;
- új blokk a fájl végére:

```ts
describe('szöveges bemenet', () => {
  const enc = (text: string) => new TextEncoder().encode(text)
  const BODY = 'Első sor.\nMásodik sor.'

  function doc(updateId: number, document: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return {
      update_id: updateId,
      message: { message_id: updateId, chat: { id: 42 }, from: { id: 42 }, document, ...extra },
    }
  }

  function file(updateId: number, name: string, extra: Record<string, unknown> = {}) {
    return doc(updateId, { file_id: `F${updateId}`, file_name: name, file_size: 20 }, extra)
  }

  it('a csatolt .txt sort nyit a címmel, és a kopogtatás viszi a szöveget és a nyelvkódot', async () => {
    const store = await boundStore()
    const d = deps(store, { download: () => Promise.resolve(enc(`${BODY}\r\n`)) })
    const id = await textItemId(BODY)
    const planned = await handleUpdate(file(5, 'átirat.en.txt'), d)
    expect(d.sent).toEqual(['Sorba került: átirat'])
    expect((await store.listByUpdate(5))[0]).toMatchObject({
      jobId: `5:${id}`,
      videoId: id,
      url: '',
      title: 'átirat',
      fileId: 'F5',
      fileName: 'átirat.en.txt',
      text: null,
    })
    expect(planned.knocks).toEqual([{ jobId: `5:${id}`, videoId: id, url: '', text: BODY, title: 'átirat', textLang: 'en' }])
  })

  it('a nagybetűs kiterjesztés is jó, és az aláírás linkje nem indul', async () => {
    const store = await boundStore()
    const d = deps(store, { download: () => Promise.resolve(enc(BODY)) })
    const planned = await handleUpdate(file(5, 'ÁTIRAT.TXT', { caption: `https://youtu.be/${ID}` }), d)
    expect(d.sent).toEqual(['Sorba került: ÁTIRAT'])
    expect(planned.knocks).toHaveLength(1)
    expect(await store.listByUpdate(5)).toHaveLength(1)
    expect((await store.listByUpdate(5))[0]?.videoId).toBe(await textItemId(BODY))
  })

  it('ugyanaz a szöveg más néven, nyitott sor mellett: már sorban, kopogtatás nélkül', async () => {
    const store = await boundStore()
    const d = deps(store, { download: () => Promise.resolve(enc(BODY)) })
    await handleUpdate(file(5, 'egy.txt'), d)
    const second = await handleUpdate(file(6, 'masik.txt'), d)
    expect(d.sent).toEqual(['Sorba került: egy', 'Már sorban van: masik.'])
    expect(second.knocks).toEqual([])
  })

  it('a .pdf, a név nélküli és a 3 MB-os fájl hibát kap, letöltés és sor nélkül, a videós mondat sem jön', async () => {
    const store = await boundStore()
    let downloads = 0
    const d = deps(store, {
      download: () => {
        downloads += 1
        return Promise.resolve(enc(BODY))
      },
    })
    await handleUpdate(file(5, 'jegyzet.pdf'), d)
    await handleUpdate(doc(6, { file_id: 'F6' }), d)
    await handleUpdate(doc(7, { file_id: 'F7', file_name: 'nagy.txt', file_size: 3 * 1024 * 1024 }), d)
    expect(d.sent).toEqual([
      'Csak .txt vagy .md fájlt tudok feldolgozni.',
      'Csak .txt vagy .md fájlt tudok feldolgozni.',
      'A fájl túl nagy: 3.0 MB, legfeljebb 2 MB.',
    ])
    expect(downloads).toBe(0)
    for (const update of [5, 6, 7]) expect(await store.listByUpdate(update)).toEqual([])
  })

  it('a .md frontmatter nélkül megy tovább', async () => {
    const store = await boundStore()
    const d = deps(store, { download: () => Promise.resolve(enc('---\ntitle: X\n---\n# Fejezet\nszöveg\n')) })
    const planned = await handleUpdate(file(5, 'jegyzet.md'), d)
    expect(planned.knocks[0]?.text).toBe('# Fejezet\nszöveg')
  })

  it('a nem UTF-8 fájl, az üres fájl és a sikertelen letöltés megnevezett mondatot kap, sor nélkül', async () => {
    const store = await boundStore()
    const a = deps(store, { download: () => Promise.resolve(new Uint8Array([0xc3, 0x28])) })
    await handleUpdate(file(5, 'a.txt'), a)
    const b = deps(store, { download: () => Promise.resolve(enc(' \n')) })
    await handleUpdate(file(6, 'b.txt'), b)
    const c = deps(store)
    await handleUpdate(file(7, 'c.txt'), c)
    expect([...a.sent, ...b.sent, ...c.sent]).toEqual([
      'A fájl nem UTF-8 szöveg.',
      'A fájl üres.',
      'A fájlt nem tudtam letölteni, küldd újra.',
    ])
    for (const update of [5, 6, 7]) expect(await store.listByUpdate(update)).toEqual([])
  })

  it('a /scan szövegéből a cím az első sor, a szöveg a D1-ben vár', async () => {
    const store = await boundStore()
    const d = deps(store)
    const planned = await handleUpdate(command(5, '/scan \n\n  Kubernetes alapok\nMa arról lesz szó.'), d)
    const text = 'Kubernetes alapok\nMa arról lesz szó.'
    const id = await textItemId(text)
    expect(d.sent).toEqual(['Sorba került: Kubernetes alapok'])
    expect((await store.listByUpdate(5))[0]).toMatchObject({ videoId: id, title: 'Kubernetes alapok', text, fileId: null })
    expect(planned.knocks).toEqual([{ jobId: `5:${id}`, videoId: id, url: '', text, title: 'Kubernetes alapok' }])
  })

  it('a hosszú első sor 80 karakterre vágva a cím; az üres /scan tippet ad; a 3900 karakteres figyelmeztet', async () => {
    const store = await boundStore()
    const d = deps(store)
    await handleUpdate(command(5, `/scan ${'a'.repeat(100)}`), d)
    await handleUpdate(command(6, '/scan'), d)
    await handleUpdate(command(7, `/scan ${'x'.repeat(3900)}`), d)
    expect(d.sent).toEqual([
      `Sorba került: ${'a'.repeat(80)}`,
      'Írd a /scan után a szöveget, vagy küldd fájlként.',
      `Sorba került: ${'x'.repeat(80)}\nA szöveg elérhette a Telegram-üzenet határát, lehet, hogy csonka. Hosszabb átiratot fájlként küldj.`,
    ])
    expect(await store.listByUpdate(6)).toEqual([])
  })

  it('a /scanner nem a /scan parancs', async () => {
    const store = await boundStore()
    const d = deps(store)
    await handleUpdate(command(5, '/scanner'), d)
    expect(d.sent).toEqual(['Nincs YouTube-videó az üzenetben.'])
  })

  it('down után a cron a D1 szövegéből kopogtat, és a vár sor a címet mondja', async () => {
    const store = await boundStore()
    const down = deps(store, { knock: () => Promise.resolve('down') })
    const planned = await handleUpdate(command(5, '/scan Kubernetes alapok'), down)
    await applyKnocks(planned.knocks, down)
    expect(down.sent).toEqual(['Sorba került: Kubernetes alapok', 'A gép ébredésére vár: Kubernetes alapok.'])
    const up = deps(store)
    await handleCron(up)
    expect(up.knocks.map((knock) => knock.text)).toEqual(['Kubernetes alapok'])
  })

  it('a cron a .md csatolmányt újra letölti, a frontmatter újra lekerül; sikertelen letöltésnél nem kopogtat', async () => {
    const store = await boundStore()
    let downloads = 0
    const md = () => {
      downloads += 1
      return Promise.resolve(enc('---\ntitle: X\n---\n# Fejezet\n'))
    }
    const down = deps(store, { download: md, knock: () => Promise.resolve('down') })
    await applyKnocks((await handleUpdate(file(5, 'a.md'), down)).knocks, down)
    const failing = deps(store)
    await handleCron(failing)
    expect(failing.knocked).toEqual([])
    expect((await store.listByUpdate(5))[0]?.status).toBe('waiting')
    const up = deps(store, { download: md })
    await handleCron(up)
    expect(up.knocks).toEqual([
      { jobId: `5:${await textItemId('# Fejezet')}`, videoId: await textItemId('# Fejezet'), url: '', text: '# Fejezet', title: 'a' },
    ])
    expect(downloads).toBe(2)
  })

  it('a ready visszahívás után a szöveg kiürül, és a szöveg megvan üzenet a gombokkal jön; failed után is üres', async () => {
    const store = await boundStore()
    const d = deps(store)
    await handleUpdate(command(5, '/scan Kubernetes alapok'), d)
    const id = await textItemId('Kubernetes alapok')
    await handleCallback(`5:${id}`, { status: 'ready', title: 'Kubernetes alapok' }, d)
    expect((await store.listByUpdate(5))[0]?.text).toBeNull()
    expect(d.sent.at(-1)).toBe('Kubernetes alapok. A szöveg megvan.')
    expect(d.keyboards.at(-1)).toEqual(recipeKeyboard(`5:${id}`))
    await handleUpdate(command(6, '/scan Másik szöveg'), d)
    const other = await textItemId('Másik szöveg')
    await handleCallback(`6:${other}`, { status: 'failed', error: 'Ismeretlen nyelv.' }, d)
    expect((await store.listByUpdate(6))[0]?.text).toBeNull()
  })

  it('a kész futás linkje /notes/t-…/summary', async () => {
    const id = await textItemId(BODY)
    expect(runReadyMessage('Cím', { jobId: `5:${id}`, recipes: ['summary'], lang: null }, 'https://worker.test')).toBe(
      `Cím · summary. A jegyzet megvan.\nhttps://worker.test/notes/${id}/summary`,
    )
  })
})
```

`worker/src/entry.test.ts`, új teszt a `worker belépés` blokkban:

```ts
  it('a csatolt fájlt a getFile és a fájl-URL útján tölti le, és a sor a file_id-vel kerül a D1-be', async () => {
    const urls: string[] = []
    globalThis.fetch = (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      urls.push(url)
      if (url.endsWith('/getFile')) {
        return Promise.resolve(Response.json({ ok: true, result: { file_path: 'documents/file_1.txt' } }))
      }
      if (url.includes('/file/bot')) return Promise.resolve(new Response('Első sor.\nMásodik sor.'))
      return Promise.resolve(new Response(null, { status: 200 }))
    }
    const db = memoryDb()
    const env = {
      DB: db,
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_ALLOWED_EMAILS: 'en@example.com',
      TELEGRAM_BOT_USERNAME: 'refinery_bot',
      TELEGRAM_WEBHOOK_SECRET: 'hook',
      REFINERY_SERVE_SECRET: 'titok',
      SERVE_URL: 'http://127.0.0.1:8787',
    }
    const update = {
      update_id: 5,
      message: {
        message_id: 1,
        chat: { id: 42 },
        from: { id: 42 },
        document: { file_id: 'FILE', file_name: 'átirat.txt', file_size: 22 },
      },
    }
    const request = new Request('https://worker.test/telegram', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'hook' },
      body: JSON.stringify(update),
    })
    expect((await worker.fetch(request, env, { waitUntil: () => undefined })).status).toBe(200)
    expect(urls.slice(0, 2)).toEqual([
      'https://api.telegram.org/bottoken/getFile',
      'https://api.telegram.org/file/bottoken/documents/file_1.txt',
    ])
    expect(db.rows).toHaveLength(1)
    expect((db.rows[0] as unknown[]).slice(-3)).toEqual(['FILE', 'átirat.txt', null])
  })

  it('a rossz alakú document 400', async () => {
    const env = {
      DB: memoryDb(),
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_ALLOWED_EMAILS: 'en@example.com',
      TELEGRAM_BOT_USERNAME: 'refinery_bot',
      TELEGRAM_WEBHOOK_SECRET: 'hook',
      REFINERY_SERVE_SECRET: 'titok',
      SERVE_URL: 'http://127.0.0.1:8787',
    }
    const bad = { update_id: 5, message: { message_id: 1, chat: { id: 42 }, from: { id: 42 }, document: { file_id: 1 } } }
    const request = new Request('https://worker.test/telegram', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'hook' },
      body: JSON.stringify(bad),
    })
    expect((await worker.fetch(request, env, { waitUntil: () => undefined })).status).toBe(400)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run worker`
Expected: FAIL — a `download` nem része a `WorkerDeps`-nek, a csatolmányra a videós mondat jön, a `/scan` ismeretlen.

- [ ] **Step 3: Write the implementation**

`worker/src/messages.ts`:

```ts
export const TEXT_ONLY = 'Csak .txt vagy .md fájlt tudok feldolgozni.'
export const SCAN_EMPTY = 'Írd a /scan után a szöveget, vagy küldd fájlként.'
export const DOWNLOAD_FAILED = 'A fájlt nem tudtam letölteni, küldd újra.'
export const SCAN_LONG =
  'A szöveg elérhette a Telegram-üzenet határát, lehet, hogy csonka. Hosszabb átiratot fájlként küldj.'
```

a `readyLine` cseréje:

```ts
export function readyLine(title: string, text = false): string {
  return `${flatTitle(title)}. ${text ? 'A szöveg' : 'A felirat'} megvan.`
}
```

a `HELP_TEXT` első sora után egy sor, és a parancslistában a `/start` elé egy:

```ts
  'Küldj egy YouTube-linket, és letöltöm a feliratát.',
  'Csatolt .txt vagy .md átiratot is feldolgozok.',
  '',
  '/scan <szöveg> – beillesztett átirat feldolgozása (egy üzenetnyi)',
  '/start – a bot összekötése a Google-fiókoddal',
```

`worker/src/plan.ts`: a `messages.js` re-export listájába `TEXT_ONLY, SCAN_EMPTY, DOWNLOAD_FAILED, SCAN_LONG,`.

`worker/src/handle.ts`:
- importok: a `plan.js` listába `DOWNLOAD_FAILED, SCAN_EMPTY, SCAN_LONG, TEXT_ONLY,`, és:

```ts
import {
  MAX_TEXT_BYTES,
  TEXT_EXTENSIONS,
  isTextItemId,
  normalizeText,
  splitSubtitleName,
  textItemId,
  tooLargeMessage,
} from 'transcript-refinery/text'
```

- `PlannedKnock` végére:

```ts
  /** Szöveges tétel: a normalizált szöveg, a cím és a fájlnév nyelvkódja; a serve ebből tölti az R2-t. */
  text?: string
  title?: string
  textLang?: string
```

- `WorkerDeps`-be a `probe` után:

```ts
  /** A Telegram-csatolmány bájtjai (`getFile`, majd a fájl-URL); `null`, ha nem sikerült. */
  download: (fileId: string) => Promise<Uint8Array | null>
```

- a `COMMAND` konstans alá:

```ts
const SCAN = /^\/scan(?:@\w+)?(?:\s+([\s\S]*))?$/
/** A Telegram 4096 karakternél bont, mondathatáron, így az első darab rövidebb is lehet. */
const SCAN_WARN_AT = 3900
const TITLE_MAX = 80

type TelegramDocument = { file_id: string; file_name?: string; file_size?: number }
type TextJob = { videoId: string; title: string; text: string; fileId: string | null; fileName: string | null }

/** A szöveges mag hibája (`a fájl üres`) a botban mondatként. */
function sentence(message: string): string {
  return `${message.charAt(0).toUpperCase()}${message.slice(1)}.`
}

/** Szöveges tételnél a cím, videónál az azonosító, ahogy ma. */
function label(row: JobRow): string {
  return isTextItemId(row.videoId) ? (row.title ?? row.videoId) : row.videoId
}

/** Csatolmányból vagy `/scan`-ből a szöveges tétel; `string` a visszaküldendő mondat, `null`, ha nem szöveges bemenet. */
async function textInput(
  message: { text?: string; document?: TelegramDocument },
  deps: WorkerDeps,
): Promise<{ job: TextJob; warn: boolean } | string | null> {
  const doc = message.document
  if (doc !== undefined) {
    const fileName = doc.file_name ?? ''
    const name = splitSubtitleName(fileName, TEXT_EXTENSIONS)
    if (name === null) return TEXT_ONLY
    if ((doc.file_size ?? 0) > MAX_TEXT_BYTES) return sentence(tooLargeMessage(doc.file_size ?? 0))
    const bytes = await deps.download(doc.file_id)
    if (bytes === null) return DOWNLOAD_FAILED
    let text: string
    try {
      text = normalizeText(bytes, fileName.toLowerCase().endsWith('.md'))
    } catch (error) {
      return sentence((error as Error).message)
    }
    return { job: { videoId: await textItemId(text), title: name.base, text, fileId: doc.file_id, fileName }, warn: false }
  }
  const scan = SCAN.exec(message.text ?? '')
  if (scan === null) return null
  let text: string
  try {
    text = normalizeText(new TextEncoder().encode(scan[1] ?? ''), false)
  } catch {
    // Egy Telegram-szöveg nem lehet bináris és 2 MB-os sem: a valós hiba csak az üresség.
    return SCAN_EMPTY
  }
  const first = text.split('\n').find((line) => line.trim() !== '') ?? text
  const title = [...first.trim()].slice(0, TITLE_MAX).join('')
  return {
    job: { videoId: await textItemId(text), title, text, fileId: null, fileName: null },
    warn: (message.text ?? '').length >= SCAN_WARN_AT,
  }
}

function textKnock(row: JobRow, text: string): PlannedKnock {
  const knock: PlannedKnock = { jobId: row.jobId, videoId: row.videoId, url: row.url, text, title: row.title ?? row.videoId }
  const lang = row.fileName ? splitSubtitleName(row.fileName, TEXT_EXTENSIONS)?.language : null
  if (lang) knock.textLang = lang
  return knock
}

/**
 * A sor kopogtatása. Szöveges sornál a szöveg a D1-ből, vagy a csatolmány
 * újraletöltéséből; `null`, ha a letöltés nem sikerült (a hívó `down`-nak veszi).
 */
async function jobKnock(row: JobRow, deps: WorkerDeps): Promise<PlannedKnock | null> {
  if (row.text) return textKnock(row, row.text)
  if (row.fileId && row.fileName) {
    const bytes = await deps.download(row.fileId)
    if (bytes === null) return null
    try {
      return textKnock(row, normalizeText(bytes, row.fileName.toLowerCase().endsWith('.md')))
    } catch {
      // A file_id tartalma nem változik, és a beérkezéskor átment: ide nem jutunk.
      return null
    }
  }
  return { jobId: row.jobId, videoId: row.videoId, url: row.url }
}

async function textRow(
  updateId: number,
  messageId: number,
  chatId: string,
  sub: string,
  input: { job: TextJob; warn: boolean },
  deps: WorkerDeps,
): Promise<{ status: number; knocks: PlannedKnock[] }> {
  const { job, warn } = input
  const lines: string[] = []
  const knocks: PlannedKnock[] = []
  if (await deps.store.activeByVideo(job.videoId)) {
    lines.push(alreadyLine(job.title))
  } else {
    const row: JobRow = {
      jobId: `${updateId}:${job.videoId}`,
      updateId,
      chatId,
      messageId,
      videoId: job.videoId,
      url: '',
      status: 'queued',
      error: null,
      title: job.title,
      notifiedReady: false,
      acceptedAt: null,
      sub,
      fileId: job.fileId,
      fileName: job.fileName,
      // A csatolmány a file_id-ből újra letölthető, a beillesztett szöveg nem.
      text: job.fileId === null ? job.text : null,
    }
    await deps.store.insert(row)
    lines.push(queuedLine(job.title))
    knocks.push(textKnock(row, job.text))
  }
  if (warn) lines.push(SCAN_LONG)
  await deps.send(chatId, lines.join('\n'))
  return { status: 200, knocks }
}
```

- a `handleUpdate` paraméterének `message` típusa bővül: `document?: TelegramDocument; caption?: string`;
- a `handleUpdate`-ben a `listByUpdate` ellenőrzés után, a `linesForMessage` elé:

```ts
  const input = await textInput(message, deps)
  if (typeof input === 'string') {
    await deps.send(chatId, input)
    return { status: 200, knocks: [] }
  }
  if (input !== null) return textRow(update.update_id, message.message_id, chatId, binding.sub, input, deps)
```

- a `settle`-ben: `const sent = await deps.send(row.chatId, waitingLine(label(row)))`;
- a `requestRun`-ban mindkét `alreadyLine(row.videoId)` → `alreadyLine(label(row))`;
- a `handleCallback`-ben: `const sent = await deps.send(row.chatId, readyLine(body.title, isTextItemId(row.videoId)), recipeKeyboard(row.jobId))`;
- a `handleCron` első ciklusa:

```ts
  for (const row of await deps.store.due(deps.now())) {
    const knock = await jobKnock(row, deps)
    await settle(row, row, () => deps.store.save(row), knock === null ? 'down' : await deps.knock(knock), deps)
  }
```

`worker/src/index.ts`:
- a `deps()`-ben a `probe` után:

```ts
    download: async (fileId) => {
      try {
        const meta = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ file_id: fileId }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (!meta.ok) return null
        const body = (await meta.json()) as { result?: { file_path?: unknown } }
        const path = body.result?.file_path
        if (typeof path !== 'string') return null
        const file = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        return file.ok ? new Uint8Array(await file.arrayBuffer()) : null
      } catch {
        return null
      }
    },
```

- az `isUpdate` visszatérési típusában a `message` kiegészül `document?: { file_id: string; file_name?: string; file_size?: number }; caption?: string`-gel, és a `return hasNumericId(message.chat)` elé:

```ts
  const document = (update.message as { document?: unknown }).document
  if (document !== undefined) {
    if (typeof document !== 'object' || document === null) return false
    const fields = document as { file_id?: unknown; file_name?: unknown; file_size?: unknown }
    if (typeof fields.file_id !== 'string') return false
    if (fields.file_name !== undefined && typeof fields.file_name !== 'string') return false
    if (fields.file_size !== undefined && typeof fields.file_size !== 'number') return false
  }
```

`docs/operations/telegram-worker-topology.md`, a bemenetek táblázatában a `**Bármilyen egyéb szöveg**` sor elé:

```markdown
| **Csatolt `.txt`/`.md` fájl** (parancs nélkül, legfeljebb 2 MB) | A Worker letölti, normalizálja, `t-…` azonosítót számol; a serve az R2-be teszi (`videos/<t-id>/text.txt`) | `Sorba került: <cím>`, kész: `<cím>. A szöveg megvan.` |
| **`/scan <szöveg>`** (egy üzenetnyi) | Ugyanígy; a cím az első sor, a szöveg a D1-ben vár, amíg a serve át nem veszi | `Sorba került: <cím>`; 3900 karaktertől figyelmeztetés |
| **Más csatolmány** | Nem indít feladatot | `Csak .txt vagy .md fájlt tudok feldolgozni.` |
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run worker` majd a teljes ellenőrzés (`pnpm build` a Worker típusellenőrzése előtt).
Expected: PASS; a meglévő link-, recept-, cron- és `/cancel`-tesztek változatlanul zöldek.

- [ ] **Step 5: Commit**

```bash
git add worker/src/messages.ts worker/src/plan.ts worker/src/handle.ts worker/src/index.ts worker/src/handle.test.ts worker/src/entry.test.ts docs/operations/telegram-worker-topology.md
git commit   # commit-message skill; pl. "feat(worker): Accept text attachments and /scan"
```

---

## Kiadás (a kód-PR merge-e után, a terven kívül)

A bevált menet ([[kiadas-minden-spec-utan]]): v1.18.0 changelog + `bumpp` PR-en át, tag; `pnpm docker:publish` (a serve változik), a peter-mba konténer frissítése; `pnpm worker:migrate` **a** `pnpm worker:deploy` **előtt**; a `/scan` a BotFather-parancslistába; éles próba egy `.txt` csatolmánnyal és egy `/scan` szöveggel. Utána a #206 zárható.

## Spec-lefedettség

| Spec-szakasz | Task |
|---|---|
| 1. Közös normalizálás, `transcript-refinery/text` | Task 1 |
| 2. Worker: felismerés, azonosító, sor, kopogtatás, súgó | Task 4 (sor), Task 5 |
| 3. Serve: átvétel | Task 2 |
| 3. Serve: futás koppintásra | Task 3 |
| 4. Hibakezelés | Task 2 (azonosító-eltérés), Task 5 (Worker-mondatok) |
| 5. Tesztek | minden task 1. lépése |
| 6. Kiadás és telepítés | Kiadás szakasz |
