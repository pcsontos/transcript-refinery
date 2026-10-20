# Vault és állapottár rendezése — megvalósítási terv

> **Az ügynöknek:** KÖTELEZŐ al-skill: `superpowers:executing-plans`. A lépések jelölőnégyzetesek (`- [ ]`).

**Cél:** az állapottár a vault-jegyzetek útját a vaulthoz relatívan tárolja (#275); a vaulton belül átmozgatott jegyzetet a `run` és a `watch` követi, a `scan` jelenti (#276); az új elemek jegyzetei a `vault.layout` sablon szerinti, elemenként egy mappába kerülnek, a Telegram-tételek a `telegram/` alá (#273).

**Felépítés:**
- A #275 **az állapottár határán** dől el: íráskor a `vault.path` alatti út relatívvá válik, olvasáskor a relatív út abszolúttá. A hívók (fordítás, webes elemoldal, queue-link, commit) ugyanúgy abszolút utat kapnak, mint ma, ezért nem változnak.
- A #276 egy új modul (`src/vault/relink.ts`): a vault bejárása, egy tiszta összevető függvény és egy vékony alkalmazó. A frontmatter-olvasást a `src/serve/notes.ts` meglévő `readHead`/`frontmatter` párosa adja.
- A #273 a `noteFile` új aláírása: a sablon a configból jön, és ha az elemnek már van kimenete, annak a mappája nyer (rögzítés). A forrásnév `telegram` a `SERVE_OUT` mappa átnevezéséből jön, kód nélkül.

**Technológia:** TypeScript, `node:sqlite` (`PRAGMA user_version`, `VACUUM INTO`), `node:fs/promises` (`readdir` `recursive`), vitest, zod.

**Spec:** `docs/plans/2026-10-20-vault-rendezes-spec.md`

**Ág:** `feat/vault-rendezes` a `main`-ről. Egy kód-PR, egy kiadás (v1.20.0).

## Eltérések a spectől (a tervezés közben dőltek el)

| Spec | Terv | Miért |
|---|---|---|
| Kulcs: `translation_of` esetén `<recipe>-<language>` | Kulcs: `recipe ?? 'transcript'` | A fordítás frontmatterében a `recipe` már a teljes fajta (`recipe: notes-hu`, ellenőrizve a vaultban). |
| Forrásonkénti `name:` mező, a hash a lemezmappa nevéből | Nincs `name:`. A `SERVE_OUT` `tmp/serve-out` → `tmp/telegram`. | A Telegram-tételek azonosítója a videóazonosító vagy a tartalom hash-e (`textItemId`), a mappanév nem számít bele. Felhasználói döntés. |
| Globális sablon + forrásonkénti felülírás | Csak globális `vault.layout` | A hiányzó mező szegmense kimarad, így ma minden forrás értelmes helyre kerül. Felhasználói döntés. |
| Mozgató szkript az állapottár `done` soraiból | A vault frontmatteréből | A lokális állapottárban 114 út van, a vaultban 198 jegyzet. A frontmatterben ott az `item_id`, `channel`, `video_id`, `title`, `uploaded`, `source`. |
| A `serve` követése nyitott kérdés | Megoldott | A `serve` a `commandRun`-t hívja (`src/serve/summary.ts:149`), tehát a `run` követése rá is vonatkozik. |
| A `scanNotes` csoportosítása nyitott kérdés | Nem kell hozzányúlni | Mappán és alapnéven belül csoportosít; az elemmappában az átirat és a receptek ugyanúgy egymás mellett vannak. |

## Globális megkötések

- Új függőség nincs. Új fájl csak: `src/vault/relink.ts`, `src/vault/relink.test.ts`, `scripts/move-notes.ts`.
- Az utak POSIX-osak (macOS, Linux-konténer); `sep`-cserére nincs szükség.
- Magyar kommentek és üzenetek, a környező kód sűrűségével. Tudatos korlátnál `ponytail:` komment.
- Ellenőrzés minden feladat végén: `pnpm typecheck && pnpm lint && pnpm test`, mind zöld.
- Commit minden feladat végén a `commit-message` skill-lel.

## Amire a review figyeljen

1. **A határon kívüli út:** a `vault.path` alá nem eső abszolút út íráskor és migrációkor is abszolút marad, olvasáskor változatlanul jön vissza. Az 1. feladat tesztje rögzíti.
2. **Előtag-illesztés:** a `/vault` nem lehet a `/vault-masik/x.md` előtagja. A vizsgálat `vaultPath + '/'`-rel megy, és a migráció SQL-je `substr`-rel, nem `LIKE`-kal (a `_` és a `%` a `LIKE`-ban helyettesítő karakter). Az 1. feladat tesztje rögzíti.
3. **A `.bak` a WAL mellett:** egyszerű fájlmásolás a `-wal` fájlban ülő adatot elveszítené, ezért `VACUUM INTO` készíti.
4. **A pontos mappák:** a bejárás minden ponttal kezdődő szegmenst kihagy (`.git`, `.obsidian`, `.trash`). Enélkül az Obsidian lomtárába tett jegyzet „elmozdultnak” számítana. A 2. feladat tesztje rögzíti.
5. **Rögzítés és fordítás:** a fordítás a forrásjegyzet mappájába kerül, mert a forrásjegyzet kimenete már rögzítette az elem mappáját.

---

### 1. feladat: Relatív utak az állapottár határán és a migráció (#275)

**Fájlok:**
- Módosul: `src/state/db.ts` (`openState`, `recordArtifact`, `listPendingCommits`, `listPendingNotes`, `clearPendingCommits`, `artifactOf`), `src/state/queries.ts` (két új segéd), `src/state/reader.ts` (`openStateReader`)
- Módosul (hívók): `src/cli.ts:538`, `src/queue/refresh.ts:91`, `src/watch/round.ts:53` → `openState(cfg.statePath, cfg.vaultPath)`; `src/view/items.ts:116`, `:192` → `openStateReader(cfg.statePath, cfg.vaultPath)` (a `Pick`-be bekerül a `vaultPath`)
- Teszt: `src/state/db.test.ts`, `src/state/reader.test.ts`

**Interfészek:**
```ts
// queries.ts
/** A tárolt út: a `vaultPath` alatti relatív, minden más változatlan. */
export function toStored(vaultPath: string | undefined, path: string): string
//   vaultPath && path.startsWith(vaultPath + '/') ? path.slice(vaultPath.length + 1) : path
/** A tárolt út abszolútként. */
export function fromStored(vaultPath: string | undefined, path: string): string
//   vaultPath === undefined || isAbsolute(path) ? path : join(vaultPath, path)

// db.ts
export function openState(path: string, vaultPath?: string): StateStore
// reader.ts
export function openStateReader(path: string, vaultPath?: string): StateReader | null
```
A `vaultPath` elhagyható: így a meglévő tesztek és a `web/test/e2e/fixture.ts` változatlanul fut, és a viselkedés pontosan a mai.

**Viselkedés:**
- Írás: a `recordArtifact` a `path`-ot és a `pending_commits` utat `toStored`-dal teszi le. A `clearPendingCommits` a kapott (abszolút) utakat `toStored`-dal alakítja vissza a `DELETE` előtt.
- Olvasás: az `artifactOf`, a `listPendingCommits`, a `listPendingNotes` és a reader `artifacts()` minden nem `null` útja `fromStored`-on megy át.
- Migráció az `openState`-ben, a `SCHEMA` után, csak ha van `vaultPath` és `PRAGMA user_version` < 1:
  1. Megszámolja a `vaultPath + '/'` előtagú sorokat mindkét táblában (`substr(path, 1, length(?)) = ?`).
  2. Ha van ilyen: `<path>.bak` törlése, ha létezik (`rmSync(…, { force: true })`), majd `VACUUM INTO '<path>.bak'`.
  3. Egy tranzakcióban: `UPDATE artifacts SET path = substr(path, length(?) + 1) WHERE substr(path, 1, length(?)) = ?`, ugyanez a `pending_commits`-re; `PRAGMA user_version = 1`.
  4. Ha marad `/`-rel kezdődő út, egy `console.error` sor: darabszám és az első három út.
- `PRAGMA user_version = 1` akkor is beáll, ha nem volt mit átírni (friss tár), így a `.bak` csak valódi migrációnál készül.

- [x] **1. lépés: a bukó tesztek** (`db.test.ts`, ideiglenes mappában)
  - Vaulttal nyitott tár, `recordArtifact(…, '/v/Inbox/a.md', …, pendingCommit: true)`: a nyers SQLite-sorban `Inbox/a.md` áll (külön `DatabaseSync`-kel olvasva), az `artifactOf` és a `listPendingCommits` `/v/Inbox/a.md`-t ad; `clearPendingCommits(['/v/Inbox/a.md'])` után a lista üres.
  - `'/v-masik/a.md'` a `/v` vaulttal abszolút marad a nyers sorban is.
  - Migráció: vault nélkül nyitott tárba két sor (`/v/Inbox/a.md`, `/regi/b.md`), bezárás, újranyitás `/v`-vel → a nyers sorok `Inbox/a.md` és `/regi/b.md`; megvan a `.bak`, benne az eredeti abszolút sor; a `user_version` 1.
  - Második megnyitás: a `.bak` módosítási ideje nem változik.
  - Friss tár vaulttal: nincs `.bak`, a `user_version` 1.
  - Vault nélküli nyitás: a `user_version` 0 marad.
  - `reader.test.ts`: relatív sor a `openStateReader(path, '/v')` `artifacts()`-ában abszolút.
- [x] **2. lépés:** `pnpm vitest run src/state` → FAIL.
- [x] **3. lépés:** a fenti viselkedés megírása, a hívók átállítása.
- [x] **4. lépés:** teszt → PASS; teljes ellenőrzés zöld.
- [x] **5. lépés:** commit (`feat(state): Store vault note paths relative to the vault`).

### 2. feladat: A vault bejárása és az összevetés (#276)

**Fájlok:**
- Új: `src/vault/relink.ts`, `src/vault/relink.test.ts`
- Módosul: `src/serve/notes.ts` (a `readHead` és a `frontmatter` `export`-ot kap, más nem változik)

**Interfészek:**
```ts
/** Egy jegyzet a vaultban, a frontmatteréből. */
export interface FoundNote { path: string; fields: Record<string, unknown> }
/** A vault minden `.md` fájlja `item_id`-s frontmatterrel. Ponttal kezdődő szegmens kimarad. */
export async function findNotes(vaultPath: string): Promise<FoundNote[]>
/** `(item_id, kind)` kulcs; a `recipe` hiánya átiratot jelent. `null`, ha nincs `item_id`. */
export function noteKey(fields: Record<string, unknown>): string | null   // `${itemId}\u0000${kind}`

export interface Tracked { itemId: string; kind: string; path: string }
export interface RelinkReport {
  moved: (Tracked & { to: string })[]
  missing: Tracked[]
  conflicts: (Tracked & { candidates: string[] })[]
}
/** Tiszta: a tárolt utak, a talált jegyzetek és egy létezés-vizsgáló alapján. */
export function planRelink(tracked: Tracked[], found: FoundNote[], exists: (path: string) => boolean): RelinkReport
/** A jelentés konzolsorai; üres jelentésnél üres tömb. */
export function describeRelink(report: RelinkReport, vaultPath: string): string[]
```
- `findNotes`: `readdir(vaultPath, { recursive: true })`, szűrés `.md`-re és arra, hogy egyik szegmens se kezdődjön ponttal; fájlonként `frontmatter(await readHead(path))`; olvashatatlan fájl kimarad (`try/catch`, mint az `entryFor`-ban). `// ponytail: minden futás újraolvas (~0,5 s / 3500 fájl); gyorsítótár, ha a vault nagyságrenddel nő.`
- `planRelink`: ha `exists(t.path)` → semmi. Különben a kulcs jelöltjei: 0 → `missing`, 1 → `moved`, több → `conflicts`.
- `describeRelink`: `áthelyezve: <régi> → <új>`, `eltűnt: <út>`, `ütközés: <item_id> <kind>: <jelölt>, <jelölt>`; az utak a `vaultPath`-hoz relatívak.

- [x] **1. lépés: a bukó tesztek**
  - `planRelink`: létező tárolt út → üres jelentés; hiányzó út + egy jelölt → `moved`; nulla jelölt → `missing`; két jelölt → `conflicts`, és nincs `moved`.
  - `noteKey`: `recipe` nélkül `transcript`; `recipe: notes-hu` + `translation_of: notes` + `language: hu` → `notes-hu`; `item_id` nélkül `null`.
  - `findNotes` ideiglenes vaultban: `.obsidian/x.md`, `.trash/y.md` és egy frontmatter nélküli fájl kimarad; egy almappás, `item_id`-s jegyzet megvan.
- [x] **2. lépés:** `pnpm vitest run src/vault/relink.test.ts` → FAIL.
- [x] **3. lépés:** megírás.
- [x] **4. lépés:** PASS; teljes ellenőrzés zöld.
- [x] **5. lépés:** commit (`feat(vault): Detect moved notes by frontmatter`).

### 3. feladat: Követés a `scan`-ben, a `run`-ban és a `watch`-ban (#276)

**Fájlok:**
- Módosul: `src/state/db.ts` (két új metódus), `src/vault/relink.ts` (`relinkNotes`), `src/cli.ts` (`commandScan`, `commandRun`), `src/watch/round.ts` (`watchRound`)
- Teszt: `src/state/db.test.ts`, `src/vault/relink.test.ts`, `src/cli.test.ts`, `src/watch/round.test.ts`

**Interfészek:**
```ts
// StateStore
/** A `done` sorok nem üres útja, abszolútként. */
trackedPaths(): Tracked[]
/** Egy kész jegyzet új útja (abszolút; a határ relatívvá alakítja). */
movePath(itemId: string, kind: string, path: string): void

// relink.ts
/** Bejár, összevet, és ha `apply`, a `moved` utakat átírja. A jelentés sorait adja. */
export async function relinkNotes(store: StateStore, vaultPath: string, apply: boolean): Promise<string[]>
```
- `commandScan`: a felderítés kiírása után `relinkNotes(store, cfg.vaultPath, false)` sorai, ha nem üres. A tárat csak akkor nyitja, ha az állapotfájl létezik (mint a `refresh.ts:91`); különben nincs követés-jelentés. Ad hoc módban (`--dir`/`--file`) is fut, mert a vault ugyanaz.
- `commandRun`: rögtön az `openState` után, a `--dry-run`-tól függetlenül csak `apply = !flags.dryRun`; a sorok `console.log`-gal.
- `watchRound`: az `openState` után `relinkNotes(store, cfg.vaultPath, true)`, a sorok `out`-tal.

- [x] **1. lépés: a bukó tesztek**
  - `db.test.ts`: `movePath` után az `artifactOf` az új utat adja, a nyers sor relatív.
  - `relink.test.ts`: ideiglenes vault + tár; egy kész jegyzetet átmozgatva `relinkNotes(…, false)` jelenti, és a tár változatlan; `true`-val a tár az új utat adja.
  - `cli.test.ts`: a `scan` kimenetében megjelenik az `áthelyezve:` sor; a `run --dry-run` nem írja át az utat.
  - `round.test.ts`: egy kör után az átmozgatott jegyzet útja frissül, és az `out` megkapja a sort.
- [x] **2. lépés:** FAIL.
- [x] **3. lépés:** megírás.
- [x] **4. lépés:** PASS; teljes ellenőrzés zöld.
- [x] **5. lépés:** commit (`feat(cli): Follow moved notes in scan, run and watch`).

### 4. feladat: Sablonos célút és a mappa rögzítése (#273)

**Fájlok:**
- Módosul: `src/vault/paths.ts`, `src/config.ts` (`vault.layout`, `Config.layout`), `src/state/db.ts` (`noteDirOf`), `src/pipeline.ts` (`PipelineDeps.layout`, a három `noteFile`-hívás), `src/cli.ts` (`:198`, `:588`, a `deps` összeállítása `:918`), `src/watch/round.ts:64`, `src/queue/done.ts` (`DoneLookupDeps.layout`), `src/queue/refresh.ts:99`, `src/serve/summary.ts:170–190`, `refinery.config.example.yaml`, `docs/usage.md`
- Teszt: `src/vault/paths.test.ts`, `src/config.test.ts`, `src/state/db.test.ts`, `src/serve/summary.test.ts`; a régi útra számító elvárások frissítése a többi tesztben

**Interfészek:**
```ts
// paths.ts
export const DEFAULT_LAYOUT = '{channel}/{item_id}'
export const LAYOUT_FIELDS = ['item_id', 'title', 'channel', 'video_id', 'uploaded'] as const
/** A sablon hibája, vagy `null`. Csak `{mező}` szegmensek, ismert mezőnévvel. */
export function layoutError(layout: string): string | null
/** A kitöltött szegmensek; a hiányzó vagy üres mező szegmense kimarad. A szegmensek `sanitizeSegment`-en mennek át. */
export function layoutSegments(layout: string, fields: Partial<Record<(typeof LAYOUT_FIELDS)[number], string>>): string[]
/** Egy elem sablonmezői. */
export function itemFields(item: SourceItem): Partial<Record<(typeof LAYOUT_FIELDS)[number], string>>
export function noteFile(
  notesRoot: string,
  item: SourceItem,
  outputFile: string,
  opts?: { layout?: string; pinnedDir?: string | null },
): string
//   join(opts.pinnedDir ?? join(notesRoot, sanitizeSegment(item.source), ...layoutSegments(layout ?? DEFAULT_LAYOUT, itemFields(item))),
//        `${sanitizeSegment(item.baseName)}${outputFile}`)
export function transcriptFile(notesRoot: string, item: SourceItem, opts?: …): string

// StateStore
/** Az elem bármely kimenetének mappája (abszolút), vagy `null`. Ez rögzíti az elem mappáját. */
noteDirOf(itemId: string): string | null
```
- A `paths.ts` doc-kommentje (a metaadat-függetlenség indoklása) lecserélődik: a célút a metaadatból jön, a kettéválást a `pinnedDir` akadályozza meg.
- Config: `vault.layout: z.string().default(DEFAULT_LAYOUT)` egy `superRefine`-nal, amely a `layoutError` üzenetét adja (pl. `vault.layout: ismeretlen mező: {chanel}; ismert: item_id, title, channel, video_id, uploaded`).
- Rögzítés: ahol van tár (a pipeline három helye, `cli.ts:588`), a hívás `{ layout: cfg.layout, pinnedDir: store.noteDirOf(item.itemId) }`. A `queue/done.ts` és a `cli.ts:198` csak `layout`-ot ad. `// ponytail: a tár nélküli fallback (állapotrekord nélküli kész fájl keresése) a sablon szerinti úton keres; egy régi szerkezetű, rekord nélküli fájlt nem talál meg.`
- `serve/summary.ts`: a commitolandó utak nem újraszámolással jönnek, hanem a `commandRun` után nyitott tárból: `openState(cfg.statePath, cfg.vaultPath)`, `artifactOf(input.videoId, kind)?.path` a `transcript` és az `ids` fajtáira, a `null` kimarad. A csak az útszámításhoz összerakott `SourceItem` törlődik; a címkeresés (`discoverAll`) marad.

- [x] **1. lépés: a bukó tesztek**
  - `paths.test.ts`: `channel`-lel `<root>/<forrás>/<csatorna>/<item_id>/<alapnév>_notes.md`; `channel` nélkül `<root>/<forrás>/<item_id>/…`; a csak szóköz `channel` is hiányzik; `pinnedDir` esetén `<pinnedDir>/<alapnév>_notes.md`.
  - `layoutError('{chanel}/{item_id}')` a mezőnevet tartalmazó hibát ad; `'videos/{item_id}'` hiba; `DEFAULT_LAYOUT` → `null`.
  - `config.test.ts`: hiányzó `layout` → `DEFAULT_LAYOUT`; `{chanel}` → config-hiba a `vault.layout` névvel.
  - `db.test.ts`: `noteDirOf` egy kész kimenet mappáját adja; kimenet nélkül `null`.
  - `pipeline.test.ts`: egy elem, amelynek az átirata a régi helyen van a tárban, az új receptjét ugyanabba a mappába írja.
  - `summary.test.ts`: a commit a tárban rögzített úton lévő fájlt veszi fel.
- [x] **2. lépés:** FAIL.
- [x] **3. lépés:** megírás; a régi útra számító tesztelvárások frissítése (ahol a teszt maga is `noteFile`-lal számol, azt nem kell).
- [x] **4. lépés:** PASS; teljes ellenőrzés zöld.
- [x] **5. lépés:** commit (`feat(vault): Place notes by a configurable per-item layout`).

### 5. feladat: `telegram/` forrásnév

**Fájlok:** `package.json` (`serve`, `serve:inspect`: `tmp/serve-out` → `tmp/telegram`), `README.md:283`, `.env.example` (ha a mappát említi)

- [x] **1. lépés:** csere, `grep -rn "serve-out" --exclude-dir=node_modules --exclude-dir=dist .` → csak a `docs/plans/` régi dokumentumai és a CHANGELOG maradhat.
- [x] **2. lépés:** teljes ellenőrzés zöld; commit (`chore(serve): Rename serve output folder to telegram`).

### 6. feladat: Egyszeri mozgató szkript

**Fájlok:** új `scripts/move-notes.ts` (futtatás: `pnpm exec tsx scripts/move-notes.ts [--apply]`)

**Viselkedés:**
- Betölti a configot (`loadCliConfig`), `findNotes(cfg.vaultPath)`-szal bejár, és csak a `cfg.notesRoot` alatti jegyzeteket veszi.
- A cél: `join(notesRoot, RENAMED[source] ?? source, ...layoutSegments(cfg.layout, mezők a frontmatterből), basename(régi út))`, ahol `const RENAMED: Record<string, string> = { 'serve-out': 'telegram' }`. A frontmatter mezőnevei egyeznek a sablon mezőivel (`item_id`, `title`, `channel`, `video_id`, `uploaded`).
- Kiírja a `régi → új` párokat (a `notesRoot`-hoz relatívan); a már a helyén lévőt kihagyja; ha a cél létezik, `kihagyva, létezik:` sor.
- `--apply`: `mkdir -p` a célmappára, majd `git -C <vault> mv <régi> <új>` (`execFile`). Commitot nem készít, a végén kiírja: `Commitold a vaultot, aztán futtasd: refinery run`.
- Teszt nincs: egyszer futó, próbafuttatással ellenőrzött szkript, a logikája (`findNotes`, `layoutSegments`) tesztelt.

- [x] **1. lépés:** megírás; `pnpm typecheck && pnpm lint` zöld.
- [x] **2. lépés:** próbafuttatás a valódi vaulton (`--apply` nélkül): a kimenetben a `serve-out/…` jegyzetek `telegram/<csatorna>/<id>/` alá mennének, a `chapters/…` a `chapters/<id>/` alá; nincs `kihagyva` sor a pinchflat-minta duplikátumon kívül.
- [x] **3. lépés:** commit (`chore(scripts): Add one-off note move script`).

### 7. feladat: PR, kiadás, telepítés és éles ellenőrzés

- [ ] **1. lépés:** PR a `feat/vault-rendezes` ágról, `Closes #273, #275, #276`; `gh pr checks` zöld; merge után kiadás a bevált menettel (v1.20.0).
- [ ] **2. lépés (telepítés a peter-mba-n):** a `serve` leállítása → `mv tmp/serve-out tmp/telegram` → ha a `SERVE_OUT` máshol (launchd, compose) is be van állítva, ott is átírni → `serve` indítása. Ellenőrzés: `GET /version` az új verziót adja.
- [ ] **3. lépés (#275 éles):** az első `refinery scan` után az állapotfájl mellett van `.bak`, a `sqlite3 <állapotfájl> "select count(*) from artifacts where path like '/%'"` → 0 (vagy a kiírt, vaulton kívüli sorok száma). A webes elemoldal mutatja egy jegyzet törzsét.
- [ ] **4. lépés (#273 éles):** a pinchflat-minta duplikátum kézi törlése a vaultból; `scripts/move-notes.ts` próbafuttatása, átnézése, majd `--apply`; vault-commit; `refinery run` (recept nélkül is lefut a követés) → minden mozgatás `áthelyezve:` sorként jelenik meg; utána a `refinery scan` nem jelez elmozdulást.
- [ ] **5. lépés (#276 éles):** egy jegyzetet Obsidianban másik mappába húzva a `scan` jelzi, a `run` frissíti; a webes elemoldal és a queue-link az új helyre mutat.
- [ ] **6. lépés:** egy Telegramról kért új videó jegyzetei a `telegram/<csatorna>/<videóazonosító>/` alá kerülnek, és a vault-commit felveszi őket.
