# Spec — Szöveges átirat (`.txt`, `.md`) Telegramból (#206, B szelet)

**Dátum:** 2026-10-15 · **Státusz:** átnézésre vár

Ez a #206 B szelete. Az A szelet (`docs/plans/2026-10-14-szoveges-atirat-spec.md`, kiadva v1.17.0-ként) a magot és a CLI-t hozta: `scan`/`run` `--file`, `--dir`, `--match`, a `t-` tartalom-hash azonosítóval és horgonyzás nélküli `clean`-nel. A B ugyanezt a Telegramból teszi elérhetővé: csatolt fájlból és `/scan` után beillesztett szövegből. Az A szelet döntései (azonosság, normalizálás, frontmatter, 2 MB-os kapu, nyelv, horgonyzás, fordítás) itt is érvényesek; ahol ez a spec nem mond mást, a mai viselkedés marad.

## A cél egy mondatban

Egy Telegramban csatolt `.txt`/`.md` fájlból vagy egy `/scan` után beillesztett szövegből ugyanúgy recept-gombok, futás és vault-jegyzet lesz, mint egy YouTube-linkből; ugyanazért a szövegért nem fizetünk kétszer.

## Háttér: mi van ma (a kódból ellenőrizve)

- **Worker** (`worker/src/handle.ts`, `handleUpdate`): csak a `message.text`-et olvassa; a linkeket és videóazonosítókat a `linesForMessage` (`worker/src/plan.ts`) szedi ki. Csatolt fájlnál (`document`, `caption`, nincs `text`) a válasz a félrevezető `NO_VIDEO_LINE` („Nincs YouTube-videó az üzenetben.”). `/scan` parancs nincs.
- **A sor** (`jobs` tábla): `jobId = <update_id>:<videoId>`; erre épül a dedup (`activeByVideo`), a cron-újrakopogtatás (`due`, a sorból újraépített `{ jobId, videoId, url }`) és a jegyzetlink (`runReadyMessage`, `/notes/<videoIdOf(jobId)>/<fajta>`).
- **Szereposztás** (`docs/plans/2026-10-04-telegram-cloudflare-spec.md`): a Workernek nincs R2-kötése, a konténernek (serve) nincs bot-tokenje és D1-hozzáférése. A Worker kopogtat és üzen, a serve dolgozik és tárol.
- **Az R2 szerepe:** a serve saját tartós tárolója a két lépés (letöltés, majd futás koppintásra) között, és gyorsítótár (`remoteReady`). Kulcsai `videos/<videoId>/<nyelv>.vtt|srt` és `videos/<videoId>/info.json`. A `SERVE_OUT` munkaállomány, futásonként kiürül (`keepThisVideo`).
- **Serve** (`src/serve/job.ts`): recept nélküli kopogtatásra yt-dlp-vel feliratot tölt le, feltölti az R2-be, `ready`-vel visszahív. Recept-kopogtatásra az R2-ből a `SERVE_OUT`-ba ír (`loadSummaryPair`), és a `runRecipes` (`src/serve/summary.ts`) `commandRun`-t hív a `SERVE_OUT`-tal mint egyetlen `sources`-szal.
- **A szöveges normalizálás** (`src/source/text.ts`): a `readTextSource` fájlhoz kötött (`node:fs`), a `textItemId` `node:crypto`-t használ; a Worker egyiket sem tölti be. A Worker ma a csomag `transcript-refinery/classify` exportját használja.
- A `commandRun` már fogad `adHoc: { file }` kapcsolót (A szelet).
- **Lefelé minden azonosító-alapú:** a `/notes/<id>/<fajta>` a jegyzet frontmatterének `item_id`-je szerint keres (`src/serve/notes.ts`), tehát egy `t-…` tételre is működik.

## Ezen a körön kívül

- Több üzenetre bontott beillesztett szöveg összefűzése.
- `.docx`, `.pdf` és más formátum.
- A csatolmány aláírásának (caption) felhasználása: cím, link.
- Csoportos visszajelzés több egyszerre küldött fájlra (`media_group_id`); fájlonként külön üzenet jön.
- A CLI-ből és a Telegramból jött szöveges jegyzet nevének egységesítése.

## Döntések a tervezésből

| Kérdés | Döntés |
|---|---|
| Mi indítja a csatolmányt? | Bármely csatolt `.txt`/`.md` magától indul, parancs nélkül, mint a link. A `/scan` csak a beillesztett szövegé. |
| Melyik fájl jöhet? | A **kiterjesztés** dönt (`file_name`), nem a MIME-típus, mert a `.md` kliensenként `text/markdown`, `text/plain` vagy `application/octet-stream`. |
| Aláírás a csatolmányon | Nem számít; egy benne lévő link sem indul. |
| Beillesztett szöveg hossza | Egyetlen üzenet, legfeljebb a Telegram 4096 karakteres határa. A hosszabb szöveget a kliens több üzenetre bontja, és csak az első viszi a `/scan`-t. 3900 karaktertől a futás indul, mellette figyelmeztetés: hosszabb átiratot fájlként. |
| Cím | Csatolmánynál a fájlnév alapneve (`splitSubtitleName` szabállyal, `átirat.en.md` → `átirat`, nyelv `en`). Beillesztett szövegnél az első nem üres sor, legfeljebb 80 karakter. |
| Ki számolja az azonosítót? | A **Worker**, a beérkezéskor; így a sor `videoId`-ja rögtön a `t-…`, és a dedup, a cron, a `/cancel` és a jegyzetlink a meglévő kóddal megy. |
| A normalizálás kódja | Egy helyen él: a `src/source/text.ts` tiszta (Node-mentes) részéből a csomag `transcript-refinery/text` exportja; a Worker és a serve ugyanazt hívja. Duplikálás nincs. |
| Hogyan jut a szöveg a serve-hez? | A kopogtatás törzsében (`text`, `title`). A serve újraellenőrzi, és ő tölti fel az R2-be, ahogy ma a `.vtt`-t. A Worker R2-kötést nem kap. |
| Mit tárol a D1 a cron-újrapróbáláshoz? | Csatolmánynál a Telegram `file_id`-t (tartós), és újrapróbáláskor a Worker újra letölti a fájlt. Beillesztett szövegnél magát a szöveget (≤ 4096 karakter). |
| Mikor ürül a D1-beli szöveg? | A sor lezárásakor (`ready`, `failed`, `cancelled`), ugyanabban a mentésben. A `202` nem elég, mert a serve újraindulásakor a munka elvész, és a cron 15 perc után újra kopogtat. A `file_id` megmarad, mint a link URL-je. |
| Hol várakozik a szöveg a serve átvétele után? | Az R2-ben (`videos/<t-id>/text.txt`), mint a felirat. |
| Fájlnév a `SERVE_OUT`-ban | `<cím> [t-…].<nyelv>.txt`, nyelvkód nélkül `<cím> [t-…].txt`, mint a videónál `<cím> [videoId]`. Az azonos című szövegek így nem ütköznek a write-once-on. Mindig `.txt`, `.md`-ből is: egy második frontmatter-vágás tartalmat vihetne el. |
| Vault-mappa | Ugyanaz, mint a Telegramból jött videóké (a forrásnév a `SERVE_OUT` neve). |

## 1. Közös normalizálás: `src/source/text.ts` és a `transcript-refinery/text` export

- A `readTextSource` belseje egy tiszta függvénybe kerül: `normalizeText(bytes: Uint8Array, markdown: boolean): string`. Ebben a sorrendben: UTF-8-dekódolás (`fatal: true`, a BOM lekerül), NUL-bájt-ellenőrzés, sorvégek `\n`-re, `.md`-nél frontmatter-levágás (`stripFrontmatter`), `vaultSafeLinks`, a szélek levágása, ürességellenőrzés. A hibaüzenetek a maiak („a fájl nem UTF-8 szöveg”, „a fájl üres”).
- A `readTextSource` a méretkaput (2 MB) és a beolvasást tartja meg, utána a `normalizeText`-et hívja. A viselkedése nem változik.
- A `textItemId` Web Cryptóra áll (`crypto.subtle.digest('SHA-256', …)`), ami Node-ban és a Workerben is elérhető; ettől aszinkron lesz. A hívója (`textItem`) már ma is aszinkron. Az azonosító értéke nem változik: a meglévő azonosítók (állapottár, sorhorgony) érvényesek maradnak.
- A Node-mentes rész (`normalizeText`, `stripFrontmatter`, `vaultSafeLinks`, `textItemId`, `TEXT_EXTENSIONS`, a 2 MB-os határ értéke) egy modulban él, és a `package.json` `exports`-a `./text` néven adja ki, a `./classify` mintájára.
- **Hatástalanság:** egy már normalizált szövegen a `normalizeText` (`markdown: false`) nem változtat, így az azonosító a második beolvasáskor is ugyanaz.

## 2. A Worker: `worker/src/handle.ts`, `plan.ts`, `messages.ts`, `index.ts`

**Bemenet felismerése** a `handleUpdate`-ben, ebben a sorrendben (a kötés-ellenőrzés és az `update_id`-dedup a mai):

1. `message.document` van → **csatolmány-út.**
   - A kiterjesztés `.txt` vagy `.md` (kis- és nagybetű mindegy), különben: „Csak .txt vagy .md fájlt tudok feldolgozni.”
   - Ha a `file_size` 2 MB fölött van: „A fájl túl nagy: X MB, legfeljebb 2 MB.” Letöltés ilyenkor nincs.
   - Letöltés: `getFile`, majd `https://api.telegram.org/file/bot<token>/<file_path>`. Ha nem sikerül: „A fájlt nem tudtam letölteni, küldd újra.”
   - Az aláírás nem számít.
2. `/scan` (opcionálisan `@botnév`), utána szöveg → **szöveg-út.**
   - Üres `/scan`-re: „Írd a /scan után a szöveget, vagy küldd fájlként.”
   - Ha a `message.text` legalább 3900 karakter, a futás indul, és a visszajelzés mellé ez kerül: „A szöveg elérhette a Telegram-üzenet határát, lehet, hogy csonka. Hosszabb átiratot fájlként küldj.”
3. Különben a mai link-út, változatlanul. A `NO_VIDEO_LINE` csak itt jöhet, csatolmányra soha.

**Azonosító és cím** a beérkezéskor: a Worker a `normalizeText`-tel normalizál (a csatolmánynál `.md`-re `markdown: true`), hibánál a hiba szövegét küldi vissza, és nem ír sort. Ezután `textItemId`. A cím a fenti döntés szerint; a nyelvkód a fájlnévből, ha van, különben a serve dönti el a tartalomból.

**Sor a D1-ben:**
- `jobId = <update_id>:<t-id>`, `videoId = t-id`, `url = ''`, a `title` már most kitöltve.
- Új migráció: `worker/migrations/0005_text.sql`, három nullázható oszloppal: `file_id` (a csatolmányé), `text` (a `/scan` szövege) és `text_lang` (a fájlnévből kapott nyelvkód). A cím a meglévő `title` oszlopba kerül.
- A sor lezárásakor (`ready`, `failed`, `cancelled`) a `text` ugyanabban a mentésben `NULL` lesz.
- A visszajelzés „Sorba került: <cím>”, nem az azonosító. Ha ugyanez a `t-…` már nyitott, a mai „folyamatban” sor jön, és kopogtatás nincs.

**Kopogtatás:**
- A `PlannedKnock` három opcionális mezőt kap: `text` (a normalizált szöveg), `title` és `textLang` (a fájlnévből kapott nyelvkód). Nem `lang`, mert az a fordítás célnyelve a recept-kopogtatásban.
- Az első kopogtatás a már letöltött szöveget viszi.
- A cron-újrapróbálás (`handleCron`) szöveges sornál a `text` oszlopból veszi a szöveget, vagy a `file_id`-ből újra letölti és normalizálja. Ha a letöltés nem sikerül, az a `down`-nal azonos eset: a sor `waiting`, a következő cron újrapróbálja.
- A recept-kopogtatás (`knockFor`) nem viszi a szöveget, mert a serve ekkor már az R2-ből dolgozik.

**Jegyzetlink:** változatlanul `/notes/<videoIdOf(jobId)>/<fajta>`, ami szöveges tételnél `/notes/t-…/<fajta>`.

**Súgó:** a `HELP_TEXT` két sorral bővül: a `.txt`/`.md` csatolmánnyal és a `/scan <szöveg>`-gel. A BotFather-parancslistába a `/scan` kézi lépésként kerül be (a kiadásnál).

## 3. A serve: `src/serve/http.ts`, `job.ts`, `summary.ts`

**Bemenet:** az `isJob` elfogadja az opcionális `text`, `title` és `textLang` mezőt; típushiba esetén `400`, mint ma.

**1. lépés: átvétel** (`runJob`, recept nélkül, `text`-tel). A feliratletöltés párja, yt-dlp nélkül:
- Ha az R2-ben teljes a szöveges pár (`videos/<t-id>/text.txt` nem üres, `info.json` `id`-je egyezik), azonnal `ready` a címmel.
- Különben a serve a `normalizeText`-tel újraellenőrzi a szöveget, és újraszámolja a `textItemId`-t. Ha ez nem egyezik a kopogtatás `videoId`-jével: `failed`, „A szöveg azonosítója nem egyezik.” (a Worker és a serve verzióeltérése ellen).
- Feltöltés a `putWithRetry`-jal két kulcsra: `videos/<t-id>/text.txt` (a normalizált szöveg) és `videos/<t-id>/info.json` (`{ id, title, language? }`, a `language` csak a fájlnévből kapott nyelvkóddal).
- Visszahívás: `ready` a címmel. A visszahívás formája nem változik.

**2. lépés: futás koppintásra** (`runRecipeJob`, `runRecipes`):
- A `loadSummaryPair` a feliratpár mellett a szöveges párt is felismeri, és a `SERVE_OUT`-ba `<sanitizeSegment(cím)> [t-…].<nyelv>.txt` (nyelvkód nélkül `… [t-…].txt`) néven írja ki.
- A `runRecipes` szöveges tételnél a `commandRun`-t `adHoc: { file: <a kiírt fájl> }`-lal hívja. A futás így az A szelet `--file` útja: `format: 'text'`, horgonyzás nélkül, a nyelv a fájlnévből vagy a tartalomból. A költségbecslés, a költségkeret, a write-once, a „már feldolgozva” kihagyás, a riport változatlan.
- A fájlkeresés a `splitSubtitleName`-mel a szöveges kiterjesztést is ismeri.
- A jegyzet útja a `noteFile`-lal ugyanúgy képződik, mint videónál. A vault-commit címe az `info.json`-ból jön, nem a `discoverAll`-ból, mert az a `.txt`-t szándékosan nem veszi fel.
- A jegyzet frontmatterében `item_id: t-…` és `origin: telegram` áll, így a `/notes` olvasó és a jegyzetenkénti vault-commit a meglévő kóddal megy.
- A fordítás (`lang`) külön munka nélkül működik, mert a kész forrásjegyzetből dolgozik.

**Nem változik:** a kapu (`acceptJob`), a `/cancel`, a `/status`, a `/notes`, a titkok. A serve nem kap bot-tokent és D1-hozzáférést.

## 4. Hibakezelés

| Helyzet | Hol derül ki | Válasz |
|---|---|---|
| nem `.txt`/`.md` csatolmány | Worker, letöltés előtt | „Csak .txt vagy .md fájlt tudok feldolgozni.” |
| 2 MB fölött | Worker, `file_size` alapján | „A fájl túl nagy: X MB, legfeljebb 2 MB.” |
| nem UTF-8, NUL-bájt, üres | Worker, normalizáláskor | „a fájl nem UTF-8 szöveg”, „a fájl üres” |
| üres `/scan` | Worker | „Írd a /scan után a szöveget, vagy küldd fájlként.” |
| ≥ 3900 karakteres `/scan` | Worker | a futás indul, mellette a csonkolási figyelmeztetés |
| a Telegram-letöltés nem sikerül | Worker | beérkezéskor: „A fájlt nem tudtam letölteni, küldd újra.”; cron-újrapróbáláskor `waiting`, mint a `down` |
| a serve nem érhető el | Worker | a mai „várakozik” út |
| eltér az azonosító | serve, 1. lépés | `failed`: „A szöveg azonosítója nem egyezik.” |
| ismeretlen nyelv, költségkeret, modellhiba | serve, 2. lépés | a mai `runFailedLine` út |

Csendes kihagyás nincs: minden csatolmányra és `/scan`-re jön válasz.

## 5. Tesztek (megfigyelhető viselkedés)

Mind a Vitest-készletben, hamis Telegrammal, hamis serve-vel, hamis R2-vel és hamis modellklienssel, valós költség nélkül.

**Közös modul** (`src/source/text.test.ts`):
- a `normalizeText` + `textItemId` ugyanazt az azonosítót adja, mint a mai `readTextSource` útja: CRLF, BOM, frontmatter, link;
- egy már normalizált szöveg `.txt`-ként újraolvasva ugyanazt az azonosítót adja;
- a meglévő A szelet tesztjei (azonosítók, sorhorgony) változtatás nélkül zöldek.

**Worker** (`worker/src/handle.test.ts`):
- `.txt`-csatolmány → a D1-ben egy `t-…` sor a címmel, „Sorba került: <cím>”, kopogtatás `text`-tel;
- ugyanaz a fájl más néven, miközben a sor nyitott → „folyamatban”, nincs második kopogtatás;
- `.pdf`, illetve 3 MB-os `.txt` → hibaüzenet, sor és kopogtatás nincs, és a `NO_VIDEO_LINE` sem jön;
- `.md` frontmatterrel → a kopogtatás szövegében nincs frontmatter;
- `/scan szöveg` → a cím az első sor (80 karakterre vágva); üres `/scan` → tipp; 3900 karakteres `/scan` → futás és figyelmeztetés;
- `down` után a cron a D1 `text`-jéből, illetve a `file_id`-ből újra letöltve kopogtat; sikertelen újraletöltés → `waiting`;
- `ready` visszahívás → a `text` oszlop üres, megjönnek a recept-gombok; `failed` és `cancelled` után is üres;
- a kész futás jegyzetlinkje `/notes/t-…/<fajta>`.

**Serve** (`src/serve/job.test.ts`, `src/serve/summary.test.ts`, `src/serve/http.test.ts`):
- szöveges kopogtatás → az R2-ben `text.txt` és `info.json`, yt-dlp-hívás nincs, `ready` a címmel;
- teljes R2-pár → azonnali `ready`, feltöltés nélkül;
- eltérő hash → `failed`, „A szöveg azonosítója nem egyezik.”;
- a recept-futás a `SERVE_OUT`-ba `<cím> [t-…].txt`-t ír; a vaultban megjelenik a jegyzet `item_id: t-…`-vel, időbélyeg nélkül; a `noteUrl` visszajön;
- ugyanaz a szöveg még egyszer → „már feldolgozva”, a hamis kliens hívásszáma nem nő;
- hibás típusú `text` mező → `400`.

**Migráció:** a `0005` után a meglévő sorok és a link-út tesztjei változatlanul zöldek.

## 6. Kiadás és telepítés

A bevált menet szerint:
1. Minor verzió (v1.18.0) és changelog, PR-en át; utána tag.
2. `pnpm docker:publish`, mert a serve kódja változik; a peter-mba konténer frissítése.
3. A D1-migráció (`wrangler d1 migrations apply`), **utána** a Worker-deploy, mert az új Worker-kód az új oszlopokat írja.
4. A `/scan` a BotFather-parancslistába (kézi).
5. Éles próba: egy `.txt` csatolmány és egy `/scan` szöveg, mindkettőből `summary`.

A #206 a B szelet kiadásával és az éles próbával zárható.

## Nyitott pontok a tervhez

- A `transcript-refinery/text` modul neve és a `src/source/text.ts` szétválasztásának pontos határa.
- A Worker és a serve üzenetszövegeinek végleges alakja.
