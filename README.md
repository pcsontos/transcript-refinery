# Transcript Refinery

YouTube-feliratokból strukturált tudásjegyzeteket készít egy Obsidian vaultba.

> **Állapot: tervezési fázis.** Implementáció még nincs — előbb az architektúra
> készül el, és a döntések menet közben rögzülnek. Lásd: [`docs/`](<./docs/>).

## A probléma

A feliratfájl rossz olvasmány. A YouTube gördülő ablakos formátumban szolgálja ki,
ahol minden sor háromszor szerepel; az automatikus feliratozás írásjelek nélkül
érkezik; és egy negyvenperces előadásból tizenegyezer szónyi átirat lesz, amit
senki nem olvas újra.

Ez a projekt olyan jegyzetet csinál belőle, amit érdemes megtartani — és megméri,
mennyire jól csinálja.

## Amit megmértünk

A terv nem feltevéseken áll, hanem egy valós, 153 videós korpusz végigmérésén,
17 csatornáról:

| Megfigyelés | Mit változtatott a terven |
|---|---|
| Minden feliratsor **háromszor** szerepel — a szerzői feliratokban is, nem csak az automatikusakban | A deduplikáció univerzális normalizálási lépés, nem a minőségi ág elágazása. **66%** szöveget vesz le, mielőtt bármilyen modell látná |
| Az írásjel-sűrűség tisztán szétválasztja a felirat-forrásokat: a 100 szavankénti 1,0 és 4,0 írásjel közötti sáv gyakorlatilag üres | A minőségi kapu egyetlen küszöb, nulla modellhívással. A korpusz **47%-a** bizonyult automatikusnak |
| Deduplikáció után: medián **3 041** szó, maximum 22 477 | Minden átirat elfér egy kontextusablakban. A darabolás és map-reduce réteg, amit egy korábbi terv feltételezett, teljesen kimaradt |

## A megközelítés

- **TypeScript**, a modellhívásokhoz a Vercel AI SDK-val
- **A modellek egy LiteLLM gateway mögül** jönnek, ami az útválasztást, a kulcsonkénti
  keretet és az elköltés-követést adja. A gateway felállítása nem tartozik ide —
  a projekt adottnak veszi, hogy elérhető
- **Két ingest-forrás egy munkasor mögött:** a Pinchflat letöltési mappája (ez az
  első) és később egy `yt-dlp`-vel feloldott URL-lista — a mag mindkettőnél ugyanaz
- **Az automatikus feliratok újratranszkribálódnak** lokálisan futó `whisper.cpp`-vel,
  nem kerülnek be nyersen
- **Egyetlen valódi ágensi lépés**, nem raj: egy rubrika pontozza a kimenetet és
  konkrét hiányokat nevez meg, a generátor javít, korlátos iterációval. Ugyanaz a
  rubrika fut a mérésben is
- **A kimenet privát vaultba írt Markdown**, ami soha nem publikálódik
  automatikusan

## A hét döntés, egy mondatban

| Kérdés | Válasz |
|---|---|
| Ágens vagy munkafolyamat? | Egy valódi ágensi lépés — [evaluator–optimizer loop](<./docs/decisions/0001-agens-reteg.md>), felfújt megnevezés nélkül |
| Hogyan bővül új dokumentumtípussal? | [Egy kódmodul](<./docs/decisions/0002-dokumentumtipus-egyseg.md>) típusonként; prózatípusnál kb. tíz sor |
| Melyik ingest-forrás az első? | [A Pinchflat letöltési mappája](<./docs/decisions/0003-ingest-sorrend.md>) — azon van adat, offline és determinisztikus |
| Ki tartatja be a költségkeretet? | [Két réteg](<./docs/decisions/0004-koltsegplafon.md>): a LiteLLM keményen, az alkalmazás előzetes becsléssel |
| Groq vagy lokális transzkripció? | [Csak lokális `whisper.cpp`](<./docs/decisions/0005-transzkribalasi-ut.md>) — egy alrendszert takarít meg, és egységes minőségen mér |
| Mivel mérünk? | [Evalite, saját rubrikákkal](<./docs/decisions/0006-eval-stack.md>) — egy idegen is le tudja futtatni |
| Mi az első futtatható szelet? | [Normalizálás vault-írással](<./docs/decisions/0007-elso-szelet.md>), modellhívás nélkül |

## Még nincs megírva

Telepítés, használat, a mérési harness és maga a kód. Ahogy elkészülnek, ide
kerülnek.
