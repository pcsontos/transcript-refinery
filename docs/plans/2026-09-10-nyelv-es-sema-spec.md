# Fázis 3 közjáték — a nyelvi sodródás és a sémás kimenet javítása

**Állapot:** a terv jóváhagyva, a dokumentum áttekintésre vár.
Implementációs terv külön dokumentumban.

## A cél

A mérési szelet pilótája — 5 elem, valódi hívások, $0,92 — három hibát talált a
`main`-en. Ez a szelet mindhármat megjavítja, hogy a mérés olyan rendszeren
fusson le, amiről érdemes bármit is állítani.

A sorrend nem esztétikai kérdés. A mai rendszeren lefuttatva a mérés azt a
számot adná, hogy „a javító kör felesleges" — magabiztosan és fordítva, mert a
`flashcards` egyáltalán nem fut le, a bíró minden második hívásnál kiesik, és a
rossz nyelvű jegyzet is 1,00-t kap.

## Kiindulási állapot

### 1. hiba — a sémás kimenet sosem megy ki

A `@ai-sdk/openai-compatible@3.0.43` a `supportsStructuredOutputs` beállítást
alapból **hamisra** veszi (`dist/index.js:447`), és e nélkül a kérés törzsébe
`{ type: "json_object" }` kerül a sémát hordozó `json_schema` helyett
(`dist/index.js:569`). A `createModelClient` (`src/model/client.ts:73`) nem
adja meg a beállítást, tehát a `flashcards` sémája sosem hagyja el a gépet.

Mérhető következmény a pilótán: a `flashcards` **0/5** sikeres futás, és a bíró
— aki szintén sémás kimenetet kér — a hívások nagyjából 40%-ában kiesett.

Az SDK egyébként **szólt**: a `dist/index.js:537` figyelmeztetést tesz a
válaszba („JSON response format schema is only supported with
structuredOutputs"). A produkciós kód a `warnings` mezőt sehol nem olvassa —
csak két teszt fixture-jében fordul elő.

### 2. hiba — a `Channel:` sor elsodorja a kimenet nyelvét

Kontrollált A/B, ugyanaz az angol átirat, ugyanazok a szabályok, ugyanaz a
modell (`claude-sonnet-5`), egyetlen változó a `Channel:` sor tartalma:

| a prompt `Channel:` sora | a válasz nyelve |
|---|---|
| holland személynév | holland (kétszer) |
| `John Smith` | angol |
| nincs `Channel:` sor | angol (kétszer) |

A modell a beszélő nevéből következtet kimeneti nyelvre, és ez **felülírja**
mind az átirat nyelvét, mind a `RULE.language` kifejezett „Do not translate"
szabályát (`src/recipe/rules.ts:13`).

### 3. hiba — semmi nem ellenőrzi a nyelvet

A rubrikában nincs nyelvi kritérium. Egy holland jegyzet angol átiratból
átmegy a formátumkapun, a bíró hűségre és lefedettségre pontozza, 1,00-t kap,
és kikerül a vaultba.

A második és a harmadik hiba **együtt** a rossz: az egyik előállítja a hibás
kimenetet, a másik átengedi.

## 1. A sémás kimenet

`createOpenAICompatible` megkapja a `supportsStructuredOutputs: true`
beállítást. Egy sor.

A bizonyítás nem egy sor. A `createModelClient` opcionális `fetch` paramétert
kap, és a regressziós teszt ezen keresztül elkapja a **kimenő kérést**: a
törzs `response_format.type` mezője `json_schema` kell legyen, a séma pedig
benne. A teszt konzerv választ ad vissza, tehát nulla modellhívásba kerül, és
a mai kódon megbukik.

**Miért a kéréstörzs, és nem a beállítás.** Egy olyan teszt, ami azt állítja,
hogy „a kliens `supportsStructuredOutputs: true`-val hívja a providert", a
konfigurációt ismételné meg, nem a viselkedést írná le. A kéréstörzs az, ami
tényleg elhagyja a gépet.

**A `warnings` mező kimarad** ebből a szeletből. A regressziós teszt ezt a
hibát véglegesen megfogja, és a figyelmeztetések általános vezetékezése
kiszélesítené a szándékosan szűk `ModelClient` felületet — YAGNI, amíg egy
második eset nem indokolja.

## 2. A prompt

**A `Channel:` sor kikerül** mindhárom recept fejlécéből (`summary.ts:35`,
`qa.ts:29`, `flashcards.ts:166`). Ez a bizonyított ok eltávolítása.

A sor elvesztése nem veszteség: a csatornanév nincs benne az átiratban, tehát
már ma is feszül a `RULE.traceable` „Do not add outside knowledge" szabályával,
és semmilyen mérőszám nem tulajdonít neki értéket.

A `Title:` sor **marad**. Az a jegyzet tárgya, és az A/B-ben a `Channel:`
nélküli futás mellette is kétszer angol volt. Egy névvel kezdődő cím elvben
ugyanazt a sodródást okozhatja — ezt a 4. fejezet kapuja fogja meg, nem a
prompt.

**A nyelv kimondása.** A `RULE.language` ma konstans; függvénnyé válik, mert a
megnevezett nyelv elemenként változik:

```
- Write the notes in English. Do not translate the transcript into another language.
```

A nyelv neve az `item.language` mezőből jön — a feliratfájl nevének nyelvi
utótagjából (`.en` → English, `.hu` → Hungarian). Ahol nincs utótag, vagy a tag
ismeretlen, a tartalék **English**.

**Miért a metaadat, és nem a 3. fejezet azonosítója.** A kockázat
aszimmetrikus. Ha az azonosító tévedne, és abból írnánk a promptot, **rossz
nyelvet parancsolnánk**, és a kapu — ugyanazzal a tévedéssel — át is engedné:
néma hiba. A metaadatból írt prompt melletti tévedés csak zajos bukás, amit a
napló megmutat.

A változás mindhárom receptben `const RULES = [...]`-ből `rules(item)`
függvényt csinál. Ez a szelet legszélesebb, de legmechanikusabb módosítása.

## 3. A nyelvazonosító

Új modul: `src/lang/identify.ts`. Egy felelőssége van — megmondani, milyen
nyelvű egy szöveg, és mi a nyelv angol neve.

Nyelvenként nagyjából negyven **funkciószó**; a szöveg szavaira vett találati
arány argmaxa dönt. Latin betűs európai nyelvek: `en`, `hu`, `nl`, `de`, `es`,
`fr`, `it`. A holland azért van a listán, mert a megfigyelt hiba pont az volt.

Két őr, és **ha bármelyik nem teljesül, a válasz `null`** — nem találgatás:

- **találati arány ≥ 0,15** — enélkül a profilon kívüli nyelvek a véletlen
  egyezéseikkel „nyernének"
- **fölény a futam-második fölött ≥ 1,5×** — enélkül a kiegyenlített
  esetek érme feldobásává válnának

**Miért két őr, ha egy is „elég" lenne.** Mert külön eseteket fognak meg. Egy
török mintán a fölény *végtelen* (a második nyelv nulla találat), és csak az
arányőr — 0,040 — állítja meg. Egy négyszavas angol mondaton az arány 0,250,
bőven a küszöb fölött, és csak a fölényőr — 1,00× — állítja meg. Egyik sem
elhagyható; az implementációnak ezt mutációval kell igazolnia.

### Amit a küszöbök megválasztása előtt megmértünk

A számok nem hasraütésből valók. Egy eldobható próba lefutott a **teljes valós
korpuszon** és jegyzet alakú mintaszövegeken:

| minta | eredmény | legkisebb arány | legkisebb fölény |
|---|---|---|---|
| 154 valós átirat | 154/154 `en` | 0,410 | 5,00× |
| 6 jegyzet alakú minta (en, nl, hu, kódnehéz, rövid, kevert) | 6/6 helyes | 0,343 | 2,50× |

És amit a kapunak **nem** szabad megítélnie:

| minta | arány | fölény | ítélet |
|---|---|---|---|
| lengyel (profilon kívül) | 0,027 | 1,00× | nem tudom |
| török (profilon kívül) | 0,040 | ∞ | nem tudom |
| japán (nem latin betűs) | 0,000 | ∞ | nem tudom |
| csak kód | 0,000 | ∞ | nem tudom |
| számok és azonosítók | 0,000 | ∞ | nem tudom |
| négyszavas angol | 0,250 | 1,00× | nem tudom |

A 0,15-ös és 1,5-es küszöb tehát a leggyengébb valódi találat (0,343 / 2,50×)
és a legerősebb hamis jelölt (0,040 / 1,00×) **között** helyezkedik el,
mindkét irányban tartalékkal.

**Az implementációnak újra kell mérnie.** A próba saját szólistákkal futott; a
végleges listák eltérhetnek. A küszöb akkor marad ez, ha a végleges listákkal
is 154/154 a korpusz, és a fenti hat „nem tudom" eset továbbra is `null`.

**A tesztek nem használhatnak korpuszrészletet.** A mintaszövegek a repóba
kerülnek, a korpusz pedig privát. Minden fixture saját írású.

## 4. A nyelvi kapu

Új modul: `src/rubric/language.ts`, blokkoló kritérium a `formatCriterion`
mintájára — sima függvény, nulla token.

A kapu a jegyzet nyelvét **az átirat nyelvéhez** méri. Mindkét szöveg már ma is
a `ScoreContext`-ben van (`rubric/types.ts:15`), tehát nem kell új mező, és a
`refine` loopot nem érinti a változás.

| eset | ítélet |
|---|---|
| bármelyik szöveg `null` | átenged |
| a két nyelv egyezik | átenged |
| a két nyelv eltér | 0 pont, megnevezett hiánnyal |

**Miért az átirathoz, és nem az `item.language`-hez.** Ez pontosan az az
invariáns, amit a szabály kimond — „ugyanaz a nyelv, mint az átiraté" —, és
metaadat nélküli elemen is működik. Az `item.language` a fájlnév utótagja, ami
`null` is lehet; akkor a kapunak nem lenne mihez mérnie.

**Miért enged át, ha nem tudja.** Egy téves „ez más nyelv" ítélet egy helyes
jegyzetet blokkolna, elköltené rá az összes javító kört, és `item:failed`-del
zárná — miközben a jegyzettel semmi baj. A kapu biztonsági háló, nem az egyetlen
ellenőrzés; ahol hallgat, ott a bíró-kritériumok továbbra is pontoznak.

A hiányüzenet **angolul** szól, a `format.ts` konvenciója szerint: visszamegy a
modellnek a javító promptban, tehát a jegyzet nyelvén kell megszólalnia. Meg
kell neveznie mindkét nyelvet — mit írt és mit kellett volna.

A kritérium mindhárom recept rubrikájába bekerül, a formátumkapu után. A
`flashcards` esetében a **renderelt** Markdownra fut, mert a loop onnantól azt
tekinti kimenetnek.

## 5. A füstpróba

**A zöld teszt nem a szelet vége.**

A regressziós teszt azt bizonyítja, hogy `json_schema`-t **küldünk**. Azt nem,
hogy a LiteLLM és a `claude-sonnet-5` `strict: true` mellett **elfogadja**.
Pontosan ez az a fajta állítás, amit a fake-ek eddig elrejtettek — és amiért ez
a szelet egyáltalán létezik.

Ezért a szelet egy néhány centes, **valódi hívásos füstpróbával** zárul: egy
`summary` és egy `flashcards` elem az éles úton. Ez válaszol két kérdésre,
amire teszt nem tud:

1. átmegy-e a séma a gatewayen, vagy `strict` módban elakad
2. angolul jön-e a jegyzet a holland nevű csatornára

A füstpróba eredménye a PR leírásába kerül. **Bukása blokkoló**: a szelet nem
kész, amíg mindkét kérdésre nem tudjuk a választ.

## Megkötések

- Egyetlen teszt sem hív modellt. A füstpróba kézzel indul, a tesztfutáson
  kívül.
- Minden parancs `mise exec --` alatt fut.
- Magyar a dokumentáció, a kódkomment, a felhasználói kimenet és a
  commit-üzenet; **angol** a produkciós azonosító, a prompt és minden hiányüzenet.
- Nincs közvetlen munka a `main` ágon. Az ág: `fix/nyelv-es-sema`.
- A commit-üzenetek nem tartalmaznak attribúciós láblécet.
- Korpuszrészlet nem kerülhet a repóba — sem tesztbe, sem dokumentumba.
- Minden feladat végén zöld: `pnpm test`, `pnpm typecheck`, `pnpm lint`.

## Sikerkritériumok

1. A kimenő kérés törzsében `json_schema` áll, sémával — teszttel rögzítve, ami
   a mai kódon megbukik.
2. Egyik recept promptjában sincs `Channel:` sor, és mindhárom kimondja a
   jegyzet nyelvét.
3. Egy holland jegyzet angol átirathoz **0 pontot** kap, megnevezett hiánnyal;
   egy helyes angol jegyzet átmegy.
4. Az azonosító a hat „nem tudom" eset mindegyikére `null`-t ad, és a valós
   korpusz 154 átiratára `en`-t.
5. Mindkét őr eltávolítása külön-külön megbuktat legalább egy tesztet
   (mutációval igazolva).
6. A füstpróba lefutott, és az eredménye — bármi legyen — le van írva.
7. `docs/decisions/0009` rögzíti a nyelvi kaput: egy blokkoló kapu, ami tartósan
   meg tud buktatni egy elemet, döntés, nem részlet.

## Ami kimarad

- **A `warnings` vezetékezése.** Lásd az 1. fejezet indoklását.
- **A `maxIterations` értéke.** Az a mérés döntése, és a mérés még nem futott le
  (`#16`).
- **A `keyPoints` mező.** A `ScoreContext:21` deklarálja, de egyetlen hívási
  hely sem tölti — halott képesség, önálló kérdés.
- **Több nyelv a profilban.** Hét latin betűs nyelv fedi a korpuszt és a
  megfigyelt hibát. A bővítés akkor jön, ha egy valódi eset kéri.
- **A cím nyelvi hatásának mérése.** A `Title:` marad; ha kiderül, hogy az is
  sodor, az egy következő, mérésre alapozott döntés.
