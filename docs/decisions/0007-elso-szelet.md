# 0007 — Az első futtatható szelet: normalizálás vault-írással, modell nélkül

**Dátum:** 2026-08-30 · **Státusz:** elfogadva

## A kérdés

Mi a legkisebb darab, ami már **valódi hasznot hoz a szerzőnek** és már
**demonstrálható idegennek**? Külön megkötés, hogy az első fázisban ne legyen
modellhívás — a determinisztikus alapot önmagában kell tudni tesztelni.

## A döntés

**A normalizált átirat írja meg magát a vaultba.** Nulla modellhívás, végig
determinisztikus, teljesen unit-tesztelhető — de a kimenete nem riport, hanem egy
fájl, amit tényleg elolvasol.

A szelet a teljes függőleges utat végigjárja a modell kivételével:
forrás-adapter → felirat-értelmezés → metaadat → normalizálás → minőségi kapu →
útvonalszámítás → vault-írás → állapottár.

## Elvetett alternatívák

**Csak mérési riport, vault-írás nélkül.** A legkisebb lehetséges szelet, nulla
kockázat a vaultra. Elvetve: nem hoz napi hasznot — egy riportot nem lehet jegyzet
helyett elolvasni —, és a vault-írás útja tesztelés nélkül maradna a következő
fázisig, pedig ott van a legtöbb ütközési kockázat.

**Végponttól végpontig, egy recepttel.** Járó csontváz a modellel együtt: minden
integrációs pont azonnal bizonyítva. Elvetve: szembemegy azzal, hogy az első fázis
modellmentes legyen, és a determinisztikus alap tesztelése összekeveredne a
nem-determinisztikus rész hibakeresésével.

## Mi döntötte el

Az eredetileg javasolt szelet (csak normalizálás és mérés) a két kritériumból
csak az egyiket teljesítette. A vault-írás hozzávétele **nem növeli érdemben a
scope-ot**, viszont mindkettőt teljesíti:

- **Napi haszon:** a feliratfájl mellett eddig nem volt olvasható szöveg. Ezután
  van egy nagyjából 66%-kal rövidebb, folyamatos, bekezdésekre tört átirat ott,
  ahol keresni szoktál.
- **Demonstrálhatóság:** *bemenet 11 468 szó háromszorosan ismételt feliratsor,
  kimenet 3 939 szó olvasható próza, nulla modellhívás, végig unit-tesztelve* —
  konkrét számokkal, valós korpuszon.

Ráadásul a következő fázist olcsóvá teszi: a receptmotor bekötése egy lépés
beszúrása egy már működő csővezetékbe, nem új integráció.

## Következmények

Ez a szelet kikényszerít három döntést, amit egyébként halogatni lehetne — és
mindhármat jobb korán meghozni:

- **hova ír a vaultban** (a meglévő jegyzet-elrendezésbe, nem külön mappába),
- **hol lakik az állapottár** (a repóban, verziókövetésen kívül, nem a vaultban),
- **mi a git-stratégia** (pull futás előtt; commit és push után, kizárólag a
  ténylegesen írt útvonalakra).
