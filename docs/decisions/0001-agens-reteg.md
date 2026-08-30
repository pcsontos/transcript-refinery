# 0001 — Az ágensréteg: evaluator–optimizer loop

**Dátum:** 2026-08-30 · **Státusz:** elfogadva

## A kérdés

A projekt elsődlegesen portfólió-darab. Ez két ellentétes irányba húz. Egy
hozzáértő olvasó kiszúrja a felfújt megnevezést — és a rendszer őszintén nézve
munkafolyamat, nem ágens: *vedd ki a modellt, tegyél a helyére sablonmotort, és az
architektúra változatlan.* Ugyanakkor ha ez a kirakat-repó, nem mutathat kizárólag
strukturált modellhívásokat, ha ágensi kompetenciát akar demonstrálni.

Ezt nem lehet úgy feloldani, hogy erősebb nevet adunk egy munkafolyamatnak.

## A döntés

Beépül **egy** valódi ágensi lépés: **evaluator–optimizer loop**. A generátor ír
egy vázlatot, egy rubrika pontozza és konkrét hiányokat nevez meg, a generátor
javít — korlátos iterációval, perzisztált revíziókkal. A modell dönti el, hány kör
kell.

A rendszer **nem nevezi magát multi-agentnek.** Egy loop ez, nem raj.

## Elvetett alternatívák

**Nincs ágensi lépés, csak mért munkafolyamat.** A legőszintébb és a legkisebb
scope. Elvetve, mert a repó így semmit nem mutat, ami túlmegy a sémával vezérelt
modellhíváson.

**RAG-alapú kereszthivatkozás** (a jegyzet linkeljen a vault meglévő jegyzeteire:
keresés → ítélet → újabb keresés). Ez a legágensibb opció, valódi eszközhasználati
loopal. Elvetve **a v1-ből**, mert külső, jelenleg nem folyamatosan elérhető
pgvector-alapú tárra épül, karbantartott indexet igényel, és a vault linkelési szabálya
miatt saját relatívútvonal-számítást is. Erős v2-jelölt.

**Mindkettő.** Két alrendszer kockáztatja, hogy egyik sem lesz kész és kimérve.

## Mi döntötte el

Egyetlen tulajdonság, ami a többi opcióban nincs meg: **a rubrika két helyen fut.**
Futásidőben az optimalizáló jele, a méréskor a pontozó. Egy értékelő, két hívási
hely. Így a legmagasabb prioritású munkacsomag (a mérés) és az ágensréteg
**egyetlen befektetés**, nem kettő.

Az ágens-jelleg emellett őszinte: a végrehajtás menetét a modell ítélete vezérli,
nem beégetett kör-szám.

## Következmények

- **Nincs válogató ágens.** A versengő stílusváltozatok modellje elesik: az
  evaluator–optimizer ugyanazt éri el olcsóbban. Ezzel tárgytalanná válik a korábbi
  terv hibás válogató-sémája is (három vázlat be, egyetlen pontszám ki, a győztes
  megnevezése és az indoklás nélkül).
- **A „multi-agent" megnevezés eltűnik** a repóból és a kommunikációból.
- A loop minden iterációjának pontszáma rögzül — ebből mérhetővé válik, hogy
  **segít-e egyáltalán a második kör, és mennyiért.** A nemleges válasz is
  publikálandó eredmény.
