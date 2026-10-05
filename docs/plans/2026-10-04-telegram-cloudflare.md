# Telegram-felirat az R2-be — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A saját Telegram-chat YouTube-videójának felirata és `info.json` fájlja a `refinery serve` folyamaton át az R2-be kerül, és a bot visszamondja a címet.

**Architecture:** A Worker ajtó: webhook, D1, cron, Telegram. A konténer a gyökércsomag új `refinery serve` parancsa, a `src/serve/` alatt. A serve a meglévő fetch-utat függvényként hívja, SigV4-gyel tölt fel az R2-be, és visszahívja a Workert. Külön `container/` csomag nincs. A `worker/` csomag a `web/` mellett él.

**Tech Stack:** Node.js `>=26.2.0`, TypeScript, Vitest, `node:http`, `node:crypto`, `node:fetch`. Cloudflare Worker és D1 a `worker/` csomagban, wrangler-konfiggal, wrangler csomag nélkül. Új npm-függőség nincs.

**Spec:** `docs/plans/2026-10-04-telegram-cloudflare-spec.md`

Az implementáció a `main` ágról indul, `feat/telegram-serve` ágon. Worktree az indításkor készül, ha a választott végrehajtás azt kéri.

## Global Constraints

- Csak az első szelet. A vault, a `_queue.md`, a recept, a `run`, a Google-kötés, az olvasó oldal, a lejátszási lista feldolgozása, a LiteLLM és a költségplafon kimarad.
- A `serve` a fetch-utat függvényként hívja. A csővezetéket és a `.state/refinery.db` fájlt nem nyitja meg. Az `src/index.ts` barrelt nem bővíti.
- A fetch hívás argv-ja: `['subtitle', url, '--out', outDir, '--flat']`. `--sub-format` nincs. A sorrend a fetch alapja: `vtt/srt`. `--convert-subs` nincs.
- A nyelv a config `languages` listája, üres lista esetén `hu,en`. Új config-kulcs nincs.
- Az R2-kulcs: `videos/<videóazonosító>/<nyelv>.<kiterjesztés>` és `videos/<videóazonosító>/info.json`. A kiterjesztés `vtt` vagy `srt`, ahogy a fájl létrejött.
- A készlet az `alreadyFetched` szabálya: legalább egy nem üres, a beállított nyelvek egyikére illő felirat, és az `info.json`, amelynek az `id` mezője a videó. `en` kérésre `en-US` illik.
- YouTube kimarad, ha az R2-készlet teljes, vagy ha az R2 hiányos, de a helyi pár teljes. Hiányos helyi párnál a serve törli a videó helyi fájljait, majd overwrite nélkül hívja a fetch-et.
- A közös titok fejléce mindkét irányban: `Authorization: Bearer <REFINERY_SERVE_SECRET>`.
- A serve csak a `127.0.0.1` címen hallgat. A `SERVE_PORT` alapja `8787`.
- A D1 ismétléskulcsa a Telegram `update_id`: a másodpéldány `200`, új sor és kopogtatás nélkül.
- Állapotok: `queued`, `waiting`, `accepted`, `ready`, `failed`. A sor `ready` csak sikeres Telegram-küldés után. A `failed` sort a cron nem éleszti.
- A cron percenként fut. Az ébredős üzenet csak a `queued` → `waiting` váltáskor megy ki. A tizenöt percnél régebbi `accepted` sort ugyanazzal a `jobId` értékkel kopogtatja.
- A feltöltés háromszor próbálkozik, utána a mondat: `A feltöltés nem sikerült.`
- A hiányzó `yt-dlp` mondata szó szerint: `A yt-dlp nem található a PATH-on. Telepítés: brew install yt-dlp vagy mise use yt-dlp`
- A felirat hiánya: `Nincs felirat`. A rossz titok: `A konténer elutasította a hívást.`
- A teszt nem éri el a YouTube-ot, a Telegramot, az R2-t, a Tunnelt, és nem épít Docker-képet.
- A `pnpm test` a munka végén zöld. Új tesztfüggőség nincs.

## Review Focus

Ezek a bemenetek a specből következnek, és egy elnézett ág rossz fájlt tárol vagy kétszer ír a felhasználónak. Mindegyikhez a tulajdonos feladat tartalmaz tesztet.

1. A `watch?v=<id>&list=<lista>` cím videó, a `summary` szó nem kap `Nem YouTube-cím` sort. (6. feladat)
2. Egy illeszkedő nyelv felirata és az `info.json` készlet, akkor is, ha a config másik nyelvet is kér. A következő munka a YouTube-ot kihagyja. (1. és 3. feladat)
3. Ugyanaz a `jobId`, amíg a munka tart, újra `202`, második fetch nélkül. Másik munka `409`. (4. feladat)
4. Az ismételt `update_id` nem ír sort és nem kopogtat. (6. feladat)
5. Az ébredős üzenet és a kész üzenet csak egyszer megy ki. Sikertelen Telegram-küldésnél a sor `accepted` marad. (6. feladat)

## File Structure

| Fájl | Felelősség |
|---|---|
| `src/serve/inventory.ts` | Helyi pár vizsgálata, törlése, R2-kulcs |
| `src/serve/r2.ts` | SigV4 és az objektumtár |
| `src/serve/job.ts` | Egy munka: R2, helyi pár, fetch, feltöltés, visszahívás |
| `src/serve/http.ts` | HTTP-kapu, titok, egy munka egyszerre |
| `src/serve/command.ts` | `refinery serve` belépés, env, a fetch bekötése |
| `src/cli.ts` | `serve` ág a közös elemző előtt, `USAGE` |
| `worker/src/messages.ts` | A spec mondatai |
| `worker/src/plan.ts` | Üzenetből terv, állapotváltás, cron |
| `worker/src/store.ts` | `JobStore` és a memóriabeli megvalósítás |
| `worker/src/d1.ts` | D1-adapter, teszt nélkül, a `JobStore` mögött |
| `worker/src/index.ts` | Webhook, cron, `waitUntil` |
| `worker/wrangler.toml` | Worker név, D1 `DB`, percenkénti cron |
| `worker/migrations/0001_jobs.sql` | A sor táblája |
| `Dockerfile` | Node 26.2, `yt-dlp`, `CMD refinery serve` |
| `package.json` | `./classify` export |
| `pnpm-workspace.yaml` | `worker` |
| `vitest.config.ts` | A `worker/**/*.test.ts` és a classify alias |

---

### Task 1: A helyi feliratkészlet

**Files:**
- Create: `src/serve/inventory.ts`
- Test: `src/serve/inventory.test.ts`

**Interfaces:**
- Consumes: semmit. A fájlnév-minta egyezzen a `src/fetch/subtitle/skip.ts` `SUB` és `INFO` kifejezésével.
- Produces:
  - `export interface SubtitleFile { language: string; extension: 'vtt' | 'srt'; absolutePath: string }`
  - `export interface LocalPair { complete: boolean; title: string; files: SubtitleFile[]; infoPath: string | null }`
  - `export function subtitleKey(videoId: string, language: string, extension: string): string` → `videos/<videoId>/<language>.<extension>`
  - `export function infoKey(videoId: string): string` → `videos/<videoId>/info.json`
  - `export function readLocalPair(dir: string, videoId: string, languages: readonly string[]): Promise<LocalPair>`
  - `export function deleteLocalPair(dir: string, videoId: string): Promise<void>`
  - A `title` az `info.json` `title` mezője, üres mezőnél a `videoId`. A `complete` az `alreadyFetched` szabálya: igaz, ha van legalább egy nem üres, prefix szerint illő felirat, és az info `id` mezője a videó. `en` kérésre `en-US` illik. `en-US` kérésre a puszta `en` nem illik.

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { deleteLocalPair, infoKey, readLocalPair, subtitleKey } from './inventory.js'

const ID = 'abcdefghijk'
let dir: string

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

async function setup(): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), 'serve-pair-'))
}

describe('readLocalPair', () => {
  it('egy illeszkedő nyelv és az info kész, akkor is, ha en is a listán van', async () => {
    await setup()
    await writeFile(join(dir, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(dir, `Cím [${ID}].info.json`), JSON.stringify({ id: ID, title: 'Cím' }))
    const pair = await readLocalPair(dir, ID, ['hu', 'en'])
    expect(pair.complete).toBe(true)
    expect(pair.files.map((file) => file.language)).toEqual(['hu'])
    expect(subtitleKey(ID, 'hu', 'vtt')).toBe(`videos/${ID}/hu.vtt`)
    expect(infoKey(ID)).toBe(`videos/${ID}/info.json`)
  })

  it('felirat nélkül vagy üres felirattal a pár nem kész', async () => {
    await setup()
    await writeFile(join(dir, `Cím [${ID}].info.json`), JSON.stringify({ id: ID, title: 'Cím' }))
    await writeFile(join(dir, `Cím [${ID}].hu.vtt`), '')
    const pair = await readLocalPair(dir, ID, ['hu', 'en'])
    expect(pair.complete).toBe(false)
  })

  it('hu.vtt és en.srt együtt kész, a cím az info title mezője', async () => {
    await setup()
    await writeFile(join(dir, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(dir, `Cím [${ID}].en.srt`), '1\n')
    await writeFile(join(dir, `Cím [${ID}].info.json`), JSON.stringify({ id: ID, title: 'Cím' }))
    const pair = await readLocalPair(dir, ID, ['hu', 'en'])
    expect(pair.complete).toBe(true)
    expect(pair.title).toBe('Cím')
  })

  it('az en kérésre az en-US fájl illik', async () => {
    await setup()
    await writeFile(join(dir, `Cím [${ID}].en-US.vtt`), 'WEBVTT\n')
    await writeFile(join(dir, `Cím [${ID}].info.json`), JSON.stringify({ id: ID, title: '' }))
    const pair = await readLocalPair(dir, ID, ['en'])
    expect(pair.complete).toBe(true)
    expect(pair.title).toBe(ID)
    expect(pair.files[0]?.language).toBe('en-US')
  })

  it('a deleteLocalPair csak ennek a videónak a fájlját törli', async () => {
    await setup()
    const other = 'z2345678901'
    await writeFile(join(dir, `Cím [${ID}].hu.vtt`), 'WEBVTT\n')
    await writeFile(join(dir, `Cím [${ID}].info.json`), '{}')
    await writeFile(join(dir, `Más [${other}].hu.vtt`), 'WEBVTT\n')
    await deleteLocalPair(dir, ID)
    const gone = await readLocalPair(dir, ID, ['hu'])
    const kept = await readLocalPair(dir, other, ['hu'])
    expect(gone.files).toEqual([])
    expect(kept.files).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/serve/inventory.test.ts`
Expected: FAIL, a `./inventory.js` modul hiányzik.

- [ ] **Step 3: Write minimal implementation**

A `readLocalPair` a mappa egy szintjét olvassa. Hiányzó mappa: üres, nem kész pár. A `complete` az `alreadyFetched` szabálya: egy nem üres, illeszkedő felirat és érvényes info elég. Üres feliratfájl nem számít. Az info csak akkor számít, ha az `id` mező a videó. A nyelvi illeszkedés: a fájl címkéje kisbetűsen a kért kóddal kezdődik. A `deleteLocalPair` minden olyan fájlt töröl, amelynek a neve erre a 11 karakteres azonosítóra illik a fenti két mintával, más videót nem.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/serve/inventory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/serve/inventory.ts src/serve/inventory.test.ts
git commit -m "feat: read a serve subtitle pair from the fetch folder"
```

---

### Task 2: Az R2-tár

**Files:**
- Create: `src/serve/r2.ts`
- Test: `src/serve/r2.test.ts`

**Interfaces:**
- Consumes: semmit
- Produces:
  - `export interface ObjectStore { list(prefix: string): Promise<string[]>; put(key: string, body: Uint8Array): Promise<void>; get(key: string): Promise<Uint8Array | null> }`
  - `export interface R2Config { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string }`
  - `export function signR2(input: { method: 'GET' | 'PUT' | 'HEAD'; key: string; body: Uint8Array; now: Date; config: R2Config }): { url: string; headers: Record<string, string> }`
  - `export function createR2Store(config: R2Config, fetchImpl?: typeof fetch, now?: () => Date): ObjectStore`
  - A URL: `https://<accountId>.r2.cloudflarestorage.com/<bucket>/<key>`. A régió `auto`, a szolgáltatás `s3`. A `list` a `GET /<bucket>?list-type=2&prefix=<prefix>` hívás, és a válasz `<Key>` elemeit adja. A `put` nem 2xx válaszra dob. A `get` 404-re `null`. A készletvizsgálat a listát használja, mert a kulcs nyelve a fájl címkéje (`en` vagy `en-US`), nem mindig a config kódja.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { createR2Store, signR2, type R2Config } from './r2.js'

const config: R2Config = {
  accountId: 'account',
  bucket: 'refinery',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
}

describe('signR2', () => {
  it('a rögzített PUT kérés aláírása stabil', () => {
    const signed = signR2({
      method: 'PUT',
      key: 'videos/abcdefghijk/hu.vtt',
      body: new TextEncoder().encode('felirat'),
      now: new Date('2015-08-30T12:36:00Z'),
      config,
    })
    expect(signed.url).toBe(
      'https://account.r2.cloudflarestorage.com/refinery/videos/abcdefghijk/hu.vtt',
    )
    expect(signed.headers['x-amz-date']).toBe('20150830T123600Z')
    expect(signed.headers['x-amz-content-sha256']).toBe(
      '596a51f53168cadf8af76759ff459b3b921a2ca55ec12a46a93a5ed8b9671aa6',
    )
    expect(signed.headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/auto/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=5bc2cef8a7d0afd039032397e4e866058a8b430a2265f5313e7f0cf7ff077494',
    )
  })
})

describe('createR2Store', () => {
  it('a list üres kulcslistát ad, a put a törzset küldi, a get visszaadja', async () => {
    const calls: { method: string; url: string; body: string }[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const method = init?.method ?? 'GET'
      calls.push({
        method,
        url: String(input),
        body: typeof init?.body === 'string' ? init.body : '',
      })
      if (method === 'GET' && String(input).includes('list-type=2')) {
        return new Response('<ListBucketResult></ListBucketResult>', { status: 200 })
      }
      if (method === 'PUT') return new Response(null, { status: 200 })
      return new Response('felirat', { status: 200 })
    }
    const store = createR2Store(config, fetchImpl, () => new Date('2015-08-30T12:36:00Z'))
    expect(await store.list('videos/abcdefghijk/')).toEqual([])
    await store.put('videos/abcdefghijk/hu.vtt', new TextEncoder().encode('felirat'))
    expect(calls[1]?.method).toBe('PUT')
    expect(calls[1]?.url).toContain('/refinery/videos/abcdefghijk/hu.vtt')
    const got = await store.get('videos/abcdefghijk/info.json')
    expect(new TextDecoder().decode(got ?? new Uint8Array())).toBe('felirat')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/serve/r2.test.ts`
Expected: FAIL, a `./r2.js` modul hiányzik.

- [ ] **Step 3: Write minimal implementation**

A `signR2` a SigV4 kanonikus kérést ezekből a fejlécekből építi, ebben a sorrendben: `host`, `x-amz-content-sha256`, `x-amz-date`. A `payload hash` üres `HEAD` és `GET` törzsnél az üres bájtsor hash-e. Az aláíró kulcs: `AWS4` + secret, majd a dátum, az `auto`, az `s3`, az `aws4_request`. A `createR2Store` ezt a fejlécet adja a `fetchImpl`-nek. A kulcs szegmenseit `encodeURIComponent` kódolja, a perjel a kulcsban marad.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/serve/r2.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/serve/r2.ts src/serve/r2.test.ts
git commit -m "feat: sign R2 uploads from the serve process"
```

---

### Task 3: Egy munka lefuttatása

**Files:**
- Create: `src/serve/job.ts`
- Test: `src/serve/job.test.ts`

**Interfaces:**
- Consumes:
  - `readLocalPair`, `deleteLocalPair`, `subtitleKey`, `infoKey`, `LocalPair` a `src/serve/inventory.ts` fájlból
  - `ObjectStore` a `src/serve/r2.ts` fájlból
  - `YTDLP_MISSING` a `src/fetch/subtitle/ytdlp.ts` fájlból
- Produces:
  - `export interface ServeJob { jobId: string; videoId: string; url: string }`
  - `export type CallbackBody = { status: 'ready'; title: string } | { status: 'failed'; error: string }`
  - `export interface JobEffects { store: ObjectStore; languages: readonly string[]; readPair: (videoId: string) => Promise<LocalPair>; deletePair: (videoId: string) => Promise<void>; readFile: (path: string) => Promise<Uint8Array>; fetchSubtitle: (url: string) => Promise<{ code: number; stdout: string; stderr: string }>; callback: (jobId: string, body: CallbackBody) => Promise<void> }`
  - `export async function runJob(job: ServeJob, effects: JobEffects): Promise<void>`
  - `export function subtitleArgv(url: string, outDir: string): string[]` → `['subtitle', url, '--out', outDir, '--flat']`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { YTDLP_MISSING } from '../fetch/subtitle/ytdlp.js'
import type { LocalPair } from './inventory.js'
import type { ObjectStore } from './r2.js'
import { runJob, subtitleArgv, type CallbackBody } from './job.js'

const ID = 'abcdefghijk'
const job = { jobId: 'job-1', videoId: ID, url: `https://www.youtube.com/watch?v=${ID}` }

function memoryStore(initial: Record<string, Uint8Array> = {}): ObjectStore & { objects: Record<string, Uint8Array> } {
  const objects = { ...initial }
  return {
    objects,
    list: async (prefix) => Object.keys(objects).filter((key) => key.startsWith(prefix)),
    put: async (key, body) => {
      objects[key] = body
    },
    get: async (key) => objects[key] ?? null,
  }
}

function pair(partial: Partial<LocalPair>): LocalPair {
  return {
    complete: false,
    title: ID,
    files: [],
    infoPath: null,
    ...partial,
  }
}

describe('subtitleArgv', () => {
  it('flat kimenetet kér, formátumot nem', () => {
    expect(subtitleArgv(job.url, '/out')).toEqual(['subtitle', job.url, '--out', '/out', '--flat'])
  })
})

describe('runJob', () => {
  it('egy illeszkedő R2-felirat és az info elég, a fetch nem indul', async () => {
    const info = new TextEncoder().encode(JSON.stringify({ id: ID, title: 'Kész cím' }))
    const store = memoryStore({
      [`videos/${ID}/hu.vtt`]: new Uint8Array([1]),
      [`videos/${ID}/info.json`]: info,
    })
    const calls: string[] = []
    const callbacks: CallbackBody[] = []
    await runJob(job, {
      store,
      languages: ['hu', 'en'],
      readPair: async () => pair({}),
      deletePair: async () => {
        calls.push('delete')
      },
      readFile: async () => info,
      fetchSubtitle: async () => {
        calls.push('fetch')
        return { code: 0, stdout: '', stderr: '' }
      },
      callback: async (_id, body) => {
        callbacks.push(body)
      },
    })
    expect(calls).toEqual([])
    expect(callbacks).toEqual([{ status: 'ready', title: 'Kész cím' }])
  })

  it('hiányos helyi párt töröl, majd letölt', async () => {
    const store = memoryStore()
    const calls: string[] = []
    let local = pair({
      files: [{ language: 'hu', extension: 'vtt', absolutePath: '/out/a.hu.vtt' }],
      title: 'Fél',
    })
    await runJob(job, {
      store,
      languages: ['hu', 'en'],
      readPair: async () => local,
      deletePair: async () => {
        calls.push('delete')
        local = pair({})
      },
      readFile: async () => new Uint8Array(),
      fetchSubtitle: async () => {
        calls.push('fetch')
        local = pair({
          complete: true,
          title: 'Új',
          files: [
            { language: 'hu', extension: 'vtt', absolutePath: '/out/a.hu.vtt' },
            { language: 'en', extension: 'srt', absolutePath: '/out/a.en.srt' },
          ],
          infoPath: '/out/a.info.json',
        })
        return { code: 0, stdout: '[OK]   Új', stderr: '' }
      },
      callback: async () => {},
    })
    expect(calls).toEqual(['delete', 'fetch'])
    expect(store.objects[`videos/${ID}/hu.vtt`]).toBeDefined()
    expect(store.objects[`videos/${ID}/en.srt`]).toBeDefined()
    expect(store.objects[`videos/${ID}/info.json`]).toBeDefined()
  })

  it('a nulla felirat mondta Nincs felirat, feltöltés nélkül', async () => {
    const store = memoryStore()
    const callbacks: CallbackBody[] = []
    await runJob(job, {
      store,
      languages: ['hu'],
      readPair: async () => pair({}),
      deletePair: async () => {},
      readFile: async () => new Uint8Array(),
      fetchSubtitle: async () => ({
        code: 1,
        stdout: `[SKIP] Nincs felirat: Cím [${ID}]`,
        stderr: '',
      }),
      callback: async (_id, body) => {
        callbacks.push(body)
      },
    })
    expect(Object.keys(store.objects)).toEqual([])
    expect(callbacks).toEqual([{ status: 'failed', error: 'Nincs felirat' }])
  })

  it('a hiányzó yt-dlp a fetch mondatát adja', async () => {
    const callbacks: CallbackBody[] = []
    await runJob(job, {
      store: memoryStore(),
      languages: ['hu'],
      readPair: async () => pair({}),
      deletePair: async () => {},
      readFile: async () => new Uint8Array(),
      fetchSubtitle: async () => ({ code: 1, stdout: '', stderr: YTDLP_MISSING }),
      callback: async (_id, body) => {
        callbacks.push(body)
      },
    })
    expect(callbacks).toEqual([{ status: 'failed', error: YTDLP_MISSING }])
  })

  it('a harmadik sikertelen put után a mondat A feltöltés nem sikerült', async () => {
    let puts = 0
    const store = memoryStore()
    store.put = async () => {
      puts += 1
      throw new Error('r2')
    }
    const callbacks: CallbackBody[] = []
    const bytes = new TextEncoder().encode('x')
    await runJob(job, {
      store,
      languages: ['hu'],
      readPair: async () =>
        pair({
          complete: true,
          title: 'Cím',
          files: [{ language: 'hu', extension: 'vtt', absolutePath: '/out/a.hu.vtt' }],
          infoPath: '/out/a.info.json',
        }),
      deletePair: async () => {},
      readFile: async () => bytes,
      fetchSubtitle: async () => {
        throw new Error('nem hívható')
      },
      callback: async (_id, body) => {
        callbacks.push(body)
      },
    })
    expect(puts).toBe(3)
    expect(callbacks).toEqual([{ status: 'failed', error: 'A feltöltés nem sikerült.' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/serve/job.test.ts`
Expected: FAIL, a `./job.js` modul hiányzik.

- [ ] **Step 3: Write minimal implementation**

A `runJob` sorrendje:

1. A `list('videos/<videoId>/')` eredményén ugyanaz a nyelvi szabály dönt, mint a helyi páron. Ha a készlet teljes, a cím az info objektum `title` mezője, üres mezőnél a videóazonosító. Visszahívás `ready`. Fetch nincs.
2. Ha a helyi pár `complete`, arról tölt fel. Fetch nincs.
3. Egyébként `deletePair`, majd `fetchSubtitle`. Ha a stderr tartalmazza a `YTDLP_MISSING` szöveget, a visszahívás `failed` ezzel a mondattal. Ha a stdout tartalmazza a `Nincs felirat` szöveget, a visszahívás `failed` a `Nincs felirat` mondattal. Más nem nulla kódnál a visszahívás `failed`, a stdout első sora, ennek híján a stderr első sora.
4. Sikeres fetch után újraolvassa a helyi párt, és a kiírt fájlokat tölti fel. Nulla fájlnál feltöltés nincs.
5. A `put` hibájára legfeljebb háromszor próbálkozik. Utána `failed`: `A feltöltés nem sikerült.`
6. A visszahívás hibája nem dob ki a folyamatból. A hiba a hívó naplójára kerül, a függvény visszatér.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/serve/job.test.ts src/serve/inventory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/serve/job.ts src/serve/job.test.ts
git commit -m "feat: run one serve job through fetch and R2"
```

---

### Task 4: A HTTP-kapu és a `refinery serve`

**Files:**
- Create: `src/serve/http.ts`
- Create: `src/serve/command.ts`
- Test: `src/serve/http.test.ts`
- Modify: `src/cli.ts` (a `USAGE` parancslistája és a `main` eleje, a `fetch` ág mellett)
- Test: `src/cli.test.ts` (egy új `it` a meglévő USAGE tesztek mellett)

**Interfaces:**
- Consumes: `runJob`, `ServeJob`, `JobEffects`, `subtitleArgv` a `src/serve/job.ts` fájlból. `commandFetch` a `src/fetch/command.ts` fájlból. `loadCliConfig` a `src/config.ts` fájlból.
- Produces:
  - `export interface ServeGate { current: string | null }`
  - `export function acceptJob(gate: ServeGate, jobId: string): 202 | 409`
  - `export function createServeServer(input: { secret: string; gate: ServeGate; onJob: (job: ServeJob) => Promise<void> }): http.Server`
  - `export async function commandServe(env: NodeJS.ProcessEnv): Promise<number>`
  - A kapu a `POST /jobs` útvonalat hallgatja. A test JSON: `{ jobId, videoId, url }`. Rossz vagy hiányzó Bearer: `401`, a munka nem indul. Az első `202` elindul az `onJob`, de a válasz nem várja meg. Ugyanaz a `jobId`, amíg a `gate.current` ő, újra `202`, második `onJob` nélkül. Másik `jobId`: `409`. Az `onJob` promise `finally` ága `null`-ra teszi a `gate.current` mezőt. A kimeneti mappa a `SERVE_OUT`. Hiányzó kötelező env: stderrre a neve, kilépés `1`.

- [ ] **Step 1: Write the failing test**

```ts
import { once } from 'node:events'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { USAGE, main } from '../cli.js'
import { createServeServer, type ServeGate } from './http.js'

const gate: ServeGate = { current: null }
let server: Server

afterEach(async () => {
  if (server?.listening) {
    server.close()
    await once(server, 'close')
  }
  gate.current = null
})

async function post(port: number, secret: string, body: unknown): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${port}/jobs`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.status
}

describe('createServeServer', () => {
  it('rossz titok 401, az első munka 202, ugyanaz a munka még egyszer 202, a másik 409', async () => {
    const started: string[] = []
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    server = createServeServer({
      secret: 'titok',
      gate,
      onJob: (job) => {
        started.push(job.jobId)
        return held
      },
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as { port: number }).port
    const job = { jobId: 'job-1', videoId: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk' }
    expect(await post(port, 'rossz', job)).toBe(401)
    expect(await post(port, 'titok', job)).toBe(202)
    expect(await post(port, 'titok', job)).toBe(202)
    expect(await post(port, 'titok', { ...job, jobId: 'job-2' })).toBe(409)
    expect(started).toEqual(['job-1'])
    release()
  })
})

describe('serve parancs', () => {
  it('a USAGE felsorolja a serve parancsot', () => {
    expect(USAGE).toContain('serve')
  })

  it('a refinery serve --help a súgót írja, és nem nyit portot', async () => {
    expect(await main(['serve', '--help'])).toBe(0)
  })
})
```

Az `onJob` visszatérési értéke `void | Promise<void>`. A tesztbeli szerver a visszaadott promise `finally` ágában engedi el a kaput. A `401` teszt üres `started` tömböt hagy.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/serve/http.test.ts`
Expected: FAIL, a `./http.js` modul hiányzik.

- [ ] **Step 3: Write minimal implementation**

A `createServeServer` a `node:http` szervere. A titkot `timingSafeEqual` hasonlítja, eltérő hossznál `401`. A `commandServe` beolvassa a `REFINERY_SERVE_SECRET`, a `WORKER_CALLBACK_URL`, a `SERVE_OUT`, a `SERVE_PORT`, az `R2_ACCOUNT_ID`, az `R2_BUCKET`, az `R2_ACCESS_KEY_ID` és az `R2_SECRET_ACCESS_KEY` változót. Hiányzó változónál a stderrre írja a nevét, és `1`-gyel tér vissza. A `202` válasz az `onJob` indítása után azonnal kimegy, a fetch végét nem várja meg. A nyelvet a `loadCliConfig` adja. A fetch bekötése:

```ts
const argv = subtitleArgv(job.url, outDir)
const stdout: string[] = []
const stderr: string[] = []
const code = await commandFetch(argv, {
  stdout: (line) => stdout.push(line),
  stderr: (line) => stderr.push(line),
})
```

A szerver a `127.0.0.1` címre köt. A `src/cli.ts` `main` függvényében a `fetch` ág mellett: ha a parancs `serve`, a `commandServe(process.env)` fut, és a közös `parseArgs` nem látja. Üres `SERVE_OUT` indulási hiba: `Hiányzó SERVE_OUT.` A `USAGE` parancslistájába ez a sor kerül a `fetch subtitle` alá:

```text
  serve           Egy videó feliratát az R2-be tölti. A fetch-utat hívja.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/serve/http.test.ts src/cli.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/serve/http.ts src/serve/command.ts src/serve/http.test.ts src/cli.ts src/cli.test.ts
git commit -m "feat: accept one serve job over the local HTTP port"
```

---

### Task 5: A Worker döntései

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/src/messages.ts`
- Create: `worker/src/store.ts`
- Create: `worker/src/plan.ts`
- Test: `worker/src/plan.test.ts`
- Modify: `package.json` (a `./classify` export)
- Modify: `pnpm-workspace.yaml` (a `worker` sor)
- Modify: `vitest.config.ts` (include és alias)

**Interfaces:**
- Consumes: `classifyInput` a `src/fetch/classify.ts` fájlból, teszten a vitest aliasról, a Worker kódjában a `transcript-refinery/classify` exportról.
- Produces:
  - `export type JobStatus = 'queued' | 'waiting' | 'accepted' | 'ready' | 'failed'`
  - `export interface JobRow { jobId: string; updateId: number; chatId: string; messageId: number; videoId: string; url: string; status: JobStatus; error: string | null; title: string | null; notifiedReady: boolean; acceptedAt: number | null }`
  - `export interface JobStore { listByUpdate(updateId: number): Promise<JobRow[]>; activeByVideo(videoId: string): Promise<JobRow | null>; insert(row: JobRow): Promise<void>; save(row: JobRow): Promise<void>; due(now: number): Promise<JobRow[]> }`
  - `export function memoryStore(): JobStore`
  - `export function linesForMessage(text: string, active: readonly JobRow[]): { lines: string[]; jobs: { videoId: string; url: string }[] }`
  - `export function queuedLine(videoId: string): string`
  - `export function waitingLine(videoId: string): string`
  - `export function readyLine(title: string): string`
  - `export function alreadyLine(videoId: string): string`
  - `export const REJECTED_SECRET = 'A konténer elutasította a hívást.'`
  - A `jobId` alakja `<updateId>:<videoId>`. Az `activeByVideo` a `queued`, `waiting` és `accepted` sort adja. A `due` a `queued`, a `waiting` és a 15 percnél régebbi `accepted` sort adja.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { memoryStore, type JobRow } from './store.js'
import {
  REJECTED_SECRET,
  alreadyLine,
  linesForMessage,
  queuedLine,
  readyLine,
  waitingLine,
} from './plan.js'

const ID = 'abcdefghijk'
const OTHER = 'z2345678901'

function row(partial: Partial<JobRow>): JobRow {
  return {
    jobId: `1:${ID}`,
    updateId: 1,
    chatId: '42',
    messageId: 7,
    videoId: ID,
    url: `https://www.youtube.com/watch?v=${ID}`,
    status: 'queued',
    error: null,
    title: null,
    notifiedReady: false,
    acceptedAt: null,
    ...partial,
  }
}

describe('linesForMessage', () => {
  it('a listás watch cím videó, a summary szó nem sor', () => {
    const planned = linesForMessage(
      `https://www.youtube.com/watch?v=${ID}&list=PL123 summary`,
      [],
    )
    expect(planned.jobs).toEqual([{ videoId: ID, url: `https://www.youtube.com/watch?v=${ID}` }])
    expect(planned.lines).toEqual([queuedLine(ID)])
    expect(planned.lines.join('\n')).not.toContain('Nem YouTube-cím')
  })

  it('a lista külön mondat, az idegen cím is, a puszta szó nem', () => {
    const planned = linesForMessage(
      'https://www.youtube.com/playlist?list=PL123 https://vimeo.com/1 summary',
      [],
    )
    expect(planned.jobs).toEqual([])
    expect(planned.lines).toEqual(['Lejátszási lista későbbre marad.', 'Nem YouTube-cím.'])
  })

  it('videó nélkül a saját mondat megy', () => {
    expect(linesForMessage('summary', []).lines).toEqual(['Nincs YouTube-videó az üzenetben.'])
  })

  it('a queued videó nem nyit új munkát', () => {
    const planned = linesForMessage(`https://youtu.be/${ID}`, [row({ status: 'queued' })])
    expect(planned.jobs).toEqual([])
    expect(planned.lines).toEqual([alreadyLine(ID)])
  })

  it('a ready videó új munkát nyit', () => {
    const planned = linesForMessage(ID, [row({ status: 'ready' })])
    expect(planned.jobs).toHaveLength(1)
  })
})

describe('memoryStore', () => {
  it('az update_id másodpéldánya ugyanazokat a sorokat adja', async () => {
    const store = memoryStore()
    await store.insert(row({}))
    expect(await store.listByUpdate(1)).toHaveLength(1)
    expect(await store.activeByVideo(ID)).not.toBeNull()
    expect(await store.activeByVideo(OTHER)).toBeNull()
  })

  it('a due a friss accepted sort kihagyja, a tizenöt perceset hozza', async () => {
    const store = memoryStore()
    const now = 1_000_000
    await store.insert(row({ jobId: 'a', status: 'accepted', acceptedAt: now }))
    await store.insert(row({
      jobId: 'b',
      updateId: 2,
      videoId: OTHER,
      status: 'accepted',
      acceptedAt: now - 15 * 60 * 1000 - 1,
    }))
    await store.insert(row({ jobId: 'c', updateId: 3, status: 'failed' }))
    const due = await store.due(now)
    expect(due.map((item) => item.jobId)).toEqual(['b'])
  })
})

describe('mondatok', () => {
  it('a spec mondatai', () => {
    expect(queuedLine(ID)).toBe(`Sorba került: ${ID}`)
    expect(waitingLine(ID)).toBe(`A gép ébredésére vár: ${ID}.`)
    expect(readyLine('Cím')).toBe('Cím. A felirat megvan.')
    expect(alreadyLine(ID)).toBe(`Már sorban van: ${ID}.`)
    expect(REJECTED_SECRET).toBe('A konténer elutasította a hívást.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

A `vitest.config.ts` `include` tömbje kapja a `worker/**/*.test.ts` mintát. Az alias a teszt idejére a forrásra mutat:

```ts
import { fileURLToPath } from 'node:url'

resolve: {
  alias: {
    'transcript-refinery/classify': fileURLToPath(new URL('./src/fetch/classify.ts', import.meta.url)),
  },
},
```

A `package.json` exports kap egy `./classify` kulcsot: types `./dist/fetch/classify.d.ts`, default `./dist/fetch/classify.js`. A `pnpm-workspace.yaml` packages listája: `web`, `worker`. A `worker/package.json` neve `transcript-refinery-worker`, privát, `type: module`, függősége `transcript-refinery: workspace:*`. A `worker/tsconfig.json` a gyökér konfigot terjeszti, `noEmit: true`, include `src/**/*.ts`.

Run: `pnpm exec vitest run worker/src/plan.test.ts`
Expected: FAIL, a `./plan.js` modul hiányzik.

- [ ] **Step 3: Write minimal implementation**

A `linesForMessage` whitespace szerint vág. A `://` nélküli, 11 karakteres azonosítótól eltérő szó kimarad. A többi token a `classifyInput(token, false)` eredménye. Videónál, ha az `active` tömbben ugyanez az azonosító `queued`, `waiting` vagy `accepted`, a sor `alreadyLine`, munka nincs. Különben `queuedLine` és egy munka. Listánál a lista mondata. `rejected` és URL-szerű tokennél `Nem YouTube-cím.` Üres munkalista és üres sorlista helyett a videó nélküli mondat.

A `memoryStore` tömbben tartja a sorokat. Az `activeByVideo` a három nyitott állapotot nézi. A `due` a `queued` és `waiting` sorokat, valamint azokat az `accepted` sorokat, amelyeknek `acceptedAt` értéke régebbi, mint `now - 15 * 60 * 1000`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run worker/src/plan.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add worker package.json pnpm-workspace.yaml vitest.config.ts
git commit -m "feat: plan Telegram lines and job rows for the worker"
```

---

### Task 6: Webhook, visszahívás, cron

**Files:**
- Create: `worker/src/handle.ts`
- Test: `worker/src/handle.test.ts`

**Interfaces:**
- Consumes: `JobStore`, `JobRow`, `JobStatus`, `memoryStore` a `worker/src/store.ts` fájlból. `linesForMessage`, `waitingLine`, `readyLine`, `REJECTED_SECRET` a `worker/src/plan.ts` fájlból.
- Produces:
  - `export interface WorkerDeps { ownerChatId: string; store: JobStore; now: () => number; knock: (job: { jobId: string; videoId: string; url: string }) => Promise<202 | 409 | 401 | 'down'>; send: (text: string) => Promise<boolean> }`
  - `export interface PlannedKnock { jobId: string; videoId: string; url: string }`
  - `export async function handleUpdate(update: { update_id: number; message?: { message_id: number; chat: { id: number }; text?: string } }, deps: WorkerDeps): Promise<{ status: number; knocks: PlannedKnock[] }>`
  - `export async function applyKnocks(knocks: readonly PlannedKnock[], deps: WorkerDeps): Promise<void>`
  - `export async function handleCallback(jobId: string, body: { status: 'ready'; title: string } | { status: 'failed'; error: string }, deps: WorkerDeps): Promise<number>`
  - `export async function handleCron(deps: WorkerDeps): Promise<void>`
  - Az idegen chat `200`, `send` és `insert` nélkül. A saját chat `200`. A `handleUpdate` a választ elküldi, és a kopogtatásokat visszaadja, de nem hívja a `knock` függvényt. Az `applyKnocks` és a `handleCron` kopogtat. Ismételt `update_id` `200`, `insert` és üres `knocks` nélkül.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { applyKnocks, handleCallback, handleCron, handleUpdate, type WorkerDeps } from './handle.js'
import { memoryStore, type JobRow } from './store.js'

const ID = 'abcdefghijk'

function deps(store: ReturnType<typeof memoryStore>, over: Partial<WorkerDeps> = {}): WorkerDeps & {
  sent: string[]
  knocked: string[]
} {
  const sent: string[] = []
  const knocked: string[] = []
  return {
    ownerChatId: '42',
    store,
    now: () => 1_000_000,
    sent,
    knocked,
    knock: async (job) => {
      knocked.push(job.jobId)
      return 202
    },
    send: async (text) => {
      sent.push(text)
      return true
    },
    ...over,
  }
}

describe('handleUpdate', () => {
  it('idegen chat üres, a saját chat sora kopogtatás előtt megy ki', async () => {
    const store = memoryStore()
    const foreign = deps(store)
    const update = {
      update_id: 5,
      message: { message_id: 1, chat: { id: 7 }, text: `https://youtu.be/${ID}` },
    }
    expect((await handleUpdate(update, foreign)).status).toBe(200)
    expect(foreign.sent).toEqual([])
    expect(await store.listByUpdate(5)).toEqual([])

    const own = deps(store)
    const accepted = await handleUpdate(
      { ...update, message: { ...update.message, chat: { id: 42 } } },
      own,
    )
    expect(accepted.status).toBe(200)
    expect(own.sent).toEqual([`Sorba került: ${ID}`])
    expect(own.knocked).toEqual([])
    await applyKnocks(accepted.knocks, own)
    expect(own.knocked).toEqual([`5:${ID}`])
  })

  it('az ismételt update_id nem kopogtat újra', async () => {
    const store = memoryStore()
    const first = deps(store)
    const update = {
      update_id: 5,
      message: { message_id: 1, chat: { id: 42 }, text: ID },
    }
    await handleUpdate(update, first)
    const second = deps(store)
    const repeated = await handleUpdate(update, second)
    expect(repeated.status).toBe(200)
    expect(repeated.knocks).toEqual([])
    expect(second.knocked).toEqual([])
    expect(second.sent).toEqual([])
    expect(await store.listByUpdate(5)).toHaveLength(1)
  })

  it('a Tunnel hiánya waiting, és az üzenet csak az első váltáskor megy', async () => {
    const store = memoryStore()
    const down = deps(store, { knock: async () => 'down' })
    const planned = await handleUpdate(
      { update_id: 5, message: { message_id: 1, chat: { id: 42 }, text: ID } },
      down,
    )
    expect(down.sent).toEqual([`Sorba került: ${ID}`])
    await applyKnocks(planned.knocks, down)
    expect(down.sent).toEqual([`Sorba került: ${ID}`, `A gép ébredésére vár: ${ID}.`])
    const row = (await store.listByUpdate(5))[0]
    expect(row?.status).toBe('waiting')
    const again = deps(store, { knock: async () => 'down' })
    await handleCron(again)
    expect(again.sent).toEqual([])
    expect(again.knocked).toEqual([`5:${ID}`])
  })
})

describe('handleCallback', () => {
  it('a kész üzenet sikere után ready, a küldési hiba accepted marad, az ismétlés nem küld', async () => {
    const store = memoryStore()
    const row: JobRow = {
      jobId: `5:${ID}`,
      updateId: 5,
      chatId: '42',
      messageId: 1,
      videoId: ID,
      url: `https://www.youtube.com/watch?v=${ID}`,
      status: 'accepted',
      error: null,
      title: null,
      notifiedReady: false,
      acceptedAt: 1,
    }
    await store.insert(row)
    const failedSend = deps(store, { send: async () => false })
    expect(await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím' }, failedSend)).toBe(200)
    expect((await store.listByUpdate(5))[0]?.status).toBe('accepted')
    expect((await store.listByUpdate(5))[0]?.title).toBe('Cím')

    const ok = deps(store)
    await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím' }, ok)
    expect(ok.sent).toEqual(['Cím. A felirat megvan.'])
    expect((await store.listByUpdate(5))[0]?.status).toBe('ready')

    const repeat = deps(store)
    await handleCallback(`5:${ID}`, { status: 'ready', title: 'Cím' }, repeat)
    expect(repeat.sent).toEqual([])
  })

  it('a 401 failed, és a cron nem éleszti', async () => {
    const store = memoryStore()
    const own = deps(store, { knock: async () => 401 })
    const planned = await handleUpdate(
      { update_id: 8, message: { message_id: 1, chat: { id: 42 }, text: ID } },
      own,
    )
    await applyKnocks(planned.knocks, own)
    expect(own.sent).toContain('A konténer elutasította a hívást.')
    expect((await store.listByUpdate(8))[0]?.status).toBe('failed')
    const cron = deps(store)
    await handleCron(cron)
    expect(cron.knocked).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run worker/src/handle.test.ts`
Expected: FAIL, a `./handle.js` modul hiányzik.

- [ ] **Step 3: Write minimal implementation**

A `handleUpdate` idegen chatnél `{ status: 200, knocks: [] }`. Ha az `update_id` már szerepel a tárolóban, ugyanez, `send` nélkül. Különben a `linesForMessage` adja a szöveget és a munkákat. Minden munkából `queued` sor lesz, `jobId` = `<updateId>:<videoId>`. A `send` a beszúrás után fut. A függvény a `knocks` tömböt adja vissza, és a `knock` függvényt nem hívja. Az `applyKnocks` kopogtat. `202`: a sor `accepted`, `acceptedAt` a `now`. `409`: a sor `queued` marad, új üzenet nincs. `401`: a sor `failed`, `error` a `REJECTED_SECRET`, és ez a mondat is kimegy. `'down'`: a sor `waiting`, és a `waitingLine` kimegy.

A `handleCallback` ismeretlen `jobId` mellett `200`, küldés nélkül. `failed` test: a sor `failed`, az `error` a test `error` mezője, a `send` ezt a mondatot viszi. `ready` test: ha `notifiedReady` igaz, küldés nincs. Ha a `send` hamis, a cím a sorba kerül, az állapot `accepted` marad. Ha a `send` igaz, az állapot `ready`, a `notifiedReady` igaz.

A `handleCron` a `due` sorait kopogtatja. `waiting` sornál sikertelen kopogtatásra nem küld új ébredős üzenetet. `queued` sornál a `'down'` az első ébredős üzenet. `401` `failed` lesz. `202` `accepted` lesz.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run worker/src/handle.test.ts worker/src/plan.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/handle.ts worker/src/handle.test.ts
git commit -m "feat: turn Telegram updates into serve knocks"
```

---

### Task 7: A Worker belépése, a kép és a mutató

**Files:**
- Create: `worker/src/index.ts`
- Create: `worker/src/d1.ts`
- Create: `worker/wrangler.toml`
- Create: `worker/migrations/0001_jobs.sql`
- Create: `Dockerfile`
- Test: `worker/src/entry.test.ts`
- Modify: `docs/README.md` (a brief bekezdése a tervre is mutat)
- Modify: `README.md` (egy bekezdés az „Ami már fut” alatt)

**Interfaces:**
- Consumes: `handleUpdate`, `handleCallback`, `handleCron`, `WorkerDeps` a `worker/src/handle.ts` fájlból. `JobStore` a `worker/src/store.ts` fájlból. `createR2Store` csak a serve oldalon, ez a feladat nem hívja.
- Produces:
  - `export function createD1Store(db: D1Like): JobStore`
  - `export default { fetch, scheduled }` a Worker belépésében
  - A `D1Like` csak a használt hívásokat kéri: `prepare(sql).bind(...).all()`, `first()`, `run()`. Új `@cloudflare/workers-types` csomag nincs.

- [ ] **Step 1: Write the failing test**

```ts
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('szállítási fájlok', () => {
  it('a Dockerfile a Node 26.2 képről indul, és a serve parancsot futtatja', async () => {
    const docker = await readFile('Dockerfile', 'utf8')
    expect(docker).toContain('node:26.2')
    expect(docker).toContain('yt-dlp')
    expect(docker).toContain('CMD ["refinery", "serve"]')
  })

  it('a wrangler percenként fut, és a D1 kötés neve DB', async () => {
    const toml = await readFile('worker/wrangler.toml', 'utf8')
    expect(toml).toContain('crons = ["* * * * *"]')
    expect(toml).toContain('binding = "DB"')
    const sql = await readFile('worker/migrations/0001_jobs.sql', 'utf8')
    expect(sql).toContain('CREATE TABLE jobs')
    expect(sql).toContain('update_id')
    expect(sql).toContain('notified_ready')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run worker/src/entry.test.ts`
Expected: FAIL, a `Dockerfile` vagy a `wrangler.toml` hiányzik.

- [ ] **Step 3: Write minimal implementation**

A `worker/migrations/0001_jobs.sql`:

```sql
CREATE TABLE jobs (
  job_id TEXT PRIMARY KEY,
  update_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  video_id TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  title TEXT,
  notified_ready INTEGER NOT NULL DEFAULT 0,
  accepted_at INTEGER
);
CREATE INDEX jobs_update ON jobs(update_id);
CREATE INDEX jobs_video_status ON jobs(video_id, status);
```

A `worker/wrangler.toml` neve `transcript-refinery`, a `main` a `src/index.ts`, a compatibility date `2026-10-04`. A D1 binding neve `DB`, az adatbázis neve `transcript-refinery`. A trigger `* * * * *`.

A `worker/src/index.ts` a `/telegram` útvonalon meghívja a `handleUpdate`-et, a választ már az elküldte, és `200` testtel azonnal válaszol. A visszaadott `knocks` tömböt a `ctx.waitUntil(applyKnocks(...))` viszi, a webhook válasz után. A `/internal/jobs/:jobId` útvonal a Bearer titkot nézi, majd a `handleCallback`-et hívja. A `scheduled` a `handleCron`. A `send` a `https://api.telegram.org/bot<token>/sendMessage` hívás. A `knock` a `SERVE_URL` `/jobs` útvonalára POST-ol, és a `202`, `409`, `401` vagy hálózati hiba szerint `'down'` értéket ad.

A `Dockerfile`:

```dockerfile
FROM node:26.2-bookworm AS build
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:26.2-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ADD https://github.com/yt-dlp/yt-dlp/releases/download/2026.03.17/yt-dlp_linux /usr/local/bin/yt-dlp
RUN chmod 755 /usr/local/bin/yt-dlp
WORKDIR /app
COPY --from=build /src/package.json /app/package.json
COPY --from=build /src/dist /app/dist
COPY --from=build /src/node_modules /app/node_modules
RUN chmod 755 /app/dist/cli.js && ln -s /app/dist/cli.js /usr/local/bin/refinery
CMD ["refinery", "serve"]
```

A `src/cli.ts` shebangje a lefordított `dist/cli.js` elején marad, ezért a symlink `refinery` néven indul. A teszt a képet nem építi.

A gyökér `README.md` „Ami már fut” szakasza egy bekezdést kap: a `refinery serve` egy videó feliratát és `info.json` fájlját az R2-be tölti, a Telegram-ajtó a `worker/` csomag. A `docs/README.md` brief-bekezdése hivatkozza ezt a tervfájlt.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run worker/src/entry.test.ts && pnpm test && pnpm typecheck && pnpm --filter transcript-refinery-worker exec tsc -p tsconfig.json --noEmit`
Expected: PASS. A worker typecheck a `worker/tsconfig.json` `noEmit` beállításával fut. Ha a filteres hívás a gyökér `tsc`-t nem látja, a parancs a gyökérből: `pnpm exec tsc -p worker/tsconfig.json --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add worker Dockerfile README.md docs/README.md
git commit -m "feat: add the worker entry and the serve image"
```
