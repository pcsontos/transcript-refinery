# 0003 — A folder-adapter az első ingest-forrás

**Dátum:** 2026-08-30 · **Státusz:** elfogadva

## A kérdés

Két ingest-út kell, közös feldolgozó maggal: a Pinchflat mappájából felszedett
feliratok, illetve közvetlen URL-ek. Melyik legyen az első?

Egy korábbi következtetés az URL-utat jelölte meg elsőnek, azzal az indokkal, hogy
a mappa-alapú forrásnak nincs adata. **Ez a feltevés megdőlt:** a Pinchflat fut, és
több mint másfélszáz feldolgozható felirat vár. A helyzet megfordult — most a
mappa-alapú útnak van adata, és az URL-útnak nincs.

## A döntés

**A folder-adapter a v1.** Az URL-adapter ugyanerre a magra, egy későbbi fázisban.

## Mi döntötte el

Az URL-út látszólag egyszerűbb, mert nincs benne fájlrendszer-logika. Valójában
viszont hálózatot, `yt-dlp`-hibakezelést és a playlist-feloldás problémáját hozza
be, miközben nincs mit feldolgoznia.

| | folder-adapter | URL-adapter |
|---|---|---|
| van rajta adat | **több mint 150 elem, most** | nincs |
| hálózat kell | nem | igen |
| idempotencia-kulcs | kész, a metaadatfájlból | csak lekérdezés után |
| újratranszkribálás bemenete | a médiafájl helyben | újraletöltés |
| mérési halmaz | **ez maga a korpusz** | – |
| új hibamódok | – | privát videó, nincs felirat, playlist-robbanás |

Egy további megfigyelés, ami a folder-út fő terhelő érvét megszünteti: a Pinchflat
mappanevei vegyes írásmódúak, a vault elrendezése viszont egységes — ez látszólag
csatornanév-normalizálást igényelne. **Nem igényel:** a metaadat forrása nem a
mappanév, hanem a videó melletti metaadatfájl, ami a kanonikus csatornanevet,
a videóazonosítót, az URL-t és a dátumot is tartalmazza. A mappanév csak a fájlok
megtalálására kell.

## Következmények

- A fejlesztés és a tesztelés **offline és determinisztikus** — nincs hálózati
  flakiness a korai fázisokban.
- Az idempotencia-kulcs (a videóazonosító) készen van, fájlnév-értelmezés nélkül.
- A mérési halmaz ugyanabból a korpuszból jön, amin a rendszer fut.
- **A második adapter igazolja visszamenőleg a vágást.** Az ellenőrizhető
  kritérium: az URL-út ugyanarra a videóra ugyanazt a kimenetet adja, mint a
  folder-út.
- A több mint másfélszáz elem első futásra sok. A szűrők (csatorna, darabszám,
  dátum) ezért nem első-futás kényelmi funkciók, hanem **állandó képesség.**
