# 0002 — A dokumentumtípus mint kódmodul

**Dátum:** 2026-08-30 · **Státusz:** elfogadva

## A kérdés

Két összeegyeztethetetlen modell élt a korábbi tervekben: egy videóból négy
különböző dokumentum készül, vagy egy videóból három versengő stílusváltozat,
amiből egy nyer.

A tényleges igény egyik sem: **sokféle dokumentumtípus kell** (tisztított átirat,
összefoglaló, kérdés-felelet, tanulókártya, tanulási útmutató, cikkvázlat), és a
bővítés legyen olcsó.

Ezzel a kérdés átalakult. Nem az a tét, hány típus legyen, hanem **mi a bővítés
egysége.**

## A döntés

Egy dokumentumtípus egy **TypeScript modul** (`*.recipe.ts`), ami egy `Recipe`
objektumot exportál: azonosító, kimeneti fájlnév, publikálhatóság, modellszerep,
prompt, opcionális séma, opcionális renderer, rubrika, iterációs korlát.

Erős alapértelmezésekkel egy prózarecept nagyjából tíz sor, amiből kilenc maga a
prompt.

## Elvetett alternatívák

**Tisztán adatvezérelt: minden recept egy Markdown fájl**, a strukturált kimenet
sémája JSON Schema-ként a frontmatterben. Nulla kód bármilyen új típushoz.
Elvetve: nincs fordítási idejű típusbiztonság, és a renderelés (például
tanulókártya sorformátumba) egy generikus sablonnyelvre szorulna, ami hamar szűk
lesz.

**Hibrid:** prompt és rubrika adatként, séma és renderer opcionális kódként.
Elvetve, bár közel állt — a kétféle betöltési út bonyolultsága nem éri meg a
megspórolt tíz sort.

## Mi döntötte el

Három tulajdonság, amit csak a kódút ad meg:

1. **A promptok komponálhatók és tesztelhetők**, mint bármely más kód.
2. **A mérési harness közvetlenül importálja a rubrikát** — ez az `0001` döntés
   feltétele: ha a rubrika egy betöltési konvenció mögött lakna, a futásidejű loop
   és a mérés két külön igazsággá csúszna szét.
3. **Olvashatóság idegennek.** Egy publikus repóban egy explicit modul
   átláthatóbb, mint egy konvenció alapján felszedett Markdown.

## Következmények

- Új prózatípus hozzáadása **pontosan egy új fájlt** érint, a motorhoz nem kell
  nyúlni. Ez a roadmap egyik ellenőrizhető sikerkritériuma.
- A fordítás nem architekturális kérdés: egy másik nyelvű összefoglaló egyszerűen
  egy újabb recept.
- A `publishable: false` mező a publisher által **kikényszerített invariáns**, nem
  konvenció. Bizonyos típusok soha nem kerülhetnek publikálási útra.
- Attól, hogy hat recept létezik a repóban, még nem fut le hat. Hogy melyik fut,
  futás-szintű kapcsoló; a szállított alapértelmezés konzervatív.
