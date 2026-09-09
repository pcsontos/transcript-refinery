# Fázis 3, második szelet — az iteráció megmérése

**Állapot:** spec, jóváhagyva. Implementációs terv külön dokumentumban.

## A cél

A roadmap Fázis 3 harmadik sikerkritériuma:

> **Publikált mérés arról, javít-e a második iteráció, mennyivel, és mennyiért.**
> A nemleges válasz is eredmény: akkor a loop alapból egy körre áll.

Ez a szelet ezt a mérést építi meg, lefuttatja, publikálja az eredményét, és
**végrehajtja a belőle következő döntést** — akármelyik irányba mutat.

A kérdés empirikus a modell viselkedéséről, tehát valódi modellhívásokkal, a
valós korpuszon kell megválaszolni. Az `evaluation.md` §6 ezt már felteszi;
itt megválaszoljuk.

## Kiindulási állapot

**A meglévő harness nem tudja megválaszolni a kérdést.** A `pnpm eval`
(`evals/summary.eval.ts`) a teljes loopot futtatja, de konzerv fixture-modellen
(`evals/fixture-model.ts:36`): a fixture adja a jegyzeteket **és** a bíró
ítéleteit is. Így a „javít-e a második kör" kérdésre pontosan azt válaszolná,
amit a fixture szerzője beleírt. A harness működését bizonyítja, a modell
viselkedéséről nem mond semmit.

**A privát mérőréteg üres.** Az `evals/private/` gitignore-olt és meg van
tervezve (`evaluation.md` §4), de sosem lett feltöltve. A
`evals/private-layer.ts:15` a hiányát beszédesen kezeli, nem hibaként.

**A loop korán megáll.** A `src/refine/loop.ts:64` küszöb-feltétele és a
`:80` nem-javulási őre miatt az elsőre átmenő elemek **sosem csinálnak második
kört**. Ha csak azt mérnénk, ami magától eljut a javító körig, a válasz a nehéz
elemekre torzulna: „a második kör sokat javít", mert kizárólag ott fut le, ahol
az első gyenge volt.

**A receptek három generálást engednek.** Mindhárom recept `maxIterations: 2`
(`summary.ts:51`, `flashcards.ts:181`, `qa.ts:46`), ami a
`loop.ts:64` ciklusfeltétele mellett **három** generálást jelent, nem kettőt.
A `loop.test.ts` „az iterációkorlát legfeljebb három generálást enged"
tesztje ezt rögzíti.

**A korpusz mért állapota** (a projekt saját becslőjével, nulla modellhívással):

| | |
|---|---|
| elem | 154, egyetlen sérült sem |
| medián / átlag hossz | 3 041 / 3 922 szó |
| szélsőértékek | 569 – 22 477 szó |
| becsült költség, 3 generálás | $0,0615 / elem |

## 1. Motorvarrat — körönkénti nyomvonal

A `refine` két additív bővítést kap.

**`RefineOptions.stopEarly?: boolean`**, alapértelmezés `true`. Hamisra állítva
a loop pontosan `maxIterations + 1` generálást futtat le: sem a küszöb átlépése
(`loop.ts:64`), sem a nem-javulási őr (`loop.ts:80`) nem szakítja meg. A `best`
továbbra is a **legjobb pontszámú** kör marad, nem az utolsó — a mérési mód nem
változtatja meg, mit tekint a rendszer eredménynek.

**`RefineResult.rounds: RoundTrace[]`**, körönként egy bejegyzés:

```ts
export interface RoundTrace {
  score: number
  gaps: number
  usage: ModelUsage
}
```

Mindig kitöltve, produkciós futásban is — a nyomvonal néhány szám, a költsége
nulla, és a futásriport is használhatja később.

**A nyomvonal számokat visz, szöveget nem.** A `gaps` a hiányok *száma*, nem a
listája. Ez nem kényelmi döntés: így semmilyen úton nem kerülhet vault-tartalom
a mérési adatba, és a publikált riport sem tud véletlenül tartalmat kiszivárogtatni.

**A produkciós út viselkedése változatlan.** A `refine` meglévő tesztjei
egyetlen sor módosítása nélkül futnak tovább. Ez a varrat regressziós horgonya:
ha bármelyik elmozdul, a varrat rossz.

## 2. A mérőhalmaz

**Rétegzett minta.** A korpusz 569-től 22 477 szóig terjed; egy találomra vett
húszas minta kihagyhatja a hosszú elemeket, pedig épp ott érdekes a javító kör.
A kiválasztás ezért szóhossz szerinti négy negyedből 5-5 elemet vesz.

**Determinisztikus és rögzített.** A kiválasztott elemazonosítók az
`evals/private/measurement-items.json`-be kerülnek (gitignore-olt). A három
ismétlés és minden későbbi újrafuttatás **ugyanazt a húsz elemet** méri —
enélkül az ismétlések új minták lennének, és a szórásbecslés értelmét vesztené.

**A publikus réteg érintetlen.** A `pnpm eval` továbbra is lefut nulla hívással
a szintetikus fixture-ökön, hogy a harness idegen kézben is működjön.

## 3. A mérés kerete

| | |
|---|---|
| elem | 20, hossz szerint rétegezve |
| ismétlés | 3, elemenként független futás |
| recept | `summary` (próza) és `flashcards` (strukturált) |
| generálás | 3, korai megállás nélkül |
| becsült költség | ≈ $7,4 |

A `qa` recept kimarad: alakja a `summary`-é, a prózaágról ugyanazt mondaná.

**A költségplafonról.** A becsült ≈ $7,4 **fölötte van** a konfiguráció
`cost_limit_usd: 5.00` alapértelmezésének, tehát a mérés a produkciós plafonnal
el sem indulna. Ez nem hiba, hanem a plafon szándéka: a konfig kommentje szerint
„kikényszeríti a szándékos felülbírálást". A mérőfuttató ezért **kötelező
`--budget` kapcsolót** kap, saját plafonnal, és a meglévő költségőrrel
(`src/model/budget.ts:135`) ellenőrzi: a becslés a megadott keret fölött el sem
indul. Alapértelmezett érték nincs — a keretet minden futásnál ki kell mondani.

## 4. Mérőszámok

Nyers adat `(elem, recept, ismétlés)` hármasonként: körönkénti pontszám,
hiányszám, token és költség.

**1. A körök javulása a zajhoz mérve.** Nem elég, hogy a második kör átlaga
magasabb. Ugyanannak az elemnek a három ismétlése között van egy természetes
szórás; ha a körök közti javulás ennél kisebb, akkor a „javulás" nem
megkülönböztethető a zajtól. A riport mindkét számot kiírja, egymás mellett.

**2. A produkciós mentési arány.** Éles futásban a javító kör **csak akkor
indul, ha az első kör megbukott**. A döntés szempontjából tehát az a szám
számít: azokban az esetekben, ahol az első kör a küszöb alatt maradt, hányszor
húzta át a második. Ez más szám, mint az általános átlagjavulás, és ez a döntő.

**3. Költség.** Elemenkénti átlag egy, két és három körrel, és a százalékos
növekmény.

Mindhárom receptenként külön is, mert a prózaág és a strukturált ág eltérhet.

## 5. Előre rögzített döntési szabály

A szabály a futás **előtt** rögzül. Enélkül a számok megnézése után bármelyik
eredmény megmagyarázható, és a mérés önigazolássá válik.

A szabály három mennyiséggel dolgozik, mindegyik pontosan definiálva:

- **Javulás** (`javulas_k`): a `(elem, ismétlés)` párokon vett átlaga annak,
  hogy a *k*-adik kör pontszáma mennyivel magasabb a `k−1`-edikénél.
- **Zajszint** (`zaj`): elemenként vesszük az első kör pontszámának szórását a
  három ismétlés között, majd ezeknek a szórásoknak a **mediánját**. Ez az a
  mérték, amennyit ugyanaz az elem magától ingadozik.
- **Mentési arány** (`mentes_k`): azoknak a `(elem, ismétlés)` pároknak az
  aránya, ahol a `k−1`-edik kör a küszöb alatt maradt **és** a *k*-adik elérte.
  A nevező csak a `k−1`-edik körben megbukott párok száma.

A szabály **receptenként külön** alkalmazandó, mert a `maxIterations` is
receptenkénti érték — a prózaág és a strukturált ág eltérő döntést kaphat:

- Az alapértelmezés **egy generálásra** áll (`maxIterations: 0`), ha
  `javulas_2 < zaj` **és** `mentes_2 < 20%`.
- Ha a második kör átmegy ezen (tehát legalább az egyik feltétel nem teljesül),
  de a harmadikra `javulas_3 < zaj` **és** `mentes_3 < 20%`, akkor az
  alapértelmezés **két generálás** (`maxIterations: 1`).
- Egyébként marad a mai három (`maxIterations: 2`).

A döntés végrehajtása — a receptek `maxIterations` értékének átállítása — **ennek
a szeletnek a része**, nem külön feladat. A roadmap ezt így ígéri.

## 6. A publikált eredmény

`docs/measurements/2026-09-09-iteracio.md`, **kizárólag aggregátumok**: átlagok,
szórások, arányok, költségek. Elemcím, csatornanév, jegyzet-részlet nem kerül
bele — sem a táblákba, sem a példákba.

A dokumentum tartalmazza a mérés korlátait is, köztük azt, hogy **a bíró maga is
nem-determinisztikus**: ugyanannak a kimenetnek két pontozása eltérhet. A három
ismétlés ezt elnyeli, de nem tünteti el, és a riport ezt kimondja.

Az `evaluation.md` §6-ban az ígéret helyére a válasz kerül; a `roadmap.md`
Fázis 3 harmadik kritériuma kipipálódik.

## Megkötések

- **Egyetlen teszt sem hív modellt.** A mérés valódi hívásokat végez, de kézzel
  indítva, a tesztfutáson kívül.
- Minden parancs `mise exec --` alatt.
- Magyar a dokumentáció, a kódkomment, a felhasználói kimenet és a commit-üzenet;
  angol a produkciós azonosító és minden, ami a modellnek megy.
- Nincs közvetlen munka a `main` ágon.
- A privát réteg és a helyi konfiguráció verziókövetésen kívül marad.

## Sikerkritériumok

1. A `refine` produkciós viselkedése változatlan: a meglévő loop-tesztek
   módosítás nélkül futnak.
2. `stopEarly: false` mellett egy elsőre átmenő elem is lefuttatja mind a három
   generálást, és a `rounds` három bejegyzést tartalmaz.
3. A mintavétel kétszer futtatva ugyanazt a húsz elemazonosítót adja, és a négy
   hossz-negyedből 5-5 elemet választ.
4. Az összesítés a „javulás a zaj alatt" esetet is helyesen ítéli meg: erre van
   teszt, szintetikus adattal, modellhívás nélkül.
5. A mérés a költségplafon fölött el sem indul.
6. A publikált riport egyetlen elemcímet, csatornanevet vagy jegyzet-részletet
   sem tartalmaz.
7. A receptek `maxIterations` értéke a döntési szabály szerint áll a szelet
   végén, és a riport receptenként megnevezi, melyik ág teljesült, a három
   mennyiség (`javulas`, `zaj`, `mentes`) kiírt értékével együtt.

## Ami kimarad

- **Modellválasztás.** „Melyik modell éri meg" az `evaluation.md` §6 másik
  kérdése, saját szelet.
- **A `qa` recept mérése.** Alakja a `summary`-é.
- **A futásriport körönkénti megjelenítése.** A nyomvonal rendelkezésre áll
  hozzá, de a riport bővítése nem ennek a szeletnek a dolga.
- **A publikus réteg bővítése.** A három szintetikus fixture marad.
