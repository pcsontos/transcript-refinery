# `refinery deploy`: szűrés, újragenerálás és `--dry-run` — implementációs terv

> **Végrehajtóknak:** a terv natívan, feladatonként hajtandó végre (a felhasználó szokása: Sonneten, skill és alügynök nélkül, lásd a memóriát); a záró, teljes ágra szóló review Opuson. A lépések jelölőnégyzetesek (`- [ ]`). Valódi pénzt költő lépés nincs: minden teszt hamis átalakítóval vagy hamis klienssel fut.

**Cél:** a kézi `refinery deploy` szűkíthető tételre, fajtára, csatornára és forrásra; az `--item` újragenerál (akár `--model`-lel más modellen); a `--dry-run` előre megmutatja, mit tenne, írás, commit, push és modellhívás nélkül.

**Architektúra:** minden a meglévő `deployNotes`-ban (`src/deploy/deploy.ts`) marad, egy függvényben. Új sorrend: (1) vault-fázis — szkennelés, a szűrők ellenőrzése és alkalmazása, a klón érintése előtt; (2) klón-fázis — élesben pull + függő munka, szárazfutásban csak `git fetch`, és egy `read(target)` függvény, amely az összevetés alapját adja (élesben a munkafa, szárazfutásban a távoli `main` + a helyi eltérések); (3) tételenként a közös `decide()` dönt, az eredmény a `report.planned`-be kerül; szárazfutásban itt vége, élesben jön az átalakítás és az írás. A CLI (`src/cli.ts`) csak bont, ellenőriz és kiír.

**Technológia:** TypeScript, vitest, `node:util` `parseArgs` (`multiple: true`), git CLI. Új függőség nincs.

**Spec:** `docs/plans/2026-10-31-deploy-szures-spec.md`

## Globális megkötések

- Új kapcsolók: `--item`, `--kind` (vesszős lista és/vagy ismétlés, unió), `--channel`, `--source`, `--model`, `--dry-run`; minden kombinálható a `--config`-gal és a `--retry-failed`-del.
- Ismert `--kind` nevek: `clean-mild`, `clean-moderate`, `clean-deep`, `summary`, `notes`, `flashcards`, `qa`, `bloom`, `glossary`, és a rövid `clean` (minden `clean-*`-ra illik).
- Szűrők kapcsolata: ÉS. `--channel`/`--source`: a vault-jegyzet frontmatterének `channel`/`source` mezője, pontos egyezés, kis- és nagybetű nélkül; egy tétel illik, ha bármelyik (nem átirat) jegyzete illik.
- Újragenerálás csak `--item`-mel. `--channel`/`--source`/`--kind` önmagában nem kényszerít.
- Ismeretlen `--item` id, ismeretlen `--kind` név, ismeretlen vagy ár nélküli `--model`: hiba, kilépés 1-gyel, a klón érintése és modellhívás előtt.
- Szárazfutás: nem ír, nem commitol, nem pushol, nem hív modellt; a klónon csak `git fetch`; nincs dolláros becslés.
- A függő munka (maradék-commit, pusholatlan commitok) szűrt futásban is globális.
- Az `auto` út (`run`, `serve`) nem kap új kapcsolót; a `deployNotes` hívása ott változatlan.
- Kommentek, hibaüzenetek, tesztnevek magyarul, a meglévő kód stílusában. Commit-üzenet a `commit-message` skillel (memória), dedikált kód-ágon.

## A spec által a tervre hagyott döntések

| kérdés | döntés |
|---|---|
| A döntés és az írás szétválasztása | Kiemelt, tiszta `decide()` a `deploy.ts`-ben; az éles és a szárazfutás ugyanazon a cikluson megy át, a szárazfutás a döntés után `continue`. Nincs külön `planDeploy` függvény és köztes adatszerkezet. |
| Összevetés a távoli állapottal | `read(target)`: ha a fájl helyben eltér (`git diff --name-only <merge-base HEAD @{u}>` + követetlen fájlok), a munkafából; különben `git show @{u}:<út>`. Ez épp a `pull --rebase --autostash` utáni állapot. |
| A `--kind` nevek forrása | Rögzített lista (`SITE_KINDS`) a `deploy.ts`-ben, ebből számol a `routeOf` is. A configban nincs más recept, amiből site-oldal lesz. |
| Fajtaszűrés és a tétel többi jegyzete | A `variantOf` a tétel **összes** jegyzetén fut (a `siblings`, az ütközés és a `meta.json` címe így ugyanaz, mint egy teljes futásban); a `--kind` csak a kihagyás-sorokat és az írandó jelölteket szűri. Különben `--kind glossary` mellett a szójegyzék elvesztené a forrás-adatát. |
| `--item`/`--kind`/`--model` más parancsnál | Hiba: `A --<név> csak a deploy kapcsolója.` |
| Üres lista (`--item=`, `--item ,`) | Hiba: `A --item értéke üres.` (nem a teljes vault). |
| A függő munka jelzése | Új mező `pendingCommits` (a pull utáni pusholatlan commitok + a maradék-commit). `> 0` esetén minden futásban külön sor; a „szűrőn kívüli tételt érintett" vizsgálata elmarad, a sor egyszerűen jelzi, hogy korábbi munka is kimegy. |
| Bájtra azonos újragenerálás | Ha a kiírandó szöveg azonos a kint lévővel, nincs írás és a `written`-be sem kerül. |
| Összesítő-sor | „ebből 3 oldalhoz hívna modellt" — a mintabeli „3-hoz" ragja számfüggő, az „oldalhoz" nem. |
| Fejlécsor | A CLI írja (`deployHeader`), a jelentés legelső soraként; szűrő vagy `--model` nélkül éles futásban nincs. |

## Review Focus

1. **`--kind glossary` / `--kind summary` egy tétel többi jegyzete nélkül:** a szójegyzék a testvérjegyzet `source`-át, a fordítás az eredeti `generated_at`-jét használja; fajtaszűrés mellett is ugyanúgy kell kimennie, mint teljes futásban. (1. feladat teszt)
2. **Fajtaszűrt futás `meta.json`-ja:** ugyanazt a címet írja, mint a teljes futás, nem a szűrt jelölt (pl. fordítás) címét. (1. feladat teszt)
3. **Üres vagy szóközös lista:** `--item=` nem jelentheti a teljes vaultot kényszer nélkül; `--item "a, b"` a szóközt levágja. (5. feladat teszt)
4. **Pusholatlan helyi commit a klónban:** a szárazfutás az abban lévő oldalt változatlannak látja, ahogy az éles futás is a pull után. (4. feladat teszt)
5. **`--item` és `--channel` diszjunkt:** érthető „nincs találat" üzenet, nem „ismeretlen tétel" hiba, és a klón érintetlen. (1. feladat teszt)

---

### 1. feladat: Vault-oldali szűrés (tétel, fajta, csatorna, forrás)

**Fájlok:**
- Módosít: `src/deploy/variant.ts`, `src/deploy/deploy.ts`
- Teszt: `src/deploy/variant.test.ts`, `src/deploy/deploy.test.ts`

**Interfészek:**
- Termel:
  - `variant.ts`: `export function siteKindOf(vaultKind: string, fields: Record<string, unknown>): string` — `glossary-*` → `glossary`; ha van `translation_of`, a `-<nyelv>` végződés levágva (nyelv: a `language` mező `-orig` nélkül; ha nem így végződik, a `vaultKind` változatlan); különben a `vaultKind`.
  - `deploy.ts`:
    ```ts
    export const SITE_KINDS = ['clean-mild', 'clean-moderate', 'clean-deep', 'summary', 'notes', 'flashcards', 'qa', 'bloom', 'glossary'] as const
    export interface DeployFilter { items?: readonly string[]; kinds?: readonly string[]; channel?: string; source?: string }
    // DeployReport új mezője:
    noMatch?: true
    // deployNotes bemenete új mezője:
    filter?: DeployFilter
    ```
  - Hibaüzenetek (`throw new Error`), a `gitCurrentBranch` előtt: `--item: nincs ilyen tétel a vaultban: <id-k, vesszővel>`; `--kind: ismeretlen fajta: <nevek>. Ismert: clean, clean-mild, …` (a `clean` + `SITE_KINDS`).
  - `deployLines`: `noMatch` esetén egyetlen sor: `deploy: Nincs a szűrőnek megfelelő jegyzet.`

- [ ] **1. lépés: Írd meg a bukó teszteket**

`variant.test.ts`:
```ts
it('siteKindOf a vault-fajtából a site-fajtát adja', () => {
  expect(siteKindOf('summary', { language: 'hu' })).toBe('summary')
  expect(siteKindOf('summary-de', { language: 'de', translation_of: 'summary' })).toBe('summary')
  expect(siteKindOf('notes-en', { language: 'en-orig', translation_of: 'notes' })).toBe('notes')
  expect(siteKindOf('glossary-hu', { language: 'hu' })).toBe('glossary')
  expect(siteKindOf('clean-deep', { language: 'hu' })).toBe('clean-deep')
})
```

`deploy.test.ts`, új `describe('szűrés', …)` a `deployNotes` alatt (a meglévő `note`, `show`, `remoteHas`, `valid` segédekkel):
- `'tételszűrés: más tételre nem hív modellt és nem ír'` — `A` és `B` `summary`; `deployNotes({ cfg, transform, filter: { items: ['A'] } })` → `transform.calls === 1`, `written` `['A/summary.hu.mdx']`, `remoteHas('content/notes/B/summary.hu.mdx') === false`.
- `'ismeretlen tétel a klón érintése előtt hibát ad'` — `filter: { items: ['A', 'X', 'Y'] }` → `rejects.toThrow('--item: nincs ilyen tétel a vaultban: X, Y')`; előtte-utána `git(clone, 'rev-parse', 'HEAD')` és `git(clone, 'status', '--porcelain')` egyezik, `transform.calls === 0`. Ugyanígy `kinds: ['clean', 'foo']` → `rejects.toThrow('--kind: ismeretlen fajta: foo. Ismert: clean, clean-mild')`.
- `'fajtaszűrés: summary mindkét nyelven, clean minden clean-*'` — `vid1`: `summary`, `summary-en` (fordítás, mint az első tesztben), `notes`, `clean-mild`, `clean-deep`. `kinds: ['summary']` → `written.sort()` `['vid1/summary.en.mdx', 'vid1/summary.hu.mdx']`; új klón-állapotból (`rm content` + `reset --hard origin/main`, mint a „listán kívüli komponens" tesztben, vagy új tétel-id) `kinds: ['clean']` → `['vid1/clean-deep.hu.mdx', 'vid1/clean-mild.hu.mdx']`.
- `'fajtaszűrés: a kizárt fajta kihagyása nem látszik, a kiválasztotté igen'` — `vid1`: `summary-de` (`language: 'de'`, `translation_of: 'summary'`) és `qa-de` hasonlóan → `kinds: ['summary']` mellett `skipped` pontosan egy elem, oka `nyelv: de`, útja a `summary-de` fájl.
- `'fajtaszűrés mellett a szójegyzék megkapja a testvér forrás-adatát'` — a meglévő „szójegyzék glossary.hu-ként megy" teszt mintájára (vault-commit), `kinds: ['glossary']` → `written` `['vid1/glossary.hu.mdx']`, `show(...)` tartalmazza a `source: youtube`-ot.
- `'fajtaszűrt futás meta.json-ja a teljes futás címét írja'` — `vid1` `summary` `title: 'Eredeti'` és `summary-en` fordítás `title: 'Translated'`; `kinds: ['summary']` → `meta.json` `{ title: 'Eredeti' }`. Majd `vid2`: `clean-deep` `title: 'Mély'`, `summary` `title: 'Össz'`; `kinds: ['summary']` → `meta.json` címe ugyanaz, mint egy szűretlen futásé ugyanerre a vaultra (`'Mély'`, mert a `clean-deep.hu` áll elöl a rendezésben).
- `'csatorna- és forrásszűrés a vault frontmatterén, kis- és nagybetű nélkül'` — `A` `channel: 'Csatorna A'`, `B` `channel: 'Más'` (a `note` mezőiben) → `filter: { channel: 'csatorna a' }` csak `A`-t írja; `filter: { source: 'YOUTUBE', items: ['B'] }` csak `B`-t.
- `'semmire nem illeszkedő szűrés: nincs találat, a klón érintetlen'` — `A` `channel: 'Csatorna A'`; `filter: { items: ['A'], channel: 'Más' }` → `report.noMatch === true`, `commits === 0`, `push === null`, a klón HEAD-je és `status`-a változatlan, és egy előre odatett követetlen klónfájl sem kerül commitba (ez a függő munka; szűrt, üres futás nem nyúl hozzá). `filter: { items: ['A'], kinds: ['qa'] }` ugyanígy. `deployLines(report)` `['deploy: Nincs a szűrőnek megfelelő jegyzet.']`.

- [ ] **2. lépés: Futtasd, bukjanak**

Run: `pnpm vitest run src/deploy/variant.test.ts src/deploy/deploy.test.ts`
Expected: FAIL (`siteKindOf` nincs exportálva, a `filter` hatástalan).

- [ ] **3. lépés: Valósítsd meg**

- `siteKindOf` a `variant.ts`-ben, a meglévő `noOrig`-gal.
- `deploy.ts`: `routeOf` a `SITE_KINDS` két részlistájából (`LLM_KINDS`, `CARD_KINDS`) számol, viselkedése nem változik.
- `deployNotes` új eleje, a `gitCurrentBranch` **elé**: a `--kind` ellenőrzése; `scanNotes`; az ismeretlen `--item` id-k; tételenként a jegyzetek beolvasása (a mai `notes` map) a kiválasztott tételekre (`itemIds` ∩ `filter.items` ∩ csatorna/forrás); ha volt `filter` és egyetlen kiválasztott tételnek sincs illeszkedő fajtájú (`siteKindOf`) jegyzete → `return { ...üres jelentés, noMatch: true }`. A beolvasott jegyzetek a klón-fázis tételciklusába mennek, a vault másodszor nem olvasódik.
- A tételciklusban a `variantOf` minden jegyzetre fut, de a `skipped.push` (nyelv és társai, ütközés) és az írandó jelöltek csak az illeszkedő fajtájúakra. Illeszkedés: `kinds` nincs megadva, vagy tartalmazza a fajtát, vagy tartalmazza a `clean`-t és a fajta `clean-`-nel kezdődik. A `meta.json` címe a szűretlen `ordered`-ből jön, mint ma.
- A csatorna/forrás egyezése a `src/view/list.ts` `same()` mintájára (`toLocaleLowerCase`); nem szöveges mező nem illik.

- [ ] **4. lépés: Futtasd, menjenek át**

Run: `pnpm vitest run src/deploy && pnpm typecheck && pnpm lint`
Expected: PASS, a meglévő deploy-tesztek is.

- [ ] **5. lépés: Commit** (`commit-message` skill)

```bash
git add src/deploy/variant.ts src/deploy/variant.test.ts src/deploy/deploy.ts src/deploy/deploy.test.ts
```

---

### 2. feladat: Közös döntés, tervezett oldalak, `mdx_failed` és függő munka a jelentésben

**Fájlok:**
- Módosít: `src/deploy/deploy.ts`
- Teszt: `src/deploy/deploy.test.ts`, és a `DeployReport`-literálok: `src/cli.test.ts` (209., 3348., 3429. sor körül), `src/serve/summary.test.ts` (688. sor) — keresd: `grep -n "transform: null" src/cli.test.ts src/serve/summary.test.ts`

**Interfészek:**
- Fogyaszt: 1. feladat `DeployFilter`, `noMatch`.
- Termel:
  ```ts
  export type Route = 'llm' | 'cards' | 'plain'
  export type DeployAction = 'new' | 'update' | 'retry' | 'regenerate'
  // DeployReport új mezői (kötelezők):
  planned: { target: string; action: DeployAction; route: Route }[]   // amit írásra kiválasztott, sorrendben
  unchanged: number                                                    // illeszkedő, nem írandó jelöltek
  pendingCommits: number                                               // a pull utáni pusholatlan commitok + a maradék-commit
  // a skipped elemének új, nem kötelező mezője:
  skipped: { path: string; reason: string; target?: string }[]
  ```
  ```ts
  /** Az „írná-e” döntés; az éles futás és a szárazfutás közös kódja. */
  function decide(
    old: Record<string, unknown> | null,
    generatedAt: unknown,
    route: Route,
    o: { force: boolean; retryFailed: boolean; hasTransform: boolean },
  ): DeployAction | 'unchanged' | 'failed'
  ```
  A szabály (a mai `changed` kifejtve, és az `mdx_failed` külön ága):
  ```ts
  if (old === null) return 'new'
  if (stamp(old.generated_at) !== generatedAt) return 'update'
  if (old.mdx_fallback === true && (route !== 'llm' || o.hasTransform)) {
    if (stamp(old.mdx_failed) !== generatedAt) return 'update'
    return o.retryFailed || o.force ? 'retry' : 'failed'
  }
  return o.force ? 'regenerate' : 'unchanged'
  ```
  Ebben a feladatban `force: false`; a 3. feladat köti be.
- A ciklusban: `'failed'` → `skipped.push({ path: c.path, target: c.target, reason: 'mdx_failed (--retry-failed nélkül)' })`, `continue`; `'unchanged'` → `unchanged++`, `continue`; különben `planned.push(...)`, és megy tovább az átalakításra, mint ma.
- `deployLines`: az első sor után, ha `pendingCommits > 0`: `deploy: korábbi futás függő munkája is kimegy: <n> commit`.

- [ ] **1. lépés: Írd meg a bukó teszteket**

- A meglévő `'kétszer bukott oldal mdx_failed-et kap, a következő futás nem hív, a --retry-failed igen'` bővül: a második (hívás nélküli) futás `skipped` tartalmazza a `{ path: <a summary vault-fájlja>, target: 'vid1/summary.hu.mdx', reason: 'mdx_failed (--retry-failed nélkül)' }`-t, `deployLines` sora `  kihagyva: <fájlnév> — mdx_failed (--retry-failed nélkül)`; a `--retry-failed`-es futás `planned` `[{ target: 'vid1/summary.hu.mdx', action: 'retry', route: 'llm' }]`.
- A meglévő `'második futás változatlan vaultnál nem ír és nem commitol'` bővül: a második futás `planned` `[]`, `unchanged === 1`; az első `planned` `[{ target: 'vid1/summary.hu.mdx', action: 'new', route: 'llm' }]`.
- A meglévő `'újragenerált jegyzet frissül'`: a második futás `planned[0].action === 'update'`.
- A meglévő `'elutasított push után a következő futás pusholja'` bővül: `second.pendingCommits === 1`, és `deployLines(second)` tartalmazza a `deploy: korábbi futás függő munkája is kimegy: 1 commit` sort; a `'félbemaradt írás a következő futásban commitba kerül'`-ben `pendingCommits === 1`; egy friss futásban `0`, és a sor nincs.

- [ ] **2. lépés: Futtasd, bukjanak**

Run: `pnpm vitest run src/deploy/deploy.test.ts`
Expected: FAIL (`planned`, `unchanged`, `pendingCommits` nincs; az `mdx_failed` oldal nem jelenik meg a `skipped`-ben).

- [ ] **3. lépés: Valósítsd meg** a fenti interfész szerint; a `pendingCommits` a `gitPullRebase` után `gitAheadCount(clone)`, plusz 1, ha a maradék-commit létrejött. A push feltétele nem változik. A tesztliterálokat egészítsd ki `planned: [], unchanged: 0, pendingCommits: 0`-val.

- [ ] **4. lépés: Futtasd, menjenek át**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS (a teljes suite: a CLI és a serve is a `DeployReport`-ot használja).

- [ ] **5. lépés: Commit** (`commit-message` skill)

---

### 3. feladat: Újragenerálás `--item`-mel, rontás nélkül

**Fájlok:**
- Módosít: `src/deploy/deploy.ts`
- Teszt: `src/deploy/deploy.test.ts`

**Interfészek:**
- Fogyaszt: 2. feladat `decide()` (`force`), `planned`.
- Termel: `force = filter?.items !== undefined`. Új szabályok az írási ágban:
  - `keep = action === 'regenerate' && old.mdx_fallback !== true` (kint lévő, végleges oldal, változatlan jegyzettel). Ha ilyenkor az átalakítás elbukik (`failed !== null`: elvetett kimenet, dobott hiba, frontmatter/MDX-hiba), a skip oka `<ok>; a kint lévő oldal marad`, és nincs írás (sem fallback, sem `mdx_failed`). A költségplafon (`'budget'`) a mai ágon marad: azonos `generated_at` mellett `continue`.
  - Ha a kiírandó szöveg bájtra azonos a kint lévővel (`text === existing`), nincs írás, és a `written`-be sem kerül.

- [ ] **1. lépés: Írd meg a bukó teszteket** (`describe('újragenerálás', …)`)

- `'--item a változatlan LLM-es oldalt újra a modellre küldi, nélküle nem'` (elfogadás 7, 5) — `vid1` `summary` és `vid2` `summary`; `deployNotes({ cfg, transform: valid() })`; majd `t = fakeTransform(final('Új <Callout type="note">y</Callout>'))`: `deployNotes({ cfg, transform: t })` → `t.calls === 0`; `deployNotes({ cfg, transform: t, filter: { items: ['vid1'], kinds: ['summary'] } })` → `t.calls === 1`, `planned` `[{ target: 'vid1/summary.hu.mdx', action: 'regenerate', route: 'llm' }]`, `show('content/notes/vid1/summary.hu.mdx')` tartalmazza a `y</Callout>`-t, a `vid2` oldala változatlan.
- `'--item kind nélkül a tétel minden oldalát újragenerálja'` — `vid1`: `summary`, `notes`, `qa`; első futás `valid()`-dal; második `filter: { items: ['vid1'] }` → `planned` három eleme mind `regenerate`, `t.calls === 2` (a `qa` kódos út).
- `'--item felülírja az mdx_failed-et'` — a „kétszer bukott" teszt mintájára elbukott oldal; `filter: { items: ['vid1'] }`, `--retry-failed` nélkül → `planned[0].action === 'retry'`, a transform hívódik.
- `'elbukott újragenerálás nem rontja a kint lévő oldalt'` (elfogadás 9) — `valid()`-dal kint lévő végleges oldal, a bájtjait mentsd (`show`); három változat külön futással: `fakeTransform({ kind: 'failed', reason: 'rossz' })`, `fakeTransform(new Error('hálózat'))`, `fakeTransform(final('<Callout>'))` (nem fordul le) → mindháromnál a `show` bájtra egyezik a mentettel, nem tartalmaz `mdx_fallback`/`mdx_failed`-et, `commits === 0`, és a `skipped` oka a `; a kint lévő oldal marad`-ra végződik.
- `'bájtra azonos újragenerálás nem ír és nem commitol'` — `qa` oldal kiküldve; `filter: { items: ['vid1'] }` → `planned[0].action === 'regenerate'`, `written` `[]`, `commits === 0`.

- [ ] **2. lépés: Futtasd, bukjanak**

Run: `pnpm vitest run src/deploy/deploy.test.ts -t 'újragenerálás'`
Expected: FAIL (a `force` nincs bekötve).

- [ ] **3. lépés: Valósítsd meg** a fenti szabályokat a meglévő írási ágban (`converted` / `failed` / `text` kezelése).

- [ ] **4. lépés: Futtasd, menjenek át**

Run: `pnpm vitest run src/deploy && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **5. lépés: Commit** (`commit-message` skill)

---

### 4. feladat: Szárazfutás

**Fájlok:**
- Módosít: `src/vault/git.ts`, `src/deploy/deploy.ts`
- Teszt: `src/deploy/deploy.test.ts` (a git-segédeket a deploy-tesztek valódi repókon fedik)

**Interfészek:**
- Fogyaszt: 2–3. feladat `decide()`, `planned`, `unchanged`, `skipped[].target`.
- Termel:
  - `git.ts`:
    ```ts
    export async function gitFetch(repo: string): Promise<void>                       // git fetch
    /** A fájl tartalma egy revízióban (`<rev>:<út>`); `null`, ha ott nincs. */
    export async function gitShowOptional(repo: string, rev: string, path: string): Promise<string | null>
    /** Az upstreamtől helyben eltérő fájlok (pusholatlan commit, munkafa, követetlen), repó-relatív úttal. */
    export async function gitLocalChanges(repo: string, paths: readonly string[]): Promise<Set<string>>
    ```
    A `gitLocalChanges`: `git merge-base HEAD @{u}`, majd `git diff --name-only <base> -- <paths>` és `git ls-files --others --exclude-standard -- <paths>` uniója.
  - `deployNotes` bemenete: `dryRun?: boolean`. Szárazfutásban a branch-ellenőrzés marad; `gitPullRebase`, maradék-commit, `contract`-olvasás, átalakítás, írás, commit és push helyett: `gitFetch`, majd `read(target)` = helyi eltérésnél a munkafa (`readOptional`), különben `gitShowOptional(clone, '@{u}', 'content/notes/<target>')`. Élesben `read` = a mai `readOptional(join(clone, NOTES_DIR, target))`. A döntés után szárazfutásban `continue`; a `meta.json`-ág és a push kimarad. `transform.usage()` szárazfutásban nem kerül a jelentésbe (`transform: null`).
  - ```ts
    /** A szárazfutás sorai; `hasTransform`: van-e LLM-átalakító. */
    export function dryRunLines(report: DeployReport, hasTransform: boolean): string[]
    ```
    `noMatch` esetén a `deployLines` sora. Különben soronként (két szóköz behúzás, az első két oszlop a leghosszabbra kitöltve, egy-egy szóköz köz):
    - tervezett oldal: `új` / `frissítés` / `frissítés` / `újragenerálás` (rendre `new`/`update`/`retry`/`regenerate`), a `target`, és az út: `LLM` (átalakító nélkül `fallback, nincs átalakító`) / `kód` / `escape`; `retry`-nál utána ` (mdx_failed, újrapróbálva)`;
    - kihagyás: `kihagyva`, `target ?? basename(path)`, az ok; a `deployLines` rendezése szerint, a tervezettek után.
    - Összesítő: `deploy (szárazfutás): <n> oldalt írna, ebből <m> oldalhoz hívna modellt; <k> kihagyva, <u> változatlan` (`m` = `route === 'llm'` és `hasTransform`); `n === 0` esetén `deploy (szárazfutás): nincs mit írni; <k> kihagyva, <u> változatlan`.

- [ ] **1. lépés: Írd meg a bukó teszteket** (`describe('szárazfutás', …)`)

- `'nem ír, nem commitol, nem pushol, nem hív modellt'` (elfogadás 10) — `vid1` `summary` (új); a klónba egy követetlen `content/notes/vid9/summary.hu.mdx`; mentsd: klón `rev-parse HEAD`, `status --porcelain`, `remote` `rev-parse main`, vault `status --porcelain`. `deployNotes({ cfg, transform: t, dryRun: true })` → mind a négy egyezik, `t.calls === 0`, `commits === 0`, `push === null`, `planned` `[{ target: 'vid1/summary.hu.mdx', action: 'new', route: 'llm' }]`.
- `'a lista és az utána futó éles deploy ugyanazt választja'` (elfogadás 11, 13) — vegyes vault: `vid1` `summary` fallbackként kint (átalakító nélküli első futás), `vid2` `qa` új, `vid3` `notes` `mdx_failed`-del kint (kétszer bukó transformmal), `vid4` `summary` végleges és változatlan. `dry = deployNotes({ cfg, transform, dryRun: true })`, `live = deployNotes({ cfg, transform })` → `dry.planned` `toEqual` `live.planned`, `dry.unchanged === live.unchanged`, a `vid3` mindkettőben kihagyott `mdx_failed (--retry-failed nélkül)` okkal. Ugyanez `retryFailed: true`-val egy újabb bukó állapoton: a `vid3` `retry`-ként szerepel mindkettőben. Ugyanez `filter: { items: ['vid4'] }`-gyel: `[{ target: 'vid4/summary.hu.mdx', action: 'regenerate', route: 'llm' }]` mindkettőben.
- `'előrébb járó távoli main oldalát változatlannak látja'` (elfogadás 12) — `vid1` kiküldve; a klónban `git reset -q --hard HEAD~1` (a klón lemaradt, a fájl nincs a munkafában) → szárazfutás `planned` `[]`, `unchanged === 1`, a klón HEAD-je utána is a régi.
- `'pusholatlan helyi commit oldalát változatlannak látja'` (Review Focus 4) — az `'elutasított push után…'` teszt hookjával a `vid1` commitja helyben marad → szárazfutás `planned` `[]`, `unchanged === 1`; az utána, engedett pusszal futó éles deploy `planned` `[]`, `pendingCommits === 1`.
- `'dryRunLines a mintát követi'` — kézzel összerakott jelentés: `planned` `[{ target: 'S/clean-moderate.hu.mdx', action: 'update', route: 'llm' }, { target: 'Q/qa.hu.mdx', action: 'new', route: 'cards' }, { target: 'Q/glossary.hu.mdx', action: 'regenerate', route: 'plain' }, { target: 'Q/notes.hu.mdx', action: 'retry', route: 'llm' }]`, `skipped` `[{ path: '/v/B_notes-de.md', reason: 'nyelv: de' }]`, `unchanged: 4` → `dryRunLines(r, true)` pontosan:
  ```
    frissítés      S/clean-moderate.hu.mdx  LLM
    új             Q/qa.hu.mdx              kód
    újragenerálás  Q/glossary.hu.mdx        escape
    frissítés      Q/notes.hu.mdx           LLM (mdx_failed, újrapróbálva)
    kihagyva       B_notes-de.md            nyelv: de
  deploy (szárazfutás): 4 oldalt írna, ebből 2 oldalhoz hívna modellt; 1 kihagyva, 4 változatlan
  ```
  `dryRunLines(r, false)` első sora `  frissítés      S/clean-moderate.hu.mdx  fallback, nincs átalakító`, az összesítőben `ebből 0 oldalhoz`. Üres `planned`-del: `deploy (szárazfutás): nincs mit írni; 0 kihagyva, 4 változatlan`.

- [ ] **2. lépés: Futtasd, bukjanak**

Run: `pnpm vitest run src/deploy/deploy.test.ts -t 'szárazfutás'`
Expected: FAIL (`dryRun` hatástalan, `dryRunLines` nincs).

- [ ] **3. lépés: Valósítsd meg** a git-segédeket és a `deployNotes` két klón-ágát; a `dryRunLines`-t a `deployLines` mellé.

- [ ] **4. lépés: Futtasd, menjenek át**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **5. lépés: Commit** (`commit-message` skill)

---

### 5. feladat: CLI-bekötés, `--model`, súgó és dokumentáció

**Fájlok:**
- Módosít: `src/cli.ts`, `src/deploy/deploy.ts` (`deployHeader`), `src/help.ts`, `docs/usage.md` (8. fejezet)
- Teszt: `src/cli.test.ts` (`describe('deploy', …)` és az `OPTIONS` táblázat), `src/deploy/deploy.test.ts` (`deployHeader`)

**Interfészek:**
- Fogyaszt: `DeployFilter`, `deployNotes({ filter, dryRun })`, `dryRunLines`, `deployLines`; `withRecipeModels` (`src/model/recipe-model.ts`), `MDX_MODEL_KEY`, `mdxTransformFor` (`src/deploy/llm.ts`).
- Termel:
  - `deploy.ts`: `export function deployHeader(filter: DeployFilter, opts: { dryRun: boolean; model?: string }): string | null` — szűrőrészek sorrendben `tétel: a, b`, `fajta: summary`, `csatorna: x`, `forrás: y`, `; `-vel; ha van: `szűrés: <részek>`, ha nincs és szárazfutás: `szűrés nélkül`; `--model`-nél még `modell: <név>`; ezek ` · `-tal összefűzve. Előtag `deploy` vagy `deploy (szárazfutás)`, kettősponttal. Szűrő és modell nélkül éles futásban `null`.
  - `cli.ts`:
    - `parseArgs`: `item: { type: 'string', multiple: true }`, `kind: { type: 'string', multiple: true }`, `model: { type: 'string' }`.
    - `DEPLOY_OPTIONS`: `config`, `retry-failed`, `item`, `kind`, `channel`, `source`, `model`, `dry-run`, `help`; az üzenet: `A deploy nem ismeri a --<x> kapcsolót; támogatott: --config, --retry-failed, --item, --kind, --channel, --source, --model, --dry-run.`
    - Nem-deploy parancsnál megadott `item`/`kind`/`model`: `A --<név> csak a deploy kapcsolója.`, kilépés 1, a config betöltése előtt.
    - Bontás: `values.item?.flatMap((v) => v.split(',')).map((s) => s.trim()).filter((s) => s !== '')`; ha a kapcsoló meg volt adva, de a lista üres: `A --item értéke üres.` (ugyanígy `--kind`), kilépés 1.
    - `commandDeploy(cfg, raw, opts: { retryFailed?: boolean; dryRun?: boolean; filter?: DeployFilter; model?: string; createClient?: … })`: (1) showroom-ellenőrzés, mint ma; (2) `transform = mdxTransformFor(model ? withRecipeModels(raw, { [MDX_MODEL_KEY]: model }) : raw, cfg, createClient)`; ha szöveg és van `model`: `console.error(`--model: ${transform}`)`, `return 1`; (3) a `deployHeader` sora, ha van; (4) ha a transform szöveg: a mai `deploy: LLM-átalakítás nélkül: …` sor; (5) `deployNotes({ cfg, transform, retryFailed, dryRun, filter })`, kiírás `dryRun ? dryRunLines(report, transform !== undefined) : deployLines(report)`. A `deployTransform` segéd a `run` auto útjáé marad.
  - `help.ts` (deploy): a leírás „Csak a --config és a --retry-failed kapcsolót ismeri." mondata helyett az új kapcsolók rövid leírása; `options`: `['--item <id,…>', 'csak ezek a tételek; az oldalaik akkor is újragenerálódnak, ha nem változtak']`, `['--kind <fajta,…>', 'csak ezek a fajták (summary, notes, qa, flashcards, bloom, clean-mild, clean-moderate, clean-deep, glossary; clean = minden clean-*)']`, `SOURCE`, `CHANNEL` (a vault-jegyzet mezője szerint), `['--model <név>', 'erre a futásra ez a modell tagol (a pricing: blokkban ismert név)']`, `['--dry-run', 'csak kiírja, mit tenne: nem ír, nem commitol, nem hív modellt (a költségplafont nem látja előre)']`; példák: `refinery deploy --dry-run --item SlGRN8jh2RI`, `refinery deploy --item SlGRN8jh2RI --kind summary --model <név>`.
  - `docs/usage.md`: új alfejezet a 8. fejezetben, az „Automatikus kiküldés" elé: `### Szűrés, újragenerálás és szárazfutás` — a kapcsolók, a vesszős forma és az ismétlés, a rövid `clean`, a `--channel`/`--source` vault-mezős jelentése, az `--item` mint újragenerálás (`--kind` nélkül minden oldal, `mdx_failed` is; elbukáskor a kint lévő oldal marad), a `--model`, a függő munka globális volta és a sora, a szárazfutás (csak `git fetch`, a távoli `main`-nel vet össze) és a korlátja: **a költségplafont nem látja előre, az éles futás kevesebb oldalt írhat LLM-mel, mint a lista**. A „Mit hagy ki" pont kiegészül: az `mdx_failed` oldal okkal kihagyottként listázódik.

- [ ] **1. lépés: Írd meg a bukó teszteket**

`deploy.test.ts`:
```ts
it('deployHeader a szűrést és a modellt írja', () => {
  expect(deployHeader({ items: ['SlGRN8jh2RI'], kinds: ['summary'] }, { dryRun: false })).toBe('deploy: szűrés: tétel: SlGRN8jh2RI; fajta: summary')
  expect(deployHeader({ items: ['a', 'b'] }, { dryRun: true })).toBe('deploy (szárazfutás): szűrés: tétel: a, b')
  expect(deployHeader({}, { dryRun: true })).toBe('deploy (szárazfutás): szűrés nélkül')
  expect(deployHeader({ channel: 'X' }, { dryRun: false, model: 'm' })).toBe('deploy: szűrés: csatorna: X · modell: m')
  expect(deployHeader({}, { dryRun: false })).toBeNull()
})
```

`cli.test.ts` (`describe('deploy')`, a meglévő `configPath`-os `main`-teszt mintájára):
- A meglévő `'a main a deploynak a --config és a --retry-failed kapcsolót engedi'` átírva: a `--dry-run` most engedett; elutasított példa a `--limit 1`, az üzenet tartalmazza a `--config, --retry-failed, --item, --kind, --channel, --source, --model, --dry-run` listát.
- `'az --item és a --kind vesszővel, ismételve és szóközzel is ugyanazt adja'` (elfogadás 2, Review Focus 3) — `['--item=a,b']`, `['--item', 'a,b']`, `['--item=a', '--item', 'b']`, `['--item', 'a, b']` mind `deployNotes` `filter.items` `['a', 'b']`; `['--kind=summary,clean']` és `['--kind', 'summary', '--kind', 'clean']` → `filter.kinds` `['summary', 'clean']`; `['--channel', 'C', '--source', 'S', '--dry-run']` → `filter` `{ channel: 'C', source: 'S' }` és `dryRun: true`.
- `'üres --item hiba, nem teljes vault'` — `['--item=']` és `['--item', ',']` → 1, hiba `A --item értéke üres.`, `deployNotes` nem hívódik.
- `'az --item, a --kind és a --model más parancsnál hiba'` — `['list', '--item', 'a']`, `['run', '--model', 'm']` → 1, `A --item csak a deploy kapcsolója.` / `A --model csak a deploy kapcsolója.`
- `'a --model a kliensnek a megadott modellt adja, és a fejlécbe írja'` (elfogadás 8) — a `showroom('manual')` raw `pricing`-jába `'masik-modell'` a draft árával; `commandDeploy(cfg, raw, { model: 'masik-modell', createClient: (view) => { seen = view.models.draft; return hamisKliens({ generate: 0 }) } })` → `seen === 'masik-modell'`, az első naplósor `deploy: modell: masik-modell`, `deployNotes` `transform`-ja definiált. Ugyanez `model` nélkül, `model.recipes.mdx: 'masik-modell'`-lel a raw-ban → `seen === 'masik-modell'`; mindkettő nélkül `'proba-draft'`.
- `'ismeretlen --model hibával áll meg, deploy nélkül'` — `model: 'nincs-ilyen'` → 1, a hibasor `--model: pricing: nincs ára`-val kezdődik, `deployNotes` nem hívódik.
- `'a --dry-run a szárazfutás sorait írja'` — `deployNotes` mock `{ …, planned: [{ target: 'a/qa.hu.mdx', action: 'new', route: 'cards' }], unchanged: 0, … }` → a napló utolsó sora `deploy (szárazfutás): 1 oldalt írna, ebből 0 oldalhoz hívna modellt; 0 kihagyva, 0 változatlan`, az első `deploy (szárazfutás): szűrés nélkül`.
- Az `OPTIONS` táblázat: `deploy: ['--config', '--retry-failed', '--item', '--kind', '--channel', '--source', '--model', '--dry-run']`.

- [ ] **2. lépés: Futtasd, bukjanak**

Run: `pnpm vitest run src/cli.test.ts -t deploy && pnpm vitest run src/deploy/deploy.test.ts -t deployHeader`
Expected: FAIL.

- [ ] **3. lépés: Valósítsd meg** a fenti interfész szerint; utána a `help.ts` és a `docs/usage.md`.

- [ ] **4. lépés: Futtasd, menjenek át**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build && node dist/cli.js deploy --help`
Expected: PASS; a súgó felsorolja az új kapcsolókat.

- [ ] **5. lépés: Kézi próba a valódi deploy-klónon (modellhívás nélkül)**

Run: `node dist/cli.js deploy --dry-run --item <egy valódi item_id a vaultból>` — majd `git -C <showroom.clone_path> status --porcelain` és `git -C <clone_path> log -1 --format=%H` előtte-utána.
Expected: a fejléc, a tétel sorai `frissítés`/`újragenerálás` teendővel, az összesítő; a klón állapota és HEAD-je változatlan. Ismeretlen id-vel (`--item nincs-ilyen`) kilépés 1, `--item: nincs ilyen tétel a vaultban: nincs-ilyen`. Éles, pénzt költő futás ebben a tervben nincs; az a felhasználó döntése.

- [ ] **6. lépés: Commit** (`commit-message` skill)

---

## Az elfogadási feltételek lefedése

| # | feladat / teszt |
|---|---|
| 1 | 1. „tételszűrés…"; 2. `pendingCommits` + sor; 5. fejléc |
| 2 | 5. „vesszővel, ismételve…" |
| 3 | 1. „fajtaszűrés: summary mindkét nyelven, clean…" |
| 4 | 1. „csatorna- és forrásszűrés…" (a deploy nem olvassa az állapot-DB-t, így a peter-mba tételei is látszanak) |
| 5 | 1. „tételszűrés…", 3. „--item … újra a modellre" (`calls`) |
| 6 | 1. „ismeretlen tétel…", „semmire nem illeszkedő…"; 5. „ismeretlen --model…" |
| 7 | 3. „--item a változatlan LLM-es oldalt…"; 5. `model.recipes.mdx` |
| 8 | 5. „a --model a kliensnek…", „ismeretlen --model…" |
| 9 | 3. „elbukott újragenerálás nem rontja…" |
| 10 | 4. „nem ír, nem commitol…" |
| 11 | 4. „a lista és az utána futó éles deploy…" |
| 12 | 4. „előrébb járó távoli main…" |
| 13 | 2. `mdx_failed` a `skipped`-ben; 4. `retry` mindkét módban |
| 14 | 5. súgó, `OPTIONS`, kapcsolóhiba-üzenet, `docs/usage.md` |
