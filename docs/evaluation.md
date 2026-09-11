# Mérés

A mérés ebben a projektben nem kiegészítő, hanem a termék fele. Ez a dokumentum
írja le, mit mérünk, mivel, és min.

A futtató az **Evalite** (Vitest-alapú, lokális); a választás indoklása a
[`decisions/0006-eval-stack.md`](<./decisions/0006-eval-stack.md>)-ben van.

## 1. Három különböző dolog, három különböző módszer

A repónak épp azt a megkülönböztetést kell megtanítania, amit sok projekt
összemos:

| mit | mivel mérjük | modellhívás |
|---|---|---|
| felirat-értelmező, normalizálás, útvonalszámítás, formátum-linter | **unit teszt** — pontos elvárt kimenet, fixture | nincs |
| a minőségi kapu **küszöbe** | **címkézett halmaz** — precision és recall | nincs |
| a receptek kimenete | **eval** — rubrika, részben modell-bíróval | részben |

A középső a legérdekesebb. A kapu maga determinisztikus, de a küszöbérték
**ítélet**, tehát mérni kell. Egy korábbi elemzés épp itt tévedett: a
nagybetű-arányt is bevette a kapuba, és ezzel 40 fájlt önkényesen átsorolt. Egy
címkézett halmaz ezt a hibát elkapja.

## 2. Mit mér a rubrika

Receptenként négy szempont, és **csak az egyik igényel modellt**:

### Formátum-megfelelés — determinisztikus

Érvényes frontmatter, kötelező mezők, kötelező szögletes-zárójeles relatív linkek,
nulla wikilink, előírt szerkezet. Sima függvény, nulla token.

Ez a hibák jelentős részét kiszűri, **mielőtt bármi drága elindulna** — és a
futásidejű optimalizáló loopban is ez ad először visszajelzést.

### Nyelvi megfelelés — determinisztikus

A kimeneti nyelvét az átirat nyelvéhez méri, funkciószó-profillal, nulla
tokenből. Ez a második determinisztikus kapu, és blokkoló: ha az elemzés más
nyelvnek talál egy szöveget, amit az átirat beszél, a jegyzet nem kerül
modell-bíró-hívásba. Lásd [`decisions/0009-nyelvi-kapu.md`](<./decisions/0009-nyelvi-kapu.md>).

### Hűség — modell-bíró, referencia nélkül

Minden állítás visszavezethető-e a feliratra. Nem kell hozzá elvárt kimenet: **a
viszonyítási alap maga az átirat.**

Ez a legfontosabb kritérium, mert a hallucináció itt a legkárosabb hibamód: egy
jegyzet, ami olyat állít, ami nem hangzott el, rosszabb, mint a hiányzó jegyzet.

### Lefedettség — modell-bíró, könnyű referenciával

Megvannak-e a fő pontok. Ehhez kell valami arról, mik a fő pontok.

**Kézzel írt referencia-jegyzeteket szándékosan nem készítünk.** Avulnak, drágák,
és egyetlen ember stílusát emelik igazsággá. Helyette videónként egy
**kulcspont-lista**, egyszer kigenerálva és kézzel javítva — olcsóbb, stabilabb, és
pont annyit rögzít, amennyit a lefedettség mérni akar.

### A bíró modellje

Az értékelő szerep alapból **más modell**, mint a generáló. Ha ugyanaz a modell
pontozza a saját kimenetét, az önpreferencia-torzítás miatt a mérés kevesebbet ér.

## 3. A mérőhalmaz

**Nagyjából 20 elem**, rétegezve, nem véletlenszerűen:

- **felirat-eredet szerint** — szerzői felirat és újratranszkribált egyaránt,
- **hossz szerint** — rövid, medián körüli, és a korpusz leghosszabb darabja,
- **téma szerint** szétterítve a csatornák között,
- **plusz a minőségi kapu határesete**, ami a küszöb elcsúszását hivatott elkapni.

Húsz elem elég egy valódi regresszió kimutatására, és elég kicsi ahhoz, hogy a
kulcspont-listák kézzel gondozhatók legyenek. Percek alatt lefut, tehát tényleg
minden változtatásnál futtatható.

## 4. Két rétegű mérőhalmaz — és miért

A mérőhalmaz **mások feliratai.**

A projekt gondosan végigérvelte, miért nem publikálunk mások videóiból generált
*tartalmat*: származékos mű, és se jogilag, se reputációsan nem éri meg. Húsz
teljes felirat becommitolása egy **publikus** repóba ennél közvetlenebb — szó
szerinti újraközlés. Ugyanaz a logika, erősebb formában.

Ezért a mérőhalmaz két rétegű:

| réteg | mi van benne | verziókövetve |
|---|---|---|
| **publikus** | kézzel írt, szintetikus felirat-fixture-ök | igen |
| **privát** | a valós korpuszból válogatott ~20 elem | nem |

**A publikus réteg** a valós alakzatokat utánozza: háromszorozott sorok, írásjel
nélküli ASR-szöveg, hosszú fájl, strukturált tartalom. Ezen egy idegen lefuttatja
a mérést, és látja, hogy a harness működik, a pontozók futnak, a riport előáll.
Jogilag tiszta.

**A privát réteg** hajtja a tényleges modellválasztást és a regresszió-figyelést.
Lokálisan él, verziókövetésen kívül.

Ez a vágás nem védekezés, hanem a dokumentáció része: egy jogi kérdés az AI-adatok
körül, végiggondolva és leírva.

## 5. Mit ad ez a bemutatáshoz

A rendszer kimenete privát jegyzet, tehát nehéz megmondani, mit lehet egyáltalán
megmutatni. Négy válasz, egyik sem tár fel vault-tartalmat:

1. **A mérőfelület** modell-jelöltek pontszámaival — ez a fő bemutató.
2. **Az előzetes becslés kimenete:** mi futna le, mennyi tokenért, mennyiért.
3. **A normalizálás mért számai** valós korpuszon: 11 468 → 3 939 szó, 66%
   csökkenés, nulla modellhívás. Aggregátum, nem tartalom.
4. **Példakimenetek** a szintetikus fixture-ökből: a jegyzet *alakja*
   megmutatható anélkül, hogy bárki tartalma kikerülne.

## 6. Amit a mérés meg fog válaszolni

Két kérdés, amit a legtöbb hasonló projekt meg sem kérdez, itt viszont számmal
megválaszolható:

- **Segít-e a második iteráció, és mennyiért?** Lemérve: [a mérés](./measurements/2026-09-09-iteracio.md)
  20 elemen, 3 ismétléssel, valódi hívásokkal futott. A `summary`-nál és a
  `flashcards`-nál is nulla volt a zajszint és nulla a megbukott pár — minden
  elem elsőre átment a küszöbön, tehát a második kör javulása és mentési
  aránya egyaránt 0. A javító kör a mai korpuszon és modelleken nem térül
  meg, ezért mindhárom recept (a két mért, és alakja miatt a `summary`
  döntését öröklő `qa`) alapból `maxIterations: 0`-ra áll.
- **Melyik modell éri meg?** A jelöltek ugyanazon a halmazon futnak, és a mért
  hűség és lefedettség dönt, egységnyi költségre vetítve — nem benyomás.
