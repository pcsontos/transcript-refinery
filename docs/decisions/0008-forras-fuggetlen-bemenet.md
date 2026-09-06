# 0008 — A bemenet a kész feliratfájl, semmi más

**Dátum:** 2026-09-05 · **Státusz:** elfogadva ·
**Felülírja:** [0003](<./0003-ingest-sorrend.md>), [0005](<./0005-transzkribalasi-ut.md>)

## A kérdés

A `0003` a Pinchflat letöltési mappáját tette az első ingest-forrássá, és az
idempotencia-kulcsot a videó melletti metaadatfájlból vette. A `0005` egy
lokális `whisper.cpp`-utat írt elő az automatikus feliratú videók
újratranszkribálására, `ffmpeg`-függőséggel. Mindkettő azt feltételezi, hogy az
app tudja, **honnan** jön a felirat, és szükség esetén elő is állítja.

Kell-e ez a tudás a fő értékhez — hogy a feliratból mérhető minőségű jegyzet
legyen?

## A döntés

**Nem kell. Az app egyetlen bemeneti szerződése a kész `.vtt`/`.srt` fájl.**

- A felderítés a feliratfájlokon iterál; a `.info.json` opcionális kiegészítő.
- Az elem azonosítója a metaadat videóazonosítója, ha van; egyébként a
  forrásnév és a forráson belüli alapnév hash-e.
- A feliratot előállító lépés — letöltés, transzkribálás — **kívül van** az
  appon. Ami előáll, az egy újabb forrásmappa.

## Mi döntötte el

**1. A metaadat-feltevés kizárta a bemenetek felét.** A `0003` érve az volt,
hogy a metaadatfájl kanonikus csatornanevet és azonosítót ad, tehát nem kell
fájlnevet értelmezni. Igaz — de ez a feliratot metaadat-függővé tette: egy
kézzel odamásolt vagy whisperrel készült `.srt`, ami mellett nincs
`.info.json`, ma **láthatatlan**. A rendszer a saját céljának a felét zárta ki
egy kényelmi feltevésért.

**2. A transzkribálás más program.** A `0005` gondos elemzés arról, hogyan
transzkribáljunk — de a válasza egy külön futtatható eszköz, nem ennek az
appnak a rétege. `ffmpeg`-függés, médiafájl-olvasás és egy `Transcriber`
absztrakció olyan felületet adna, aminek semmi köze a „feliratból jegyzet"
maghoz. Kívül tartva ugyanaz a whisper-kimenet egyszerűen egy újabb
`sources` mappa.

**3. A célút nem függhet metaadattól.** Ha a vault-beli hely a csatornanévből
és a címből jön, ugyanaz a felirat két helyre kerül aszerint, hogy volt-e
metaadat — és a write-once védelem nem veszi észre a duplikátumot. A
forrásmappa szerkezetének tükrözése ugyanazt a csoportosítást adja, feltevés
nélkül.

## Következmények

- A `PINCHFLAT_DOWNLOADS` helyére a `sources` tömb lép: több feliratmappa,
  forrásonként külön almappával a vaultban.
- A konfiguráció YAML-ba költözik; a `.env`-ben csak a `LITELLM_API_KEY` marad.
- Az állapottár kulcsa `item_id`. **Ha egy elem mellé utólag kerül metaadat,
  az azonosítója megváltozik, és az elem újra feldolgozódik** — tudatos csere a
  beszédes azonosítóért.
- A séma nem migrálódik: egy korábbi (videó-alapú) verzióból maradt
  állapotfájlt törölni kell, a vaultban lévő jegyzetek viszont érintetlenek
  maradnak, mert az állapottár csak a feldolgozottságot tartja nyilván, nem a
  jegyzetek tartalmát.
- A frontmatter mindig elkészül; a metaadat hiánya mezőket vesz el, a
  frontmattert magát nem.
- A `0005` „egyetlen transzkribálási út" döntése **nem hibás, csak nem ide
  tartozik**: ha a whisper-út megépül, külön eszközként épül meg, és a
  kimenete forrásmappaként jön vissza.
- A `Source` absztrakció megmarad; a „két implementációval igazolva" szerepét
  két különböző eredetű forrásmappa tölti be, nem egy URL-adapter.
