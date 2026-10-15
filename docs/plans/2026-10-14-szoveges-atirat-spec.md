# Spec — Szöveges átirat (`.txt`, `.md`) a CLI-ből (#206, A szelet)

**Dátum:** 2026-10-14 · **Státusz:** átnézésre vár

Ez a dokumentum a #206 tervezéséből készült. Az issue három bemeneti utat kér a `.txt` átirathoz: Telegram-csatolmány, Telegram `/scan` szöveggel, és terminál (`--file`/`--dir`). A tervezés során két dolog változott. Egyrészt a munka két szeletre vált: ez az **A szelet** (mag és CLI), a Telegram-utak a **B szelet**, saját spec→terv→kód körrel. A B épít az A-ra, fordítva nincs függés. Másrészt a `.md` bekerült a körbe, holott az issue eredetileg a „Nem cél” részbe sorolta. Ahol ez a spec nem mond mást, a mai viselkedés marad.

## A cél egy mondatban

Egy időbélyeg nélküli `.txt` vagy `.md` átiratból a terminálból indítva ugyanúgy jegyzet készül a vaultban, állapottal és költségsorral, mint egy feliratból; ugyanazért a szövegért nem fizetünk kétszer.

## Háttér: mi van ma (a kódból ellenőrizve)

- A felderítés (`src/source/folder.ts`, `SUBTITLE_EXTENSIONS`) csak `.srt`/`.vtt` fájlt vesz fel, és csak a konfigurált `sources` mappáit járja be (`discoverAll`).
- A feliratparszer (`src/subtitle/parse.ts`) kiterjesztés szerint választ, másra hibát dob. A `normalizeItem` (`src/pipeline.ts:71`) parszol, deduplikál (`dedupeTimedLines`), és a nyelvet a fájlnévből vagy a tartalomból (`identifyLanguage`) veszi.
- Időbélyeget csak a horgonyzott `clean` szintek használnak (`src/recipe/clean.ts`, `anchorParagraphs`). Üres `timed` mellett minden bekezdés horgonyozatlanul megy át, és a futás horgonyzási figyelmeztetést ad. A fordítás már ma `timed: []`-vel fut (`src/pipeline.ts:200`), mert a kész forrásjegyzetből dolgozik.
- A `refinery scan` felderít és listáz, nem ír; a `--queue` a vault `_queue.md` sorába fésül. Csak a `refinery run` hív modellt és ír jegyzetet. Egyiknek sincs `--file`/`--dir` kapcsolója.
- A sor videósora `### N. Cím %%itemId%%` (`src/queue/line.ts`, `VIDEO` regex, `videoLine`). Útvonalat nem tárol. A `run --queue` az azonosítót a `sources` újbóli bejárásával oldja fel (`src/cli.ts:682–697`); amit nem talál, az a „nem található” listára kerül.
- Az azonosító (`src/source/identity.ts`, `itemIdFor`) a videóazonosító, vagy a forrásnév és a relatív alapnév hash-e.
- A jegyzet útja `<notesRoot>/<forrás>/<relatív mappa>/<alapnév><recept>.md` (`src/vault/paths.ts`, `noteFile`); a write-once elv a modellhívás előtt kihagyja a már létező jegyzetet.
- A súgó a `src/help.ts`-ben él (`COMMANDS`); a `refinery --help`, a `scan --help` és a `run --help` ebből olvas. A CLI felhasználói leírása a `docs/usage.md`.

## Ezen a körön kívül

- **B szelet:** Telegram-csatolmány, Telegram `/scan` szöveggel, a fájl eljuttatása a Workertől a serve-hez.
- A konfigurált `sources` bejárása nem változik: továbbra is csak `.srt`/`.vtt`. Így a forrásmappákban heverő jegyzetek, README-k nem kerülnek be véletlenül.
- A `.md` frontmatter mezőinek (pl. `title:`) felhasználása; a cím a fájlnévből jön.
- Egyéb formátum (`.docx`, `.pdf`), hang-átirat, időbélyeg-előállítás.
- Az Obsidianban kattintható forráslink a sorban.

## Döntések a tervezésből

| Kérdés | Döntés |
|---|---|
| Melyik parancs kapja a kapcsolókat? | A `scan` és a `run` is, azonos jelentéssel. A `scan` ingyenes előnézet, a `run` dolgoz fel. |
| Mit szed fel a `--dir`? | Rekurzívan minden `.srt`, `.vtt`, `.txt` és `.md` fájlt. |
| Szűrés | `--match '<glob>'` (pl. `'*.md'`), a beépített `path.matchesGlob`-bal. Glob, nem regexp. Csak szűkít: a mintára illő, de nem támogatott kiterjesztésű fájl nem kerül be. |
| Idézőjel | A súgó és a doksi idézőjeles mintát mutat, mert a zsh az idézetlen `*.md`-t maga bontja ki, és találat nélkül el sem indítja a parancsot. |
| `.md` „kérésre” | A `.md` csak `--dir`/`--file` útján jön be, a konfigurált `sources`-ból soha. |
| Viszony a `sources`-hoz | A `--dir`/`--file` erre az egy futásra a `sources` helyére lép. |
| Azonosság | `t-` előtag + a normalizált tartalom hash-e. Átnevezés, áthelyezés nem új tétel; szerkesztés új tétel. |
| Hash-normalizálás | A BOM lekerül, a sorvégek `\n`-re váltanak, a széleken a whitespace levágódik. |
| Név, cím, nyelv | A fájlnévből, a `splitSubtitleName` szabályával (`átirat.en.md` → alapnév `átirat`, nyelv `en`). Nyelvkód nélkül a tartalom dönt, mint feliratnál. |
| Forrásnév | `--dir` esetén a mappa neve, `--file` esetén a fájlt tartalmazó mappa neve. Ez adja a jegyzet vault-mappáját és a sorcsoportot. |
| `.md` tartalma | A vezető YAML-frontmatter lekerül; a fejlécek, listák, linkek maradnak. |
| Normalizálás | Saját ág a `normalizeItem`-ben; nincs szintetikus feliratblokk és nincs deduplikálás. |
| Horgonyzott `clean` | Szöveges tételnél nincs horgonyzás és nincs horgonyzási figyelmeztetés; a jegyzet időbélyeg nélkül készül. |
| Fordítás | Külön munka nélkül működik, mert a kész forrásjegyzetből dolgozik. |
| Sor | Szöveges tételnél a horgony `%%azonosító abszolút-út%%`. Rejtett, mert egy látható linket a Better Markdown Links plugin átírhatna. |
| Azonos nevű jegyzet | Elfogadott: a jegyzet útja az alapnévből képződik, így szerkesztett vagy azonos nevű másik fájl a write-once miatt kimarad; újrafeldolgozás `--force`-szal. A `scan` jelzi az ütközést. |
| Fájlméret-kapu | 2 MB. A költséget a meglévő becslés és költségkeret védi; ez csak a véletlen óriásfájl ellen van. |
| Súgó | A `refinery --help`, a `scan --help` és a `run --help` az új kapcsolókkal és példákkal bővül; a `docs/usage.md` is. |

## 1. Szöveges forrás: `src/source/text.ts`

Új egység, egyetlen felelősséggel: egy `.txt`/`.md` fájlból `SourceItem`-et és átiratszöveget állít elő.

- **Beolvasás és ellenőrzés**, ebben a sorrendben, mindegyik megnevezett hibával:
  - a fájl mérete legfeljebb 2 MB („a fájl túl nagy: X MB, legfeljebb 2 MB”);
  - a tartalom érvényes UTF-8 (`TextDecoder` `fatal: true`) és nincs benne NUL-bájt („a fájl nem UTF-8 szöveg”);
  - `.md` esetén a vezető frontmatter levágása: ha a fájl (BOM után) `---` sorral kezdődik, és van záró `---` vagy `...` sor, a kettő közti rész és a záró sor lekerül. Záró sor nélkül nincs levágás;
  - a megmaradt szöveg nem üres („a fájl üres”).
- **Azonosító:** `t-` + a normalizált szöveg (BOM nélkül, `\n` sorvégekkel, levágott szélekkel) SHA-256 hash-ének első 16 hex jegye. A hash a frontmatter levágása *után* készül, így egy frontmatter-módosítás nem új tétel.
- **Név és nyelv:** a `splitSubtitleName` kiterjesztéslistája `.txt`-vel és `.md`-vel bővül, vagy egy közös segédfüggvény szolgálja ki mindkettőt; a nyelvkód-szabály azonos.
- **Mező:** a `SourceItem` egy új `format: 'subtitle' | 'text'` mezőt kap, a `normalizeItem` ez alapján ágazik el. A `subtitlePath` neve marad; a dokumentációs kommentje „a forrásfájl abszolút útja” lesz.

## 2. Ad hoc felderítés: `src/source/folder.ts`

Új függvény, amely a `--dir`/`--match`/`--file` kapcsolókból elemlistát állít elő:

- **`--file <út>`:** egyetlen tétel. A kiterjesztés `.srt`, `.vtt`, `.txt` vagy `.md` lehet, különben kapcsolóhiba. Feliratnál a mai csoportosítás és sidecar-keresés él (a fájl mappájában).
- **`--dir <mappa>`:** a meglévő `walk` bejárás; a feliratok a mai csoportosítással és sidecar-kereséssel, a `.txt`/`.md` fájlok egyenként.
- **`--match '<glob>'`:** `path.matchesGlob`-bal. A `/` nélküli minta a **fájlnévre** illeszkedik (mint a `.gitignore`-ban), így a `'*.md'` a teljes fa minden `.md` fájljára illik; a `/`-t tartalmazó minta a mappához képesti relatív útra (`'jegyzetek/*.md'`). Ok: a puszta `matchesGlob('sub/x.md', '*.md')` hamis, tehát relatív útra illesztve a `'*.md'` csendben kihagyná az almappákat.
- **Forrásnév:** lásd a döntéseknél. A `sourceFile` a forrásnév mappájához képesti relatív út.
- **Duplikátum:** azonos azonosítójú tételből az első marad, mint a `discoverAll`-nál.

## 3. Normalizálás: `src/pipeline.ts`

A `normalizeItem` szöveges tételnél:

- a szöveget az 1. pont szerint olvassa és ellenőrzi;
- a `lines` a nem üres sorok, változatlan sorrendben, deduplikálás nélkül; a `timed` üres;
- a `wordsRaw` és a `wordsNormalized` azonos;
- a nyelv a mai szabály szerint: fájlnév, különben `identifyLanguage`, különben megnevezett hiba;
- a `captionSource` és a `punctuationDensity` ugyanúgy számolódik, mint feliratnál. A `captionSource` a meglévő `classifyCaptions` heurisztikából jön.

A `clean` horgonyzása (`src/recipe/clean.ts`) üres `timed` mellett nem fut, és a pipeline nem ad horgonyzási eseményt.

## 4. A sor: `src/queue/line.ts`

- **Írás:** szöveges tételnél `### 0. Cím %%t-… /abszolút/út/fájl.md%%`. Feliratnál változatlan.
- **Olvasás:** a `VIDEO` regex horgonyrésze az első szóköznél kettéválik: előtte az azonosító, utána (ha van) az útvonal. Az azonosítóban nincs szóköz, az útvonalban lehet.
- **Határeset:** ha az útvonalban `%%` van, a `scan --queue` erre a tételre megnevezett hibát ad, és nem ír sort.
- A visszaírás (`withSuffix`) a horgonyt érintetlenül hagyja, így az útvonal a státuszutótag frissítésekor sem vész el. A meglévő sorokhoz nem kell nyúlni, migráció nincs.

## 5. CLI és súgó: `src/cli.ts`, `src/help.ts`, `docs/usage.md`

**Kapcsolók** a `scan`-en és a `run`-on:

- `--dir <mappa>`: ad hoc mappa a `sources` helyett;
- `--match '<glob>'`: szűrő a `--dir`-hez;
- `--file <út>`: egyetlen fájl a `sources` helyett.

**`scan`:** a mai lista formája marad. Szöveges tételnél a részletsor `N szó, szöveg (.txt|.md)`. Az olvashatatlan fájl a listában marad a hibaüzenetével, mint ma az olvashatatlan felirat. Ha a tétel jegyzetútja már foglalt, a részletsor jelzi: „jegyzet már létezik ezen a néven”. Üres eredménynél: `0 feldolgozható fájl` és a használt szűrő.

**`scan --queue`:** a mai összefésülés, a 4. pont szerinti horgonnyal.

**`run`:** a mai folyamat a `sources` helyett az ad hoc tételekkel. A költségbecslés, a költségkeret, a write-once, a „már feldolgozva” kihagyás, a riport és a vault-commit változatlan.

**`run --queue`:** az azonosítót előbb a `sources`-ban keresi. Amit ott nem talál, de a horgonyában útvonal van, azt a fájlból építi fel. Ha a fájl nincs meg: „nem található: <út>”. Ha a tartalma megváltozott (más a hash): „nem található: a fájl tartalma megváltozott a sorba vétel óta (<út>)”. Mindkettő a mai „nem található” listára kerül.

**Kapcsolóhibák** (a futás el sem indul, az állapottárhoz nem nyúl):

- `--dir` és `--file` együtt;
- `--source` a `--dir` vagy a `--file` mellett;
- `--match` `--dir` nélkül;
- `--file` nem támogatott kiterjesztéssel;
- nem létező `--dir` vagy `--file`.

A `--channel` szűrő marad; metaadat nélküli tételre ma sem illik.

**Súgó:** a `scan` és a `run` `options` listája a három kapcsolóval bővül, a `description` elmondja, hogy az ad hoc forrás a `sources` helyére lép, és hogy a `.md` csak így jön be. Példák: `refinery scan --dir ~/atiratok --match '*.md'`, `refinery run --file ~/atiratok/átirat.txt`. A `refinery --help` áttekintő a parancsok összefoglalóját a mai módon mutatja; a `scan` összefoglalójából kikerül a „videókat” szó, mert már nem csak videó jöhet. A `docs/usage.md` egy új alfejezetet kap a szöveges átiratról, ugyanezekkel a példákkal.

## 6. Hibakezelés

- **Tételszintű hiba** (üres, túl nagy, nem UTF-8, ismeretlen nyelv): a mai `item:failed` út, megnevezett üzenettel; a többi tétel feldolgozása folytatódik. Csendes kihagyás nincs.
- **Kapcsolóhiba:** a futás előtt, nem nulla kilépési kóddal.
- **Sorbeli útvonal:** eltűnt vagy megváltozott fájl a „nem található” listára kerül, a futás folytatódik.

## 7. Tesztek (megfigyelhető viselkedés)

Mind a Vitest-készletben, hamis modellklienssel, valós költség nélkül.

**Végponttól végpontig** (`src/e2e.test.ts` mintájára):

- `run --file átirat.txt`: a vaultban megjelenik a jegyzet, az állapottárban `done` a tétel, a riportban költségsor van.
- Ugyanaz a fájl még egyszer, akár átnevezve: a tétel „már feldolgozva” címén kimarad, a hamis kliens hívásszáma nem nő.
- `.md` frontmatterrel: a modellnek átadott promptban nincs benne a frontmatter, a fejlécek igen.
- `clean-light` szöveges tételen: a jegyzetben nincs időbélyeg, és nem jön horgonyzási esemény.

**`scan`, sor, `run --queue`:**

- `scan --dir x --match '*.md'`: csak a `.md` tételeket listázza, az almappákból is; `--match 'al/*.md'` csak az `al` mappa `.md` fájljait. Vegyes mappa minta nélkül: mind a négy fajtát listázza. `*.pdf` minta: „0 feldolgozható fájl”.
- `scan --dir x --queue`: a sorban a szöveges tétel horgonya `%%t-… <út>%%`. Utána `run --queue`: a tétel feldolgozódik, bár a `sources`-ban nincs. Ha a fájlt közben törlöm vagy módosítom: „nem található”, a megfelelő okkal.
- A meglévő sorformátum-tesztek változtatás nélkül zöldek.

**Hibautak:** üres, 2 MB fölötti, NUL-bájtos és érvénytelen UTF-8 fájl: megnevezett hiba, a többi tétel feldolgozódik. Minden kapcsolóütközés a futás előtt hibával áll meg, és az állapottár nem változik.

**Súgó:** a `refinery scan --help` és a `refinery run --help` kimenetében megjelenik a `--dir`, a `--match` és a `--file`, a fenti példákkal.

**Egységtesztek** (`src/source/text.ts`): frontmatter-levágás (záró sorral és anélkül); a hash CRLF↔LF és BOM esetén azonos, egy betű eltérésnél más; név és nyelv a fájlnévből.

## 8. Kiadás

Minor verzióemelés és changelog PR-en át, tag, majd a konténerkép kiadása a bevált menet szerint, mert a serve képe a CLI kódját tartalmazza. A Worker nem változik.

## Nyitott pontok a tervhez

- A hibaüzenetek és a súgó pontos szövegei: a tervben.
- A #206 törzsének frissítése a spec jóváhagyása után: az A/B szétbontás, a `.md` bekerülése és a döntések.
