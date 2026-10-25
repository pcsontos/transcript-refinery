# `refinery deploy` — implementációs terv

> **Végrehajtóknak:** a terv natívan, feladatonként hajtandó végre (a felhasználó szokása: Sonneten, alügynök nélkül, lásd a memóriát). A lépések jelölőnégyzetesek (`- [ ]`).

**Cél:** új `refinery deploy` parancs és `auto` bekötés, ami a vault jegyzeteit a showroom szerződése szerinti `.mdx`-ként egy külön showroom-klónba írja, tételenként commitolja és a `main`-re pusholja.

**Architektúra:** három új, egy felelősségű fájl a `src/deploy/` alatt: `variant.ts` (tiszta függvény: vault-jegyzet → nyelvi változat vagy kihagyási ok), `mdx.ts` (escape, frontmatter-szabály, `compile` + komponens-ellenőrzés), `deploy.ts` (a menet: ág, pull, összevetés, írás, commit, push). A configba `showroom:` blokk kerül; a CLI `commandRun` és a serve `runRecipes` hívja `auto` módban. Az LLM-es átalakító csak egy opcionális `transform` paraméter; ebben a körben senki nem adja át, csak a teszt.

**Technológia:** TypeScript, Node, vitest, `yaml` (megvan), `@mdx-js/mdx` **3.1.1** (új, a site-tal azonos verzió), valódi git ideiglenes repókban (a `src/vault/git.test.ts` mintájára).

**Spec:** `docs/plans/2026-10-24-refinery-deploy-spec.md`

## Globális megkötések

- Config: `showroom.deploy: auto | manual` (alapértelmezés `manual`), `showroom.clone_path` abszolút út; `showroom:` blokk nélkül a deploy ki van kapcsolva.
- Célút: `content/notes/<itemId>/<site-fajta>.<nyelv>.mdx`, plusz `content/notes/<itemId>/meta.json` = `{ "title": "<cím>" }`.
- Nyelv csak `hu` vagy `en`; a `-orig` végződés levágódik (`language` és `source_language`).
- Frontmatter: a vault mezői átnevezés nélkül + `kind`; determinisztikus úton `mdx_fallback: true`.
- A site kötelező mezői: `item_id`, `title`, `kind`, `language`, `generated_at`, `source`, `origin`; a `translation_of`, `source_language`, `source_generated_at` csak együtt; `translation_of === kind`.
- Escape kódon kívül: `{` → `\{`, `}` → `\}`, `<` → `\<`. Kódkerítés (```` ``` ````, `~~~`) és soron belüli kód érintetlen.
- A deploy nem töröl; csak a saját útjait commitolja (`gitCommitPaths`); nem `main`-en álló klónnál megáll írás nélkül.
- Commitüzenet: `noteCommitMessage('deploy', <cím>, <itemId>)`; tételenként egy commit, a végén egy push.
- Az `auto` hiba nem buktatja a futást (CLI: kiírt sor; serve: napló, a `ready` megy).
- Kommentek, hibaüzenetek, tesztnevek magyarul, a meglévő kód stílusában.

## Eltérés a jegytől (jóváhagyva 2026-10-25, a specben rögzítve)

- **A watch nem kap `auto` bekötést.** A `watchRound` csak átiratot ír (`processItem`, modellt nem hív, `src/watch/round.ts` fejkommentje), az átirat pedig a spec szerint nem megy ki. A bekötés soha nem találna mit deployolni. Ha a watch egyszer recepteket is futtat, akkor kell.

## Review-fókusz

1. **Félbeszakadt futás**: a fájl kiíródott, a commit nem. A következő futás a munkafa fájlját változatlannak látná, és sosem commitolná. → A 4. feladat elején a deploy a `content/notes` maradékát egy „maradék” commitba veszi (teszt: `félbemaradt írás a következő futásban commitba kerül`).
2. **Behúzott kódblokk** (4 szóköz): az MDX ezt nem kódnak, hanem szövegnek veszi, ezért ott is escape kell. → 3. feladat, teszt: `behúzott kódban is escape-el`.
3. **HTML-komment és nyers HTML** a vaultban (`<!-- -->`, `<br>`): escape-elve szövegként fordul le. → 3. feladat, teszt: `HTML-komment és <br> lefordul`.
4. **YAML-különleges cím** (idézőjel, kettőspont, `#`): a frontmatter nem törhet el. → 3. feladat, teszt: `kettőspontos, idézőjeles cím a site-szabálynak megfelel`.
5. **Elutasított push** (a távoli ág előrébb jár): a commit helyben marad, a jelentés megnevezi, a következő futás pull után pusholja. → 4. feladat, teszt: `elutasított push után a következő futás pusholja`.

---

### 1. feladat: `showroom:` config-blokk

**Fájlok:**
- Módosítás: `src/config.ts` (`CoreSchema`, `Config`, `loadConfig`, `validateConfig`)
- Módosítás: `refinery.config.example.yaml` (kommentált `showroom:` blokk a `translate:` mintájára, a külön klónról szóló mondattal)
- Teszt: `src/config.test.ts`

**Interfészek:**
- Ad: `export interface ShowroomConfig { deploy: 'auto' | 'manual'; clonePath: string }`, és `Config.showroom: ShowroomConfig | null`.

- [x] **1. lépés: bukó tesztek**
  - `showroom: blokk nélkül a showroom null`: `loadConfig(alap)` → `cfg.showroom === null`.
  - `a deploy alapértéke manual`: `{ showroom: { clone_path: '/x' } }` → `{ deploy: 'manual', clonePath: '/x' }`.
  - `relatív clone_path hibát ad`: `clone_path: 'x'` → dob, az üzenet tartalmazza: `showroom.clone_path`.
  - `ismeretlen deploy-érték hibát ad`: `deploy: 'mindig'` → dob.
  - `validateConfig: nem létező klón`: dob, üzenet: `showroom.clone_path: nem létező mappa`; `nem git-repó` ugyanígy (`.git` nélküli ideiglenes mappa).
- [x] **2. lépés:** `pnpm vitest run src/config.test.ts` → a fenti esetek FAIL.
- [x] **3. lépés: megvalósítás.** `showroom: z.object({ deploy: z.enum(['auto','manual']).default('manual'), clone_path: absolutePath('showroom.clone_path') }).optional()`; a `validateConfig` a `vault.path`-ellenőrzés két sorát ismétli a `clonePath`-ra, ha nem `null`.
- [x] **4. lépés:** `pnpm vitest run src/config.test.ts && pnpm typecheck` → PASS.
- [x] **5. lépés: commit** (`feat(config): Add the showroom block`).

### 2. feladat: vault-jegyzet → nyelvi változat

**Fájlok:**
- Létrehozás: `src/deploy/variant.ts`
- Teszt: `src/deploy/variant.test.ts`

**Interfészek:**
- Használja: `originOf(fields)` (`src/serve/notes.ts:81`).
- Ad:
  ```ts
  export type SiteLanguage = 'hu' | 'en'
  export interface VaultNote { vaultKind: string; fields: Record<string, unknown> }
  export type Variant =
    | { ok: true; siteKind: string; language: SiteLanguage; target: string; fields: Record<string, unknown> }
    | { ok: false; reason: string }
  /** `siblings`: a tétel többi jegyzetének mezői vault-fajta szerint. `committedAt`: csak szójegyzéknél, a vault-commit ideje. */
  export function variantOf(itemId: string, note: VaultNote, siblings: ReadonlyMap<string, Record<string, unknown>>, committedAt: string | null): Variant
  ```
  A `target` a `content/notes`-hoz képest: `<itemId>/<siteKind>.<language>.mdx`. A `fields` a kiírandó frontmatter, `mdx_fallback` nélkül (azt a 4. feladat teszi hozzá).

A szabályok sorrendben (a hibaszövegek pontosan ezek, a napló ezeket mutatja):
1. `lang = String(fields.language ?? '').replace(/-orig$/, '')`. Ha nem `hu`/`en`: `{ ok: false, reason: 'nyelv: <eredeti érték vagy „ismeretlen”>' }`.
2. **Szójegyzék** (`/^glossary-/.test(vaultKind)`): `siteKind = 'glossary'`; `committedAt === null` → `'a szójegyzék még nincs commitolva'`; a `source`/`origin` az első olyan testvérből, amelyben van `source`, ha nincs ilyen → `'a tételnek nincs forrás-adata'`; a `source_language` **kimarad** (a site `frontmatterError`-ja a magányos mezőre buktat); `generated_at = committedAt`.
3. **Fordítás** (van `translation_of`): a `vaultKind`-nak `-<lang>`-re kell végződnie, különben `'a fordítás fájlneve nem <fajta>-<nyelv> alakú'`; `siteKind` a végződés nélkül; `source_language` (`-orig` nélkül) hiányzik → `'fordítás: hiányzik a source_language'`; `source_generated_at` hiányzik → a `siblings.get(siteKind)?.generated_at`, ha az sincs → `'fordítás: hiányzik a source_generated_at, és az eredeti nincs a vaultban'`; `translation_of = siteKind`.
4. **Eredeti**: `siteKind = vaultKind`.
5. `generated_at` hiányzik → `'nincs generated_at'`. `origin = originOf(fields)`, `language = lang`, `kind = siteKind`.

- [x] **1. lépés: bukó tesztek**
  - `hu-orig eredeti hu változat lesz`: `{ language: 'hu-orig', … }`, `summary` → `target: 'X/summary.hu.mdx'`, `fields.language: 'hu'`, `fields.kind: 'summary'`.
  - `de eredeti kimarad`: `reason: 'nyelv: de'`; `language` nélkül `'nyelv: ismeretlen'`.
  - `origin nélküli régi jegyzet pótolt origint kap`: `source: 'telegram'` → `origin: 'telegram'`; más forrás → `'cli'`.
  - `URL nélküli tétel url nélkül marad`: `'url' in fields === false`.
  - `clean-moderate-hu fordítás`: `translation_of: 'clean'`, `language: 'hu'`, `source_language: 'en-orig'` → `target: 'X/clean-moderate.hu.mdx'`, `kind` és `translation_of`: `'clean-moderate'`, `source_language: 'en'`.
  - `hiányzó source_generated_at pótlódik az eredetiből`: testvér `clean-moderate` `generated_at: 'T1'` → `source_generated_at: 'T1'`; testvér nélkül a pontos kihagyási ok.
  - `hiányzó source_language kihagyás`.
  - `szójegyzék glossary.hu lesz`: `kind: 'glossary-hu'`, `committedAt: 'T2'`, testvér `{ source: 's', origin: 'cli' }` → `target: 'X/glossary.hu.mdx'`, `generated_at: 'T2'`, `'source_language' in fields === false`; `committedAt: null` → kihagyás.
- [x] **2. lépés:** `pnpm vitest run src/deploy/variant.test.ts` → FAIL (nincs modul).
- [x] **3. lépés:** `variantOf` megvalósítása a fenti szabályokkal.
- [x] **4. lépés:** a teszt PASS, `pnpm typecheck` PASS.
- [x] **5. lépés: commit** (`feat(deploy): Map vault notes to site variants`).

### 3. feladat: MDX — escape, frontmatter-szabály, ellenőrzés

**Fájlok:**
- Létrehozás: `src/deploy/mdx.ts`
- Módosítás: `package.json` (`"@mdx-js/mdx": "3.1.1"` a `dependencies`-be, pontos verzióval), `pnpm install`
- Teszt: `src/deploy/mdx.test.ts`

**Interfészek:**
- Ad:
  ```ts
  export interface Contract { components: Record<string, { attributes: Record<string, { type: 'string' | 'enum'; values?: string[]; required: boolean }> }> }
  export function escapeMdx(body: string): string
  export function renderMdx(fields: Record<string, unknown>, body: string): string
  /** A site `lib/note-frontmatter.ts` szabályai + a kötelező mezők; `target` a content/notes-hoz képest. */
  export function frontmatterError(target: string, fields: Record<string, unknown>): string | null
  /** `compile` + komponens-ellenőrzés; üres lista = rendben. */
  export async function mdxErrors(source: string, contract: Contract): Promise<string[]>
  ```

Megvalósítási döntések:
- `escapeMdx`: soronként halad, követi a kerítést (a nyitó jel ```` ``` ```` vagy `~~~`, legalább 3, a záró ugyanaz a jel legalább annyi hosszal). Kódon kívül a soron belüli kódot (egyező hosszú backtick-sorozatok közötti rész) kihagyja, a többiben a `{`, `}`, `<` elé `\` kerül. A behúzott kód **nem** kód (MDX-ben nincs).
- `renderMdx`: `` `---\n${stringify(fields)}---\n\n${body}` `` a `yaml` csomag `stringify`-jával.
- `frontmatterError`: a showroom `lib/note-frontmatter.ts` `frontmatterError`-jának átirata (út-minta, nyelv, `item_id`/`kind`/`language` egyezés, fordítás-hármas, `translation_of === kind`), előtte a hét kötelező mező nem üres szövegként való jelenléte: `` `${target}: hiányzik: ${mező}` ``.
- `mdxErrors`: `compile(source, { remarkPlugins: [gyűjtő] })` a `@mdx-js/mdx`-ből. A gyűjtő remark-plugin rekurzívan bejárja a fát (`unist-util-visit` nélkül, pár soros saját bejárás). Minden `mdxJsxFlowElement`/`mdxJsxTextElement` csomópontnál hibát ad, ha: a neve `null` (fragment) vagy nincs a `contract.components`-ben (a kisbetűs HTML-elem így kiesik); egy attribútum `mdxJsxExpressionAttribute` (spread), értéke nem string (kifejezés vagy érték nélküli), a neve nincs a listán, vagy enum-értéke nincs a `values`-ban; egy `required` attribútum hiányzik. Szintén hiba minden `mdxFlowExpression`/`mdxTextExpression` és `mdxjsEsm` csomópont (`{…}`, `import`/`export`). A `compile` dobása egy hibasor (az első sora).

- [x] **1. lépés: bukó tesztek**
  - `kódon kívül escape-el, kódban nem`: ``'a < b {x} `if (n < 1) {}`'`` → ``'a \\< b \\{x\\} `if (n < 1) {}`'``; kerítésen belüli sorok változatlanok, `~~~` kerítéssel is.
  - `behúzott kódban is escape-el`: `'    a < b'` → `'    a \\< b'`.
  - `HTML-komment és <br> lefordul`: `mdxErrors(renderMdx(f, escapeMdx('<!-- x -->\n\nsor<br>')), c)` → `[]`.
  - `tipikus vault-jegyzet lefordul`: címsor, lista, táblázat, link, kódkerítés, Mermaid-kerítés → `[]`.
  - `ismeretlen komponens hibát ad`: `<Foo />`, `<div>x</div>`, `<>x</>` → mindegyik nem üres lista.
  - `tiltott attribútumérték hibát ad`: `<Callout type="danger">x</Callout>` → nem üres; `type="note"` → `[]`; `<Card />` (`title` hiányzik) → nem üres; `<Tab title={x}>` → nem üres.
  - `le nem forduló MDX hibát ad`: `'<Callout>'` (zárás nélkül) → nem üres.
  - `frontmatterError`: a site szabályainak esetei (rossz suffix, `kind`-eltérés, csonka fordítás-hármas, `translation_of ≠ kind`) és `hiányzik: title`; jó eredeti és jó fordítás → `null`.
  - `kettőspontos, idézőjeles cím a site-szabálynak megfelel`: `title: 'A: "b" #c'` → a `renderMdx` kimenetét a `frontmatter()` (`src/serve/notes.ts:97`) visszaolvasva ugyanazt a címet adja.
- [x] **2. lépés:** `pnpm vitest run src/deploy/mdx.test.ts` → FAIL.
- [x] **3. lépés:** függőség hozzáadása, a négy függvény megvalósítása. A `Contract` a teszthez a showroom `contract/mdx-components.json` mai tartalmának másolata a tesztfájlban.
- [x] **4. lépés:** a teszt PASS, `pnpm typecheck && pnpm lint` PASS.
- [x] **5. lépés: commit** (`feat(deploy): Escape and check MDX against the contract`).

### 4. feladat: a deploy menete

**Fájlok:**
- Létrehozás: `src/deploy/deploy.ts`
- Módosítás: `src/vault/git.ts` (két kis függvény)
- Teszt: `src/deploy/deploy.test.ts`, `src/vault/git.test.ts`

**Interfészek:**
- Használja: `scanNotes` (`src/serve/notes.ts:207`), `frontmatter`, `FRONTMATTER` (`src/vault/lint.js`), `variantOf`, `escapeMdx`, `renderMdx`, `frontmatterError`, `mdxErrors`, `gitPullFfOnly`, `gitCommitPaths`, `gitPush`, `noteCommitMessage`.
- Ad (`git.ts`): `gitCurrentBranch(repo): Promise<string>` (`git rev-parse --abbrev-ref HEAD`), `gitLastCommitIso(repo, path): Promise<string | null>` (`git log -1 --format=%cI -- <út>`, üres kimenet → `null`).
- Ad (`deploy.ts`):
  ```ts
  /** Az LLM-es átalakító (#278): a vault-törzsből `.mdx`-törzs. A frontmattert nem írja. */
  export type Transform = (input: { fields: Record<string, unknown>; body: string; language: SiteLanguage; contract: Contract }) => Promise<string>
  export interface DeployReport { written: string[]; skipped: { path: string; reason: string }[]; commits: number; push: PushResult | null }
  export async function deployNotes(input: { cfg: Config; itemIds?: ReadonlySet<string>; transform?: Transform }): Promise<DeployReport>
  /** A jelentés terminálsorai (CLI és serve-napló közös): összesítő, kihagyások, commit/push. */
  export function deployLines(report: DeployReport): string[]
  ```

A menet (`cfg.showroom` nem `null`, a hívó gondoskodik róla; ha `null`, dob):
1. `gitCurrentBranch(clone) !== 'main'` → `throw new Error(`showroom.clone_path: a klón nem a main ágon áll (${ág})`)`.
2. Maradék: `gitCommitPaths(clone, ['content/notes'], noteCommitMessage('deploy', 'félbemaradt futás maradéka', '-'))`; a pontos üzenet a végrehajtóé, a lényeg, hogy a munkafa `content/notes`-a tiszta legyen az összevetés előtt.
3. `gitPullFfOnly(clone)`; a hibája továbbdobódik.
4. `contract = JSON.parse(readFile(clone/contract/mdx-components.json))`, a pull **után**.
5. `scanNotes(cfg.notesRoot)`, `itemIds`-szel szűrve. Tételenként minden fájl teljes olvasása (`frontmatter()` + törzs a `FRONTMATTER` utáni rész); a `transcript` fajta kimarad, napló nélkül. Szójegyzéknél `gitLastCommitIso(cfg.vaultPath, út)`. `variantOf` → kihagyás a `skipped`-be (`path`: a vault-fájl útja). Ütközésnél (két változat ugyanarra a `target`-re) az eredeti nyer, a másik kihagyási oka `ütközik: <target>`.
6. Változás: a célfájl frontmattere hiányzik, **vagy** `generated_at`-je (szövegként) más, **vagy** `mdx_fallback === true` és van `transform`.
7. Előállítás: ha van `transform`, `renderMdx(fields, await transform(...))`, és `frontmatterError` + `mdxErrors`; hiba vagy dobás esetén a kihagyás-napló okkal (`LLM-kimenet elvetve: <első hiba>`), és jön a visszaesés. Visszaesés: `renderMdx({ ...fields, mdx_fallback: true }, escapeMdx(body))`, ugyanazzal az ellenőrzéssel; ha ez is bukik → kihagyás az első hibával.
8. Írás (`mkdir -p`), `meta.json`, ha hiányzik vagy más a cím. Tételenként `gitCommitPaths(clone, <a tétel írt útjai>, noteCommitMessage('deploy', cím, itemId))`.
9. Ha volt commit: `push = await gitPush(clone)`, különben `null`.

- [x] **1. lépés: bukó tesztek.** Előkészítés: ideiglenes csupasz távoli repó (`git init --bare`), belőle klón `main`-en egy `contract/mdx-components.json`-nal (pusholva); ideiglenes vault git-repó, `vault.notes_dir` alatt jegyzetekkel; `cfg` a `loadConfig`-gal. Esetek:
  - `első futás kiírja és pusholja`: magyar `summary` + `summary-en` fordítás → a távoli `main`-en `content/notes/X/summary.hu.mdx`, `summary.en.mdx` (fordításé `kind: summary`), `meta.json`; `report.commits === 1`, `push.pushed === true`; az átirat-fájlból nincs `.mdx`.
  - `második futás változatlan vaultnál nem ír és nem commitol`: `written: []`, `commits: 0`, `push: null`, és a hamis `transform` hívásszáma 0.
  - `újragenerált jegyzet frissül`: más `generated_at` → `written` tartalmazza.
  - `mdx_fallback jegyzetet transformmal újra átalakít, nélküle nem`.
  - `le nem forduló transform-kimenet helyett a determinisztikus megy`: `transform` → `'<Callout>'` → a fájlban `mdx_fallback: true`; a `skipped`-ben `LLM-kimenet elvetve`.
  - `listán kívüli komponens helyett a determinisztikus megy`: `<Foo />`, illetve `<Callout type="danger">` → ugyanígy.
  - `jó transform-kimenet megy, jelző nélkül`: `<Callout type="note">x</Callout>` → a fájlban nincs `mdx_fallback`.
  - `a komponenslista a pull után olvasódik`: a távoliba pusholt bővített lista (`Foo` hozzáadva) után a `<Foo />` kimenet elfogadott.
  - `de fordítás nem kerül a commitba, a napló megnevezi`: `skipped` → `{ reason: 'nyelv: de' }`, és a `deployLines` kimenetében a fájl neve.
  - `URL nélküli tétel url nélkül kimegy`.
  - `szójegyzék glossary.hu-ként megy, a vault-commit idejével`; a bővített és újracommitolt szójegyzék a következő futásban frissül.
  - `nem main-en álló klónnál megáll`: `git checkout -b masik` → dob, a távoli `main` változatlan.
  - `itemIds szűr`: két tétel, `itemIds = {A}` → csak `A` mappája íródik.
  - `félbemaradt írás a következő futásban commitba kerül`: a klónba kézzel írt `content/notes/X/summary.hu.mdx` (commit nélkül) a futás után a távolin van.
  - `elutasított push után a következő futás pusholja`: a távoliba egy másik klónból közben pusholt commit; az első futás `push.pushed === false` vagy a pull hibát dob (a végrehajtó a valódi viselkedést rögzíti); a második futás után a távolin ott a jegyzet.
  - `git.test.ts`: `gitCurrentBranch` → `'main'`; `gitLastCommitIso` commitolt fájlra ISO-időt, commitolatlanra `null`-t ad.
- [x] **2. lépés:** `pnpm vitest run src/deploy/deploy.test.ts src/vault/git.test.ts` → FAIL.
- [x] **3. lépés:** megvalósítás a fenti menet szerint.
- [x] **4. lépés:** a tesztek PASS, `pnpm typecheck && pnpm lint` PASS.
- [x] **5. lépés: commit** (`feat(deploy): Deploy vault notes to the showroom clone`).

### 5. feladat: `refinery deploy` parancs és `auto` a `run`-ban

**Fájlok:**
- Módosítás: `src/cli.ts` (`main`: új ág; `commandDeploy`; `commandRun` `runFinish`-e)
- Módosítás: `src/help.ts` (új `deploy` bejegyzés a többi mintájára)
- Teszt: `src/cli.test.ts`

**Interfészek:**
- Használja: `deployNotes`, `deployLines`.
- Ad: `export async function commandDeploy(cfg: Config): Promise<number>`.

- [x] **1. lépés: bukó tesztek** (a `cli.test.ts` meglévő mintáival; a `deployNotes`-t a meglévő tesztek módján kell helyettesíteni, vagy a 4. feladat ideiglenes repóival):
  - `deploy showroom blokk nélkül hibával áll meg`: kilépőkód 1, üzenet: `A deploy ki van kapcsolva: nincs showroom: blokk a configban.`
  - `deploy kiírja a jelentést`: kilépőkód 0, a kimenetben a `deployLines` sorai.
  - `run auto módban a futás tételeit deployolja`: `deploy: auto` → a `deployNotes` a futás kiválasztott egységeinek `itemId`-halmazával hívódik (`selected.map(u => u.item.itemId)`), a vault-push után.
  - `run manual módban nem deployol`, és `showroom: blokk nélkül nem deployol`.
  - `run --no-commit és --dry-run nem deployol`.
  - `run auto: a deploy hibája nem buktatja a futást`: a `deployNotes` dob → a kilépőkód ugyanaz, mint deploy nélkül, a kimenetben `deploy sikertelen: <első sor>`.
- [x] **2. lépés:** `pnpm vitest run src/cli.test.ts` → FAIL.
- [x] **3. lépés:** megvalósítás. `main`: `if (command === 'deploy') return commandDeploy(cfg)` a `loadCliConfig`/`validateConfig` után; az ismeretlen kapcsolót a `check-structured` mintájára (`--config` az egyetlen) utasítja el. `runFinish`: a vault-commit/push blokk után, ha `commit && cfg.showroom?.deploy === 'auto'`, `try { for (const line of deployLines(await deployNotes({ cfg, itemIds }))) console.log(line) } catch (e) { console.log(`deploy sikertelen: ${első sor}`) }`.
- [x] **4. lépés:** PASS, `pnpm typecheck && pnpm lint` PASS.
- [x] **5. lépés: commit** (`feat(cli): Add the deploy command and auto deploy after run`).

### 6. feladat: `auto` a serve-ben, a `ready` előtt

**Fájlok:**
- Módosítás: `src/serve/summary.ts` (`runRecipes`: új opcionális `deploy` bemenet a `git` mintájára; hívás a sikeres vault-push után)
- Teszt: `src/serve/summary.test.ts`

**Interfészek:**
- `runRecipes` input bővül: `deploy?: typeof deployNotes`.

- [x] **1. lépés: bukó tesztek** (a meglévő `summary.test.ts` hamis `git`-jével és `load`-jával):
  - `auto módban a push után a videó tételét deployolja`: a hamis `deploy` `itemIds = {videoId}`-vel hívódik, a `git.push` után, és a `runRecipes` csak utána tér vissza (`ok: true`) — vagyis a `ready` előtt.
  - `manual módban nem deployol`.
  - `sikertelen push után nem deployol`.
  - `a deploy hibája mellett ok: true`: a hamis `deploy` dob → `{ ok: true, noteUrl }`, és `console.warn` a `[deploy]` előtaggal.
- [x] **2. lépés:** `pnpm vitest run src/serve/summary.test.ts` → FAIL.
- [x] **3. lépés:** megvalósítás; a jelentés sorai `console.log('[deploy] …')`-ként, a `deployLines`-szal.
- [x] **4. lépés:** PASS, a teljes `pnpm test && pnpm typecheck && pnpm lint` PASS.
- [x] **5. lépés: commit** (`feat(serve): Deploy to the showroom before reporting ready`).

### 7. feladat: dokumentáció

**Fájlok:**
- Módosítás: `docs/usage.md` (a `refinery deploy` szakasza: mit visz ki, mit hagy ki, `auto`/`manual`, a külön klón létrehozása egy `git clone` sorral, a `mdx_fallback` jelentése)
- Módosítás: `README.md` (parancslista egy sora), `docs/architecture.md` (egy bekezdés a `src/deploy/`-ról, ha a fájl modulonként leírja a felépítést)

- [x] **1. lépés:** a szövegek megírása; a `refinery help deploy` kimenete és a `docs/usage.md` ugyanazt mondja.
- [x] **2. lépés:** `pnpm test && pnpm typecheck && pnpm lint` PASS.
- [x] **3. lépés: commit** (`docs: Document refinery deploy`).

### 8. feladat: élő próba és PR

- [ ] **1. lépés:** a felhasználó létrehozza a külön klónt (`git clone git@github.com:pcsontos/refinery-showroom.git ~/github/pcsontos/refinery-showroom-deploy`), és beírja a `showroom:` blokkot (`deploy: manual`) a helyi `refinery.config.yaml`-ba.
- [ ] **2. lépés:** `pnpm build && node dist/cli.js deploy`. Elvárt: a kihagyások listája (ok szerint) és egy push ok sor; a showroom `main`-jén új commitok; a Workers Build zöld; a site-on adminként látszanak a jegyzetek; a showroom CI-ja zöld.
- [ ] **3. lépés:** második `pnpm build && node dist/cli.js deploy` → `0 commit`, push nélkül.
- [ ] **4. lépés:** PR a kód-ágról (`Refs #277`, a #278 és a #322 megemlítve); a CI-t `gh pr checks`-szel kell ellenőrizni merge előtt.
