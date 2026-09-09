# Spec — Köteges feldolgozás és riport (Fázis 2)

**Dátum:** 2026-09-06 · **Státusz:** jóváhagyásra vár

Ez a dokumentum a [`roadmap.md`](<../roadmap.md>) Fázis 2 szakaszának
specifikációja. Az implementációs terv ebből készül; a végrehajtó mindkettőt
olvassa.

## A cél egy mondatban

A teljes korpusz **felügyelet nélkül, egy éjszaka alatt** menjen végig, és
reggelre álljon rendelkezésre egy riport arról, mennyi sikerült, mennyi nem,
miért, és hány elem készült automatikus, illetve kreátori feliratból.

A Fázis 2 négy sikerkritériuma közül a negyedik — egy külső eszközzel
újratranszkribált felirat új forrásmappaként, kódmódosítás nélkül ugyanazon a
magon megy át — a [`0008`](<../decisions/0008-forras-fuggetlen-bemenet.md>)
utáni refactorral **már teljesül**, és a meglévő e2e teszt fedi. Ez a spec a
maradék hármat célozza.

## Kiindulási állapot

Amit a mai kód tud, és amit nem:

- `src/events.ts:68` — a `summarize()` három számot ad: sikeres, kihagyott,
  hibás. Felirat-forrás szerinti bontás nincs, pedig az adat ott van az
  `item:normalized` eseményben (`src/events.ts:12`).
- `src/cli.ts:143` — az eseményfolyam **egyetlen** fogyasztója a konzol. A futás
  nem hagy nyomot a lemezen: se napló, se riport.
- `src/cli.ts:172` — ha az előzetes becslés meghaladja a plafont, a futás **el
  sem indul** (kilépési kód 2). Egy 153 elemes korpusz a mért ~8 cent/elem
  mellett ~12 $, tehát az 5,00 $-os alapértelmezéssel a köteg indíthatatlan.
- `src/cli.ts:198` — a tényleges költségőr futás közben megállítja a köteget, de
  a felhasználó nem tudja meg, **hány elem maradt** és mivel folytassa.
- `src/pipeline.ts:237` és `:247` — a hiba elemenként elszigetelt, a köteg megy
  tovább. Újrapróbálkozás viszont nincs: egy percnyi gateway-kiesés éjszaka
  tetszőleges számú elemet elvisz.
- `src/state/db.ts` — az állapottár elemenként **már most** tárolja a
  felirat-forrást, a szószámot, a hibaüzenetet, a pontszámot és a költséget. A
  köteg-szintű riporthoz nem kell séma-változtatás, csak olvasó lekérdezés.
- `src/model/client.ts:47` — a `modelClientFrom` közvetlenül hívja a
  `generateText`-et, hibakezelés nélkül.

## 1. Futásnapló — JSONL

- Minden futás egy naplófájlt nyit: `<logs.dir>/<futásazonosító>.jsonl`. A
  futásazonosító a futás kezdetének fájlnév-biztos ISO időbélyege, például
  `2026-09-07T02-14-03`.
- A napló a `RunEvent` folyam **soronként egy JSON objektuma**, szűrés nélkül —
  ugyanaz, amit a konzol renderel, csak veszteség nélkül.
- Minden sor **azonnal kiíródik** (nincs pufferelt lezárás). Ez a napló egyetlen
  létjogosultsága: ha a gép a köteg közepén hal meg, ez marad meg.
- A mag szerződése nem változik: a pipeline továbbra sem ír konzolra és fájlba,
  csak eseményt küld. A naplózó egy második sink a CLI-ben.

## 2. Riport — Markdown, két szinten

A futás végén `<logs.dir>/<futásazonosító>.md` készül, négy szakasszal:

1. **Ez a futás** — sikeres, kihagyott, hibás elemszám, a sikeresek **kreátori /
   automatikus** bontásban, az automatikus feliratból készült elemek
   felsorolásával. Forrása a futás eseményfolyama.
2. **Hibák** — elemenként az azonosító, a forrásmappa neve és az ok.
3. **A korpusz állapota** — forrásmappánként összes / kész / hibás / hátralévő,
   a teljes korpusz kreátori–automatikus bontása, az eddigi futások száma és az
   összköltés. Forrása az **állapottár**, nem a futás: ez az a szakasz, ami egy
   éjszakai újraindítást is túlél, és megfigyelhetővé teszi, hogy nem veszett
   munka.
4. **Következő lépés** — hány elem maradt, és a konkrét parancs, amivel
   folytatható.

- A **konzol nem hízik meg**: a mai záró sor marad, kiegészítve a felirat-forrás
  bontásával és a riportfájl útjával. Aki nézi a futást, ne kelljen Markdownt
  olvasnia.
- **Ctrl+C-re is elkészül a riport**: a SIGINT-kezelő lezárja a naplót, kiírja a
  riportot, és a folyamat kilép. Áramszünetre nem készülhet riport — arra a
  JSONL és a következő futás köteg-szintű szakasza a válasz.
- Recept nélküli (átirat-only) futás is riportot ír; ott a költség- és
  pontszám-mezők egyszerűen kimaradnak.

## 3. Költségplafon — szeletelés, nem tiltás

- A becslés elemenként kumulálódik, és a feldolgozandó lista ott vágódik el, ahol
  a plafon alá még befér. A futás ennyi elemmel indul, a többi a következő
  futásra marad — az állapottár miatt kézi könyvelés nélkül.
- Az eseményfolyam megnevezi a szeletelést: hány elem indul, hány marad, mennyi a
  becsült költség és a plafon.
- **Ha már az első elem becsült költsége meghaladja a plafont**, a futás nem
  indul: kilépési kód 2, és a hibaüzenet megnevezi az adott elem becsült
  költségét és a plafont. Enélkül a felhasználó egy néma „0 elem feldolgozva"
  futást kapna.
- A szeletelt megállás **nem hiba**: kilépési kód 0. Az 1-est továbbra is a hibás
  elemek adják, a 2-est az, ha egyetlen elem sem indulhatott.
- A tényleges költségőr (`guard.exceeded()`) felső korlátnak megmarad: ha a valós
  költés futás közben éri el a plafont, a köteg tisztán megáll, és a riport
  megmondja, hány elem maradt.
- A **modell nélküli átiratkészítés kimarad a szeletelésből** — ott nincs mit
  plafonolni, minden elem feldolgozásra kerül.

## 4. Hibatűrés — korlátos újrapróbálkozás

- Az újrapróbálkozás a **modellhívás** köré kerül, nem az elem köré. Egy elem
  teljes újrafuttatása másodszor is kifizettetné a már sikeres generálásokat.
- Alapértelmezés: legfeljebb 3 kísérlet, exponenciális backoffal (1, 2, 4
  másodperc). Nem konfigurálható — amíg nincs mért igény rá, beégetett érték.
- Az **átmeneti / végleges besorolás külön, tisztán tesztelt függvény.** Átmeneti:
  429, 408, 5xx, és a hálózati hibák (`ECONNRESET`, `ETIMEDOUT`, megszakadt
  kérés). Végleges: minden más 4xx, a séma- és validációs hibák, valamint a
  feliratolvasási hibák — ezek azonnal buknak, újrapróbálkozás nélkül.
- Az újrapróbálkozást a `ModelClient` **dekorátora** végzi, amit a receptfuttatás
  elemenként hoz létre — így az esemény meg tudja nevezni, melyik elemről van
  szó, és a `src/model/client.ts` érintetlen marad.
- Minden újrapróbálkozás eseményt küld (elem, hányadik kísérlet, várakozás, ok),
  tehát a konzolon és a naplóban is látszik.

## 5. Hibás elemek újrafuttatása

- A `--retry-failed` kapcsoló hatására a futás **csak** azokat az elemeket veszi,
  amelyek az adott recepthez hibás státusszal szerepelnek az állapottárban.
- Kombinálható a meglévő `--source`, `--channel` és `--limit` szűrőkkel.
- A kapcsoló attól hasznos, hogy nem futtat végig egy teljes korpuszt azért, hogy
  öt hibás elemhez hozzáérjen — a plafon és az idő így nem megy el a már kész
  elemek átvizsgálására.

## 6. Konfiguráció és takarítás

- Új konfigurációs kulcs: `logs.dir`, alapértelmezése `logs/`, a projekt
  gyökeréhez képest értendő (mint a `state.path`). A `refinery.config.example.yaml`
  kommentelt példát kap.
- A `logs/` bekerül a `.gitignore`-ba, a `.state/` és a `tmp/` mellé: futási
  melléktermék, nem a repó terméke.
- Naplórotáció **nincs**. A régi naplók törlése a felhasználó dolga; amíg nincs
  mért igény, nem építünk rá kódot.
- A `README.md` állapotsora és a `docs/roadmap.md` Fázis 2 szakasza a végén
  frissül; az `architecture.md` megkapja a napló- és riportréteget.

## Megkötések

- **Node `26.2.0`, pnpm `11.24.0`** a `.mise.toml`-ból; minden parancs
  `mise exec --` előtaggal fut.
- **A dokumentáció, a kódkommentek, a commit-üzenetek és a felhasználónak szóló
  kimenetek magyarul.** A kódazonosítók, típusnevek és a conventional commit
  előtagok angolul.
- **TDD:** minden viselkedésváltozás előbb bukó tesztben jelenik meg. A meglévő
  tesztek átírandók, nem törlendők.
- **Az állapottár sémája nem változik** — a Fázis 2 csak olvas belőle. A
  `.state/refinery.db` továbbra is eldobható marad.
- **A `docs/decisions/` és `docs/plans/` korábbi állományait nem írjuk át** —
  történeti feljegyzések.
- A normalizálási, recept-, rubrika- és vault-réteg viselkedése **nem változik**.
- **Nincs párhuzamosság.** Szekvenciálisan a korpusz egy éjszakába belefér, a
  konkurencia viszont rate limitet, szálbiztos költségőrt és összegabalyodott
  haladásjelzést hozna. Ha a mérés később mást mond, külön szelet lesz.

## Sikerkritériumok

Megfigyelhető viselkedés, nem fájltartalom. Mindegyikhez tartozzon teszt:

1. Egy futás után a naplófájl **minden sora önállóan érvényes JSON**, és a hibás
   elem `item:failed` sora szerepel benne.
2. Egy kreátori és egy automatikus feliratú forrásmappán futtatva a riport „Ez a
   futás" szakaszának bontása a tényleges számokat mutatja, és az automatikus
   feliratból készült elem **neve szerepel** a felsorolásban.
3. A köteg közepén megszakított futás után az újrafuttatás a már kész elemekre
   **nulla modellhívást** tesz, és a riport „A korpusz állapota" szakasza a két
   futás **összegét** mutatja.
4. Olyan árazással, amellyel háromból kettő fér a plafon alá: pontosan **két
   elem** dolgozódik fel, a riport **egy** hátralévő elemet jelent, a kilépési
   kód **0**, és az újrafuttatás a harmadik elemmel folytatja.
5. Ha már az első elem becsült költsége a plafon fölött van: egyetlen
   modellhívás sem történik, a kilépési kód **2**, és a hibaüzenet megnevezi az
   elem becsült költségét és a plafont.
6. Két egymást követő 429 után sikeres hívással az elem **elkészül**, pontosan
   **három** modellhívás történt, és a naplóban két újrapróbálkozás-esemény van.
7. 400-as hibára **nincs** újrapróbálkozás: pontosan egy hívás történik, az elem
   hibás lesz, és a riport megnevezi az okot.
8. `--retry-failed`: egy hibás és egy kész elemből **csak a hibás** fut le.
9. Ctrl+C-vel megszakított futás után a napló és a **riport is** a lemezen van,
   és a riport a megszakításig elkészült elemeket tartalmazza.
10. `pnpm test`, `pnpm typecheck` és `pnpm lint` zölden fut.

## Amit ez a szelet szándékosan nem tartalmaz

- Párhuzamos feldolgozás (lásd a megkötéseket).
- Naplórotáció, naplótisztítás.
- Értesítés (e-mail, push) a futás végén.
- A riport vaultba írása — a `logs/` a helye, a vault a jegyzeteké.
- Új recept, a receptmotor bármilyen bővítése — az a Fázis 3.
