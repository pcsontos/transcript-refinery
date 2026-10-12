# Spec — Vault-commit üzenete: jegyzetenként egy commit, fajtával, címmel és azonosítóval

**Dátum:** 2026-10-12 · **Státusz:** átnézésre vár

Ez a dokumentum a #215 issue tervezéséből készült. Ahol ez a spec nem mond mást, a mai viselkedés marad.

## A cél egy mondatban

A vault `git log --oneline` sorából derüljön ki, melyik videó melyik jegyzete került be: minden jegyzet saját commitot kap, amelynek első sora megnevezi a jegyzet fajtáját, a videó címét és teljes azonosítóját.

## Ezen a körön kívül

A commit törzse (csak első sor készül). A push módja és hibakezelése. A `refinery scan --queue` saját commitja (`src/cli.ts:220`). A `--no-commit` viselkedése. A már meglévő vault-történet átírása. A `docs/roadmap.md` lezárt fázisainak „egyetlen commit" megfogalmazása.

## Döntések a tervezésből

| Kérdés | Döntés |
|---|---|
| Mi egy commit egysége? | Egy jegyzetfájl. Az átirat is saját commitot kap. |
| Az első sor formátuma | `docs(transcript-refinery): <fajta> \| <cím> [<azonosító>]` |
| Hosszkorlát | 80 karakter. A cím rövidül, az azonosító soha. |
| Többvideós futás | Nincs külön eset: minden jegyzet külön commit, akárhány videóból. |
| `run --queue` | Ugyanígy jegyzetenként commitol; az `N jegyzet a feldolgozási sorból` üzenet megszűnik. Ez felülírja az issue erre vonatkozó elfogadási feltételét. |
| `watch — ` előtag | Megszűnik, a jegyzetek és a sor commitjánál is. |
| A `_queue.md` | A futás utolsó jegyzet-commitjával megy. Saját commitot csak akkor kap, ha a futásban nincs jegyzet. |
| Ismeretlen cím | Nem fordul elő: az `items.title` kötelező, info.json híján a fájl alapneve. |
| Azonosító | Az `items.video_id`; ha nincs, az `item_id`. |

## 1. Az első sor

### Ma

Három helyen három beégetett szöveg készül, egyik sem nevezi meg a videót:

- `src/serve/summary.ts:160`: `docs(transcript-refinery): átirat 1 videóhoz` (a `COMMIT_SCOPE` nélkül);
- `src/cli.ts:612–613`: `N jegyzet a feldolgozási sorból`, illetve `átirat N videóhoz`;
- `src/watch/round.ts:97–98`: `watch — feldolgozási sor frissítése`, illetve `watch — átirat N videóhoz`.

Az N a commitra váró jegyzetfájlok száma, nem a videóké.

### Új viselkedés

Egy tiszta függvény állítja elő az első sort a fajtából, a címből és az azonosítóból:

- **Előtag:** `docs(<COMMIT_SCOPE>): <fajta> | `. A fajta `transcript` vagy a recept azonosítója (`summary`, `qa`, `summary-hu`, …), ahogy a `pending_commits.kind` tárolja.
- **A cím tisztítása:** a `[<azonosító>]` előfordulása kimarad belőle (a yt-dlp fájlnevéből örökölt címben ott van), a szóközsorozatok és sortörések egy szóközzé válnak, a szélekről a szóköz lekerül.
- **Ha a teljes sor belefér 80 karakterbe:** `<előtag><cím> [<azonosító>]`.
- **Ha nem fér bele:** a cím annyi karakterre rövidül, hogy a sor legfeljebb 80 legyen, a végéről a szóköz lekerül, és `…` zárja, szóköz nélkül az azonosító előtt: `<előtag><csonka cím>…[<azonosító>]`.
- **Ha a cím a tisztítás után üres:** `<előtag>[<azonosító>]`.
- **Ha az azonosító mellett a címnek nem marad hely:** `<előtag>…[<azonosító>]`; a sor ekkor átlépheti a 80 karaktert, az azonosító ép marad.
- A hossz Unicode-karakterben (kódpontban) számít, nem bájtban.

Példák:

```
docs(transcript-refinery): summary | Első videó [a1]
docs(transcript-refinery): summary-hu | It took me 10+ years to re…[D0Vw5X2PSIQ]
```

## 2. Jegyzetenkénti commit (`run`, `run --queue`, `watch`)

### Ma

A `run` és a `watch` a `store.listPendingCommits()` összes útját és (ha változott) a sor fájlját egyetlen `gitCommitPaths` hívással commitolja, utána az összes utat leveszi a várólistáról.

### Új viselkedés

- Az állapottár új lekérdezése a commitra váró jegyzeteket egyenként adja vissza, rögzítési sorrendben: azonosító, cím, fajta, út. Az azonosító és a cím az `items` táblából jön (`LEFT JOIN`); ha az elem hiányzik, mindkettő az `item_id`.
- Egy közös függvény végigmegy a listán, és **jegyzetenként egy commitot** készít az 1. pont szerinti üzenettel.
- **Egy jegyzet csak a saját commitja után kerül le a várólistáról.** Ha egy commit hibát dob, a sorozat megáll; a már commitolt jegyzetek lekerültek, a többit a következő futás pótolja.
- Ha egy jegyzet fájlja nem változott (nincs mit commitolni), nem készül commit, de a jegyzet lekerül a várólistáról, mint ma.
- **A sor fájlja** (`_queue.md`), ha a futás módosította:
  - ha van commitra váró jegyzet, az **utolsó** jegyzet commitjába kerül, annak üzenetével;
  - ha nincs, saját commitot kap: `docs(<COMMIT_SCOPE>): feldolgozási sor frissítése`.
- **Push** futásonként egyszer megy, a commitok után, és csak akkor, ha legalább egy commit készült.
- A `watch` terminálsora az utolsó commit hashét írja ki. Több commitnál a darabszám is szerepel: `commit: <hash> (3 commit, push ok)`; egy commitnál a mai `commit: <hash> (push ok)` marad.
- A `listPendingCommits()` megmarad (a meglévő tesztek erre épülnek), de az éles kód már nem hívja.

## 3. Telegram-út (`serve`)

### Ma

A `runRecipes` a futás után egyetlen commitba teszi az átiratot és a kért receptek jegyzeteit (`src/serve/summary.ts:155–161`), beégetett üzenettel.

### Új viselkedés

- A létező fájlok egyenként kerülnek commitba, az 1. pont szerinti üzenettel: elöl az átirat (`transcript`), utána a receptek a kérés sorrendjében, a fajta a recept azonosítója (fordításnál `<recept>-<nyelv>`).
- **A cím** a letöltés info.json-jából jön (a `discoverAll` adja), ha nincs ilyen, a fájl alapneve; az azonosító a kérés `videoId`-ja.
- Nem változott fájlról (például már korábban commitolt átiratról) nem készül commit.
- A push és a visszatérési értékek nem változnak.

## Hibakezelés összefoglalva

| Helyzet | Viselkedés |
|---|---|
| A sorozat k-adik commitja hibát dob | Az első k−1 jegyzet commitolva és levéve a várólistáról; a többi rajta marad; a hiba a mai úton jut a hívóhoz. |
| A jegyzet fájlja nem változott | Nincs commit, a jegyzet lekerül a várólistáról. |
| Csak a sor változott | Egy `feldolgozási sor frissítése` commit. |
| A várólistán lévő jegyzet eleme hiányzik az `items`-ből | A cím és az azonosító is az `item_id`. |
| Az azonosító olyan hosszú, hogy cím nem fér mellé | Az azonosító teljes, a sor átlépheti a 80 karaktert. |

## Tesztek

Vitest, a megfigyelhető viselkedésre:

- `src/vault/commit.test.ts` (új) — az első sor: rövid cím; hosszú cím (pontosan 80 karakter, `…[<azonosító>]` a végén); a címben ismétlődő azonosító és sortörés; hosszú azonosító.
- `src/state/db.test.ts` — a jegyzetenkénti lekérdezés azonosítót (`video_id`, annak híján `item_id`), címet, fajtát és utat ad, rögzítési sorrendben.
- `src/cli.test.ts` — `--recipe` mellett az átirat és a recept külön commit a várt üzenetekkel; `run --queue` öt jegyzetre öt commitot ad, a sor fájlja az utolsóban; ha a második commit elhasal, az első jegyzet lekerül a várólistáról, a második rajta marad.
- `src/e2e.test.ts` — valódi gittel: a `git log` sorai és az utolsó commit fájllistája (jegyzet + `_queue.md`).
- `src/watch/round.test.ts` — egy új videó egy commit (`transcript | …`), benne a `_queue.md`; ha csak a sor változott, az üzenet `feldolgozási sor frissítése`.
- `src/serve/summary.test.ts` — az átirat és a recept külön commit, a várt üzenetekkel; a fájllisták a teljes történetből olvasva egyeznek.

## Kiadás

Minor verzióemelés (v1.15.0) a megszokott menettel. Új Docker-kép kell (`pnpm docker:publish`), mert a `serve` kódja változik. A Worker kódja nem változik.
