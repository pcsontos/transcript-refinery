# Fázisok

Minden fázis sikerkritériuma **megfigyelhető viselkedés**, nem fájltartalom. Rossz
kritérium: „létezik a normalizáló modul." Jó kritérium: „a parancs lefutása után a
jegyzetben nincs duplikált sor."

Egy szabály végigmegy minden fázison: **recept nem kerülhet be a rubrikája
nélkül.**

## Fázis 0 — Normalizálás és vault-írás, modell nélkül

A teljes függőleges út a modell kivételével. Indoklás:
[`decisions/0007-elso-szelet.md`](<./decisions/0007-elso-szelet.md>).

**Kész, ha:**

- A szkennelő parancs hálózat nélkül kilistázza a korpusz összes elemét
  csatornával, címmel, nyers és normalizált szószámmal, felirat-minőséggel.
- Egyetlen elemre futtatva létrejön a normalizált átirat a helyes vault-mappában:
  **nulla duplikált sor, érvényes frontmatter, nulla wikilink.**
- Ugyanaz a parancs másodszor futtatva **semmit nem ír**, és „már feldolgozva"
  státuszt jelent.
- Tíz elemből egy sérült feliratfájllal: kilenc sikerül, a futás végigmegy, és a
  záró riport **megnevezi a hibás elemet és az okát.**
- A futás után a vault munkafája **tiszta**, és pontosan egy új commit van, ami
  csak a jegyzet-gyűjtemény alá nyúl.

## Fázis 1 — Első recept, LiteLLM-bekötés, mérési harness

**Kész, ha:**

- A mérés egy **friss klónon, kulcs nélkül, offline** lefut a szintetikus
  fixture-ökön, és pontszámokat ír ki.
- A minőségi kapu precisionje és recallja **szám formájában** megjelenik, és a
  határeset benne van a címkézett halmazban.
- Egyetlen elemre futtatva jegyzet készül, aminek a frontmatterében ott a modell,
  az iterációszám és a pontszám.
- Az előzetes becslés a futás **előtt** kiírja a becsült tokent és költséget, és a
  megadott plafon alatt **el sem indul.**

## Fázis 2 — Újratranszkribálás és a backfill

**Kész, ha:**

- Egy automatikus feliratúnak minősített videó újratranszkribálódik, és a
  frontmatter a lokális whispert és a modellnevet jelöli forrásként.
- A 72 videós backfill **felügyelet nélkül, egy éjszaka alatt** lefut; reggel
  riport áll rendelkezésre arról, mennyi sikerült, mennyi nem, és miért.
- A gép újraindítása a köteg közepén **nem veszít munkát**: az újrafuttatás a kész
  elemeket kihagyja.

## Fázis 3 — Több recept és az iteráció megmérése

**Kész, ha:**

- **Egy prózarecept hozzáadása pontosan egy új fájlt érint** — és ezt egy commit
  bizonyítja, ami egyetlen fájlt ad hozzá, és a motorhoz nem nyúl.
- Egy strukturált recept (tanulókártya) érvényes, sémával kikényszerített kimenetet
  termel, a vault által várt sorformátumban.
- **Publikált mérés arról, javít-e a második iteráció, mennyivel, és mennyiért.**
  A nemleges válasz is eredmény: akkor a loop alapból egy körre áll.

## Fázis 4 — URL-adapter

**Kész, ha:**

- Az URL-út **ugyanazt a kimenetet** adja ugyanarra a videóra, mint a mappa-alapú
  út. Ez bizonyítja, hogy a mag forrásfüggetlen.
- Egy playlist-URL kiírja a feloldott darabszámot, és egy küszöb felett
  megerősítést kér, mielőtt bármit letöltene.

## Fázis 5 — Felületek

Ebben a sorrendben:

1. **Obsidian queue-jegyzet** — fájlolvasás és visszaírás, olcsó. A jegyzetbe
   bemásolt URL-eket feldolgozza, és az állapotot visszaírja ugyanoda.
2. **Nuxt-felület** — áttekintő és átnéző réteg, élő haladásjelzéssel a mag
   eseményfolyamából.

A sorrend nem ízlés kérdése: **egy szép felület egy ki nem értékelt csővezeték
fölött pont az ellenkezőjét üzeni annak, amit ez a projekt állít magáról.** A
mérés előbb.

## v2 és utána

Nem befolyásolja a v1 architektúráját:

- **Kereszthivatkozás a vault meglévő jegyzeteire** vektoros kereséssel — ez a
  legágensibb bővítés, és külön pgvector-alapú tárat igényel.
- **Groq Whisper API**, ha valaha szükség lesz rá.
- **A vízvezeték-réteg újraépítése n8n-ben**, tanulási célból és
  őszinte technológiai összehasonlításként: *megépítettem kétszer, itt van, melyik
  mire jó.*
