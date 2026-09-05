# Forrásfüggetlen bemenet — implementációs terv

> **Ágens-végrehajtóknak:** KÖTELEZŐ AL-SKILL: használd a
> `superpowers:subagent-driven-development` (ajánlott) vagy a
> `superpowers:executing-plans` skillt a terv feladatonkénti végrehajtásához.
> A lépések checkbox (`- [ ]`) szintaxist használnak a követéshez.

**Cél:** Az app egyetlen bemeneti szerződése a kész `.vtt`/`.srt` feliratfájl
legyen — az előállító (Pinchflat, whisper, yt-dlp) fogalma nélkül —, a
konfiguráció YAML-ból jöjjön, és a kimenet a vault `Inbox/transcript-refinery`
fája alá kerüljön, forrásonkénti almappákba.

**Architektúra:** A felderítés megfordul: ma a metaadatfájlokon iterálunk és a
feliratot keressük mellé, ezután a **feliratfájlokon** iterálunk, és az
`.info.json` opcionális kiegészítő. Ebből következik minden más: az elem
azonosítója nem lehet többé kötelezően a videóazonosító (`item_id`, ami
metaadat híján útvonal-hash), a vault-beli célút nem függhet metaadattól (a
forrásmappa szerkezetét tükrözi), és a frontmatter mindig elkészül, csak
kevesebb mezővel. A konfiguráció egyetlen YAML-fájlba költözik; a `.env`-ben
csak a `LITELLM_API_KEY` marad.

**Tech stack:** A meglévő stack (TypeScript 5.9, Node 26.2.0, pnpm 11.24.0,
ESLint 10, `node:sqlite`, `zod@^4`, `vitest@^4`) egyetlen új futásidejű
függőséggel: `yaml`.

**Spec:** [`2026-09-05-forras-fuggetlen-architektura-spec.md`](<./2026-09-05-forras-fuggetlen-architektura-spec.md>)

## Globális megkötések

Minden feladat követelményei implicit módon tartalmazzák ezt a szakaszt.

- **Node `26.2.0`, pnpm `11.24.0`** a `.mise.toml`-ból. Minden parancs
  `mise exec --` előtaggal fut, soha nem a shell PATH-ból.
- **A dokumentáció, a kódkommentek, a commit-üzenetek és a felhasználónak szóló
  kimenetek magyarul.** A kódazonosítók, típusnevek és a conventional commit
  előtagok (`feat:`, `fix:`, `docs:`, `test:`, `chore:`) angolul.
- **TDD:** minden viselkedésváltozás előbb bukó tesztben jelenik meg. A meglévő
  tesztek átírandók, nem törlendők.
- **Tiszta törés:** migrációs kód nem készül. A `.state/refinery.db` eldobható,
  a `Resources/Videos/YouTube` alatti régi jegyzetek érintetlenül maradnak.
- **A `tsconfig.json` `strict` és `noUncheckedIndexedAccess`** — a tömbindexelés
  `T | undefined`-ot ad; a `!` a szándék kifejezése, engedélyezett.
- **A `docs/decisions/` és `docs/plans/` állományait nem írjuk át** — történeti
  feljegyzések. Az elavuló döntéseket új ADR írja felül.
- **Commit:** az üzenetet **mindig a `commit-message` skill** készíti a staged
  változásokból — kézzel írt üzenet nincs. A tárgysor végén kötelezően
  `(Feladat N)` áll. A feladatok `git commit -m` példái a tárgysor **tartalmát**
  mutatják, nem helyettesítik a skillt.
- **Átmeneti piros typecheck:** az 1–8. feladat alatt a `pnpm typecheck` piros
  lehet, mert a `cli.ts` csak a 9. feladatban áll át. Minden feladat végén a
  **saját tesztfájljai** zöldek; a teljes `pnpm test`, `pnpm typecheck` és
  `pnpm lint` a 9. feladat után kötelezően zöld.

## Fájlszerkezet

| Fájl | Felelősség |
|---|---|
| `src/config.ts` | *átírás* — YAML-betöltés, zod-séma, alapértelmezések, `Config` és `ModelConfig` |
| `src/types.ts` | *átírás* — `SourceItem` és az új `ItemMetadata` |
| `src/source/identity.ts` | **új** — elem-azonosító képzése (videóazonosító vagy útvonal-hash) |
| `src/source/metadata.ts` | **új** — `.info.json` → szűk, tipizált metaadat |
| `src/source/folder.ts` | *átírás* — felirat-vezérelt felderítés, nyelvválasztás, több forrás |
| `src/state/db.ts` | *átírás* — `item_id`-kulcsú séma |
| `src/vault/paths.ts` | *átírás* — metaadat-független célút |
| `src/vault/frontmatter.ts` | **új** — YAML-frontmatter renderelése, opcionális mezőkkel |
| `src/vault/render.ts` | *átírás* — a mezőlisták összeállítása |
| `src/events.ts`, `src/pipeline.ts` | *átírás* — `videoId` → `itemId`, új útvonalak |
| `src/recipe/summary.ts` | *átírás* — a prompt fejléce metaadat nélkül is helyes |
| `evals/summary.eval.ts` | *átírás* — a fixture-elem az új `SourceItem` alakban |
| `src/cli.ts`, `src/index.ts` | *átírás* — `--config`, `--source`, több forrás |
| `refinery.config.example.yaml` | **új** — kommentelt példakonfiguráció |
| `.env.example`, `package.json` | *átírás* — a `.env` a kulcsra zsugorodik, a `sample:fetch` törlődik |
| `docs/decisions/0008-forras-fuggetlen-bemenet.md` | **új** — ADR |
| `docs/architecture.md`, `README.md`, `docs/roadmap.md` | *átírás* |

## Eldöntött: a Fázis 2 és a Fázis 4 sorsa

**Státusz: jóváhagyva 2026-09-05-én, az alábbi javaslat szerint.** A 11. feladat
ezt a döntést írja be a roadmapbe és az ADR-be.

A spec 6. pontja megkövetelte, hogy a terv **nevezze meg** az ütközést és
javasoljon rá döntést, de ne döntse el magától. Az ütközés:

- **Fázis 2 — Újratranszkribálás és backfill.** A mai szövege szerint az app
  automatikus feliratú videókat transzkribál újra lokális whisperrel. Ehhez
  médiafájlt kellene olvasnia és `ffmpeg`-et futtatnia — pontosan az, amit az
  új bemeneti szerződés kizár. A [`0005-transzkribalasi-ut`](<../decisions/0005-transzkribalasi-ut.md>)
  ADR teljes egészében erről szól.
- **Fázis 4 — URL-adapter.** A mai szövege szerint az app URL-ből (playlistből)
  tölt le. Szintén előállítás, nem fogyasztás.

**A jóváhagyott döntés:**

1. **Fázis 2 kivezetése az appból.** A whisper-futtatás külső eszköz marad,
   aminek a kimenete egy újabb `sources` mappa — az app számára ez ugyanolyan
   feliratfájl, mint bármi más. Ami az appban **marad** a fázisból: a
   felirat-minőség osztályozása (`src/normalize/classify.ts`, kész) és az, hogy
   a jelentés megnevezi az automatikus feliratú elemeket. A fázis új neve:
   „Felirat-minőség jelentése", a backfill-kritérium (éjszakai futás,
   újraindítás nem veszít munkát) változatlanul megmarad, mert az a köteges
   feldolgozásról szól, nem a transzkribálásról.
2. **Fázis 4 törlése.** Az URL-adapter a letöltéssel együtt kikerül. Az
   „absztrakció két implementációval igazolva" szerepet a `Source` továbbra is
   betölti: két különböző eredetű forrásmappa (letöltő kimenete és
   whisper-kimenet) ugyanazon a magon megy át. A Fázis 5 (felületek) lép előre.
3. A `0005` ADR státusza **felülírva** lesz a `0008`-ban, a `0003`-é szintén
   (a folder-adapter marad, de a metaadatra épülő indoklása nem áll).

A `docs/plans/` és `docs/decisions/` korábbi állományai ettől függetlenül
változatlanok maradnak: a döntést a `0008` ADR rögzíti, nem a régi szövegek
átírása.

---

## Feladat 1 — YAML-konfiguráció és a `.env` leépítése

**Fájlok:**
- Módosít: `src/config.ts` (teljes átírás), `package.json`, `.env.example`
- Létrehoz: `refinery.config.example.yaml`
- Teszt: `src/config.test.ts` (átírás)

**Interfészek:**
- Fogyaszt: semmit (ez az első feladat).
- Termel: `CONFIG_FILENAME`, `DEFAULT_NOTES_DIR`, `SourceDir`, `Config`,
  `readConfigFile(path): Promise<unknown>`,
  `loadConfig(raw: unknown, configPath: string): Config`,
  `loadModelConfig(raw: unknown, env, configPath): ModelConfig`,
  `validateConfig(cfg: Config): Promise<void>`, `loadDotEnv(path?)`.

- [ ] **1. lépés: Függőség felvétele és a `sample:fetch` törlése**

```bash
mise exec -- pnpm add yaml
```

Majd a `package.json` `scripts` blokkjából töröld a teljes `"sample:fetch"`
sort. Semmi más script nem változik.

- [ ] **2. lépés: A bukó tesztek megírása**

Írd felül a `src/config.test.ts` teljes tartalmát:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTES_DIR,
  loadConfig,
  loadModelConfig,
  readConfigFile,
  validateConfig,
} from './config.js'

let dir: string

const MIN = { vault: { path: '/v' }, sources: ['/s/youtube'] }

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-config-'))
})

describe('loadConfig', () => {
  it('notes_dir nélkül az Inbox/transcript-refinery alá tesz', () => {
    const cfg = loadConfig(MIN, '/p/refinery.config.yaml')
    expect(cfg.notesRoot).toBe(`/v/${DEFAULT_NOTES_DIR}`)
  })

  it('a megadott notes_dir felülírja az alapértelmezést', () => {
    const cfg = loadConfig(
      { ...MIN, vault: { path: '/v', notes_dir: 'Inbox/masik' } },
      '/p/refinery.config.yaml',
    )
    expect(cfg.notesRoot).toBe('/v/Inbox/masik')
  })

  it('a forrás nevét az útvonal utolsó szegmenséből veszi', () => {
    const cfg = loadConfig(
      { ...MIN, sources: ['/s/youtube', '/s/whisper-out'] },
      '/p/refinery.config.yaml',
    )
    expect(cfg.sources).toEqual([
      { name: 'youtube', path: '/s/youtube' },
      { name: 'whisper-out', path: '/s/whisper-out' },
    ])
  })

  it('üres sources esetén beszédes hibát dob', () => {
    expect(() => loadConfig({ ...MIN, sources: [] }, '/p/c.yaml')).toThrow(
      /forrásmappa/,
    )
  })

  it('a hibaüzenet megnevezi a mezőt és a konfigurációs fájlt', () => {
    expect(() => loadConfig({ sources: ['/s'] }, '/p/c.yaml')).toThrow(
      /vault.*\/p\/c\.yaml/s,
    )
  })

  it('a relatív forrásútvonalat elutasítja', () => {
    expect(() => loadConfig({ ...MIN, sources: ['./s'] }, '/p/c.yaml')).toThrow(
      /abszolút/,
    )
  })

  it('az állapottárat alapból a repóba teszi, nem a vaultba', () => {
    const cfg = loadConfig(MIN, '/p/refinery.config.yaml')
    expect(cfg.statePath).toContain('.state')
    expect(cfg.statePath.startsWith('/v')).toBe(false)
  })

  it('a languages alapból üres, és nem hiányzó mezőként hibázik', () => {
    expect(loadConfig(MIN, '/p/c.yaml').languages).toEqual([])
  })
})

describe('readConfigFile', () => {
  it('hiányzó fájlnál megnevezi az útvonalat és a --config kapcsolót', async () => {
    await expect(readConfigFile(join(dir, 'nincs.yaml'))).rejects.toThrow(
      /nincs\.yaml[\s\S]*--config/,
    )
  })

  it('értelmezhetetlen YAML-nál megnevezi a fájlt', async () => {
    const path = join(dir, 'rossz.yaml')
    await writeFile(path, 'vault: [\n  path: /v\n', 'utf8')
    await expect(readConfigFile(path)).rejects.toThrow(/rossz\.yaml/)
  })

  it('a YAML-t sima objektummá alakítja', async () => {
    const path = join(dir, 'jo.yaml')
    await writeFile(path, 'vault:\n  path: /v\nsources:\n  - /s/youtube\n', 'utf8')
    expect(await readConfigFile(path)).toEqual(MIN)
  })
})

describe('loadModelConfig', () => {
  const RAW = {
    ...MIN,
    model: { base_url: 'http://localhost:4000/v1', draft: 'd', judge: 'j' },
    pricing: {
      draft: { input_per_million: 3, output_per_million: 15 },
      judge: { input_per_million: 0.2, output_per_million: 0.5 },
    },
    cost_limit_usd: 5,
  }

  it('a kulcsot a környezetből veszi, nem a YAML-ból', () => {
    const cfg = loadModelConfig(RAW, { LITELLM_API_KEY: 'sk-1' }, '/p/c.yaml')
    expect(cfg.apiKey).toBe('sk-1')
    expect(cfg.models.draft).toBe('d')
    expect(cfg.costLimitUsd).toBe(5)
  })

  it('hiányzó kulcsnál megmondja, hogy a .env-ből jön', () => {
    expect(() => loadModelConfig(RAW, {}, '/p/c.yaml')).toThrow(/LITELLM_API_KEY/)
  })

  it('nulla költségplafont nem fogad el', () => {
    expect(() =>
      loadModelConfig({ ...RAW, cost_limit_usd: 0 }, { LITELLM_API_KEY: 'k' }, '/p/c.yaml'),
    ).toThrow(/plafon|pozitív/)
  })
})

describe('validateConfig', () => {
  it('hibát dob, ha a vault nem git-repó', async () => {
    await mkdir(join(dir, 'vault'), { recursive: true })
    await mkdir(join(dir, 'subs'), { recursive: true })
    const cfg = loadConfig(
      { vault: { path: join(dir, 'vault') }, sources: [join(dir, 'subs')] },
      '/p/c.yaml',
    )
    await expect(validateConfig(cfg)).rejects.toThrow(/git-repó/)
  })

  it('hibát dob, ha egy forrásmappa nem létezik', async () => {
    await mkdir(join(dir, 'vault', '.git'), { recursive: true })
    const cfg = loadConfig(
      { vault: { path: join(dir, 'vault') }, sources: [join(dir, 'nincs')] },
      '/p/c.yaml',
    )
    await expect(validateConfig(cfg)).rejects.toThrow(/nincs/)
  })
})
```

- [ ] **3. lépés: A tesztek futtatása — bukniuk kell**

```bash
mise exec -- pnpm vitest run src/config.test.ts
```

Elvárt: FAIL, `readConfigFile`/`DEFAULT_NOTES_DIR` nincs exportálva.

- [ ] **4. lépés: A `src/config.ts` átírása**

Írd felül a fájl teljes tartalmát:

```ts
import { readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import type { ModelRole } from './types.js'

/** A konfigurációs fájl alapértelmezett neve a projekt gyökerében. */
export const CONFIG_FILENAME = 'refinery.config.yaml'

/**
 * A vaulton belüli jegyzet-gyűjtemény, ha a YAML nem mond mást. Egyetlen
 * helyen él: az alapértelmezés szétszórása azt jelentené, hogy két helyen
 * kellene átírni, és az egyik előbb-utóbb kimaradna.
 */
export const DEFAULT_NOTES_DIR = 'Inbox/transcript-refinery'

/**
 * Betölti az `.env`-et, ha létezik. **Egyetlen** értéket hoz: a
 * `LITELLM_API_KEY`-t — minden más beállítás a YAML-ból jön.
 *
 * A hiányzó fájl nem hiba: CI-ban a környezet közvetlenül van beállítva.
 * Minden más hiba (például szintaktikai) viszont felszínre jön, mert egy
 * csendben elnyelt elgépelés órákat visz el.
 */
export function loadDotEnv(path = join(process.cwd(), '.env')): void {
  try {
    process.loadEnvFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

const absolutePath = (label: string) =>
  z
    .string()
    .min(1, `A ${label} kötelező.`)
    .refine(isAbsolute, `A ${label} abszolút útvonal kell legyen.`)

const CoreSchema = z.object({
  vault: z.object({
    path: absolutePath('vault.path'),
    notes_dir: z.string().min(1).default(DEFAULT_NOTES_DIR),
  }),
  sources: z
    .array(absolutePath('sources eleme'))
    .min(1, 'Legalább egy forrásmappa kell.'),
  languages: z.array(z.string().min(1)).default([]),
  state: z
    .object({ path: z.string().min(1) })
    .default({ path: join('.state', 'refinery.db') }),
})

/** Egy feliratforrás: a YAML-beli útvonal és a belőle képzett név. */
export interface SourceDir {
  /** Az útvonal utolsó szegmense; ez lesz a vault-beli almappa neve. */
  name: string
  path: string
}

export interface Config {
  /** A betöltött konfigurációs fájl útvonala — a hibaüzenetek ezt nevezik meg. */
  configPath: string
  vaultPath: string
  notesRoot: string
  sources: SourceDir[]
  /** Nyelvi preferencia-sorrend; üres lista esetén a determinisztikus tartalék dönt. */
  languages: string[]
  statePath: string
}

/** A zod hibáját a mező útjával és a konfigurációs fájllal együtt dobja tovább. */
function fail(error: z.ZodError, configPath: string): never {
  const first = error.issues[0]!
  const path = first.path.join('.') || 'konfiguráció'
  throw new Error(`${path}: ${first.message} (${configPath})`)
}

/**
 * Beolvassa és YAML-ként értelmezi a konfigurációs fájlt. Szándékosan nem
 * validál: a séma-ellenőrzés a `loadConfig` és a `loadModelConfig` dolga,
 * hogy a modellréteg hiánya ne akadályozza a `scan`-t.
 */
export async function readConfigFile(path: string): Promise<unknown> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Nincs konfigurációs fájl: ${path}\n` +
          `Másold le a refinery.config.example.yaml-t, vagy add meg a --config kapcsolóval.`,
      )
    }
    throw error
  }
  try {
    return parseYaml(text) as unknown
  } catch (error) {
    throw new Error(
      `A konfigurációs fájl nem értelmezhető YAML: ${path} — ${(error as Error).message}`,
    )
  }
}

/** YAML → konfiguráció. Fájlrendszertől független, hogy tesztelhető legyen. */
export function loadConfig(raw: unknown, configPath: string): Config {
  const parsed = CoreSchema.safeParse(raw)
  if (!parsed.success) fail(parsed.error, configPath)
  const c = parsed.data
  return {
    configPath,
    vaultPath: c.vault.path,
    notesRoot: join(c.vault.path, c.vault.notes_dir),
    sources: c.sources.map((p) => ({ name: basename(p), path: p })),
    languages: c.languages,
    statePath: resolve(process.cwd(), c.state.path),
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Indulási feltételek ellenőrzése. A program nem indul el, ha a vault nem
 * elérhető vagy nem git-repó — a publisher git-műveletei enélkül elhasalnának
 * a futás közepén —, és akkor sem, ha egy megadott forrásmappa nem létezik:
 * az elgépelt útvonal némán nulla elemet adna.
 */
export async function validateConfig(cfg: Config): Promise<void> {
  if (!(await isDirectory(cfg.vaultPath))) {
    throw new Error(`vault.path: nem létező mappa: ${cfg.vaultPath} (${cfg.configPath})`)
  }
  if (!(await isDirectory(join(cfg.vaultPath, '.git')))) {
    throw new Error(`vault.path: nem git-repó: ${cfg.vaultPath} (${cfg.configPath})`)
  }
  for (const source of cfg.sources) {
    if (!(await isDirectory(source.path))) {
      throw new Error(`sources: nem létező mappa: ${source.path} (${cfg.configPath})`)
    }
  }
}

const PriceSchema = z.object({
  input_per_million: z.coerce.number().nonnegative(),
  output_per_million: z.coerce.number().nonnegative(),
})

const ModelSchema = z.object({
  model: z.object({
    base_url: z.url('A model.base_url érvényes URL kell legyen.'),
    draft: z.string().min(1, 'A model.draft kötelező.'),
    judge: z.string().min(1, 'A model.judge kötelező.'),
  }),
  pricing: z.object({ draft: PriceSchema, judge: PriceSchema }),
  cost_limit_usd: z.coerce
    .number()
    .positive('Kötelező és pozitív: köteg nem indul felső korlát nélkül.'),
})

/** USD egymillió tokenre vetítve. */
export interface ModelPricing {
  inputPerMillion: number
  outputPerMillion: number
}

export interface ModelConfig {
  baseUrl: string
  apiKey: string
  models: Record<ModelRole, string>
  pricing: Record<ModelRole, ModelPricing>
  /** Futásonkénti felső korlát dollárban. */
  costLimitUsd: number
}

/**
 * A modellréteg konfigurációja — **szándékosan külön** a `loadConfig`-tól.
 *
 * Ha ezek a `loadConfig` sémájában lennének, a modellhívás nélküli `scan` és
 * `run` is megkövetelné a modell-blokkot és a LiteLLM-kulcsot. Így viszont a
 * modell-konfigurációt csak az fizeti meg, aki receptet futtat.
 *
 * A kulcs az egyetlen érték, ami **nem** a YAML-ból jön: titok, aminek nincs
 * helye egy verziókövetett konfigurációs fájlban.
 */
export function loadModelConfig(
  raw: unknown,
  env: Record<string, string | undefined>,
  configPath: string,
): ModelConfig {
  const parsed = ModelSchema.safeParse(raw)
  if (!parsed.success) fail(parsed.error, configPath)
  const apiKey = env.LITELLM_API_KEY
  if (!apiKey) {
    throw new Error(
      'A LITELLM_API_KEY kötelező, és kizárólag környezetből (.env) jön — a YAML nem tartalmazhatja.',
    )
  }
  const c = parsed.data
  return {
    baseUrl: c.model.base_url,
    apiKey,
    models: { draft: c.model.draft, judge: c.model.judge },
    pricing: {
      draft: {
        inputPerMillion: c.pricing.draft.input_per_million,
        outputPerMillion: c.pricing.draft.output_per_million,
      },
      judge: {
        inputPerMillion: c.pricing.judge.input_per_million,
        outputPerMillion: c.pricing.judge.output_per_million,
      },
    },
    costLimitUsd: c.cost_limit_usd,
  }
}
```

- [ ] **5. lépés: A tesztek futtatása — zöldnek kell lenniük**

```bash
mise exec -- pnpm vitest run src/config.test.ts
```

Elvárt: PASS, mind a 16 teszt.

- [ ] **6. lépés: A példakonfiguráció megírása**

Hozd létre a `refinery.config.example.yaml` fájlt:

```yaml
# A Transcript Refinery konfigurációja. Másold `refinery.config.yaml` néven a
# projekt gyökerébe, vagy add meg a helyét a `--config` kapcsolóval.
#
# Egyetlen érték nem innen jön: a LITELLM_API_KEY. Az titok, ezért a `.env`-ből
# (vagy a környezetből) érkezik. Minden más beállítást kizárólag ez a fájl dönt
# el — környezeti változó nem írja felül.

vault:
  # Az Obsidian vault abszolút útvonala. Gépenként eltér, ezért nincs
  # alapértelmezése; relatív útvonal nem működhet.
  path: /Users/valaki/vault
  # A jegyzetek gyökere a vaulton belül. Elhagyható; ez az alapértelmezés.
  notes_dir: Inbox/transcript-refinery

# Feliratmappák. Az app rekurzívan minden .srt és .vtt fájlt felszed alattuk,
# és nem érdekli, mi állította elő őket. A mappa **neve** (az útvonal utolsó
# szegmense) lesz a vault-beli almappa neve, tehát beszédes nevet adj neki.
sources:
  - /Users/valaki/feliratok/youtube
  - /Users/valaki/feliratok/meetings

# Nyelvi preferencia-sorrend. Ha egy alapnévhez több felirat tartozik
# (pl. `.hu.vtt` és `.en.srt`), az itteni sorrend dönt. Üresen hagyva a
# tartalék szabály választ: .srt előbb, mint .vtt, azon belül ábécésorrend.
languages: [hu, en]

state:
  # A feldolgozottság nyilvántartása. Relatív útvonal a projekt gyökeréhez
  # képest értendő. Eldobható: újrafuttatáskor felépül.
  path: .state/refinery.db

# Szerep → modell. A receptek szerepet kérnek, nem modellnevet; a konkrét
# választás mérési eredmény lesz, nem vélemény (decisions/0004).
model:
  base_url: http://localhost:4000/v1
  draft: claude-sonnet-5
  judge: grok-4-fast-reasoning

# USD egymillió tokenre, szerepenként be- és kimenetre. Azért konfigurációból
# és nem beégetett ártáblázatból, mert az avul.
pricing:
  draft: { input_per_million: 3.00, output_per_million: 15.00 }
  judge: { input_per_million: 0.20, output_per_million: 0.50 }

# Futásonkénti költségplafon dollárban. Kötelező: köteg nem indul felső korlát
# nélkül. A korpusz mért mediánjából egy elem nagyjából 8 cent, tehát az
# 5,00-s alapértelmezés megállít egy teljes korpuszfutást, és kikényszeríti a
# szándékos felülbírálást.
cost_limit_usd: 5.00
```

- [ ] **7. lépés: A `.env.example` lecsökkentése**

Írd felül a `.env.example` teljes tartalmát:

```bash
# Ez a fájl **egyetlen** értéket hordoz: a LiteLLM-kulcsot. Minden más
# beállítás a refinery.config.yaml-ból jön (lásd refinery.config.example.yaml).
#
# A gateway telepítése nem ennek a projektnek a feladata; a projekt adottnak
# veszi, hogy elérhető. A kulcsra csak a receptfuttatásnak van szüksége — a
# `scan` és az átiratot író `run` enélkül is lefut.
LITELLM_API_KEY=
```

- [ ] **8. lépés: Commit**

```bash
git add package.json pnpm-lock.yaml src/config.ts src/config.test.ts \
        refinery.config.example.yaml .env.example
git commit -m "feat(config): a beállítások YAML-ból jönnek, a .env csak a kulcsot hozza (Feladat 1)"
```

---

## Feladat 2 — Elem-azonosító

**Fájlok:**
- Létrehoz: `src/source/identity.ts`
- Teszt: `src/source/identity.test.ts`

**Interfészek:**
- Fogyaszt: semmit.
- Termel: `itemIdFor(source: string, relBase: string, videoId?: string): string`.

- [ ] **1. lépés: A bukó teszt megírása**

Hozd létre a `src/source/identity.test.ts` fájlt:

```ts
import { describe, expect, it } from 'vitest'
import { itemIdFor } from './identity.js'

describe('itemIdFor', () => {
  it('a videóazonosítót használja, ha van', () => {
    expect(itemIdFor('youtube', 'csatorna/video', 'dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('metaadat nélkül stabil hasht ad ugyanarra a bemenetre', () => {
    const a = itemIdFor('youtube', 'csatorna/video')
    const b = itemIdFor('youtube', 'csatorna/video')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{16}$/)
  })

  it('más forrásban ugyanaz az útvonal más azonosítót kap', () => {
    expect(itemIdFor('youtube', 'a/b')).not.toBe(itemIdFor('meetings', 'a/b'))
  })

  it('más útvonal más azonosítót kap', () => {
    expect(itemIdFor('youtube', 'a/b')).not.toBe(itemIdFor('youtube', 'a/c'))
  })
})
```

- [ ] **2. lépés: A teszt futtatása — buknia kell**

```bash
mise exec -- pnpm vitest run src/source/identity.test.ts
```

Elvárt: FAIL, `Cannot find module './identity.js'`.

- [ ] **3. lépés: A megvalósítás**

Hozd létre a `src/source/identity.ts` fájlt:

```ts
import { createHash } from 'node:crypto'

/**
 * Egy elem azonosítója.
 *
 * A metaadatfájl videóazonosítója a kulcs, ha van — így a már feldolgozott
 * videók azonosítója nem változik. Ha nincs metaadat, a forrásnév és a
 * forráson belüli relatív **alapnév** párosából képzett hash áll a helyére.
 *
 * A nyelvi utótag és a kiterjesztés szándékosan nincs a hashben: egy
 * `.en.srt` → `.hu.vtt` csere ugyanazt az elemet jelenti, nem újat.
 *
 * Ismert következmény: ha egy elem mellé **utólag** kerül metaadatfájl, az
 * azonosító hashről videóazonosítóra vált, tehát az elem újra feldolgozódik.
 * Ez tudatos csere: a stabil, beszédes azonosítót többre tartjuk, mint az
 * egyszeri újrafuttatás elkerülését.
 */
export function itemIdFor(source: string, relBase: string, videoId?: string): string {
  if (videoId) return videoId
  return createHash('sha256').update(`${source}/${relBase}`, 'utf8').digest('hex').slice(0, 16)
}
```

- [ ] **4. lépés: A teszt futtatása — zöldnek kell lennie**

```bash
mise exec -- pnpm vitest run src/source/identity.test.ts
```

Elvárt: PASS, 4 teszt.

- [ ] **5. lépés: Commit**

```bash
git add src/source/identity.ts src/source/identity.test.ts
git commit -m "feat(source): elem-azonosító metaadat nélkül is (Feladat 2)"
```

---

## Feladat 3 — Sidecar metaadat

**Fájlok:**
- Létrehoz: `src/source/metadata.ts`
- Módosít: `src/types.ts` (csak az `ItemMetadata` hozzáadása)
- Teszt: `src/source/metadata.test.ts`

**Interfészek:**
- Fogyaszt: `ItemMetadata` (ebben a feladatban készül el).
- Termel: `ItemMetadata`, `SidecarData`, `mapInfoJson(raw: unknown): SidecarData`,
  `readSidecar(infoPath: string): Promise<SidecarData | null>`.

- [ ] **1. lépés: Az `ItemMetadata` típus felvétele**

Illeszd be a `src/types.ts` fájlba, a `Cue` interfész elé:

```ts
/**
 * A feliratfájl melletti metaadatfájlból kiolvasott mezők. Mind opcionális:
 * metaadat nélkül is teljes értékű elem születik, csak kevesebbet tudunk róla.
 */
export interface ItemMetadata {
  videoId?: string
  channel?: string
  /** ISO-alakú dátum (`2026-07-14`). */
  uploadedAt?: string
  url?: string
  /** Hossz másodpercben. */
  duration?: number
  tags?: string[]
  description?: string
}
```

- [ ] **2. lépés: A bukó tesztek megírása**

Hozd létre a `src/source/metadata.test.ts` fájlt:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { mapInfoJson, readSidecar } from './metadata.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-meta-'))
})

describe('mapInfoJson', () => {
  it('a felismert mezőket leképezi', () => {
    const data = mapInfoJson({
      id: 'q6p',
      title: 'Agent Orchestration',
      channel: 'Burke Holland',
      upload_date: '20260714',
      webpage_url: 'https://example.com/v',
      duration: 1806,
      tags: ['ai', 'agents'],
      description: 'Első sor\nMásodik sor',
    })
    expect(data.title).toBe('Agent Orchestration')
    expect(data.metadata).toEqual({
      videoId: 'q6p',
      channel: 'Burke Holland',
      uploadedAt: '2026-07-14',
      url: 'https://example.com/v',
      duration: 1806,
      tags: ['ai', 'agents'],
      description: 'Első sor\nMásodik sor',
    })
  })

  it('a csatornát az uploader mezőből is elfogadja', () => {
    expect(mapInfoJson({ uploader: 'Valaki' }).metadata.channel).toBe('Valaki')
  })

  it('a hiányzó mezőket nem tölti ki kitalált értékkel', () => {
    const data = mapInfoJson({ title: 'Cím' })
    expect(data.metadata.videoId).toBeUndefined()
    expect(data.metadata.url).toBeUndefined()
    expect(data.metadata.channel).toBeUndefined()
  })

  it('nem szintetizál URL-t a videóazonosítóból', () => {
    expect(mapInfoJson({ id: 'q6p' }).metadata.url).toBeUndefined()
  })

  it('a nem string dátumot és a rossz típusú mezőket eldobja', () => {
    const data = mapInfoJson({ upload_date: 20260714, duration: 'sok', tags: 'nem tömb' })
    expect(data.metadata.uploadedAt).toBeUndefined()
    expect(data.metadata.duration).toBeUndefined()
    expect(data.metadata.tags).toBeUndefined()
  })

  it('nem objektum bemenetre üres metaadatot ad', () => {
    expect(mapInfoJson(null).metadata).toEqual({})
    expect(mapInfoJson('szöveg').metadata).toEqual({})
  })
})

describe('readSidecar', () => {
  it('beolvassa a metaadatfájlt', async () => {
    const path = join(dir, 'v.info.json')
    await writeFile(path, JSON.stringify({ id: 'abc', title: 'Cím' }), 'utf8')
    const data = await readSidecar(path)
    expect(data?.metadata.videoId).toBe('abc')
  })

  it('hiányzó fájlnál null-t ad, nem dob', async () => {
    expect(await readSidecar(join(dir, 'nincs.info.json'))).toBeNull()
  })

  it('sérült JSON-nál null-t ad, nem dob — a futás nem állhat meg tőle', async () => {
    const path = join(dir, 'rossz.info.json')
    await writeFile(path, '{ ez nem json', 'utf8')
    expect(await readSidecar(path)).toBeNull()
  })
})
```

- [ ] **3. lépés: A tesztek futtatása — bukniuk kell**

```bash
mise exec -- pnpm vitest run src/source/metadata.test.ts
```

Elvárt: FAIL, `Cannot find module './metadata.js'`.

- [ ] **4. lépés: A megvalósítás**

Hozd létre a `src/source/metadata.ts` fájlt:

```ts
import { readFile } from 'node:fs/promises'
import type { ItemMetadata } from '../types.js'

export interface SidecarData {
  /** A metaadatfájlban szereplő cím, ha van. A jegyzet címe ebből lesz. */
  title?: string
  metadata: ItemMetadata
}

/** `20260714` → `2026-07-14`. Ismeretlen alaknál változatlanul hagyja. */
function isoDate(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : raw
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const strList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((x): x is string => typeof x === 'string' && x !== '')
  return items.length > 0 ? items : undefined
}

/**
 * A metaadatfájl **szűk** leképezése.
 *
 * Szándékosan whitelist: a mért korpusz metaadatfájljai hatvannál is több
 * kulcsot tartalmaznak, és abból a jegyzetbe csak az kerül, amit olvasunk is.
 *
 * Az URL-t nem szintetizáljuk a videóazonosítóból: az `https://youtube.com/...`
 * összerakása pontosan az a szolgáltatói feltevés, amit ez az architektúra
 * kivezet. Ha a fájl nem mond URL-t, akkor nincs URL.
 */
export function mapInfoJson(raw: unknown): SidecarData {
  if (typeof raw !== 'object' || raw === null) return { metadata: {} }
  const info = raw as Record<string, unknown>
  return {
    title: str(info.title),
    metadata: {
      videoId: str(info.id),
      channel: str(info.channel) ?? str(info.uploader),
      uploadedAt: isoDate(info.upload_date),
      url: str(info.webpage_url),
      duration: num(info.duration),
      tags: strList(info.tags),
      description: str(info.description),
    },
  }
}

/**
 * Beolvassa a felirat melletti metaadatfájlt, ha van.
 *
 * A hiányzó és a sérült fájl **ugyanaz az eset**: `null`. A metaadat
 * kiegészítés, nem belépő — egyik sem állíthatja meg a futást.
 */
export async function readSidecar(infoPath: string): Promise<SidecarData | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(infoPath, 'utf8'))
    return mapInfoJson(parsed)
  } catch {
    return null
  }
}
```

- [ ] **5. lépés: A tesztek futtatása — zöldnek kell lenniük**

```bash
mise exec -- pnpm vitest run src/source/metadata.test.ts
```

Elvárt: PASS, 9 teszt.

- [ ] **6. lépés: Commit**

```bash
git add src/types.ts src/source/metadata.ts src/source/metadata.test.ts
git commit -m "feat(source): opcionális metaadat szűk leképezéssel (Feladat 3)"
```

---

## Feladat 4 — Felirat-vezérelt felderítés

Ez a feladat fordítja meg az ingest irányát. Utána a `pipeline.ts`, a
`state/db.ts` és a `cli.ts` átmenetileg nem fordul — ez várt, a 8. és 9.
feladat állítja helyre.

**Fájlok:**
- Módosít: `src/types.ts` (a `SourceItem` átírása), `src/source/folder.ts`
  (teljes átírás), `src/source/types.ts` (komment)
- Teszt: `src/source/folder.test.ts` (átírás)

**Interfészek:**
- Fogyaszt: `SourceDir` (Feladat 1), `itemIdFor` (Feladat 2), `readSidecar`
  (Feladat 3).
- Termel: `SourceItem`, `splitSubtitleName(fileName): { base, language } | null`,
  `folderSource(source: SourceDir, languages: readonly string[]): Source`,
  `discoverAll(sources: readonly SourceDir[], languages: readonly string[]): Promise<SourceItem[]>`.

- [ ] **1. lépés: A `SourceItem` átírása**

A `src/types.ts`-ben cseréld le a teljes `SourceItem` interfészt:

```ts
/** Egy feldolgozandó elem a forrás-adaptertől. */
export interface SourceItem {
  /** Stabil azonosító: a metaadat videóazonosítója, vagy útvonal-hash. */
  itemId: string
  /** A forrás neve: a konfigurációbeli útvonal utolsó szegmense. */
  source: string
  /** A feliratfájl útvonala a forrás gyökeréhez képest, `/` elválasztóval. */
  sourceFile: string
  /** A feliratfájl abszolút útvonala. */
  subtitlePath: string
  /** A fájlnév nyelvi utótag és kiterjesztés nélkül. Ez adja a jegyzet nevét. */
  baseName: string
  /** A metaadat címe, ha van; egyébként az alapnév. */
  title: string
  /** A választott felirat nyelvi utótagja, ha volt a fájlnévben. */
  language: string | null
  /** A metaadatfájl mezői; üres objektum, ha nincs metaadat. */
  metadata: ItemMetadata
}
```

A `mediaPath` mező **megszűnik**: az app médiafájlt nem olvas.

- [ ] **2. lépés: A bukó tesztek megírása**

Írd felül a `src/source/folder.test.ts` teljes tartalmát:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { discoverAll, folderSource, splitSubtitleName } from './folder.js'

let root: string

const source = () => ({ name: 'youtube', path: root })

async function write(relPath: string, content = ''): Promise<void> {
  const full = join(root, relPath)
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, content, 'utf8')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'refinery-source-'))
})

describe('splitSubtitleName', () => {
  it('levágja a nyelvi utótagot és a kiterjesztést', () => {
    expect(splitSubtitleName('Beszéd.en.srt')).toEqual({ base: 'Beszéd', language: 'en' })
  })

  it('a régiós nyelvkódot is felismeri', () => {
    expect(splitSubtitleName('Beszéd.en-US.vtt')).toEqual({ base: 'Beszéd', language: 'en-US' })
  })

  it('nyelvi utótag nélkül az egész név az alapnév', () => {
    expect(splitSubtitleName('Beszéd.srt')).toEqual({ base: 'Beszéd', language: null })
  })

  it('a nem nyelvkódnak látszó utótagot nem vágja le', () => {
    expect(splitSubtitleName('Some.Talk.srt')).toEqual({ base: 'Some.Talk', language: null })
  })

  it('a korpuszban előforduló dupla pontot is helyesen kezeli', () => {
    expect(splitSubtitleName('A_jovo_fai..en.srt')).toEqual({
      base: 'A_jovo_fai.',
      language: 'en',
    })
  })

  it('nem feliratfájlra null-t ad', () => {
    expect(splitSubtitleName('video.mp4')).toBeNull()
    expect(splitSubtitleName('video.info.json')).toBeNull()
  })
})

describe('folderSource', () => {
  it('metaadatfájl nélküli feliratot is felszed', async () => {
    await write('csatorna/Beszéd.en.srt')
    const [item] = await folderSource(source(), []).discover()
    expect(item!.title).toBe('Beszéd')
    expect(item!.baseName).toBe('Beszéd')
    expect(item!.source).toBe('youtube')
    expect(item!.sourceFile).toBe('csatorna/Beszéd.en.srt')
    expect(item!.metadata).toEqual({})
  })

  it('a metaadatfájlt a felirat mellől veszi', async () => {
    await write('csatorna/Beszéd.en.srt')
    await write(
      'csatorna/Beszéd.info.json',
      JSON.stringify({ id: 'q6p', title: 'Agent Orchestration', channel: 'Burke Holland' }),
    )
    const [item] = await folderSource(source(), []).discover()
    expect(item!.itemId).toBe('q6p')
    expect(item!.title).toBe('Agent Orchestration')
    expect(item!.metadata.channel).toBe('Burke Holland')
  })

  it('a nyelvi preferencia dönt, ha több felirat van', async () => {
    await write('Beszéd.en.srt')
    await write('Beszéd.hu.vtt')
    const [item] = await folderSource(source(), ['hu', 'en']).discover()
    expect(item!.subtitlePath.endsWith('Beszéd.hu.vtt')).toBe(true)
  })

  it('egy alapnévhez akkor is egy elem tartozik, ha három felirat van', async () => {
    await write('Beszéd.en.srt')
    await write('Beszéd.hu.vtt')
    await write('Beszéd.de.vtt')
    expect(await folderSource(source(), ['hu']).discover()).toHaveLength(1)
  })

  it('preferált nyelv híján az .srt nyer a .vtt ellen', async () => {
    await write('Beszéd.de.vtt')
    await write('Beszéd.fr.srt')
    const [item] = await folderSource(source(), ['hu', 'en']).discover()
    expect(item!.subtitlePath.endsWith('Beszéd.fr.srt')).toBe(true)
  })

  it('ugyanazt választja két egymást követő futásban', async () => {
    await write('Beszéd.de.vtt')
    await write('Beszéd.fr.vtt')
    const first = await folderSource(source(), []).discover()
    const second = await folderSource(source(), []).discover()
    expect(first[0]!.subtitlePath).toBe(second[0]!.subtitlePath)
  })

  it('az azonosítót a nyelvváltás nem billenti meg', async () => {
    await write('Beszéd.en.srt')
    const before = (await folderSource(source(), []).discover())[0]!.itemId
    await write('Beszéd.hu.vtt')
    const after = (await folderSource(source(), ['hu']).discover())[0]!.itemId
    expect(after).toBe(before)
  })

  it('a sérült metaadatfájl nem ejti ki az elemet', async () => {
    await write('Beszéd.en.srt')
    await write('Beszéd.info.json', '{ ez nem json')
    const [item] = await folderSource(source(), []).discover()
    expect(item!.title).toBe('Beszéd')
  })

  it('a médiafájlokat és a metaadatfájlokat nem tekinti elemnek', async () => {
    await write('Beszéd.mp4')
    await write('Beszéd.info.json', '{}')
    expect(await folderSource(source(), []).discover()).toHaveLength(0)
  })

  it('nem létező forrásmappára üres listát ad', async () => {
    const items = await folderSource({ name: 'nincs', path: join(root, 'nincs') }, []).discover()
    expect(items).toEqual([])
  })

  it('rögzített sorrendben adja vissza az elemeket', async () => {
    await write('b/Második.en.srt')
    await write('a/Első.en.srt')
    const items = await folderSource(source(), []).discover()
    expect(items.map((i) => i.sourceFile)).toEqual(['a/Első.en.srt', 'b/Második.en.srt'])
  })
})

describe('discoverAll', () => {
  it('minden forrást bejár, és megjelöli, melyikből jött', async () => {
    await write('egy/A.en.srt')
    await mkdir(join(root, 'masodik'), { recursive: true })
    await writeFile(join(root, 'masodik', 'B.en.srt'), '', 'utf8')
    const items = await discoverAll(
      [
        { name: 'egy', path: join(root, 'egy') },
        { name: 'masodik', path: join(root, 'masodik') },
      ],
      [],
    )
    expect(items.map((i) => `${i.source}/${i.baseName}`)).toEqual(['egy/A', 'masodik/B'])
  })

  it('az azonos azonosítójú elemet nem veszi fel kétszer', async () => {
    const info = JSON.stringify({ id: 'ugyanaz' })
    await write('egy/A.en.srt')
    await write('egy/A.info.json', info)
    await write('ketto/A.en.srt')
    await write('ketto/A.info.json', info)
    const items = await discoverAll(
      [
        { name: 'egy', path: join(root, 'egy') },
        { name: 'ketto', path: join(root, 'ketto') },
      ],
      [],
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.source).toBe('egy')
  })
})
```

- [ ] **3. lépés: A tesztek futtatása — bukniuk kell**

```bash
mise exec -- pnpm vitest run src/source/folder.test.ts
```

Elvárt: FAIL, `splitSubtitleName` és `discoverAll` nincs exportálva.

- [ ] **4. lépés: A `folder.ts` átírása**

Írd felül a `src/source/folder.ts` teljes tartalmát:

```ts
import { readdir } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import type { SourceDir } from '../config.js'
import type { SourceItem } from '../types.js'
import { itemIdFor } from './identity.js'
import { readSidecar } from './metadata.js'
import type { Source } from './types.js'

const SUBTITLE_EXTENSIONS = ['.srt', '.vtt'] as const

/**
 * Nyelvkódnak látszó utótag: `en`, `hu`, `en-US`. A szűkítés szándékos — a
 * `Some.Talk.srt` alapneve `Some.Talk` marad, nem `Some`.
 */
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$/

/** Az útvonal `/` elválasztóval, hogy a frontmatter platformfüggetlen legyen. */
function toPosix(path: string): string {
  return path.split(sep).join('/')
}

async function walk(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return [] // nem létező vagy olvashatatlan mappa: nincs mit felszedni
  }
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full)))
    else files.push(full)
  }
  return files
}

export interface SubtitleName {
  base: string
  language: string | null
}

/**
 * `Beszéd.en.srt` → `{ base: 'Beszéd', language: 'en' }`. Nem feliratfájlra
 * `null`. Az alapnév a metaadatfájl megtalálásának és az elem
 * azonosításának is az alapja, ezért a levágás szabályai szűkek.
 */
export function splitSubtitleName(fileName: string): SubtitleName | null {
  const lower = fileName.toLowerCase()
  const ext = SUBTITLE_EXTENSIONS.find((candidate) => lower.endsWith(candidate))
  if (!ext) return null

  const withoutExt = fileName.slice(0, -ext.length)
  const dot = withoutExt.lastIndexOf('.')
  if (dot > 0) {
    const tag = withoutExt.slice(dot + 1)
    if (LANGUAGE_TAG.test(tag)) {
      return { base: withoutExt.slice(0, dot), language: tag }
    }
  }
  return { base: withoutExt, language: null }
}

interface Candidate {
  path: string
  language: string | null
}

/**
 * Determinisztikus tartalék: `.srt` előbb, mint `.vtt`, azon belül
 * ábécésorrend. Enélkül a fájlrendszer felsorolási sorrendje döntene, és két
 * gépen két másik jegyzet készülne ugyanabból a mappából.
 */
function byFallback(a: Candidate, b: Candidate): number {
  const rank = (c: Candidate) => (c.path.toLowerCase().endsWith('.srt') ? 0 : 1)
  return rank(a) - rank(b) || a.path.localeCompare(b.path)
}

function chooseSubtitle(
  candidates: readonly Candidate[],
  languages: readonly string[],
): Candidate {
  const sorted = [...candidates].sort(byFallback)
  for (const wanted of languages) {
    const hit = sorted.find((c) => c.language?.toLowerCase().startsWith(wanted.toLowerCase()))
    if (hit) return hit
  }
  return sorted[0]!
}

/**
 * Feliratmappából olvas. Offline és determinisztikus: a fejlesztés és a
 * tesztelés nem függ hálózattól.
 *
 * A felderítés a **feliratfájlokon** iterál. A metaadatfájl kiegészítés: ha
 * van, gazdagabb lesz a jegyzet, de a hiánya nem ejt ki elemet.
 */
export function folderSource(source: SourceDir, languages: readonly string[]): Source {
  return {
    id: source.name,

    async discover(): Promise<SourceItem[]> {
      const files = await walk(source.path)

      // Csoportosítás mappa + alapnév szerint: egy alapnévhez egy elem
      // tartozik, akárhány nyelven van hozzá felirat.
      const groups = new Map<string, Candidate[]>()
      for (const path of files) {
        const parsed = splitSubtitleName(basename(path))
        if (!parsed) continue
        const key = join(dirname(path), parsed.base)
        const list = groups.get(key) ?? []
        list.push({ path, language: parsed.language })
        groups.set(key, list)
      }

      const items: SourceItem[] = []
      const keys = [...groups.keys()].sort((a, b) => a.localeCompare(b))
      for (const key of keys) {
        const chosen = chooseSubtitle(groups.get(key)!, languages)
        const sidecar = await readSidecar(`${key}.info.json`)
        const baseName = basename(key)
        const relBase = toPosix(relative(source.path, key))

        items.push({
          itemId: itemIdFor(source.name, relBase, sidecar?.metadata.videoId),
          source: source.name,
          sourceFile: toPosix(relative(source.path, chosen.path)),
          subtitlePath: chosen.path,
          baseName,
          title: sidecar?.title ?? baseName,
          language: chosen.language,
          metadata: sidecar?.metadata ?? {},
        })
      }

      return items
    },
  }
}

/**
 * Az összes konfigurált forrás bejárása, a konfigurációban megadott
 * sorrendben.
 *
 * Az azonos azonosítójú elem kimarad: ha ugyanaz a videó két forrásban is ott
 * van, az állapottár egyetlen elemként tartaná nyilván, de két külön jegyzetet
 * írna — a második futás pedig „már feldolgozva" címén kihagyná az egyiket.
 * Az első előfordulás nyer.
 */
export async function discoverAll(
  sources: readonly SourceDir[],
  languages: readonly string[],
): Promise<SourceItem[]> {
  const seen = new Set<string>()
  const items: SourceItem[] = []
  for (const source of sources) {
    for (const item of await folderSource(source, languages).discover()) {
      if (seen.has(item.itemId)) continue
      seen.add(item.itemId)
      items.push(item)
    }
  }
  return items
}
```

- [ ] **5. lépés: A `Source` interfész kommentjének javítása**

A `src/source/types.ts`-ben cseréld le a doc-kommentet — a mai szöveg egy
URL-alapú második implementációt ígér, amit ez az architektúra nem tervez:

```ts
import type { SourceItem } from '../types.js'

/**
 * Egy feliratforrás. Az `id` a forrás neve, ahogy a konfigurációban szerepel;
 * a jelentésekben ez azonosítja, melyik mappából jött az elem.
 */
export interface Source {
  readonly id: string
  discover(): Promise<SourceItem[]>
}
```

- [ ] **6. lépés: A tesztek futtatása — zöldnek kell lenniük**

```bash
mise exec -- pnpm vitest run src/source/folder.test.ts
```

Elvárt: PASS, 19 teszt.

- [ ] **7. lépés: Commit**

```bash
git add src/types.ts src/source/folder.ts src/source/folder.test.ts src/source/types.ts
git commit -m "feat(source): a felderítés a feliratfájlokból indul, nem a metaadatból (Feladat 4)"
```

---

## Feladat 5 — Állapottár `item_id` kulcsra

**Fájlok:**
- Módosít: `src/state/db.ts`
- Teszt: `src/state/db.test.ts` (átírás)

**Interfészek:**
- Fogyaszt: `SourceItem` (Feladat 4).
- Termel: `StateStore` az átnevezett metódusokkal — `recordItem(item)`,
  `recordTranscript(itemId, …)`, `recordArtifact(itemId, …)`,
  `artifactOf(itemId, kind)`, `transcriptOf(itemId)`, `isDone(itemId, kind)`,
  `listPending(items, kind)`, `close()`.

- [ ] **1. lépés: A bukó tesztek megírása**

Írd felül a `src/state/db.test.ts` teljes tartalmát:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openState, type StateStore } from './db.js'
import type { SourceItem } from '../types.js'

let store: StateStore

const item = (overrides: Partial<SourceItem> = {}): SourceItem => ({
  itemId: 'a1b2c3',
  source: 'youtube',
  sourceFile: 'csatorna/Beszéd.en.srt',
  subtitlePath: '/s/youtube/csatorna/Beszéd.en.srt',
  baseName: 'Beszéd',
  title: 'Beszéd',
  language: 'en',
  metadata: {},
  ...overrides,
})

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'refinery-state-'))
  store = openState(join(dir, 'state.db'))
})

afterEach(() => {
  store.close()
})

describe('StateStore', () => {
  it('metaadat nélküli elemet is el tud tárolni', () => {
    store.recordItem(item())
    store.recordTranscript('a1b2c3', 'creator', 100, 90)
    expect(store.transcriptOf('a1b2c3')).toEqual({
      source: 'creator',
      wordsRaw: 100,
      wordsNormalized: 90,
    })
  })

  it('a metaadatot eltárolja, ha van', () => {
    store.recordItem(item({ itemId: 'q6p', metadata: { videoId: 'q6p', channel: 'Cs' } }))
    store.recordArtifact('q6p', 'transcript', 'done', '/v/a.md', null)
    expect(store.artifactOf('q6p', 'transcript')?.path).toBe('/v/a.md')
  })

  it('ugyanazt az elemet kétszer rögzítve nem duplikál', () => {
    store.recordItem(item())
    store.recordItem(item({ title: 'Új cím' }))
    expect(store.listPending([item()], 'transcript')).toHaveLength(1)
  })

  it('a kész elemet kihagyja a függők közül', () => {
    const it1 = item()
    const it2 = item({ itemId: 'masik' })
    store.recordItem(it1)
    store.recordArtifact('a1b2c3', 'transcript', 'done', '/v/a.md', null)
    expect(store.listPending([it1, it2], 'transcript').map((i) => i.itemId)).toEqual(['masik'])
  })

  it('a hibás artefaktum nem számít késznek', () => {
    store.recordItem(item())
    store.recordArtifact('a1b2c3', 'transcript', 'failed', null, 'olvashatatlan')
    expect(store.isDone('a1b2c3', 'transcript')).toBe(false)
  })

  it('a recept mérőszámait visszaadja', () => {
    store.recordItem(item())
    store.recordArtifact('a1b2c3', 'summary', 'done', '/v/s.md', null, {
      iterations: 2,
      score: 0.85,
      costUsd: 0.08,
      model: 'claude-sonnet-5',
    })
    const record = store.artifactOf('a1b2c3', 'summary')
    expect(record?.iterations).toBe(2)
    expect(record?.model).toBe('claude-sonnet-5')
  })

  it('a kétszeri zárás nem dob', () => {
    store.close()
    expect(() => store.close()).not.toThrow()
  })
})
```

- [ ] **2. lépés: A tesztek futtatása — bukniuk kell**

```bash
mise exec -- pnpm vitest run src/state/db.test.ts
```

Elvárt: FAIL, `store.recordItem is not a function`.

- [ ] **3. lépés: A séma és a `recordItem` átírása**

A `src/state/db.ts`-ben cseréld le a `SCHEMA` konstanst, és **töröld** a
`migrateArtifacts` függvényt, az `ARTIFACT_COLUMNS` listát és a hívásukat: a
tiszta törés miatt nincs mit migrálni, az új táblanevek üresen indulnak.

```ts
const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  item_id       TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  source_file   TEXT NOT NULL,
  base_name     TEXT NOT NULL,
  title         TEXT NOT NULL,
  language      TEXT,
  video_id      TEXT,
  channel       TEXT,
  uploaded_at   TEXT,
  url           TEXT,
  subtitle_path TEXT NOT NULL,
  discovered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transcripts (
  item_id          TEXT PRIMARY KEY REFERENCES items(item_id),
  source           TEXT NOT NULL,
  words_raw        INTEGER NOT NULL,
  words_normalized INTEGER NOT NULL,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  item_id    TEXT NOT NULL REFERENCES items(item_id),
  kind       TEXT NOT NULL,
  status     TEXT NOT NULL,
  path       TEXT,
  error      TEXT,
  iterations INTEGER,
  score      REAL,
  cost_usd   REAL,
  model      TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (item_id, kind)
);
`
```

A `recordVideo` helyére:

```ts
    recordItem(item) {
      db.prepare(
        `INSERT INTO items
           (item_id, source, source_file, base_name, title, language,
            video_id, channel, uploaded_at, url, subtitle_path, discovered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_id) DO UPDATE SET
           source = excluded.source,
           source_file = excluded.source_file,
           base_name = excluded.base_name,
           title = excluded.title,
           language = excluded.language,
           video_id = excluded.video_id,
           channel = excluded.channel,
           uploaded_at = excluded.uploaded_at,
           url = excluded.url,
           subtitle_path = excluded.subtitle_path`,
      ).run(
        item.itemId,
        item.source,
        item.sourceFile,
        item.baseName,
        item.title,
        item.language,
        item.metadata.videoId ?? null,
        item.metadata.channel ?? null,
        item.metadata.uploadedAt ?? null,
        item.metadata.url ?? null,
        item.subtitlePath,
        now(),
      )
    },
```

- [ ] **4. lépés: A többi metódus átnevezése**

A `StateStore` interfészben és a megvalósításban minden `videoId: string`
paraméter `itemId: string`-re változik, minden `video_id = ?` feltétel
`item_id = ?`-re, a `videos` táblanév `items`-re. A `listPending` a
`items.map` helyett `item.itemId`-t olvas:

```ts
    listPending(items, kind) {
      return items.filter((item) => !isDone(item.itemId, kind))
    },
```

- [ ] **5. lépés: A tesztek futtatása — zöldnek kell lenniük**

```bash
mise exec -- pnpm vitest run src/state/db.test.ts
```

Elvárt: PASS, 7 teszt.

- [ ] **6. lépés: Commit**

```bash
git add src/state/db.ts src/state/db.test.ts
git commit -m "feat(state): item_id kulcs a videóazonosító helyett (Feladat 5)"
```

---

## Feladat 6 — Metaadat-független célút

**Fájlok:**
- Módosít: `src/vault/paths.ts` (teljes átírás)
- Teszt: `src/vault/paths.test.ts` (átírás)

**Interfészek:**
- Fogyaszt: `SourceItem` (Feladat 4), `sanitizeSegment` (változatlan).
- Termel: `noteFile(notesRoot: string, item: SourceItem, outputFile: string): string`,
  `transcriptFile(notesRoot: string, item: SourceItem): string`.
- **Megszűnik:** `resolveChannelDir`, `videoDir`, `recipeFile`.

- [ ] **1. lépés: A bukó tesztek megírása**

Írd felül a `src/vault/paths.test.ts` teljes tartalmát:

```ts
import { describe, expect, it } from 'vitest'
import { noteFile, transcriptFile } from './paths.js'
import type { SourceItem } from '../types.js'

const item = (overrides: Partial<SourceItem> = {}): SourceItem => ({
  itemId: 'a1b2c3',
  source: 'youtube',
  sourceFile: '3Blue1Brown/Transformers.en.srt',
  subtitlePath: '/s/youtube/3Blue1Brown/Transformers.en.srt',
  baseName: 'Transformers',
  title: 'Transformers, the tech behind LLMs',
  language: 'en',
  metadata: {},
  ...overrides,
})

describe('noteFile', () => {
  it('a forrás nevét és a forráson belüli mappát tükrözi', () => {
    expect(noteFile('/v/Inbox/transcript-refinery', item(), '_transcript.md')).toBe(
      '/v/Inbox/transcript-refinery/youtube/3Blue1Brown/Transformers_transcript.md',
    )
  })

  it('a fájlnevet az alapnévből képzi, nem a metaadat címéből', () => {
    const path = noteFile('/v/gyökér', item({ title: 'Egészen más cím' }), '_transcript.md')
    expect(path.endsWith('/Transformers_transcript.md')).toBe(true)
  })

  it('metaadattal és nélküle ugyanoda ír', () => {
    const withMeta = item({ metadata: { videoId: 'q6p', channel: 'Cs', url: 'https://x' } })
    expect(noteFile('/v/gy', withMeta, '_transcript.md')).toBe(
      noteFile('/v/gy', item(), '_transcript.md'),
    )
  })

  it('a forrás gyökerében álló feliratot nem teszi almappába', () => {
    expect(noteFile('/v/gy', item({ sourceFile: 'Egy.en.srt' }), '_transcript.md')).toBe(
      '/v/gy/youtube/Egy_transcript.md',
    )
  })

  it('a mélyebb mappaszerkezetet is tükrözi', () => {
    const deep = item({ sourceFile: 'a/b/c/Mély.en.srt', baseName: 'Mély' })
    expect(noteFile('/v/gy', deep, '_transcript.md')).toBe('/v/gy/youtube/a/b/c/Mély_transcript.md')
  })

  it('a fájlrendszerre veszélyes karaktereket minden szegmensben cseréli', () => {
    const risky = item({ source: 'a:b', sourceFile: 'c?d/E*F.en.srt', baseName: 'E*F' })
    const path = noteFile('/v/gy', risky, '_transcript.md')
    expect(path).toBe('/v/gy/a：b/c？d/E＊F_transcript.md')
  })

  it('a recept utótagját változatlanul fűzi hozzá', () => {
    expect(noteFile('/v/gy', item(), '_summary.md').endsWith('Transformers_summary.md')).toBe(true)
  })
})

describe('transcriptFile', () => {
  it('a noteFile speciális esete', () => {
    expect(transcriptFile('/v/gy', item())).toBe(noteFile('/v/gy', item(), '_transcript.md'))
  })
})
```

- [ ] **2. lépés: A tesztek futtatása — bukniuk kell**

```bash
mise exec -- pnpm vitest run src/vault/paths.test.ts
```

Elvárt: FAIL, `noteFile` nincs exportálva.

- [ ] **3. lépés: A megvalósítás**

Írd felül a `src/vault/paths.ts` teljes tartalmát:

```ts
import { dirname, join } from 'node:path'
import type { SourceItem } from '../types.js'
import { sanitizeSegment } from './sanitize.js'

/**
 * A jegyzet célútja: `<gyökér>/<forrás>/<a felirat relatív mappája>/<alapnév><utótag>`.
 *
 * Szándékosan **metaadat-független**: ugyanoda ír metaadatfájllal és nélküle
 * is. Ha a célút a metaadatból jönne, ugyanaz a felirat két helyre kerülne
 * aszerint, hogy a metaadat elérhető volt-e — és a write-once védelem nem
 * venné észre a duplikátumot.
 *
 * A forrásmappa szerkezetének tükrözése azért jó csoportosítás, mert a
 * letöltők eleve csatornánként rendezik a fájlokat; ehhez viszont nem kell
 * tudnunk, hogy a mappa neve csatornát jelöl-e.
 */
export function noteFile(
  notesRoot: string,
  item: SourceItem,
  outputFile: string,
): string {
  const relDir = dirname(item.sourceFile)
  const segments = relDir === '.' ? [] : relDir.split('/').map(sanitizeSegment)
  return join(
    notesRoot,
    sanitizeSegment(item.source),
    ...segments,
    `${sanitizeSegment(item.baseName)}${outputFile}`,
  )
}

/** A Fázis 0 átirata: a `noteFile` speciális esete. */
export function transcriptFile(notesRoot: string, item: SourceItem): string {
  return noteFile(notesRoot, item, '_transcript.md')
}
```

- [ ] **4. lépés: A tesztek futtatása — zöldnek kell lenniük**

```bash
mise exec -- pnpm vitest run src/vault/paths.test.ts
```

Elvárt: PASS, 8 teszt.

- [ ] **5. lépés: Commit**

```bash
git add src/vault/paths.ts src/vault/paths.test.ts
git commit -m "feat(vault): a célút a forrásmappát tükrözi, nem a metaadatot (Feladat 6)"
```

---

## Feladat 7 — Frontmatter, ami mindig elkészül

**Fájlok:**
- Létrehoz: `src/vault/frontmatter.ts`
- Módosít: `src/vault/render.ts` (teljes átírás)
- Teszt: `src/vault/frontmatter.test.ts` (új), `src/vault/render.test.ts` (átírás)

**Interfészek:**
- Fogyaszt: `SourceItem`, `NormalizedTranscript`.
- Termel: `FrontmatterValue`, `FrontmatterField`,
  `renderFrontmatter(fields: readonly FrontmatterField[]): string`;
  a `renderTranscriptNote(item, transcript, generatorVersion)` és a
  `renderRecipeNote(item, transcript, body, meta, generatorVersion)`
  szignatúrája nem változik.

- [ ] **1. lépés: A frontmatter-renderelő bukó tesztjei**

Hozd létre a `src/vault/frontmatter.test.ts` fájlt:

```ts
import { describe, expect, it } from 'vitest'
import { renderFrontmatter } from './frontmatter.js'

describe('renderFrontmatter', () => {
  it('a mezőket a megadott sorrendben írja ki', () => {
    expect(renderFrontmatter([['a', '1'], ['b', '2']])).toBe('---\na: 1\nb: 2\n---')
  })

  it('a hiányzó mezőt kihagyja, nem null-ozza', () => {
    expect(renderFrontmatter([['a', '1'], ['b', undefined], ['c', '3']])).toBe(
      '---\na: 1\nc: 3\n---',
    )
  })

  it('a számot idézőjel nélkül írja', () => {
    expect(renderFrontmatter([['duration', 1806]])).toBe('---\nduration: 1806\n---')
  })

  it('a különleges karaktert tartalmazó szöveget idézőjelezi', () => {
    expect(renderFrontmatter([['title', 'Egy: kettő']])).toBe('---\ntitle: "Egy: kettő"\n---')
  })

  it('az idézőjelet és a backslasht escape-eli', () => {
    expect(renderFrontmatter([['t', 'a "b" \\ c']])).toBe('---\nt: "a \\"b\\" \\\\ c"\n---')
  })

  it('a többsoros szöveget blokk-skalárként írja', () => {
    expect(renderFrontmatter([['description', 'Első\nMásodik']])).toBe(
      '---\ndescription: |-\n  Első\n  Második\n---',
    )
  })

  it('a CRLF-et normalizálja, és a záró üres sorokat levágja', () => {
    expect(renderFrontmatter([['description', 'Első\r\nMásodik\n\n']])).toBe(
      '---\ndescription: |-\n  Első\n  Második\n---',
    )
  })

  it('a listát folyó alakban írja, elemenként idézve', () => {
    expect(renderFrontmatter([['tags', ['ai', 'két szó', 'a:b']]])).toBe(
      '---\ntags: [ai, két szó, "a:b"]\n---',
    )
  })

  it('üres mezőlistából is érvényes határolókat ad', () => {
    expect(renderFrontmatter([])).toBe('---\n---')
  })
})
```

- [ ] **2. lépés: A tesztek futtatása — bukniuk kell**

```bash
mise exec -- pnpm vitest run src/vault/frontmatter.test.ts
```

Elvárt: FAIL, `Cannot find module './frontmatter.js'`.

- [ ] **3. lépés: A frontmatter-renderelő megvalósítása**

Hozd létre a `src/vault/frontmatter.ts` fájlt:

```ts
export type FrontmatterValue = string | number | readonly string[]

/** Egy mező: név és érték. Az `undefined` érték kimarad a kimenetből. */
export type FrontmatterField = readonly [name: string, value: FrontmatterValue | undefined]

/**
 * Idézőjel nélkül biztonságos alak. Szűk szándékosan: a `:` és a `#` YAML-ban
 * jelentést hordoz, ezért az ilyen érték idézőjelet kap.
 */
const PLAIN = /^[\w .@-]+$/u

function scalar(value: string): string {
  if (value === '') return '""'
  if (PLAIN.test(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Blokk-skalár a többsoros értékekhez. A `|-` a záró sortörést levágja, így a
 * mező értéke pontosan az, ami a forrásban volt.
 */
function block(name: string, value: string): string {
  const lines = value.split('\n').map((line) => (line === '' ? '' : `  ${line}`))
  return [`${name}: |-`, ...lines].join('\n')
}

/**
 * Mezőlista → YAML-frontmatter.
 *
 * A hiányzó mező **kimarad**, nem `null` értékkel szerepel: a `channel: null`
 * azt állítaná, hogy tudjuk, nincs csatorna, holott csak nem volt metaadat.
 * A különbség a későbbi mérésben számít.
 */
export function renderFrontmatter(fields: readonly FrontmatterField[]): string {
  const lines: string[] = ['---']

  for (const [name, value] of fields) {
    if (value === undefined) continue

    if (typeof value === 'number') {
      lines.push(`${name}: ${String(value)}`)
      continue
    }

    if (typeof value !== 'string') {
      lines.push(`${name}: [${value.map(scalar).join(', ')}]`)
      continue
    }

    const text = value.replace(/\r\n/g, '\n').replace(/\n+$/, '')
    lines.push(text.includes('\n') ? block(name, text) : `${name}: ${scalar(text)}`)
  }

  lines.push('---')
  return lines.join('\n')
}
```

- [ ] **4. lépés: A tesztek futtatása — zöldnek kell lenniük**

```bash
mise exec -- pnpm vitest run src/vault/frontmatter.test.ts
```

Elvárt: PASS, 9 teszt.

- [ ] **5. lépés: A jegyzet-renderelés bukó tesztjei**

Írd felül a `src/vault/render.test.ts` teljes tartalmát:

```ts
import { describe, expect, it } from 'vitest'
import { renderRecipeNote, renderTranscriptNote } from './render.js'
import type { NormalizedTranscript, SourceItem } from '../types.js'

const item = (overrides: Partial<SourceItem> = {}): SourceItem => ({
  itemId: 'a1b2c3',
  source: 'youtube',
  sourceFile: '3Blue1Brown/Transformers.en.srt',
  subtitlePath: '/s/youtube/3Blue1Brown/Transformers.en.srt',
  baseName: 'Transformers',
  title: 'Transformers',
  language: 'en',
  metadata: {},
  ...overrides,
})

const transcript: NormalizedTranscript = {
  lines: ['Első mondat.', 'Második mondat.'],
  wordsRaw: 100,
  wordsNormalized: 90,
  captionSource: 'creator',
  punctuationDensity: 4.2,
}

describe('renderTranscriptNote', () => {
  it('metaadat nélkül is érvényes frontmattert ad', () => {
    const note = renderTranscriptNote(item(), transcript, '0.1.0')
    expect(note.startsWith('---\n')).toBe(true)
    expect(note).toContain('item_id: a1b2c3')
    expect(note).toContain('title: Transformers')
    expect(note).toContain('source: youtube')
    expect(note).toContain('source_file: 3Blue1Brown/Transformers.en.srt')
    expect(note).toContain('words_raw: 100')
    expect(note).toContain('generator: transcript-refinery@0.1.0')
  })

  it('metaadat nélkül nem ír video_id, channel és url mezőt', () => {
    const note = renderTranscriptNote(item(), transcript, '0.1.0')
    expect(note).not.toContain('video_id')
    expect(note).not.toContain('channel')
    expect(note).not.toContain('url')
  })

  it('metaadattal a bővebb mezőket is kiírja', () => {
    const note = renderTranscriptNote(
      item({
        metadata: {
          videoId: 'q6p',
          channel: '3Blue1Brown',
          uploadedAt: '2026-07-14',
          url: 'https://example.com/v',
          duration: 1806,
          tags: ['ai'],
          description: 'Első\nMásodik',
        },
      }),
      transcript,
      '0.1.0',
    )
    expect(note).toContain('video_id: q6p')
    expect(note).toContain('channel: 3Blue1Brown')
    expect(note).toContain('uploaded: 2026-07-14')
    expect(note).toContain('duration: 1806')
    expect(note).toContain('tags: [ai]')
    expect(note).toContain('description: |-\n  Első\n  Második')
  })

  it('a felirat eredetét rögzíti', () => {
    expect(renderTranscriptNote(item(), transcript, '0.1.0')).toContain(
      'transcript_source: creator_captions',
    )
    expect(
      renderTranscriptNote(item(), { ...transcript, captionSource: 'auto' }, '0.1.0'),
    ).toContain('transcript_source: auto_captions')
  })

  it('URL nélkül nem ír linksort a törzsbe', () => {
    expect(renderTranscriptNote(item(), transcript, '0.1.0')).not.toContain('🌐')
  })

  it('URL-lel kiírja a linksort', () => {
    const note = renderTranscriptNote(
      item({ metadata: { url: 'https://example.com/v' } }),
      transcript,
      '0.1.0',
    )
    expect(note).toContain('🌐 <https://example.com/v>')
  })

  it('a törzsben a cím és a bekezdéssé fűzött szöveg szerepel', () => {
    const note = renderTranscriptNote(item(), transcript, '0.1.0')
    expect(note).toContain('# Transformers')
    expect(note).toContain('Első mondat. Második mondat.')
  })
})

describe('renderRecipeNote', () => {
  const meta = {
    recipe: 'summary',
    model: 'claude-sonnet-5',
    iterations: 2,
    score: 0.85,
    costUsd: 0.0812,
  }

  it('a futás mérőszámait a frontmatterbe teszi', () => {
    const note = renderRecipeNote(item(), transcript, 'A törzs.', meta, '0.1.0')
    expect(note).toContain('recipe: summary')
    expect(note).toContain('model: claude-sonnet-5')
    expect(note).toContain('iterations: 2')
    expect(note).toContain('score: 0.85')
    expect(note).toContain('cost_usd: 0.0812')
  })

  it('metaadat nélkül is elkészül', () => {
    const note = renderRecipeNote(item(), transcript, 'A törzs.', meta, '0.1.0')
    expect(note).toContain('item_id: a1b2c3')
    expect(note).not.toContain('video_id')
    expect(note.trimEnd().endsWith('A törzs.')).toBe(true)
  })
})
```

- [ ] **6. lépés: A tesztek futtatása — bukniuk kell**

```bash
mise exec -- pnpm vitest run src/vault/render.test.ts
```

Elvárt: FAIL, a `SourceItem` mezői nem stimmelnek, `item_id` nincs a kimenetben.

- [ ] **7. lépés: A `render.ts` átírása**

Írd felül a `src/vault/render.ts` teljes tartalmát:

```ts
import { toParagraphs } from '../normalize/dedupe.js'
import type { NormalizedTranscript, SourceItem } from '../types.js'
import { renderFrontmatter, type FrontmatterField } from './frontmatter.js'

/**
 * A minden jegyzeten szereplő mezők.
 *
 * Az első négy metaadat nélkül is kitölthető — ez a garancia, hogy a
 * frontmatter mindig elkészül. Utánuk a metaadat mezői jönnek, amik hiány
 * esetén kimaradnak, majd a normalizálás mérőszámai, amik szintén mindig
 * megvannak.
 *
 * A származás rögzítése nem díszítés: enélkül a későbbi mérés nem tudná,
 * milyen minőségű bemeneten dolgozott.
 */
function baseFields(
  item: SourceItem,
  transcript: NormalizedTranscript,
  generatorVersion: string,
): FrontmatterField[] {
  const captionSource =
    transcript.captionSource === 'creator' ? 'creator_captions' : 'auto_captions'

  return [
    ['item_id', item.itemId],
    ['title', item.title],
    ['source', item.source],
    ['source_file', item.sourceFile],
    ['language', item.language ?? undefined],
    ['video_id', item.metadata.videoId],
    ['channel', item.metadata.channel],
    ['uploaded', item.metadata.uploadedAt],
    ['url', item.metadata.url],
    ['duration', item.metadata.duration],
    ['tags', item.metadata.tags],
    ['description', item.metadata.description],
    ['transcript_source', captionSource],
    ['words_raw', transcript.wordsRaw],
    ['words_normalized', transcript.wordsNormalized],
    ['punctuation_density', transcript.punctuationDensity.toFixed(2)],
    ['generated_at', new Date().toISOString()],
    ['generator', `transcript-refinery@${generatorVersion}`],
  ]
}

/** A jegyzet törzse. A linksor kimarad, ha nincs URL — üres link nem kerül a vaultba. */
function body(item: SourceItem, content: string): string {
  const link = item.metadata.url ? [`🌐 <${item.metadata.url}>`, ''] : []
  return ['', `# ${item.title}`, '', ...link, '---', '', content, ''].join('\n')
}

/** Normalizált átirat → vault-jegyzet. */
export function renderTranscriptNote(
  item: SourceItem,
  transcript: NormalizedTranscript,
  generatorVersion: string,
): string {
  const frontmatter = renderFrontmatter(baseFields(item, transcript, generatorVersion))
  return frontmatter + body(item, toParagraphs(transcript.lines))
}

/** Egy recept futásának eredménye, ahogy a frontmatterbe kerül. */
export interface RecipeNoteMeta {
  recipe: string
  /** A ténylegesen futott generáló modell neve. */
  model: string
  /** Hány generálás történt. */
  iterations: number
  score: number
  costUsd: number
}

/**
 * Recept kimenete → vault-jegyzet.
 *
 * A frontmatter az átirat származását **és** a generálás körülményeit is
 * rögzíti: melyik modell, hány körben és mennyiért állította elő a jegyzetet.
 */
export function renderRecipeNote(
  item: SourceItem,
  transcript: NormalizedTranscript,
  content: string,
  meta: RecipeNoteMeta,
  generatorVersion: string,
): string {
  const frontmatter = renderFrontmatter([
    ...baseFields(item, transcript, generatorVersion),
    ['recipe', meta.recipe],
    ['model', meta.model],
    ['iterations', meta.iterations],
    ['score', meta.score.toFixed(2)],
    ['cost_usd', meta.costUsd.toFixed(4)],
  ])
  return frontmatter + body(item, content.trim())
}
```

- [ ] **8. lépés: A tesztek futtatása — zöldnek kell lenniük**

```bash
mise exec -- pnpm vitest run src/vault/render.test.ts src/vault/frontmatter.test.ts
```

Elvárt: PASS, 18 teszt.

- [ ] **9. lépés: Commit**

```bash
git add src/vault/frontmatter.ts src/vault/frontmatter.test.ts \
        src/vault/render.ts src/vault/render.test.ts
git commit -m "feat(vault): a frontmatter metaadat nélkül is elkészül (Feladat 7)"
```

---

## Feladat 8 — Események, csővezeték és receptek

Ez a feladat állítja át a `SourceItem` **összes** fogyasztóját: a
csővezetéket, az eseményeket, a recept-promptot és a mérési harnesst.

**Fájlok:**
- Módosít: `src/events.ts`, `src/pipeline.ts`, `src/recipe/summary.ts`,
  `evals/summary.eval.ts`
- Teszt: `src/events.test.ts`, `src/pipeline.test.ts`,
  `src/recipe/summary.test.ts` (átírás)

**Interfészek:**
- Fogyaszt: minden korábbi feladat terméke.
- Termel: `RunEvent` az `itemId` mezővel; a `processItem(item, deps)` és a
  `normalizeItem(item)` szignatúrája nem változik.

- [ ] **1. lépés: Az események átnevezése**

A `src/events.ts`-ben minden `videoId: string` mező `itemId: string`-re
változik — a `item:start`, `item:parsed`, `item:normalized`, `item:published`,
`item:skipped`, `item:failed`, `item:generating`, `item:scored`, `item:refined`
variánsokban. A `scan:start` `source` mezője marad: mostantól a forrás neve
kerül bele.

Az `src/events.test.ts`-ben ugyanez a csere a fixture-eseményekben.

- [ ] **2. lépés: A csővezeték tesztjeinek átírása**

A `src/pipeline.test.ts`-ben cseréld le a fixture-építőt erre:

```ts
const item = (overrides: Partial<SourceItem> = {}): SourceItem => ({
  itemId: 'a1b2c3',
  source: 'youtube',
  sourceFile: 'csatorna/Beszéd.en.srt',
  subtitlePath: join(dir, 'Beszéd.en.srt'),
  baseName: 'Beszéd',
  title: 'Beszéd',
  language: 'en',
  metadata: {},
  ...overrides,
})
```

majd a fájl egészében: `videoId` → `itemId`, `recordVideo` → `recordItem`,
`notesRoot` marad. Az eseményekre vonatkozó `expect`-ekben a `videoId` mező
neve is változik.

Ezután **vedd fel ezt a két új tesztet** a `processItem`-et vizsgáló
`describe` blokkba:

```ts
  it('metaadat nélküli elemet is végigvisz, és a forrás fája alá ír', async () => {
    const { sink, events } = collectEvents()
    const outcome = await processItem(item(), {
      notesRoot,
      store,
      sink,
      version: '0.1.0',
      options: { force: false, dryRun: false },
    })
    expect(outcome.status).toBe('published')
    expect(outcome.path).toBe(join(notesRoot, 'youtube', 'csatorna', 'Beszéd_transcript.md'))
    expect(events.some((e) => e.type === 'item:published')).toBe(true)
  })

  it('a második futás ugyanarra az elemre nem ír újra', async () => {
    const deps = {
      notesRoot,
      store,
      sink: collectEvents().sink,
      version: '0.1.0',
      options: { force: false, dryRun: false },
    }
    await processItem(item(), deps)
    const second = await processItem(item(), deps)
    expect(second.status).toBe('skipped')
  })
```

- [ ] **3. lépés: A tesztek futtatása — bukniuk kell**

```bash
mise exec -- pnpm vitest run src/pipeline.test.ts src/events.test.ts
```

Elvárt: FAIL, a `pipeline.ts` még a `resolveChannelDir`-t hívja.

- [ ] **4. lépés: A `pipeline.ts` átállítása**

Négy csere a fájlban:

1. Az import sorban `recipeFile, resolveChannelDir, videoDir` helyett:

```ts
import { noteFile } from './vault/paths.js'
```

2. A `processItem`-ben a mappa-feloldás helyére közvetlen célút kerül. A

```ts
    const channelDir = await resolveChannelDir(notesRoot, item.channel)
    const dir = videoDir(notesRoot, channelDir, item.title)
```

két sor **törlendő**, és az átirat publikálása:

```ts
    if (kellAtirat) {
      outcome = await publishRendered(
        noteFile(notesRoot, item, '_transcript.md'),
        renderTranscriptNote(item, transcript, version),
        item,
        ARTIFACT_KIND,
        deps,
      )
    }
```

3. A `runRecipe` `dir: string` paramétere **megszűnik** (a hívásból is), és a
   célút:

```ts
  const target = noteFile(deps.notesRoot, item, recipe.outputFile)
```

4. A fájl egészében `item.videoId` → `item.itemId`, `store.recordVideo` →
   `store.recordItem`, és minden esemény `videoId:` mezője `itemId:`-re.

- [ ] **5. lépés: A recept-prompt bukó tesztje**

A `src/recipe/summary.test.ts`-ben cseréld le az `ITEM` fixture-t:

```ts
const ITEM: SourceItem = {
  itemId: 'abc123',
  source: 'youtube',
  sourceFile: 'Some Channel/Agent orchestration explained.en.srt',
  subtitlePath: '/nem/szamit.srt',
  baseName: 'Agent orchestration explained',
  title: 'Agent orchestration explained',
  language: 'en',
  metadata: { videoId: 'abc123', channel: 'Some Channel' },
}
```

és vedd fel ezt az új tesztet a `describe('summaryRecipe')` blokkba:

```ts
  it('metaadat nélkül nem ír kitalált csatornát a promptba', () => {
    const item: SourceItem = { ...ITEM, metadata: {} }
    const prompt = summaryRecipe.prompt({ item, transcript: 'A, majd B.' })
    expect(prompt).toContain('Title: Agent orchestration explained')
    expect(prompt).not.toContain('Channel:')
  })
```

- [ ] **6. lépés: A recept-prompt átállítása**

A `src/recipe/summary.ts`-ben vedd fel a fejléc-építőt a `summaryRecipe` elé:

```ts
/**
 * A prompt fejléce. A `Channel:` sor **kimarad**, ha nincs metaadat: az üres
 * vagy kitalált csatornanév félrevezetné a generálást, és a rubrika olyan
 * kontextust kérne számon, ami nem is létezett.
 */
function header(item: SourceItem): string[] {
  const lines = [`Title: ${item.title}`]
  if (item.metadata.channel) lines.push(`Channel: ${item.metadata.channel}`)
  return lines
}
```

majd a `prompt` és a `repairPrompt` törzsében a két sor

```ts
      `Title: ${item.title}`,
      `Channel: ${item.channel}`,
```

helyére mindkét helyen ez kerül:

```ts
      ...header(item),
```

Az importok közé: `import type { SourceItem } from '../types.js'`.

- [ ] **7. lépés: A mérési harness fixture-je**

Az `evals/summary.eval.ts`-ben cseréld le az `itemOf` függvényt:

```ts
function itemOf(fixture: Fixture): SourceItem {
  return {
    itemId: fixture.id,
    source: 'fixtures',
    sourceFile: `${fixture.id}.srt`,
    subtitlePath: `${fixture.id}.srt`,
    baseName: fixture.id,
    title: fixture.title,
    language: 'en',
    metadata: {
      videoId: fixture.id,
      channel: fixture.channel,
      uploadedAt: '2026-01-01',
      url: `https://example.com/${fixture.id}`,
    },
  }
}
```

- [ ] **8. lépés: A tesztek és a mérés futtatása — zöldnek kell lenniük**

```bash
mise exec -- pnpm vitest run src/pipeline.test.ts src/events.test.ts src/recipe/summary.test.ts
mise exec -- pnpm eval
```

Elvárt: PASS, és a mérés **kulcs nélkül, offline** kiírja a pontszámokat — ez
a Fázis 1 első sikerkritériuma, amit ez az átírás nem ronthat el.

- [ ] **9. lépés: Commit**

```bash
git add src/events.ts src/events.test.ts src/pipeline.ts src/pipeline.test.ts \
        src/recipe/summary.ts src/recipe/summary.test.ts evals/summary.eval.ts
git commit -m "refactor(pipeline): itemId a videoId helyett, metaadat-független célút (Feladat 8)"
```

---

## Feladat 9 — CLI: több forrás, `--config`

Ez a feladat állítja vissza a teljes zöldet.

**Fájlok:**
- Módosít: `src/cli.ts`, `src/index.ts`
- Teszt: `src/cli.test.ts` (átírás)

**Interfészek:**
- Fogyaszt: minden korábbi feladat terméke.
- Termel: `commandRun(cfg: Config, raw: unknown, flags): Promise<number>` — a
  `raw` a beolvasott YAML, amiből a `loadModelConfig` dolgozik; `main(argv)`
  változatlan szignatúrával.

- [ ] **1. lépés: A használati szöveg és a kapcsolók bővítése**

A `src/cli.ts` `USAGE` konstansában a `Kapcsolók:` blokk:

```
Kapcsolók:
  --config <út>     konfigurációs fájl (alapértelmezés: refinery.config.yaml)
  --source <név>    csak a megadott forrásmappából
  --channel <név>   csak a megadott csatorna (metaadat nélküli elemre nem illik)
  --limit <szám>    legfeljebb ennyi elem
  --recipe <id>     receptet is futtat (pl. summary); enélkül csak átirat
  --dry-run         nem ír fájlt és nem rögzít állapotot; recepttel a
                    modellhívások VALÓS költséggel megtörténnek
  --force           létező fájlt is felülír
  --no-commit       nem commitol és nem pushol a vault repójába
```

és a `parseArgs` options blokkja egészüljön ki:

```ts
      config: { type: 'string' },
      source: { type: 'string' },
```

- [ ] **2. lépés: A szűrők és a renderelő átállítása**

Az `applyFilters` a metaadat hiányát is kezeli:

```ts
function applyFilters(
  items: SourceItem[],
  filters: { source?: string; channel?: string; limit?: number },
): SourceItem[] {
  let out = items
  if (filters.source) {
    const wanted = filters.source.toLocaleLowerCase()
    out = out.filter((i) => i.source.toLocaleLowerCase() === wanted)
  }
  if (filters.channel) {
    // Metaadat nélküli elemnek nincs csatornája: a szűrő ilyenkor kizárja.
    const wanted = filters.channel.toLocaleLowerCase()
    out = out.filter((i) => i.metadata.channel?.toLocaleLowerCase() === wanted)
  }
  if (filters.limit !== undefined) out = out.slice(0, filters.limit)
  return out
}
```

A `render` függvényben minden `event.videoId` → `event.itemId`.

- [ ] **3. lépés: A `scan` és a `run` átállítása több forrásra**

A `commandScan`:

```ts
async function commandScan(cfg: Config): Promise<number> {
  const items = await discoverAll(cfg.sources, cfg.languages)
  console.log(`${items.length} feldolgozható felirat\n`)
  for (const item of items) {
    let detail: string
    try {
      const raw = await readFile(item.subtitlePath, 'utf8')
      const cues = parseSubtitle(raw, item.subtitlePath)
      const rawText = cues.flatMap((c) => c.lines).join(' ')
      const normalized = dedupeLines(cues).join(' ')
      detail = `${countWords(rawText)} → ${countWords(normalized)} szó, ${classifyCaptions(normalized)}`
    } catch (error) {
      detail = `olvashatatlan felirat: ${(error as Error).message}`
    }
    console.log(`  ${item.source}  ${item.itemId}  ${item.title}`)
    console.log(`      ${item.sourceFile}`)
    console.log(`      ${detail}`)
  }
  return 0
}
```

A `commandRun` szignatúrája a nyers konfigurációval bővül, és a modellréteg
onnan töltődik:

```ts
export async function commandRun(
  cfg: Config,
  raw: unknown,
  flags: {
    source?: string
    channel?: string
    limit?: number
    recipe?: string
    dryRun: boolean
    force: boolean
    commit: boolean
  },
): Promise<number> {
  let recipeDeps: RecipeDeps | undefined
  let maxIterations = 0
  if (flags.recipe) {
    const recipe = getRecipe(flags.recipe)
    const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)
    …
```

a törzsben pedig a felderítés:

```ts
    const all = await discoverAll(cfg.sources, cfg.languages)
```

Az importok: `folderSource` helyett `discoverAll` a `./source/folder.js`-ből.

- [ ] **4. lépés: A `main` átállítása a YAML-ra**

```ts
  const configPath = resolve(process.cwd(), values.config ?? CONFIG_FILENAME)
  const raw = await readConfigFile(configPath)
  const cfg = loadConfig(raw, configPath)
  await validateConfig(cfg)

  if (command === 'scan') return commandScan(cfg)
  if (command === 'run') {
    return commandRun(cfg, raw, {
      source: values.source,
      channel: values.channel,
      limit: values.limit === undefined ? undefined : Number(values.limit),
      recipe: values.recipe,
      dryRun: values['dry-run'],
      force: values.force,
      commit: !values['no-commit'],
    })
  }
```

Az importok: `resolve` a `node:path`-ból, valamint `CONFIG_FILENAME` és
`readConfigFile` a `./config.js`-ből.

- [ ] **5. lépés: Az `index.ts` exportjainak frissítése**

```ts
export {
  CONFIG_FILENAME,
  DEFAULT_NOTES_DIR,
  loadConfig,
  loadDotEnv,
  loadModelConfig,
  readConfigFile,
  validateConfig,
  type Config,
  type ModelConfig,
  type SourceDir,
} from './config.js'
export { discoverAll, folderSource } from './source/folder.js'
export { itemIdFor } from './source/identity.js'
export { mapInfoJson, readSidecar, type SidecarData } from './source/metadata.js'
export { renderFrontmatter, type FrontmatterField } from './vault/frontmatter.js'
export type { CaptionSource, Cue, ItemMetadata, NormalizedTranscript, SourceItem } from './types.js'
```

A többi export sor változatlan.

- [ ] **6. lépés: A `cli.test.ts` átírása**

Töröld a `MODEL_ENV_KEYS` listát és a hozzá tartozó `beforeEach`/`afterEach`
env-állítgatást a `LITELLM_API_KEY` kivételével, és cseréld le a
konfiguráció-fixture-t:

```ts
/**
 * A modellréteg konfigurációja a YAML-ból jön; egyedül a kulcs a környezetből.
 * Az értékek szintaktikailag érvényesek, de nem valódiak — a becslési szakasz
 * sosem hív ki hálózatot.
 */
const rawConfig = (costLimitUsd: number) => ({
  vault: { path: '/nemletezo/vault' },
  sources: [downloads],
  state: { path: join(work, 'state.db') },
  model: {
    base_url: 'http://localhost:4000/v1',
    draft: 'proba-draft',
    judge: 'proba-judge',
  },
  pricing: {
    draft: { input_per_million: 3, output_per_million: 15 },
    judge: { input_per_million: 0.2, output_per_million: 0.5 },
  },
  cost_limit_usd: costLimitUsd,
})
```

A `makeVideo` helper `downloads` alá írjon `<cím>.en.srt`-t **és**
`<cím>.info.json`-t (ez marad, a metaadatos utat is teszteljük), a
`makeConfig(...)` hívások helyére pedig:

```ts
    const raw = rawConfig(5)
    const cfg = loadConfig(raw, '/p/refinery.config.yaml')
```

A modellkonfiguráció a becsléshez:

```ts
    const modelConfig = loadModelConfig(raw, process.env, cfg.configPath)
```

A plafon állítása env helyett a nyers objektumon:

```ts
    const limited = { ...raw, cost_limit_usd: cost / 2 }
    const code = await commandRun(loadConfig(limited, '/p/refinery.config.yaml'), limited, {
      recipe: 'summary',
      dryRun: false,
      force: false,
      commit: false,
    })
```

A `folderSource(downloads)` hívások helyére:

```ts
    const [item] = await folderSource({ name: 'downloads', path: downloads }, []).discover()
```

A `beforeEach` env-része egyetlen sorra zsugorodik:

```ts
  process.env.LITELLM_API_KEY = 'sk-proba'
```

az `afterEach` pedig ezt az egy kulcsot állítja vissza.

- [ ] **7. lépés: A teljes csomag futtatása — most már mindennek zöldnek kell lennie**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

Elvárt: PASS mindhárom. Ha a `typecheck` a `dist/`-re panaszkodik, futtasd a
`mise exec -- pnpm build`-et is, hogy a generált deklarációk frissüljenek.

- [ ] **8. lépés: Commit**

```bash
git add src/cli.ts src/cli.test.ts src/index.ts
git commit -m "feat(cli): több feliratforrás és --config kapcsoló (Feladat 9)"
```

---

## Feladat 10 — Végponttól végpontig

**Fájlok:**
- Teszt: `src/e2e.test.ts` (átírás)

**Interfészek:**
- Fogyaszt: minden korábbi feladat terméke. Új exportot nem termel.

- [ ] **1. lépés: Az e2e-teszt átírása**

Írd felül a `src/e2e.test.ts` teljes tartalmát:

```ts
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_NOTES_DIR, loadConfig } from './config.js'
import { collectEvents, summarize } from './events.js'
import { processItem } from './pipeline.js'
import { discoverAll } from './source/folder.js'
import { openState } from './state/db.js'
import { gitCommitPaths, isDirty } from './vault/git.js'

const run = promisify(execFile)

const SRT = `1
00:00:00,000 --> 00:00:02,000
Ismételt sor.

2
00:00:01,000 --> 00:00:03,000
Ismételt sor.

3
00:00:02,000 --> 00:00:04,000
Egy második, eltérő sor.
`

let work: string
let vault: string
let notesRoot: string
let subsA: string
let subsB: string

async function write(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content, 'utf8')
}

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'refinery-e2e-'))
  vault = join(work, 'vault')
  subsA = join(work, 'youtube')
  subsB = join(work, 'meetings')
  await mkdir(vault, { recursive: true })
  await run('git', ['init', '-q'], { cwd: vault })
  await run('git', ['config', 'user.email', 'teszt@pelda.hu'], { cwd: vault })
  await run('git', ['config', 'user.name', 'Teszt'], { cwd: vault })

  const cfg = loadConfig(
    { vault: { path: vault }, sources: [subsA, subsB] },
    join(work, 'refinery.config.yaml'),
  )
  notesRoot = cfg.notesRoot
})

function config(sources: string[], notesDir?: string) {
  return loadConfig(
    {
      vault: notesDir ? { path: vault, notes_dir: notesDir } : { path: vault },
      sources,
      state: { path: join(work, 'state.db') },
    },
    join(work, 'refinery.config.yaml'),
  )
}

async function processAll(sources: string[], notesDir?: string) {
  const cfg = config(sources, notesDir)
  const store = openState(cfg.statePath)
  const { sink, events } = collectEvents()
  const items = await discoverAll(cfg.sources, cfg.languages)
  const written: string[] = []
  for (const item of items) {
    const outcome = await processItem(item, {
      notesRoot: cfg.notesRoot,
      store,
      sink,
      version: '0.1.0',
      options: { force: false, dryRun: false },
    })
    if (outcome.path && outcome.status === 'published') written.push(outcome.path)
  }
  store.close()
  return { written, summary: summarize(events), notesRoot: cfg.notesRoot }
}

describe('végponttól végpontig', () => {
  it('metaadat nélküli feliratból is jegyzet lesz, az alapértelmezett mappában', async () => {
    await write(join(subsA, '3Blue1Brown', 'Transformers.en.srt'), SRT)

    const { written, notesRoot: root } = await processAll([subsA])

    expect(root).toBe(join(vault, DEFAULT_NOTES_DIR))
    expect(written).toEqual([
      join(root, 'youtube', '3Blue1Brown', 'Transformers_transcript.md'),
    ])

    const note = await readFile(written[0]!, 'utf8')
    expect(note.startsWith('---\n')).toBe(true)
    expect(note).toContain('title: Transformers')
    expect(note).toContain('source: youtube')
    expect(note).toContain('source_file: 3Blue1Brown/Transformers.en.srt')
    expect(note).not.toContain('video_id')
    // A duplikált sor pontosan egyszer szerepel a törzsben.
    expect(note.split('Ismételt sor.').length - 1).toBe(1)
  })

  it('a metaadat a frontmatterbe kerül, ha van', async () => {
    await write(join(subsA, 'Cs', 'Beszéd.en.srt'), SRT)
    await write(
      join(subsA, 'Cs', 'Beszéd.info.json'),
      JSON.stringify({
        id: 'q6p',
        title: 'Agent Orchestration',
        channel: 'Burke Holland',
        upload_date: '20260714',
        webpage_url: 'https://example.com/v',
        duration: 1806,
        tags: ['ai'],
        description: 'Egy sor\nMásik sor',
      }),
    )

    const { written } = await processAll([subsA])
    const note = await readFile(written[0]!, 'utf8')

    expect(note).toContain('video_id: q6p')
    expect(note).toContain('channel: Burke Holland')
    expect(note).toContain('uploaded: 2026-07-14')
    expect(note).toContain('duration: 1806')
    expect(note).toContain('description: |-')
    // A fájlnév az alapnévből jön, nem a metaadat címéből.
    expect(written[0]!.endsWith('Beszéd_transcript.md')).toBe(true)
  })

  it('két forrás két almappát kap a vaultban', async () => {
    await write(join(subsA, 'A.en.srt'), SRT)
    await write(join(subsB, 'B.hu.vtt'), SRT.replace(/,/g, '.').replace(/^/, 'WEBVTT\n\n'))

    const { written, notesRoot: root } = await processAll([subsA, subsB])

    expect(written).toContain(join(root, 'youtube', 'A_transcript.md'))
    expect(written).toContain(join(root, 'meetings', 'B_transcript.md'))
  })

  it('a notes_dir felülírja az alapértelmezett mappát', async () => {
    await write(join(subsA, 'A.en.srt'), SRT)

    const { written } = await processAll([subsA], 'Inbox/masik')

    expect(written[0]!.startsWith(join(vault, 'Inbox', 'masik'))).toBe(true)
  })

  it('a második futás semmit nem ír újra', async () => {
    await write(join(subsA, 'A.en.srt'), SRT)
    await processAll([subsA])

    const second = await processAll([subsA])

    expect(second.written).toEqual([])
    expect(second.summary.skipped).toBe(1)
  })

  it('a sérült felirat nem állítja meg a futást, és a riport megnevezi', async () => {
    await write(join(subsA, 'Jó.en.srt'), SRT)
    await write(join(subsA, 'Rossz.en.srt'), '')

    const { written, summary } = await processAll([subsA])

    expect(written).toHaveLength(1)
    expect(summary.failed).toBe(1)
  })

  it('a futás után a vault munkafája tiszta, egyetlen új committal', async () => {
    await write(join(subsA, 'A.en.srt'), SRT)
    const { written } = await processAll([subsA])

    await gitCommitPaths(vault, written, 'docs(videos): átirat 1 felirathoz')

    expect(await isDirty(vault)).toBe(false)
    const log = await run('git', ['log', '--oneline'], { cwd: vault })
    expect(log.stdout.trim().split('\n')).toHaveLength(1)
  })
})
```

- [ ] **2. lépés: A teszt futtatása**

```bash
mise exec -- pnpm vitest run src/e2e.test.ts
```

Elvárt: PASS, 7 teszt. Ha a `.hu.vtt`-s eset a WEBVTT-fejléc miatt bukik,
igazítsd a fixture-t a `src/subtitle/parse-vtt.test.ts` formátumához — a
lényeg, hogy a második forrás egy **érvényes** feliratfájlt tartalmazzon.

- [ ] **3. lépés: Commit**

```bash
git add src/e2e.test.ts
git commit -m "test(e2e): metaadat nélküli út, több forrás, notes_dir felülírás (Feladat 10)"
```

---

## Feladat 11 — Dokumentáció

**Fájlok:**
- Létrehoz: `docs/decisions/0008-forras-fuggetlen-bemenet.md`
- Módosít: `docs/architecture.md`, `docs/roadmap.md`, `README.md`

**Interfészek:** nincs kódfelület.

- [ ] **1. lépés: Az ADR megírása**

Hozd létre a `docs/decisions/0008-forras-fuggetlen-bemenet.md` fájlt:

```markdown
# 0008 — A bemenet a kész feliratfájl, semmi más

**Dátum:** 2026-09-05 · **Státusz:** elfogadva ·
**Felülírja:** [0003](<./0003-ingest-sorrend.md>), [0005](<./0005-transzkribalasi-ut.md>)

## A kérdés

A `0003` a Pinchflat letöltési mappáját tette az első ingest-forrássá, és az
idempotencia-kulcsot a videó melletti metaadatfájlból vette. A `0005` egy
lokális `whisper.cpp`-utat írt elő az automatikus feliratú videók
újratranszkribálására, `ffmpeg`-függőséggel. Mindkettő azt feltételezi, hogy az
app tudja, **honnan** jön a felirat, és szükség esetén elő is állítja.

Kell-e ez a tudás a fő értékhez — hogy a feliratból mérhető minőségű jegyzet
legyen?

## A döntés

**Nem kell. Az app egyetlen bemeneti szerződése a kész `.vtt`/`.srt` fájl.**

- A felderítés a feliratfájlokon iterál; a `.info.json` opcionális kiegészítő.
- Az elem azonosítója a metaadat videóazonosítója, ha van; egyébként a
  forrásnév és a forráson belüli alapnév hash-e.
- A feliratot előállító lépés — letöltés, transzkribálás — **kívül van** az
  appon. Ami előáll, az egy újabb forrásmappa.

## Mi döntötte el

**1. A metaadat-feltevés kizárta a bemenetek felét.** A `0003` érve az volt,
hogy a metaadatfájl kanonikus csatornanevet és azonosítót ad, tehát nem kell
fájlnevet értelmezni. Igaz — de ez a feliratot metaadat-függővé tette: egy
kézzel odamásolt vagy whisperrel készült `.srt`, ami mellett nincs
`.info.json`, ma **láthatatlan**. A rendszer a saját céljának a felét zárta ki
egy kényelmi feltevésért.

**2. A transzkribálás más program.** A `0005` gondos elemzés arról, hogyan
transzkribáljunk — de a válasza egy külön futtatható eszköz, nem ennek az
appnak a rétege. `ffmpeg`-függés, médiafájl-olvasás és egy `Transcriber`
absztrakció olyan felületet adna, aminek semmi köze a „feliratból jegyzet"
maghoz. Kívül tartva ugyanaz a whisper-kimenet egyszerűen egy újabb
`sources` mappa.

**3. A célút nem függhet metaadattól.** Ha a vault-beli hely a csatornanévből
és a címből jön, ugyanaz a felirat két helyre kerül aszerint, hogy volt-e
metaadat — és a write-once védelem nem veszi észre a duplikátumot. A
forrásmappa szerkezetének tükrözése ugyanazt a csoportosítást adja, feltevés
nélkül.

## Következmények

- A `PINCHFLAT_DOWNLOADS` helyére a `sources` tömb lép: több feliratmappa,
  forrásonként külön almappával a vaultban.
- A konfiguráció YAML-ba költözik; a `.env`-ben csak a `LITELLM_API_KEY` marad.
- Az állapottár kulcsa `item_id`. **Ha egy elem mellé utólag kerül metaadat,
  az azonosítója megváltozik, és az elem újra feldolgozódik** — tudatos csere a
  beszédes azonosítóért.
- A frontmatter mindig elkészül; a metaadat hiánya mezőket vesz el, a
  frontmattert magát nem.
- A `0005` „egyetlen transzkribálási út" döntése **nem hibás, csak nem ide
  tartozik**: ha a whisper-út megépül, külön eszközként épül meg, és a
  kimenete forrásmappaként jön vissza.
- A `Source` absztrakció megmarad; a „két implementációval igazolva" szerepét
  két különböző eredetű forrásmappa tölti be, nem egy URL-adapter.
```

- [ ] **2. lépés: A roadmap frissítése**

A `docs/roadmap.md`-ben:

1. A **Fázis 0** első kritériumában a metaadat-függés helyére a felirat-vezérelt
   listázás kerül:

```markdown
- A szkennelő parancs hálózat nélkül kilistázza az összes forrásmappa minden
  feliratfájlját — forrásnévvel, címmel, nyers és normalizált szószámmal,
  felirat-minőséggel —, **metaadatfájl nélküli feliratokat is beleértve.**
```

2. A **Fázis 0** második kritériuma a célútról és a frontmatterről:

```markdown
- Egyetlen elemre futtatva létrejön a normalizált átirat a
  `Inbox/transcript-refinery/<forrás>/` fa alatt, a forrásmappa szerkezetét
  tükrözve: **nulla duplikált sor, érvényes frontmatter metaadat nélkül is,
  nulla wikilink.**
```

3. A **Fázis 2** teljes szakasza cserélődik:

```markdown
## Fázis 2 — Felirat-minőség és köteges feldolgozás

Az újratranszkribálás kikerült az appból ([`decisions/0008`](<./decisions/0008-forras-fuggetlen-bemenet.md>)):
a whisper-futtatás külön eszköz, aminek a kimenete egy újabb forrásmappa. Ami
itt marad, az a köteg és a jelentés.

**Kész, ha:**

- A futás záró riportja **számszerűen** megnevezi, hány elem készült
  automatikus és hány kreátori feliratból, és felsorolja az automatikusakat.
- A teljes korpusz **felügyelet nélkül, egy éjszaka alatt** lefut; reggel
  riport áll rendelkezésre arról, mennyi sikerült, mennyi nem, és miért.
- A gép újraindítása a köteg közepén **nem veszít munkát**: az újrafuttatás a
  kész elemeket kihagyja.
- Egy külső eszközzel újratranszkribált felirat új forrásmappaként betéve
  ugyanazon a magon megy át, kódmódosítás nélkül.
```

4. A **Fázis 4 — URL-adapter** szakasz **törlendő**, a helyére rövid indoklás
   kerül a Fázis 3 után:

```markdown
## Fázis 4 — törölve

Az URL-adapter a letöltéssel együtt kikerült ([`decisions/0008`](<./decisions/0008-forras-fuggetlen-bemenet.md>)):
az app URL-ből nem dolgozik, a letöltés más program dolga. Az „absztrakció két
implementációval igazolva" szerepet a `Source` két különböző eredetű
forrásmappával tölti be.
```

5. A **v2 és utána** szakasz első pontja után vedd fel:

```markdown
- **Külön transzkribáló eszköz** (`whisper.cpp`, `medium.en`), aminek a
  kimenete forrásmappaként érkezik vissza. A `0005` elemzése érvényes marad,
  csak nem ennek az appnak a része.
```

- [ ] **3. lépés: Az architektúra-dokumentum frissítése**

A `docs/architecture.md`-ben négy helyen kell változtatni. Minden érintett
bekezdés **állítást** fogalmazzon meg, ne a kód szerkezetét ismételje:

1. A `Source` réteg leírásában (a 98. sor környéke): a v1 forrása nem „a
   Pinchflat letöltési mappája", hanem **tetszőleges feliratmappa**; a
   felderítés a feliratfájlokon iterál, a metaadat opcionális.
2. A vault-elrendezés szakaszában (a 150. sor környéke): a célút a
   `notes_dir`/`forrásnév`/`a forrásmappa relatív szerkezete`, és **nem függ
   metaadattól** — a `resolveChannelDir`-re épülő bekezdés törlendő.
3. Új alszakasz a konfigurációról: minden a `refinery.config.yaml`-ból jön, a
   `--config` felülírja az útvonalát, és egyedül a `LITELLM_API_KEY` érkezik a
   környezetből, mert titok.
4. A watcher-bekezdésben (a 346. sor környéke) a Pinchflat-hivatkozás helyére a
   forrásmappa általános megfogalmazása kerül.

Ellenőrzés a lépés végén:

```bash
grep -ni "pinchflat\|Resources/Videos" docs/architecture.md
```

Elvárt: nincs találat.

- [ ] **4. lépés: A README frissítése**

A `README.md`-ben:

1. A „Két ingest-forrás egy munkasor mögött" pont helyére a forrásfüggetlen
   bemenet kerül: **egy szerződés, akárhány feliratmappa.**
2. A döntéstáblázat „Melyik ingest-forrás az első?" sora cserélődik:
   „Mi a bemenet? → [A kész feliratfájl](<./docs/decisions/0008-forras-fuggetlen-bemenet.md>)
   — az előállítója érdektelen."
3. A telepítés/használat szakasz a YAML-ra épüljön:

```markdown
## Beállítás

```bash
cp refinery.config.example.yaml refinery.config.yaml
# írd át benne a vault és a feliratmappák útvonalát
echo "LITELLM_API_KEY=sk-..." > .env   # csak recepthez kell
mise exec -- pnpm build && mise exec -- node dist/cli.js scan
```

Minden beállítás a `refinery.config.yaml`-ból jön; a `--config` kapcsolóval
másik fájl is megadható. Környezeti változó egyetlen értéket hoz, a
`LITELLM_API_KEY`-t — az titok, aminek nincs helye verziókövetett fájlban.

### A minta-korpusz behozatala más gépről

Fejlesztéshez elég a feliratokat és a metaadatot átmásolni; médiafájlt a
csővezeték nem olvas:

```bash
rsync -av --prune-empty-dirs --include='*/' --include='*.info.json' \
      --include='*.srt' --include='*.vtt' --exclude='*' \
      user@gep:/utvonal/feliratok/ ./tmp/feliratok/
```
```

- [ ] **5. lépés: A takarítás ellenőrzése**

```bash
grep -rn "REFINERY_SAMPLE\|sample:fetch" src/ package.json .env.example README.md docs/architecture.md docs/roadmap.md
grep -ri "pinchflat" src/ docs/architecture.md docs/roadmap.md README.md
grep -rn "PINCHFLAT_DOWNLOADS\|Resources/Videos" src/ docs/architecture.md README.md
```

Elvárt: mindhárom parancs találat nélkül fut le (a `docs/decisions/` és a
`docs/plans/` történeti anyagai szándékosan kimaradnak a keresésből).

- [ ] **6. lépés: A teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint && mise exec -- pnpm build
```

Elvárt: PASS mind a négy.

- [ ] **7. lépés: Commit**

```bash
git add docs/decisions/0008-forras-fuggetlen-bemenet.md docs/architecture.md \
        docs/roadmap.md README.md
git commit -m "docs: forrásfüggetlen bemenet — ADR, architektúra, roadmap, README (Feladat 11)"
```

---

## A terv utáni ellenőrzés

A spec sikerkritériumai és a hozzájuk tartozó bizonyíték:

| # | Kritérium | Hol bizonyítja |
|---|---|---|
| 1 | metaadat nélküli felirat → jegyzet érvényes frontmatterrel | Feladat 10, 1. teszt |
| 2 | metaadattal a bővebb mezők is megjelennek | Feladat 10, 2. teszt |
| 3 | nyelvi preferencia, reprodukálható választás | Feladat 4, 3–6. teszt |
| 4 | két forrás → két almappa | Feladat 10, 3. teszt |
| 5 | `notes_dir` alapértelmezés és felülírás | Feladat 1, 1–2. teszt; Feladat 10, 4. teszt |
| 6 | hiányzó konfigurációs fájl beszédes hibája | Feladat 1, `readConfigFile` tesztek |
| 7 | kulcs nélkül `scan`/`run` fut, recept hibázik | Feladat 1, `loadModelConfig` tesztek |
| 8 | `sample:fetch` és a hozzá tartozó változók eltűntek | Feladat 11, 5. lépés |
| 9 | nincs Pinchflat-említés a kódban és az élő dokumentációban | Feladat 11, 5. lépés |
| 10 | `pnpm test`, `typecheck`, `lint` zöld | Feladat 11, 6. lépés |
| — | az `evals/` továbbra is fut, kulcs nélkül, offline | Feladat 8, 8. lépés |
| — | a recept-prompt metaadat nélkül sem talál ki csatornát | Feladat 8, 5. lépés |
