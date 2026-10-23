# Több `--recipe`, olvasási idő, `list`-takarítás, Telegram parancsmenü és sémás mérés — megvalósítási terv

> **A végrehajtónak:** a terv natívan, skill és alügynök nélkül fut (Read, Edit, Bash). A lépések jelölőnégyzetesek (`- [ ]`).

**Cél:** a `run` több `--recipe`-et futtat egy hívásban (#244). Minden új jegyzet frontmatterjében ott a `reading_time` (#291). A `--limit`-et a `run` és a `list` egyformán ellenőrzi, a `list --channels --limit` jelez (#71). A Telegram `/` menüje a `/help` listájából jön, benne a `/model` (#305). A `refinery check-structured` kiméri a `model.switchable` modellek sémás kimenetét (#304).

**Felépítés:**
- **CLI (#244, #71):** két kis tiszta függvény a `src/cli.ts`-ben (`parseLimit`, `runRecipeFlags`), a `main()` a config betöltése előtt hívja őket. A `commandRun` `recipes` útja kész, csak be kell kötni.
- **#291:** egy `readingTime` függvény a `src/vault/render.ts`-ben, a két render-függvény közös `baseFields`-én át. A sebesség a `vault.reading_wpm`, a `PipelineDeps`-en át jut el.
- **Menü (#305):** a `worker/src/messages.ts` `BOT_COMMANDS` listájából épül a `HELP_TEXT`, és ezt olvassa a `scripts/telegram-commands.ts`.
- **#304:** egy `src/model/check-structured.ts` a `check-pricing` mintájára, a három sémás recept exportált sémájával, indulás előtti, 2× ráhagyású költségbecsléssel.

**Technológia:** TypeScript, zod, vitest, Node `parseArgs`, `fetch`.

**Spec:** `docs/plans/2026-10-23-tobb-recept-olvasasi-ido-spec.md`

**Ág:** `feat/tobb-recept-olvasasi-ido` a `main`-ről, a docs-PR merge-e után. Egy kód-PR, utána kiadás.

## Eltérések a spectől (a tervezés közben dőltek el)

| Spec | Terv | Miért |
|---|---|---|
| A `list` `:347`-es ellenőrzése a `parseLimit`-be olvad | A `commandList` ellenőrzése törlődik, a két hozzá tartozó `it.each`-sor is | A CLI a `main()`-ben ellenőriz. A `commandList`-et közvetlenül csak tesztek hívják, a web nem (`web/` nem importálja). |
| `reading_time` „a két render-függvény közös útján” | A `baseFields` kap egy kész szöveget (`reading`), a két render-függvény számolja a saját tartalmából | A `baseFields` nem látja a tartalmat. Így a számítás egy függvény (`readingTime`), a hívás kettő. |
| A #304 „ugyanazzal az úttal, amellyel a recept hív” | A `client.generateObject` a recept sémájával, a render nélkül | A render (`renderCards` stb.) nem modellképesség, a próbához érvényes mintaobjektum kellene. A modellhívás betűre a recepté (`structured.ts:36`). |
| A parancsmenü leírása „a `–` utáni rész” | A menü és a súgó ugyanazt a `description` mezőt használja, szövegbontás nincs | Egy forrás, nincs mit visszabontani. |

## Globális megkötések

- Új függőség nincs.
- Új fájl csak: `scripts/telegram-commands.ts`, `src/model/check-structured.ts` és a tesztje.
- Magyar kommentek és üzenetek, a környező kód sűrűségével.
- Ellenőrzés minden feladat végén: `pnpm typecheck && npx tsc --noEmit -p worker/tsconfig.json && pnpm lint && pnpm test`, mind zöld. A gyökér typecheck a Workert nem fedi.
- Commit minden feladat végén a `commit-message` skill-lel.

## Amire a review figyeljen

1. **Az egyetlen `--recipe` útja betűre a mai.** A `--queue` szűrő és a `--retry-failed` műtermék-típusa (`artifactKind`) ezen múlik. Az `{ recipe: ids[0] }` ágat semmi más nem érintheti.
2. **A hibák a config és az állapottár előtt állnak meg.** A `run` `--limit`/`--recipe` hibája a `loadCliConfig` előtt jön, mint az `adHocOptions`.
3. **A `HELP_TEXT` szövege nem változik.** A `worker/src/handle.test.ts:1068` literálja ezt őrzi.
4. **A token sehol nem jelenik meg** a script kimenetében és hibáiban.
5. **A súgó (`CommandHelp`, `src/help.ts`) minden kapcsolóváltozással együtt frissül**, ugyanabban a commitban (spec 6. szakasz).
6. **A `check-structured` egy hívás nélkül áll meg**, ha a becslés kétszerese a plafon fölött van, és a séma-hibát nem keveri a hálózati hibával.

---

### 1. feladat: több `--recipe` és a `--limit` (CLI, #244, #71/1–3)

**Fájlok:**
- Módosul: `src/cli.ts` (`parseArgs` `recipe`, két új függvény, `main()` bekötés, `commandList` ellenőrzése)
- Módosul: `src/help.ts` (`run` és `list` `--recipe` sora, egy új példa)
- Teszt: `src/cli.test.ts`

**Kód (`src/cli.ts`, a `unsupportedWatchOption` után):**
```ts
/** A `--limit` csak tízes pozitív egész; a `Number()` a `0x10`-et és az `1e1`-et is elfogadná. */
export function parseLimit(value: string | undefined): number | undefined | { error: string } {
  if (value === undefined) return undefined
  return /^[1-9][0-9]*$/.test(value) ? Number(value) : { error: `A --limit pozitív egész szám: ${value}` }
}

/**
 * A `run` `--recipe` értékei (#244): egy recept a mai út (queue-szűrő, hibás-szűrő),
 * kettő vagy több a `recipes` út, amelyet a serve is hív. Az ismétlés egyszer számít.
 */
export function runRecipeFlags(values: {
  recipe?: string[]
  queue?: boolean
  'retry-failed'?: boolean
}): { recipe?: string; recipes?: string[] } | { error: string } {
  const ids = [...new Set(values.recipe ?? [])]
  if (ids.length < 2) return ids.length === 0 ? {} : { recipe: ids[0] }
  if (values.queue) return { error: 'A --queue mellett egy --recipe adható meg (szűrőként).' }
  if (values['retry-failed']) return { error: 'A --retry-failed mellett egy --recipe adható meg.' }
  return { recipes: ids }
}
```

**`parseArgs` (`src/cli.ts:1044`):**
```ts
      recipe: { type: 'string', multiple: true },
```

**`main()`, közvetlenül az `adHoc` blokk után (`src/cli.ts:1073` körül), a `watch`-ellenőrzés elé:**
```ts
  const limit = parseLimit(values.limit)
  if (typeof limit === 'object') {
    console.error(limit.error)
    return 1
  }
  const recipeFlags = command === 'run' ? runRecipeFlags(values) : {}
  if ('error' in recipeFlags) {
    console.error(recipeFlags.error)
    return 1
  }
  if (command === 'list' && new Set(values.recipe).size > 1) {
    console.error('A list egyszerre egy típus részleteit mutatja.')
    return 1
  }
```

**A két hívóhely (`src/cli.ts:1102–1130`):**
- `list`: `recipe: values.recipe?.[0],` és `limit,` (a `Number(...)` sor helyett).
- `run`: a `recipe: values.recipe,` sor helyett `...recipeFlags,`, a `limit` sor helyett `limit,`.

**`commandList` (`src/cli.ts:347–350`):** a `--limit` ellenőrzése törlődik (a `main()` végzi). A helyére, az ellenőrzések végére:
```ts
  if (opts.channels && opts.limit !== undefined) {
    console.error('A --channels a teljes szűrt halmazt számolja, a --limit nem hat.')
  }
```

**`src/help.ts` (a `CommandHelp` tábla, spec 6. szakasz):**
- `LIMIT` (`:19`): `const LIMIT = ['--limit <szám>', 'legfeljebb ennyi elem (pozitív egész)'] as const`
- `run` leírásának harmadik sora (`:58`):
  ```ts
      'A --recipe receptet is futtat, többször megadva több receptet egy futásban, közös költségplafon alatt. A --queue és a --retry-failed mellett egy --recipe adható meg.\n' +
      'A --queue a vault _queue.md sorának kipipált párjait dolgozza fel.\n' +
  ```
  (a mai `'A --recipe receptet is futtat; a --queue a vault _queue.md sorának kipipált párjait dolgozza fel.\n'` helyett).
- `run` `--recipe` sora: `['--recipe <id>', 'receptet is futtat (pl. summary); többször is megadható; enélkül csak átirat']`, és a példák közé a `'refinery run --recipe summary --limit 1'` után: `'refinery run --file ~/atiratok/átirat.txt --recipe qa --recipe flashcards'`.
- `list` `--recipe` sora: `['--recipe <id>', 'csak ennek a típusnak az állapota (egy adható meg)']`; a `--channels` sora: `['--channels', 'csatornánkénti összesítő; mellette a --limit nem hat']`.

- [ ] **1. lépés: a bukó tesztek (`src/cli.test.ts`).**
  - Új `describe('parseLimit és runRecipeFlags (#244, #71)')`:
    - `parseLimit(undefined)` → `undefined`; `'3'` → `3`; `'12'` → `12`;
    - `it.each(['abc', '0', '-1', '0x10', '1e1', '1.5', '', '03'])`: `{ error: 'A --limit pozitív egész szám: <érték>' }`;
    - `runRecipeFlags({})` → `{}`; `{ recipe: ['qa'] }` → `{ recipe: 'qa' }`; `{ recipe: ['qa', 'qa'] }` → `{ recipe: 'qa' }`; `{ recipe: ['qa', 'flashcards'] }` → `{ recipes: ['qa', 'flashcards'] }`;
    - `{ recipe: ['qa', 'flashcards'], queue: true }` és `'retry-failed': true` → a két hibaszöveg;
    - `{ recipe: ['qa'], queue: true }` → `{ recipe: 'qa' }` (egy recept queue-szűrő marad).
  - A `main()`-szintű esetek a meglévő `list`-teszt mintájára (`src/cli.test.ts:2837`: `writeFile(configPath, JSON.stringify(rawWithVault(5)))`, `mkdir(join(vault, '.git'))`, `errors`/`logs` gyűjtés):
    - `main(['run', '--config', configPath, '--limit', '0x10'])` → 1, `errors` = `['A --limit pozitív egész szám: 0x10']`;
    - `main(['run', '--config', configPath, '--recipe', 'qa', '--recipe', 'summary', '--queue'])` → 1;
    - `main(['list', '--config', configPath, '--recipe', 'summary', '--recipe', 'qa'])` → 1, `'A list egyszerre egy típus részleteit mutatja.'`;
    - `main(['list', '--config', configPath, '--channels', '--limit', '5'])` → 0, az `errors` = `['A --channels a teljes szűrt halmazt számolja, a --limit nem hat.']`, a `logs` első sora `'2 csatorna'`.
  - A meglévő `:2847` elvárása: `['A --limit pozitív egész szám: abc']`.
  - A súgó szövegére nincs külön teszt: a kapcsolók jelenlétét a meglévő `OPTIONS` tábla-teszt (`:2436`) ellenőrzi.
  - A `:2873–2874` két sora (`{ limit: 0 }`, `{ limit: Number.NaN }`) törlődik.
  - Egy pozitív út a `main()`-en át: `await expect(main(['run', '--config', configPath, '--recipe', 'qa', '--recipe', 'nincsilyen', '--dry-run'])).rejects.toThrow(/Ismeretlen recept: nincsilyen/)`, modellhívás nélkül. A `recipeFrom` dob, a `commandRun` nem kapja el, ma is így viselkedik egyetlen ismeretlen receptre. A hibás azonosító a **második**: ha csak az első jutna tovább `recipe`-ként, a teszt bukna. Ez igazolja, hogy a `recipes` út kap értéket. A több receptes futás működését a meglévő `describe('commandRun — több recept egy futásban')` fedi.
- [ ] **2. lépés:** `pnpm vitest run src/cli.test.ts` → FAIL (nincs `parseLimit`, `runRecipeFlags`).
- [ ] **3. lépés:** a fenti kód.
- [ ] **4. lépés:** `pnpm vitest run src/cli.test.ts` → PASS. Ellenőrizd, hogy a `watch --recipe summary` teszt (`:2415`) továbbra is zöld: a `values.recipe` most tömb, az `unsupportedWatchOption` ezt is megadottnak veszi. Mutációs próba: a `new Set(...)` helyett `values.recipe ?? []` → a `['qa', 'qa']` eset bukik. A `/^[1-9][0-9]*$/` helyett `/^[0-9]+$/` → a `'0'` és a `'03'` eset bukik. Visszaállítás, teljes ellenőrzés zöld.
- [ ] **5. lépés:** commit (`feat(cli): Run several --recipe values in one run`, `Closes #244`, `Refs #71`).

### 2. feladat: dokumentáció a CLI-hez (#71/4)

**Fájlok:**
- Módosul: `docs/usage.md`

- [ ] **1. lépés:** a „Gyakori kapcsolók” (`docs/usage.md:137` körül) `--limit` sora: `- \`--limit <szám>\`: legfeljebb ennyi elem feldolgozása (pozitív egész)`. A receptes példák (`:125–127`) után egy bekezdés: `Több recept egy futásban: \`run --recipe qa --recipe flashcards\`. Egy közös költségplafon alatt fut, a \`--limit\` az elemeket számolja, nem a recepteket. A \`--queue\` és a \`--retry-failed\` mellett csak egy \`--recipe\` adható meg.`
- [ ] **2. lépés:** a `list`-szakasz végére (`:196` után): `Kb. 60 oszlopnál keskenyebb terminálon a sorok tördelődnek: a cím legalább 20 karakter széles.` A `--channels` mondata (`:194–195`) kiegészül: `…a \`--limit\` nem hat, és ezt a parancs a hibakimeneten jelzi.`
- [ ] **3. lépés:** `pnpm lint` zöld (a Markdown-lint is), commit (`docs: Document repeated --recipe and list limits`, `Closes #71`).

### 3. feladat: `reading_time` a frontmatterben (#291)

**Fájlok:**
- Módosul: `src/vault/render.ts` (`readingTime`, `DEFAULT_READING_WPM`, `baseFields`, a két render-függvény)
- Módosul: `src/config.ts` (`vault.reading_wpm`, `Config.readingWpm`)
- Módosul: `src/pipeline.ts` (`PipelineDeps.readingWpm`, a két render-hívás)
- Módosul: `src/cli.ts:934`, `src/watch/round.ts:65` (a `processItem` hívása)
- Módosul: `refinery.config.example.yaml`
- Teszt: `src/vault/render.test.ts`, `src/config.test.ts`

**Kód (`src/vault/render.ts`):**
```ts
import { countWords } from '../normalize/dedupe.js'

/** Az olvasási sebesség alapértéke szó/percben (#291); a config `vault.reading_wpm`-je felülírja. */
export const DEFAULT_READING_WPM = 200

/** A szöveg olvasási ideje: egy óra alatt `pp:mm`, egy órától `ó:pp:mm`. */
export function readingTime(text: string, wpm: number): string {
  const total = Math.round((countWords(text) * 60) / wpm)
  const pad = (n: number) => String(n).padStart(2, '0')
  const hours = Math.floor(total / 3600)
  const rest = `${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`
  return hours > 0 ? `${hours}:${rest}` : rest
}
```
- A `baseFields` új, kötelező paramétert kap az `origin` után: `reading: string`, és a `['punctuation_density', …]` sor után: `['reading_time', reading],`.
- `renderTranscriptNote(item, transcript, generatorVersion, origin = 'cli', readingWpm = DEFAULT_READING_WPM)`: a törzs szövegét egyszer számolja (`const text = toParagraphs(transcript.lines)`), a `baseFields`-nek `readingTime(text, readingWpm)`-t ad, a `body(item, text)`-et hívja.
- `renderRecipeNote(…, origin = 'cli', readingWpm = DEFAULT_READING_WPM)`: `const text = content.trim()`, a `baseFields`-nek `readingTime(text, readingWpm)`, a `body(item, text)`.

**`src/config.ts`:**
- Import: `import { DEFAULT_READING_WPM } from './vault/render.js'`. Előtte ellenőrizd, hogy a `render.ts` nem importál a `config.ts`-ből (ma nem), különben kör lesz.
- A `CoreSchema` `vault` objektumában a `layout` után: `reading_wpm: z.number().int('A vault.reading_wpm egész szám.').positive('A vault.reading_wpm pozitív kell legyen.').default(DEFAULT_READING_WPM),` (a `model.recipe_timeout_minutes` mintájára, `src/config.ts:260`)
- `Config`: `/** Olvasási sebesség szó/percben a jegyzetek `reading_time` mezőjéhez. */ readingWpm: number`
- `loadConfig`: `readingWpm: c.vault.reading_wpm,`

**`src/pipeline.ts`:**
- `PipelineDeps`: `/** A \`reading_time\` sebessége (szó/perc); hiányában az alapérték. */ readingWpm?: number`
- `:364`: `}, deps.version, deps.origin, deps.readingWpm)`; `:464`: `renderTranscriptNote(item, transcript, version, deps.origin, deps.readingWpm),`

**Hívók:** `src/cli.ts:934` és `src/watch/round.ts:65`, a `layout: cfg.layout,` sor után: `readingWpm: cfg.readingWpm,`.

**`refinery.config.example.yaml`, a `layout` után:**
```yaml
  # Olvasási sebesség szó/percben: ebből számol minden jegyzet frontmatterje
  # `reading_time` mezőt (pp:mm, egy órától ó:pp:mm). Elhagyható; ez az alapértelmezés.
  reading_wpm: 200
```

- [ ] **1. lépés: a bukó tesztek.**
  - `src/vault/render.test.ts`, új `describe('readingTime')`:
    - `readingTime('', 200)` → `'00:00'`;
    - `readingTime('szó '.repeat(1500), 200)` → `'07:30'`;
    - `readingTime('szó '.repeat(12500), 200)` → `'1:02:30'`;
    - `readingTime('szó '.repeat(1500), 100)` → `'15:00'`;
    - `readingTime('szó '.repeat(12000), 200)` → `'1:00:00'` (pontosan egy óra már órás alak).
  - `renderTranscriptNote(item(), transcript, '0.1.0')`: a frontmatter tartalmazza a `reading_time: "00:01"` sort. A `transcript.lines` 4 szó, 200 szó/percnél 1,2 mp → kerekítve 1. Az érték idézett, mert `:`-ot tartalmaz.
  - `renderRecipeNote(item(), transcript, 'szó '.repeat(1500), meta, '0.1.0', 'cli', 100)` → `reading_time: "15:00"`. A mező a `punctuation_density` sora után áll (a két `indexOf` sorrendje).
  - `src/config.test.ts`: `loadConfig(MIN, …).readingWpm` → `200`; `{ ...MIN, vault: { path: '/v', reading_wpm: 100 } }` → `100`; `reading_wpm: 0` és `1.5` → hiba, `/vault\.reading_wpm/`.
- [ ] **2. lépés:** `pnpm vitest run src/vault/render.test.ts src/config.test.ts` → FAIL.
- [ ] **3. lépés:** a fenti kód.
- [ ] **4. lépés:** PASS. A `src/cli.test.ts` és a `src/serve/summary.test.ts` jegyzet-elvárásai zöldek maradnak (új sor, régi sor nem tűnik el). Mutációs próba: a `baseFields` hívásában a `readingWpm` helyett `DEFAULT_READING_WPM` → a 100-as recept-eset bukik. Visszaállítás, teljes ellenőrzés zöld.
- [ ] **5. lépés:** commit (`feat(vault): Add reading_time to note frontmatter`, `Closes #291`).

### 4. feladat: a Telegram parancsmenüje egy forrásból (#305)

**Fájlok:**
- Módosul: `worker/src/messages.ts` (`BOT_COMMANDS`, `HELP_TEXT`)
- Módosul: `worker/src/handle.ts` (`START`, `COMMAND`, `SCAN` export)
- Új: `scripts/telegram-commands.ts`
- Módosul: `package.json` (`telegram:commands`)
- Módosul: `docs/operations/telegram-worker-topology.md`
- Teszt: `worker/src/handle.test.ts`

**Kód (`worker/src/messages.ts`, a mai `HELP_TEXT` helyére):**
```ts
/** A bot parancsai: ebből épül a `/help` és a Telegram `/` menüje (`pnpm telegram:commands`). */
export const BOT_COMMANDS: readonly { command: string; args?: string; description: string }[] = [
  { command: 'scan', args: '<szöveg>', description: 'beillesztett átirat feldolgozása (egy üzenetnyi)' },
  { command: 'start', description: 'a bot összekötése a Google-fiókoddal' },
  { command: 'cancel', description: 'nyitott munka megszakítása' },
  { command: 'model', description: 'a receptek modelljének megtekintése és váltása' },
  { command: 'status', description: 'a szerver állapota és a nyitott munkák' },
  { command: 'ping', description: 'a szerver elérhetősége' },
  { command: 'version', description: 'a szerver verziója' },
  { command: 'help', description: 'ez a súgó' },
]

export const HELP_TEXT = [
  'Küldj egy YouTube-linket, és letöltöm a feliratát.',
  'Csatolt .txt vagy .md átiratot is feldolgozok.',
  '',
  ...BOT_COMMANDS.map(({ command, args, description }) =>
    `/${command}${args === undefined ? '' : ` ${args}`} – ${description}`,
  ),
].join('\n')
```

**`worker/src/handle.ts:116–119`:** a `START`, a `COMMAND` és a `SCAN` elé `export`.

**`scripts/telegram-commands.ts`:**
```ts
// A Telegram `/` menüjét a `/help` listájára állítja (BOT_COMMANDS), majd visszaolvassa.
// Használat: pnpm telegram:commands [--dry-run]
// A token a TELEGRAM_BOT_TOKEN; a pnpm-parancs a worker/.dev.vars-ból tölti (--env-file-if-exists). Nem írja ki.
import { BOT_COMMANDS } from '../worker/src/messages.js'

const commands = BOT_COMMANDS.map(({ command, description }) => ({ command, description }))

async function call(method: string, body: unknown = {}): Promise<unknown> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('Nincs TELEGRAM_BOT_TOKEN (környezet vagy worker/.dev.vars).')
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const reply = (await response.json()) as { ok: boolean; result?: unknown; description?: string }
  if (!reply.ok) throw new Error(`${method}: ${reply.description ?? String(response.status)}`)
  return reply.result
}

if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify(commands, null, 2))
} else {
  await call('setMyCommands', { commands })
  console.log(JSON.stringify(await call('getMyCommands'), null, 2))
}
```

**`package.json`, a `query:remote` után:** `"telegram:commands": "tsx --env-file-if-exists=worker/.dev.vars scripts/telegram-commands.ts",`. Kipróbálva (Node 26.2, tsx): a `KEY='érték'` idézőjelét leveszi, a környezeti változó erősebb a fájlnál, hiányzó fájlnál figyelmeztet és továbbmegy.

**`docs/operations/telegram-worker-topology.md`:** a „Telepítési sorrend” bekezdés után egy mondat: `A Telegram \`/\` menüje nem a Worker része: új vagy átnevezett parancs után a \`pnpm telegram:commands\` állítja be a \`/help\` listájára (\`--dry-run\`-nal csak kiírja).`

- [ ] **1. lépés: a bukó teszt (`worker/src/handle.test.ts`, a `describe('tájékoztató parancsok')` végén).** Import: `COMMAND`, `SCAN`, `START` a `./handle.js`-ből, `BOT_COMMANDS` a `./messages.js`-ből.
  ```ts
  it('a menü parancsai és a felismert parancsok ugyanazok', () => {
    const recognized = [...(/\(([a-z|]+)\)/.exec(COMMAND.source)?.[1] ?? '').split('|'), 'scan', 'start']
    expect(BOT_COMMANDS.map((item) => item.command).sort()).toEqual(recognized.sort())
    for (const { command } of BOT_COMMANDS) {
      expect(COMMAND.test(`/${command}`) || SCAN.test(`/${command}`) || START.test(`/${command}`)).toBe(true)
    }
  })
  ```
  A meglévő `HELP` literál (`:1068`) változatlan marad: ez igazolja, hogy a súgó szövege betűre a régi. A Telegram korlátait (parancs 1–32, leírás 1–256 karakter) a `setMyCommands` ellenőrzi, a script a hibáját kiírja.
- [ ] **2. lépés:** `pnpm vitest run worker` → FAIL (nincs `BOT_COMMANDS` export).
- [ ] **3. lépés:** a fenti kód.
- [ ] **4. lépés:** PASS. `pnpm telegram:commands --dry-run` nyolc parancsot ír ki, köztük a `model`-t, hálózati hívás nélkül. Mutációs próba: a `COMMAND` regexbe `|foo` kerül → a teszt bukik. Visszaállítás. Teljes ellenőrzés zöld, a Worker tsc-vel együtt.
- [ ] **5. lépés:** commit (`feat(worker): Build the Telegram command menu from /help`, `Closes #305`).

### 5. feladat: a sémás kimenet mérése (#304)

**Fájlok:**
- Új: `src/model/check-structured.ts`, `src/model/check-structured.test.ts`
- Módosul: `src/recipe/structured.ts` (`SCHEMA_ERRORS` export)
- Módosul: `src/model/recipe-model.ts` (`withDraftModel`, a `modelConfigFor` erre épül)
- Módosul: `src/cli.ts` (a parancs bekötése), `src/help.ts`
- Teszt: `src/cli.test.ts` (`OPTIONS` tábla)

**`src/recipe/structured.ts:14`:** `const SCHEMA_ERRORS` → `export const SCHEMA_ERRORS`.

**`src/model/recipe-model.ts`, a mai `modelConfigFor` (`:11–24`) helyére:**
```ts
/** A `draft` szerep a megadott modellre, a saját árával; a `where` a hibaüzenetben a config helye. */
export function withDraftModel(cfg: ModelConfig, model: string, where: string): ModelConfig {
  const price = cfg.modelPricing[model]
  // A betöltő ezt kizárja; ha mégis ide jutunk, ne könyveljünk rossz áron.
  if (price === undefined) throw new Error(`pricing: nincs ára a(z) ${model} modellnek (${where}).`)
  return { ...cfg, models: { ...cfg.models, draft: model }, pricing: { ...cfg.pricing, draft: price } }
}

/** (a mai doc-komment marad) */
export function modelConfigFor(cfg: ModelConfig, recipeId: string): ModelConfig {
  const model = cfg.recipeModels[recipeId]
  return model === undefined ? cfg : withDraftModel(cfg, model, `model.recipes.${recipeId}`)
}
```
A hibaüzenet betűre a mai (`pricing: nincs ára a(z) <modell> modellnek (model.recipes.<recept>).`), a meglévő tesztje változatlanul zöld.

**Kód (`src/model/check-structured.ts`):**
```ts
import type { ModelConfig } from '../config.js'
import { BloomSchema } from '../recipe/bloom.js'
import { FlashcardsSchema } from '../recipe/flashcards.js'
import { NotesSchema } from '../recipe/notes.js'
import { SCHEMA_ERRORS } from '../recipe/structured.js'
import { createModelClient, type ModelClient } from './client.js'
import { withDraftModel } from './recipe-model.js'

/** A sémás receptek sémája; a teszt ellenőrzi, hogy a registry sémás receptjeivel egyezik. */
export const PROBE_SCHEMAS = { flashcards: FlashcardsSchema, notes: NotesSchema, bloom: BloomSchema }

/** Egy próba tokenje ráhagyással: mérve kb. 3,5 ezer be (séma + utasítás), 0,8–1,1 ezer ki (2026-10-23). */
const PROBE_TOKENS = { inputTokens: 4000, outputTokens: 1500 }

/** Próbák száma modellenként és sémánként: egy próba nem döntés, a kimenet ingadozhat. */
const RUNS = 3

const PROBE_PROMPT = [
  'Készíts tananyagot az alábbi rövid szövegből, magyarul.',
  '',
  'A fotoszintézis során a növények a napfény energiáját kémiai energiává alakítják.',
  'A folyamat a kloroplasztiszokban zajlik, mellékterméke az oxigén.',
].join('\n')

function probeUsd(view: ModelConfig): number {
  const price = view.pricing.draft
  return (PROBE_TOKENS.inputTokens * price.inputPerMillion + PROBE_TOKENS.outputTokens * price.outputPerMillion) / 1e6
}

/**
 * Kiméri, hogy a `model.switchable` modelljei adnak-e sémás kimenetet, és összeveti a config
 * jelzésével (#304). A configot nem írja át. 0: nincs eltérés; 1: eltérés, vagy a becslés kétszerese a plafon fölött.
 */
export async function commandCheckStructured(
  cfg: ModelConfig,
  createClient: (view: ModelConfig) => ModelClient = (view) => createModelClient(view),
): Promise<number> {
  const models = Object.entries(cfg.switchable ?? {}).map(([model, declared]) => ({
    model,
    declared,
    view: withDraftModel(cfg, model, 'model.switchable'),
  }))
  if (models.length === 0) {
    console.log('A model.switchable üres: nincs mit mérni.')
    return 0
  }
  const schemas = Object.values(PROBE_SCHEMAS)
  const estimate = models.reduce((sum, { view }) => sum + RUNS * schemas.length * probeUsd(view), 0)
  console.log(
    `${models.length} modell × ${schemas.length} séma × ${RUNS} próba, becsült költség legfeljebb ${estimate.toFixed(4)} $ (plafon: ${cfg.costLimitUsd} $).`,
  )
  // ponytail: nincs menet közbeni költségőr; a 2× ráhagyású becslés a felső korlát. Őr kell, ha a próba nagyobb lesz.
  if (estimate * 2 > cfg.costLimitUsd) {
    console.error('A becslés kétszerese a cost_limit_usd fölött van: nagyobb plafon vagy rövidebb switchable lista kell.')
    return 1
  }

  let mismatch = false
  for (const { model, declared, view } of models) {
    const client = createClient(view)
    const tally = { ok: 0, schema: 0, other: 0 }
    for (let run = 0; run < RUNS; run++) {
      for (const schema of schemas) {
        try {
          await client.generateObject('draft', PROBE_PROMPT, schema)
          tally.ok++
        } catch (error) {
          if (SCHEMA_ERRORS.has((error as Error).name)) tally.schema++
          else tally.other++
        }
      }
    }
    const tried = tally.ok + tally.schema
    const measured = tried === 0 ? '?' : tally.schema === 0 ? 'structured' : 'text'
    const differs = measured !== '?' && measured !== declared
    if (differs) mismatch = true
    const other = tally.other === 0 ? '' : `, ${tally.other} egyéb hiba`
    console.log(
      `${model}: config ${declared}, mért ${measured} (${tally.ok}/${tried} sémás${other})${differs ? '  ← ELTÉR' : ''}`,
    )
  }
  return mismatch ? 1 : 0
}
```

**`src/cli.ts`:**
- A `check-pricing` ág után: `if (command === 'check-structured') return commandCheckStructured(loadModelConfig(raw, process.env, cfg.configPath))`

**`src/help.ts`, a `check-pricing` után:**
```ts
  {
    name: 'check-structured',
    summary: 'Kiméri, hogy a model.switchable modelljei adnak-e sémás kimenetet.',
    usage: 'refinery check-structured [kapcsolók]',
    description:
      'A model.switchable minden modelljét a három sémás recept sémájával próbálja, és összeveti a config structured/text jelzésével. Valódi modellhívás, a becslést indulás előtt kiírja. Modellenként és sémánként 3 próba. A configot nem írja át.',
    options: [CONFIG, HELP],
    examples: ['refinery check-structured'],
  },
```

- [ ] **1. lépés: a bukó tesztek.**
  - `src/model/check-structured.test.ts`. Egy `ModelConfig` a `loadModelConfig`-gal, `switchable: { jo: 'structured', rossz: 'structured', szoveg: 'text', halo: 'text' }`, mindnek ugyanaz az ár: `{ input_per_million: 3, output_per_million: 15 }`. Egy próba becslése így `(4000 × 3 + 1500 × 15) / 1e6 = 0,0345 $`, a teljes `4 × 3 × 3 × 0,0345 = 1,242 $`. A hamis `createClient` a `view.models.draft` szerint válaszol:
    - `jo`: `generateObject` → `{ value: {}, usage: { inputTokens: 10, outputTokens: 5 } }`;
    - `rossz` és `szoveg`: `Object.assign(new Error('nincs objektum'), { name: 'AI_NoObjectGeneratedError' })`-t dob;
    - `halo`: `new Error('ECONNRESET')`-et dob.
  - Esetek:
    - a sorok: `jo: config structured, mért structured (9/9 sémás)`; `rossz: … mért text (0/9 sémás)  ← ELTÉR`; `szoveg: config text, mért text (0/9 sémás)`; `halo: config text, mért ? (0/0 sémás, 9 egyéb hiba)`; a kód 1;
    - eltérés nélkül (`rossz` nélkül) a kód 0;
    - `cost_limit_usd: 2` mellett (a becslés 1,242 $ alatta, a duplája 2,484 $ fölötte) a kód 1, és a `createClient` egyszer sem hívódik;
    - üres `switchable`: `'A model.switchable üres: nincs mit mérni.'`, 0;
    - a registry sémás receptjei és a `PROBE_SCHEMAS` kulcsai egyeznek: `Object.values(RECIPES).filter((recipe) => recipe.structured).map((recipe) => recipe.id).sort()` = `Object.keys(PROBE_SCHEMAS).sort()`.
  - `src/cli.test.ts`: az `OPTIONS` táblába `'check-structured': ['--config'],` (ez a tábla-teszt és a parancsonkénti súgóteszt is lefedi, az áttekintés-teszt pedig a `COMMANDS` minden nevét).
- [ ] **2. lépés:** `pnpm vitest run src/model/check-structured.test.ts src/cli.test.ts` → FAIL.
- [ ] **3. lépés:** a fenti kód.
- [ ] **4. lépés:** PASS. Mutációs próba: a `SCHEMA_ERRORS.has(...)` feltétel helyett `true` → a `halo` sor bukik. Visszaállítás, teljes ellenőrzés zöld.
- [ ] **5. lépés:** commit (`feat(cli): Add check-structured to measure schema support`, `Closes #304`).
- [ ] **6. lépés (valódi pénz, a felhasználó jóváhagyásával):** `refinery check-structured --config <peter-mba config másolata, base_url: http://localhost:4000/v1>`. A becslés előtte látszik, a futás kb. 27 hívás. Az eredményt a PR leírásába.

### 6. feladat: kód-PR, kiadás, menü

Külön kérésre.
- `gh pr checks`, a PR a felhasználó jóváhagyásával.
- Kiadás: minor (`bumpp`, changelog-generator, kiadási PR, tag). Kép kell (`pnpm docker:publish`), mert a `src/` változott. Worker-deploy nem szükséges: a súgó szövege nem változott.
- A kiadás után `pnpm telegram:commands`, majd a `scripts/telegram-bot-info.sh` kimenetében a `getMyCommands` nyolc parancsot mutat.
- A peter-mba frissítése a felhasználó lépése (compose képverzió).
