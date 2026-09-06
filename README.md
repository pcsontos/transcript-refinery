# Transcript Refinery

YouTube-feliratokból strukturált tudásjegyzeteket készít egy Obsidian vaultba.

> **Állapot: a Fázis 1 kész.** A normalizált átiratból modellel készül
> összefoglaló jegyzet a vaultba, korlátos evaluator–optimizer loopban, a
> futás előtt kikényszerített költségplafon alatt. A modellréteg, a
> receptmotor és a mérési harness megvan; a további receptek, a köteges
> feldolgozás és a felület hátravannak. Lásd:
> [`docs/roadmap.md`](<./docs/roadmap.md>).

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
- **Forrásfüggetlen bemenet: egy szerződés, akárhány feliratmappa.** A mag a kész
  `.vtt`/`.srt` fájllal szerződik, és nem érdekli, mi állította elő — letöltő
  eszköz, `whisper.cpp`, `yt-dlp` vagy kézi másolás egyaránt jó
- **A minőségi kapu felirat-forrásonként (szerzői/automatikus) osztályoz**,
  modellhívás nélkül — újratranszkribálás nincs az appban; egy külső eszköz
  kimenete egyszerűen egy újabb feliratforrás
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
| Mi a bemenet? | [A kész feliratfájl](<./docs/decisions/0008-forras-fuggetlen-bemenet.md>) — az előállítója érdektelen |
| Ki tartatja be a költségkeretet? | [Két réteg](<./docs/decisions/0004-koltsegplafon.md>): a LiteLLM keményen, az alkalmazás előzetes becsléssel |
| Groq vagy lokális transzkripció? | [Csak lokális `whisper.cpp`](<./docs/decisions/0005-transzkribalasi-ut.md>) — egy alrendszert takarít meg, és egységes minőségen mér |
| Mivel mérünk? | [Evalite, saját rubrikákkal](<./docs/decisions/0006-eval-stack.md>) — egy idegen is le tudja futtatni |
| Mi az első futtatható szelet? | [Normalizálás vault-írással](<./docs/decisions/0007-elso-szelet.md>), modellhívás nélkül |

## Ami már fut

A `scan` felderíti a konfigurált feliratmappák elemeit — metaadatfájl
nélkülieket is —, és hálózat nélkül kiírja mindegyikhez a forrást, a címet, a
nyers és normalizált szószámot és a felirat-minőséget. A `run` átiratot
készít, és a vault `Inbox/transcript-refinery/<forrás>/` fája alá írja, a
forrásmappa szerkezetét tükrözve: nulla duplikált sor, érvényes frontmatter
metaadat nélkül is, nulla wikilink. Másodszor futtatva nem ír semmit. Sérült feliratfájl nem állítja meg
a futást, a záró riport megnevezi a hibás elemet és az okát. Recept nélkül ez
bit-azonos a Fázis 0 kimenetével — a Fázis 1 ezt nem törte el.

A `run --recipe summary` a normalizált átiratból összefoglaló jegyzetet
készít, korlátos evaluator–optimizer loopban: a modell generál, egy rubrika
pontoz **és konkrét hiányokat nevez meg**, a modell eddig javít, amíg átmegy
vagy elfogy az iterációkeret. A modellek egy LiteLLM gateway mögül jönnek,
szerepet kérve (`draft`, `judge`), nem modellnévvel. A futás előtt kiírt
becslés a megadott plafon felett el sem indul; futás közben a tényleges
token-felhasználásból számolt költés állítja meg a köteget, ha túllépné.
A két kaput mindkét irányból ellenőriztük: mesterségesen alacsony plafonnal a
becslés a futás előtt megállítja a köteget, plafon hiányában pedig a
konfiguráció el sem indul — egyik esetben sincs modellhívás.
A `--dry-run` a fájlírást és az állapotrögzítést hagyja ki, a modellhívást
nem: a generálás és a pontozás valós költséggel lezajlik.

A mérési harness (`pnpm eval`) ugyanezt a loopot futtatja egy determinisztikus
fixture-modellel: kulcs és hálózat nélkül, három szintetikus feliraton fut le,
és mindegyikre valódi pontszámot ír ki. A minőségi kapu precisionje és
recallja is szám formájában mért: mindkettő **1,000** a hét elemű, kézzel
címkézett halmazon, a határeset benne van.

Egy valós vaultban, valós LiteLLM-hívással is ellenőrizve: egyetlen elemre
futtatva elkészül az átirat **és** az összefoglaló jegyzet is ugyanabban a
mappában, a jegyzet frontmatterében a modellel, az iterációszámmal és a
pontszámmal; a futás kiírja az elért pontszámot és a költséget; másodszor
futtatva a recept is „már feldolgozva" státuszt kap, nulla új modellhívással.

Az `evalite` natív függősége (`better-sqlite3`) miatt a telepítéshez C++
fordítói lánc kell: macOS-en az Xcode parancssori eszközei
(`xcode-select --install`), Debian/Ubuntu-n a `build-essential` és a `python3`
csomag. Maga a mérés (`pnpm eval`) ezután API-kulcs és hálózat nélkül fut.

212 teszttel, 29 tesztfájlban — köztük egy Fázis 0-ra írt végponttól
végpontig teszttel, és a fenti, valós adaton mért eredményekkel a Fázis 1-re.

## Beállítás

```bash
cp refinery.config.example.yaml refinery.config.yaml
# írd át benne a vault és a feliratmappák útvonalát
echo "LITELLM_API_KEY=sk-..." > .env   # csak recepthez kell
mise exec -- pnpm build && mise exec -- node dist/cli.js scan
```

Minden beállítás a `refinery.config.yaml`-ból jön; a `--config` kapcsolóval
másik fájl is megadható. Környezeti változó egyetlen értéket hoz, a
`LITELLM_API_KEY`-t — az titok, aminek nincs helye verziókövetett fájlban.

### A minta-korpusz behozatala más gépről

Fejlesztéshez elég a feliratokat és a metaadatot átmásolni; médiafájlt a
csővezeték nem olvas:

```bash
rsync -av --prune-empty-dirs --include='*/' --include='*.info.json' \
      --include='*.srt' --include='*.vtt' --exclude='*' \
      user@gep:/utvonal/feliratok/ ./tmp/feliratok/
```
