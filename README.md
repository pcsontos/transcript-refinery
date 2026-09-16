# Transcript Refinery

Kész `.vtt`/`.srt` feliratfájlokból strukturált tudásjegyzeteket készít egy
Obsidian vaultba — mindegy, mi állította elő őket.

> **Állapot: a v1 minden fázisa kész** (Fázis 0–5, ld.
> [`docs/roadmap.md`](<./docs/roadmap.md>)), és folyamatban a Fázis 6 négy új
> receptje. A teljes korpusz felügyelet nélkül végigfut: a futás JSONL naplót
> és Markdown riportot hagy maga után, a költségplafon a tiltás helyett
> szeletel, az átmeneti modellhibát korlátos újrapróbálkozás nyeli el. Négy
> recept van: összefoglaló, tanulókártya, kérdés-felelet és tisztított
> leirat (bekezdésenkénti időbélyeggel); a második iteráció mért haszna
> nemleges, a loop alapból egy körre áll. A feldolgozási sor Obsidianból
> vezérelhető (`scan --queue` / `run --queue`), és van egy csak olvasó
> Nuxt-felület az áttekintéshez és az élő követéshez.

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
| Groq vagy lokális transzkripció? | [Egyik sem](<./docs/decisions/0008-forras-fuggetlen-bemenet.md>): a transzkribálás kívül esik a hatókörön — a lokális `whisper.cpp` melletti [korábbi döntés](<./docs/decisions/0005-transzkribalasi-ut.md>) történeti, ha az eszköz mégis megépül |
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

A `--recipe flashcards` és a `--recipe qa` ugyanezen a motoron fut — a
felvételük egyetlen sort sem változtatott rajta. A kártyarecept nem
sorformátumot kér a modelltől, hanem sémás objektumot, és a vault alakját
(`## kérdés` + bekezdés, az Obsidian Decks plugin szerint) egy renderer
állítja elő: a formátum így nem a modell figyelmén múlik. Egy nulla tokenes
kapu előbb fut, mint a bírók — ismétlődő kérdésnél vagy válasz nélküli
fejlécnél a drága pontozás el sem indul.

A `--recipe clean` a feliratot enyhén szerkesztett, bekezdésekre és `##`
szakaszcímekre tagolt leiratot ad, minden bekezdés előtt a valós elhangzási
idővel (`[MM:SS]`, egy órán túl `[H:MM:SS]`). A modell prózát ír, időbélyeg
nélkül; egy determinisztikus lépés utólag horgonyozza a bekezdéseket a
feliratsorokhoz sorrendtartó illesztéssel, és a bizonytalan illesztés
kivétellel bukik, nem néma rossz időbélyeggel. Egy nulla tokenes hűségkapu
állítja meg a modellt, ha tisztítás helyett összefoglalna.

A feldolgozási sor a válogatást Obsidianba viszi. A `scan --queue` a vault
`_queue.md` jegyzetébe fésüli a felderített videókat, videónként receptenként
egy üres pipával; a `run --queue` a kipipált (videó, recept) párokat dolgozza
fel — egyetlen közös becsléssel és költségplafonnal —, és az eredményt
pontszámmal, költséggel és a jegyzet linkjével ugyanazokba a sorokba írja
vissza. A pipákhoz és a saját sorokhoz nem nyúl, a jegyzetet atomian írja, és
ha nincs mit feldolgozni, nulla modellhívással, commit nélkül fut le.

A felület (`mise exec -- pnpm web`, `http://127.0.0.1:4310`) csak olvas. Az
áttekintő a korpusz állapotát, a pontszámok eloszlását receptenként és a
feldolgozási sort mutatja; az elem oldalán a jegyzet és a normalizált átirat
egymás mellett látszik, a bíró hiánylistájával — így kiderül, *miért* maradt egy
jegyzet a küszöb alatt. Egy CLI-ből indított futás élőben követhető: az éppen
feldolgozott elem, a pontszám és a költés a plafonhoz mérve, SSE-n.

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

668 teszttel, 69 tesztfájlban — köztük egy Fázis 0-ra írt végponttól
végpontig teszttel, és a fenti, valós adaton mért eredményekkel a Fázis 1-re,
valamint a felület e2e-tesztjeivel (15 teszt, 2 fájl).

## Beállítás

```bash
cp refinery.config.example.yaml refinery.config.yaml
# írd át benne a vault és a feliratmappák útvonalát
echo "LITELLM_API_KEY=sk-..." > .env   # csak recepthez kell
pnpm install
pnpm build
```

Minden beállítás a `refinery.config.yaml`-ból jön; a `--config` kapcsolóval
másik fájl is megadható. Környezeti változó egyetlen értéket hoz, a
`LITELLM_API_KEY`-t — az titok, aminek nincs helye verziókövetett fájlban.

## Futtatás

### CLI parancsok

A fordítás (`pnpm build`) után a CLI háromféleképpen hívható, egyenértékűen
— a lenti példák `node dist/cli.js`-t használják, de `pnpm exec refinery` és
`npx refinery` ugyanígy működik (fejlesztés közben közvetlenül:
`npx tsx src/cli.ts`):

```bash
node dist/cli.js scan --queue
pnpm exec refinery scan --queue
npx refinery scan --queue
```

Az utóbbi kettő a `package.json` `bin` mezőjét használja. A csomag
`devDependencies`-ei közt saját magát is felveszi, `workspace:*` verzióval —
enélkül a pnpm egy workspace-gyökér csomag saját bin-jét nem kötné be a
`node_modules/.bin`-be. Az `npx` ugyanezt a helyi `node_modules/.bin/refinery`-t
találja meg; a registryhez nem is fordul, mert a csomag `"private": true`.

#### Felderítés (`scan`)

Kilistázza a konfigurált forrásokból elérhető feliratokat, azok szószámát és becsült minőségét (fájlírás nélkül):

```bash
node dist/cli.js scan
```

A felderített videók összefésülése a vault feldolgozási sorába (`_queue.md`):

```bash
node dist/cli.js scan --queue
```

#### Feldolgozás (`run`)

- **Csak átirat készítése (modellhívás nélkül, ingyenes):**  
  Normalizálja, deduplikálja a feliratot és beírja a vaultba:
  ```bash
  node dist/cli.js run
  ```

- **Recept futtatása LLM-mel (összefoglaló, tanulókártyák, kérdés-felelet):**
  ```bash
  node dist/cli.js run --recipe summary
  node dist/cli.js run --recipe flashcards
  node dist/cli.js run --recipe qa
  ```

- **Feldolgozási sor (`_queue.md`) alapján:**  
  A vault jegyzetében kipipált `[x]` (videó, recept) párok feldolgozása:
  ```bash
  node dist/cli.js run --queue
  ```

- **Gyakori kapcsolók:**
  - `--dry-run`: nem ír fájlt és állapotot (de a modellhívás valós költséggel lefut)
  - `--limit <szám>`: legfeljebb ennyi elem feldolgozása
  - `--source <név>`: szűrés adott forrásmappára
  - `--channel <név>`: szűrés csatornanévre
  - `--retry-failed`: csak a korábban hibára futott elemek újrafuttatása
  - `--force`: a már elkészült jegyzetek felülírása
  - `--no-commit`: nem commitol és nem pushol automatikusan a vault Git repójába

#### Árazás ellenőrzése (`check-pricing`)

Összeveti a konfigurációban beállított árakat a LiteLLM élő díjszabásával:

```bash
node dist/cli.js check-pricing
```

### Webes felület (Web UI)

A Nuxt-alapú, csak olvasási felület áttekintést ad a korpuszról és élőben közvetíti a futásokat:

```bash
# Fejlesztői mód:
pnpm web:dev

# Éles build és indítás:
pnpm web
```

A felület a `http://127.0.0.1:4310` címen érhető el.

### Tesztek és mérések

```bash
pnpm test        # Unit és integrációs tesztek (Vitest)
pnpm eval        # Determinisztikus Evalite mérések szintetikus adaton (offline)
pnpm typecheck   # Típusellenőrzés
pnpm lint        # Linter futtatása
```

### A minta-korpusz behozatala más gépről

Fejlesztéshez elég a feliratokat és a metaadatot átmásolni; médiafájlt a
csővezeték nem olvas:

```bash
rsync -av --prune-empty-dirs --include='*/' --include='*.info.json' \
      --include='*.srt' --include='*.vtt' --exclude='*' \
      user@gep:/utvonal/feliratok/ ./tmp/feliratok/
```
