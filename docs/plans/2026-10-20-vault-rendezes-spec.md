# Spec — Vault és állapottár rendezése: relatív utak, áthelyezett jegyzetek követése, új vault-szerkezet

**Dátum:** 2026-10-20 · **Státusz:** tervezés alatt

Ez a dokumentum a #275, a #276 és a #273 issue közös tervezéséből készült. Ahol ez a spec nem mond mást, a mai viselkedés marad.

## A cél egy mondatban

Az állapottár a vault-jegyzetek útját a vaulthoz képest relatívan tárolja (#275), a vaulton belül átmozgatott jegyzeteket a refinery magától követi (#276), és a jegyzetek videónként egy, configból állítható sablonú mappába kerülnek, a `serve-out/` helyett `telegram/` forrásnév alá (#273).

## Miért ebben a sorrendben

A három szakasz egymásra épül, ezért a kód szakaszonként, ebben a sorrendben készül:

1. **#275 relatív utak.** Enélkül a követés abszolút utakat írna vissza, és a vault költöztetése minden tárolt utat érvénytelenítene.
2. **#276 követés.** Erre épül a #273 migrációja: a meglévő jegyzeteket csak át kell mozgatni, az utakat a következő futás frissíti. Így a #273-nak nem kell saját DB-migráció.
3. **#273 új szerkezet.**

A szakaszok külön kód-PR-ben is mehetnek. Ez a terv kérdése.

## Mért kiinduló állapot (2026-10-20)

- A vaultban 3556 `.md` fájl van. 198 jegyzetben van `item_id` a frontmatterben, mind az `Inbox/transcript-refinery` alatt.
- A teljes vault bejárása a fájlok frontmatterének beolvasásával együtt (Node, egyszálú, a peter-mba-n) **0,55 s**.
- `(item_id, kind)` szerinti duplikátum egyetlen van: a `wjZofJX0v4M` átirata a `transcripts/pinchflat-minta/youtube/3Blue1Brown/` és a `transcripts/youtube/3Blue1Brown/` alatt.
- Az átirat-jegyzetben (`_transcript.md`) **nincs** `recipe` mező, viszont van `language`, ami ott a forrás nyelve, nem fordítás. Fordításnál a `translation_of` és a `language` mező is szerepel (`src/vault/render.ts:133`).
- Az állapottárban nincs séma-verzió. A `src/state/db.ts` csak `CREATE TABLE IF NOT EXISTS` utasításokat tartalmaz.

## Ezen a körön kívül

- Külön `refinery move` parancs (#276).
- Eltűnt jegyzet újragenerálása vagy visszaállítása függőre (#276).
- Vaulton kívülre mozgatott jegyzet követése. A queue-link és a commit-mód a vault-repóhoz kötött.
- A futás-riport és a webes felület bővítése az elmozdult vagy eltűnt jegyzetekkel. Ha szükség lesz rá, külön issue.
- Új metaadatmezők kinyerése az `.info.json`-ból (#273).

## Döntések a tervezésből

| Kérdés | Döntés | Kié |
|---|---|---|
| Hatókör | Egy spec, három szakasz, #275 → #276 → #273 sorrendben. | felhasználó |
| Hol fut a #275 migrációja? | Automatikusan, az állapottár megnyitásakor, `PRAGMA user_version` alapján, egyszer. Előtte `.bak` másolat készül az állapotfájlról. | felhasználó |
| Vegyes állapot (relatív és abszolút sorok) | Megengedett. Az abszolút út változatlanul érvényes, a relatív a `vault.path`-hoz fűződik. A megmaradt abszolút sorokat a #276 követése javítja. | felhasználó |
| Mikor keres a refinery áthelyezett jegyzeteket? | Minden `run` és `watch`-kör elején, kapcsoló nélkül, mert a bejárás 0,55 s. A `scan` csak jelent. | tervező, a mérés alapján |
| Hol jelenik meg a követés eredménye? | Csak a `scan` és a `run` konzolkimenetében. | felhasználó |
| Illesztési kulcs | `(item_id, kind)`. `recipe` nélkül `kind = transcript`, `translation_of` jelenlétében `kind = <recipe>-<language>`, egyébként `kind = <recipe>`. | tervező, a mérés alapján |
| Rögzül-e az elem mappája? | Igen, az első kimenet megírásakor. Ha egy elemnek már van kimenete az állapottárban, a további receptek annak a mappájába kerülnek. A sablon csak új elemre számolódik. | felhasználó |
| A sablon szintje | Globális alapérték, forrásonként felülírható. | felhasználó |
| Fájlnév a mappán belül | Marad `<alapnév><utótag>`, hogy az Obsidianban egyedi legyen. | felhasználó |
| A meglévő jegyzetek | Egyszeri mozgató szkript (`scripts/`), alapértelmezetten próbafuttatással, a végleges utakat a következő `run` követése írja be. A pinchflat-minta duplikátumot előtte kézzel töröljük. | felhasználó |
| A célút szerkezete | `<notesRoot>/<forrásnév>/<sablon>/<alapnév><utótag>`. A forrásnév előtag marad. | tervező, jóváhagyva |
| Sablon-szintaxis | `{mező}` szegmensek `/`-rel elválasztva, pl. `{channel}/{item_id}`. Ismeretlen mezőnév esetén config-hiba induláskor. | tervező, jóváhagyva |
| Forrásnév | Forrásonként megadható `name:` mezővel. Hiánya esetén a mai érték marad, vagyis az útvonal utolsó szegmense. | tervező, jóváhagyva |
| A hash-alapú `itemId` | Továbbra is a **lemezen lévő mappa nevéből** számolódik, nem a `name:`-ből. Ellenkező esetben az átnevezés minden metaadat nélküli elemnek (kézi, felvétel, könyvfejezet, szöveges átirat) új azonosítót adna, és azok újra feldolgozódnának. | tervező |

## 1. szakasz — #275: relatív utak az állapottárban

### Ma

Az `artifacts.path` és a `pending_commits.path` abszolút út, pl. `/Users/peteroncode/github/peteroncode/peteroncode-github-vault/Inbox/transcript-refinery/...`. A lokális állapotfájlban mind a 114 nem üres `artifacts.path` sor ilyen. Ha a `vault.path` megváltozik, egyszerre romlik el:

- a fordítás forrásjegyzetének olvasása (`readSourceNote`, `src/pipeline.ts:176`),
- a webes elemoldal törzse (`readNote`, `src/view/items.ts:169`),
- a queue-link (`doneStatus`, `src/queue/status.ts:48`),
- a félbemaradt commit felvétele (`commitPending`, `src/vault/commit.ts:34`).

### Új viselkedés

- **Írás:** új `artifacts.path` és `pending_commits.path` a `vault.path`-hoz relatív, `/`-elválasztós út.
- **Olvasás:** egyetlen közös feloldó függvény: az abszolút út változatlan, a relatív a `vault.path`-hoz fűződik. Minden felhasználó ezt hívja: a fenti négy hely, és ahol a terv még talál olyat, amely a tárolt utat fájlként nyitja meg.
- A `clearPendingCommits` ugyanazzal a formával töröl, amellyel a sor be lett írva, tehát nem keverheti a relatív és az abszolút alakot.
- **Migráció:** az állapottár megnyitásakor, ha a `user_version` kisebb az új verziónál:
  1. `.bak` másolat készül az állapotfájlról (`<állapotfájl>.bak`, felülírva, ha már van ilyen).
  2. Egy tranzakcióban: ahol az út a jelenlegi `vault.path` alá esik, lekerül róla az előtag. Ami nem esik alá, az marad, és a megnyitás egy sort ír ki róla (darabszám, az első néhány út).
  3. `user_version` emelése.
  - A migrációnak tudnia kell a `vault.path`-t. Ha az állapottárat vault nélkül nyitják meg (pl. egy mérőszkript), a migráció nem fut le, és a `user_version` sem emelkedik.
- Nem változik: az `items.subtitle_path` (a forrásfájlra mutat, vaulton kívül) és az `items.source_file` (már most relatív a forrásmappához).
- A peter-mba `serve` állapotfájlja a következő kiadás első indulásakor ugyanígy átáll.

### Elfogadási feltételek

- A lokális állapotfájl első megnyitása után mellette van egy `.bak`. A 114 sor relatív, és a webes elemoldal, egy fordítás és a queue-link ugyanúgy működik, mint előtte.
- A második megnyitás nem nyúl az állapotfájlhoz, és nem írja felül a `.bak`-ot.
- A vaultot máshova klónozva és csak a `vault.path`-ot átírva a fenti három továbbra is működik, a DB-hez nyúlás nélkül.
- Egy idegen előtagú abszolút sor a migráció után is abszolút marad, a megnyitás kiírja, és olvasáskor továbbra is feloldható, ha a fájl létezik.

## 2. szakasz — #276: áthelyezett jegyzetek követése

### Ma

A kész/kihagyás döntés csak a `status`-t nézi (`isDone`, `src/state/db.ts:199`), ezért egy átmozgatott jegyzet nem okoz hibát és nem generálódik újra. A tárolt útra épülő négy hely (1. szakasz) viszont a régi helyre mutat.

### Új viselkedés

- **Bejárás:** a teljes `vault.path`, a `.git` kivételével. A `.md` fájlok frontmatterét olvassa: `item_id`, `recipe`, `translation_of`, `language`. Frontmatter vagy `item_id` nélküli fájlt kihagy.
- **Kulcs:** `(item_id, kind)`, a döntési táblázat szerint.
- **Összevetés** az állapottár `done` státuszú, nem üres utú `artifacts` soraival:
  - *elmozdult:* a tárolt úton nincs fájl, a kulcs pontosan egy másik helyen megvan;
  - *eltűnt:* a tárolt úton nincs fájl, és a kulcs sehol sincs meg;
  - *ütközés:* a kulcs több fájlban is megvan, és a tárolt úton nincs fájl. Ha a tárolt úton van fájl, a többi példány nem számít ütközésnek, mert a tárolt út érvényes.
- **`scan`:** kiírja az elmozdultakat (`régi út → új út`), az eltűnteket és az ütközéseket. Nem ír semmit, a „nem ír semmit” ígérete marad.
- **`run` és a `watch` köre:** a feldolgozás előtt frissíti az elmozdultak útját (relatívan, az 1. szakasz szerint), és soronként kiírja. Az ütközést és az eltűntet csak kiírja, nem ír rájuk. A frissítés csak az állapottárat érinti, a vaultban nincs mit commitolni.
- A `serve` saját futásai is a feldolgozás előtt követnek, ha a terv ezt egy közös belépési ponton meg tudja oldani. Ha nem, ez a terv nyitott kérdése.
- A `pending_commits` sorait a követés nem módosítja. Egy félbemaradt commit után átmozgatott jegyzetet a commit nem talál, és ezt a mai módon jelzi.

### Elfogadási feltételek

- Egy kész jegyzetet a vaulton belül másik mappába mozgatva a `refinery scan` kiírja az elmozdulást, és nem ír semmit.
- Utána a `refinery run` frissíti az utat: a webes elemoldal újra mutatja a törzset, a queue-link az új helyre mutat, és a jegyzet fordítása lefut.
- Ugyanazt a jegyzetet két helyre másolva, az eredetit törölve a `run` ütközést jelez, és a párt nem írja át.
- Egy átirat (`recipe` nélkül) és egy fordítás (`translation_of`-fal) mozgatása is felismerődik, a forrásnyelvi `language` mező nem téveszti meg az illesztést.

## 3. szakasz — #273: új vault-szerkezet

### Ma

A célút `<notesRoot>/<forrásnév>/<a felirat relatív mappája>/<alapnév><utótag>` (`noteFile`, `src/vault/paths.ts:17`). A forrásnév a `sources:` útvonal utolsó szegmense (`src/config.ts`), a `serve` esetében a `SERVE_OUT` mappa neve (`src/serve/summary.ts:178`), ezért gépfüggő, és ma `serve-out`.

A `noteFile`-t hat hely hívja: `src/pipeline.ts:212`, `:364`, `:456`, `src/cli.ts:588`, `src/queue/done.ts:40`, `src/serve/summary.ts:187`. A `serve/summary.ts` üres metaadattal számol.

### Új viselkedés

**Config:**

```yaml
vault:
  path: /Users/valaki/vault
  notes_dir: Inbox/transcript-refinery
  # Elhagyható; ez az alapértelmezés.
  layout: "{channel}/{item_id}"

sources:
  - /Users/valaki/Downloads/transcripts          # a mai rövid alak marad
  - path: /Users/valaki/books/es6/chapters
    layout: "{item_id}"                           # forrásonkénti felülírás
```

- A `sources:` eleme lehet a mai szöveg, vagy egy `{ path, name?, layout? }` objektum.
- A `serve` forrásneve és sablona a serve configjában állítható be ugyanígy. Alapértelmezetten a forrásnév `telegram`. A pontos hely (env vagy a `serve` config-szakasza) a terv kérdése.
- **Helyettesíthető mezők:** `item_id`, `title`, `channel`, `video_id`, `uploaded`. Ismeretlen mezőnév esetén a program induláskor config-hibával áll meg, és a hibaüzenet felsorolja az ismert mezőket.
- **Hiányzó érték:** ha egy mező nincs meg, vagy üres, vagy csak szóközt tartalmaz, a szegmense kimarad. Pl. `{channel}/{item_id}` `channel` nélkül → `<item_id>/…`. Minden szegmens a meglévő `sanitizeSegment`-en megy át.

**Célút:** `<notesRoot>/<forrásnév>/<kitöltött sablon>/<alapnév><utótag>`. A felirat forráson belüli relatív mappája már nem része az útnak.

**Az elem mappájának rögzítése:**

- Ha az elemnek van legalább egy `artifacts` sora nem üres úttal, az új kimenet ennek a sornak a mappájába kerül (a feloldott tárolt út `dirname`-je). Egyébként a sablon szerint számolódik.
- Ezt a szabályt egyetlen függvény valósítja meg, amelyet az író hely és az összes újraszámoló hely hív. A `serve/summary.ts` commitja a tárolt utakat olvassa, nem számol újra üres metaadattal.
- Ennek mellékhatása, hogy egy régi szerkezetben lévő elem új receptje a régi mappába kerül, amíg a mozgató szkript le nem fut. Ez szándékos: egy elem fájljai egy helyen maradnak.

**A `serve` olvasói:** a `readLocalPair` és a `deleteLocalPair` (`src/serve/inventory.ts`) a felirat-mappát olvassa, nem a vaultot, ezért nem érinti őket a változás. A `/notes` listázó (`scanNotes`, `src/serve/notes.ts:207`) rekurzívan járja be a `notesRoot`-ot, és mappánként csoportosít. A terv ellenőrzi, hogy a videónkénti mappával is helyesen csoportosít-e.

**Mozgató szkript (egyszeri):** `scripts/` alatt.

- Az állapottár `done` soraiból és az elemek metaadatából kiszámolja az új utat a sablon szerint, és kiírja a `régi → új` párokat. Alapértelmezetten csak ennyit tesz.
- `--apply` kapcsolóval mozgat is (`git mv` a vault-repóban, hogy a történet megmaradjon). Ha a célfájl már létezik, a párt kihagyja és kiírja.
- Az állapottárhoz nem nyúl. Az utakat a következő `refinery run` követése (2. szakasz) frissíti.
- A `_queue.md`-t a következő `run` írja újra a frissített utakkal.
- Előfeltétel: a pinchflat-minta duplikátum kézi törlése.

### Elfogadási feltételek

- Egy új, `channel`-lel rendelkező videó jegyzetei a `<notesRoot>/<forrásnév>/<channel>/<item_id>/` mappába kerülnek, `<alapnév><utótag>` néven.
- Egy `channel` nélküli elem (pl. könyvfejezet) jegyzetei a `<notesRoot>/<forrásnév>/<item_id>/` mappába kerülnek.
- A Telegramról indított futás jegyzetei a `telegram/` alá kerülnek, és a `serve` commitja megtalálja őket.
- Egy régi szerkezetben lévő, már feldolgozott elem új receptje a meglévő jegyzetei mellé kerül.
- Egy `{chanel}` elírás esetén a program induláskor hibával áll meg.
- A `name: telegram` beállítása nem változtatja meg a meglévő metaadat nélküli elemek `itemId`-jét: a `refinery run` nem dolgozza fel őket újra.
- A mozgató szkript próbafuttatása semmit sem mozgat. Az `--apply` utáni `refinery run` minden mozgatott jegyzet útját frissíti, és a `scan` utána nem jelez elmozdulást.

## Nyitott kérdések a tervre

- A szakaszok egy vagy három kód-PR-ben menjenek?
- A `serve` követése (2. szakasz) közös belépési ponton megoldható-e?
- A `serve` forrásnevének és sablonjának config-helye.
- A `scanNotes` csoportosítása a videónkénti mappával.
