# 0009 — A jegyzet nyelvét kimondjuk és ellenőrizzük

**Dátum:** 2026-09-10 · **Státusz:** elfogadva

## A kérdés

Egy angol átiratból holland jegyzet született. A prompt kimondta, hogy „write
in the same language as the transcript. Do not translate", és a modell mégis
fordított.

Kontrollált A/B — ugyanaz az angol átirat, ugyanazok a szabályok, ugyanaz a
modell, egyetlen változó a prompt `Channel:` sora:

| a prompt `Channel:` sora | a válasz nyelve |
|---|---|
| holland személynév | holland (kétszer) |
| `John Smith` | angol |
| nincs `Channel:` sor | angol (kétszer) |

A modell tehát a **beszélő nevéből** következtetett kimeneti nyelvre, és ez
felülírta mind az átirat nyelvét, mind a kifejezett tiltást.

Ráadásul semmi nem fogta meg: a rubrikában nem volt nyelvi kritérium, tehát a
holland jegyzet átment a formátumkapun, 1,00-t kapott a bírótól, és
publikálható lett.

Mi legyen a prompt szerződése a nyelvről, és mi őrizze?

## A döntés

**A `Channel:` sor kikerül a promptból, a jegyzet nyelvét kimondjuk, és egy
determinisztikus, blokkoló kapu ellenőrzi.**

Három rész, és mindhárom kell:

1. a `Channel:` sor eltávolítása mindhárom receptből — a bizonyított ok
2. `- Write in <Nyelv>. Do not translate the transcript into another language.`
   — a nyelv neve az `item.language` fájlnév-utótagból, hiányzó vagy ismeretlen
   tagnál **English**
3. `languageCriterion` — blokkoló kapu, ami a kimenet nyelvét az **átirat**
   nyelvéhez méri, funkciószó-profillal, nulla tokenből

## Mi döntötte el

**1. A tiltó megfogalmazás nem elég erős.** A „same language as the
transcript" arra kéri a modellt, hogy maga állapítsa meg a nyelvet — és épp ez
az, amiben megbízhatatlannak bizonyult. A kimondott nyelvnév nem hagy
következtetnivalót.

**2. A `Channel:` sor amúgy sem volt indokolt.** A csatornanév nincs benne az
átiratban, tehát már a bevezetése óta feszül a saját `traceable`
szabályunkkal („Do not add outside knowledge"), és egyetlen mérőszám sem
tulajdonított neki értéket. A `Title:` sor marad: az a jegyzet tárgya, és az
A/B-ben mellette is kétszer angol volt a válasz.

**3. A kapu bizonytalanságnál átenged, nem buktat.** A funkciószó-profil
`null`-t ad, ha a jel gyenge, és ilyenkor a kapu átengedi a jegyzetet. Egy
téves „ez más nyelv" ítélet ugyanis egy **helyes** jegyzetet buktatna meg,
elköltené rá az összes javító kört, és `item:failed`-del zárná. A kapu
biztonsági háló, nem az egyetlen ellenőrzés — ahol hallgat, a bíró-kritériumok
továbbra is pontoznak.

**4. A prompt a metaadatból veszi a nyelvet, nem a saját azonosítónkból.** A
kockázat aszimmetrikus. Ha az azonosítóból írnánk a promptot, és az téved,
**rossz nyelvet parancsolnánk** — a kapu pedig, ugyanazzal a tévedéssel, át is
engedné: néma hiba. Fordítva a tévedés csak zajos bukás, amit a napló
megmutat.

**5. A kapu az átirathoz mér, nem a metaadathoz.** Ez pontosan az az
invariáns, amit a szabály kimond, és metaadat nélküli elemen is működik. Az
`item.language` a fájlnév utótagja, ami `null` is lehet.

## Következmények

- A rubrika kapui **kétszintűek** lettek: formátum, majd nyelv. Mindkettő
  nulla token, tehát a rossz nyelvű kimenet nem kerül bíró-hívásba.
- A nyelvi hiány visszamegy a javító promptba, angolul, mindkét nyelvet
  megnevezve — egy szám nem tudna javítást vezérelni.
- **Ha egy nyelv nincs a profilban**, a kapu hallgat rá. Ez tudatos: a hét
  latin betűs nyelv fedi a mai korpuszt és a megfigyelt hibát. A bővítés
  akkor jön, ha egy valódi eset kéri.
- A `RULE.language` konstans megszűnt; helyette `languageRule(item)` függvény
  áll, mert a szabály elemenként változik.
