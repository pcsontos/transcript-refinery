# 0012 — A fordítás a kész jegyzetből készül

**Dátum:** 2026-09-17 · **Státusz:** elfogadva

## A kérdés

A roadmap a Fázis 6 negyedik receptjeként „fordítást fordítási memóriával" vett
fel, a `0002` pedig azt ígérte, hogy a fordítás „nem architekturális kérdés:
egy másik nyelvű összefoglaló egyszerűen egy újabb recept". Azóta bekerült a
`0009` nyelvi kapuja, ami a kimenet nyelvét az átirat nyelvéhez méri. Mit
fordítson a recept, mihez mérjen, és kell-e hozzá fordítási memória?

## A döntés

**Egy általános fordító recept, forrásreceptenként egy példánnyal, amely a
forrásrecept kész jegyzetét fordítja, és ahhoz méri a hűséget.**

- A konfig (`translate.to`, `translate.recipes`) mondja meg, mely receptekből
  készül fordítás; a példányok (`clean-hu`, `summary-hu`…) saját státuszt,
  pipát, költséget és hiánylistát kapnak.
- A bemenet a forrásjegyzet törzse a vaultból, nem az átirat. A rubrika három
  nulla tokenes kapuja — formátum, célnyelv, váz — és egy fordításhűség-bíró
  ehhez mér.
- Hiányzó forrásnál a fordítás kimarad, megnevezett okkal; kéretlen modellhívás
  nincs.
- **Fordítási memória nincs.**

## Mi döntötte el

**1. A mondatpár-memória ezen a korpuszon semmit nem spórolna.** A 19 angol
feliraton a 8 szavas szakaszok 0,16%-a fordul elő más videóban is, és az is egy
csatorna visszatérő videózáró szövege. A szójegyzék haszna a következetesség
lenne; hogy a fordítások ténylegesen következetlenek-e, nem mértük — ezért marad
ki, és ezért nem zárjuk ki.

**2. A forrásjegyzethez mérni pontosabb, mint az átirathoz.** A forrás már
átment a saját rubrikáján; a fordításnak a forrást kell visszaadnia, nem az
átiratot újraértelmeznie. Az időbélyegek, a kártyák és a táblázat így
szerkezetileg összevethetők — egy nulla tokenes kapu megfogja, ha a modell
összevon, kihagy vagy összefoglal.

**3. Az átirathoz mérő kapuk és a horgonyzás nem vihetők át.** A `0009` nyelvi
kapuja egy fordítást definíció szerint megbuktatna, a szöveghűség-kapu angol
szavakat számol, és az időbélyeg-horgonyzás szó szerinti egyezéssel keres vissza
a feliratban.

**4. Forrásreceptenként egy példány, nem egy recept listával.** Az állapottár
kulcsa `(item_id, kind)`, a sorban receptenként egy pipa van. Egy listát kezelő
recept egy státusz-sort adna több fájlhoz, és az állapottárat, a sort és a
riportot is át kellene írni.

## Következmények

- A `0002` „a fordítás nem architekturális kérdés" következménye **nem állt
  meg**: a regiszter a konfig függvénye lett (`recipesFor`), és a futás receptek
  közötti függést kezel — a fordítás a forrása után fut, és hiányzó forrásnál
  kimarad.
- A `RecipeInput.transcript` és a `ScoreContext.transcript` jelentése kibővült:
  a recept bemenő és viszonyítási szövege — fordításnál a forrásjegyzet törzse.
- A forrás újragenerálása után a fordítás nem avul el automatikusan; a
  frontmatter `source_generated_at` mezője mutatja az eltérést, az újrafordítást
  a `--force` kéri.
- A hosszú forrás egy hívásban fordul; a kimenetelét és idejét a
  [kalibrálás](<../measurements/2026-09-17-forditas-kalibralas.md>) rögzíti. A
  kalibrálás egy másik leletet is hozott: mind a négy valódi mintán a
  vázkapu 0-ra buktatta a fordítást, mielőtt a bíró egyáltalán megszólalt volna
  — erről külön issue nyílt
  ([#42](https://github.com/pcsontos/transcript-refinery/issues/42)), ennek a
  szeletnek nem feladata a javítása.
- A vázkapu a [#42](https://github.com/pcsontos/transcript-refinery/issues/42)
  nyomán **tűrő** lett a puha vázelemeken: a bekezdés- és a fejlécszám a forrás
  5%-áig, de legalább egy elemig eltérhet, öt elem alatt viszont nincs tűrés. A
  Bloom-forrású fordításnál a fejléc szigorú marad (`Recipe.headingsAreContent`),
  mert ott egy `##` fejléc egy kártya. Az így átengedett, finomabb hiányokat a
  fordításhűség-bíró fogja — a kapu olcsó szűrő, nem az egyetlen védelem. Spec:
  [`plans/2026-09-18-vazkapu-tolerancia-spec.md`](<../plans/2026-09-18-vazkapu-tolerancia-spec.md>).
- Spec: [`plans/2026-09-17-forditas-spec.md`](<../plans/2026-09-17-forditas-spec.md>).
